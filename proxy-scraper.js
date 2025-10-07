const fs = require('fs');
const net = require('net');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const dns = require('dns').promises;

const CONFIG = {
    TIMEOUT: 3000,
    MAX_WORKERS: 100,
    OUTPUT_FILE: 'proxy.txt',
    MAX_IP_RANGE: 225,
    PORTS: [80, 8080, 3128, 8888],
    BATCH_SIZE: 1000,
    MIN_PORT: 1,
    MAX_PORT: 65535
};

class ProxyChecker {
    constructor() {
        this.checked = new Set();
        this.liveProxies = [];
        this.isRunning = false;
    }

    async checkProxy(ip, port) {
        const proxyKey = `${ip}:${port}`;
        if (this.checked.has(proxyKey)) return;
        this.checked.add(proxyKey);

        return new Promise((resolve) => {
            const socket = new net.Socket();
            let resolved = false;

            const cleanup = () => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(false);
                }
            };

            socket.setTimeout(CONFIG.TIMEOUT, cleanup);

            socket.on('connect', () => {
                if (!resolved) {
                    resolved = true;
                    this.liveProxies.push(proxyKey);
                    console.log(`[LIVE] ${proxyKey}`.green);
                    socket.destroy();
                    resolve(true);
                }
            });

            socket.on('error', cleanup);
            socket.on('timeout', cleanup);

            socket.connect(port, ip);
        });
    }

    async scanIpRange(startIp, endIp, ports) {
        this.isRunning = true;
        console.log(`[!] Starting proxy scan from ${startIp} to ${endIp}`.cyan);
        
        const startTime = Date.now();
        
        const ips = this.generateIpRange(startIp, endIp);
        console.log(`[+] Generated ${ips.length} IPs to scan`.yellow);

        const workers = [];
        const workerCount = Math.min(CONFIG.MAX_WORKERS, ips.length);
        
        console.log(`[+] Using ${workerCount} workers`.yellow);

        const batchSize = Math.ceil(ips.length / workerCount);
        
        for (let i = 0; i < workerCount; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, ips.length);
            const workerIps = ips.slice(start, end);
            
            if (workerIps.length === 0) continue;
            
            const worker = new Worker(path.join(__dirname, 'proxy-worker.js'), {
                workerData: {
                    ips: workerIps,
                    ports: ports,
                    timeout: CONFIG.TIMEOUT
                }
            });
            
            worker.on('message', (message) => {
                if (message.type === 'live') {
                    this.liveProxies.push(message.proxy);
                    console.log(`[LIVE] ${message.proxy}`.green);
                } else if (message.type === 'progress') {
                    console.log(`[PROGRESS] ${message.checked}/${message.total} checked`.yellow);
                }
            });
            
            worker.on('error', (err) => {
                console.error(`[ERROR] Worker error: ${err.message}`.red);
            });
            
            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`[ERROR] Worker exited with code ${code}`.red);
                }
            });
            
            workers.push(worker);
        }

        await Promise.all(workers.map(worker => {
            return new Promise(resolve => {
                worker.on('exit', resolve);
            });
        }));
        
        await this.saveResults();
        
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`[!] Scan completed in ${elapsed.toFixed(2)} seconds`.cyan);
        console.log(`[+] Found ${this.liveProxies.length} live proxies`.green);
        
        this.isRunning = false;
        return this.liveProxies;
    }

    generateIpRange(startIp, endIp) {
        const ips = [];
        const start = this.ipToLong(startIp);
        const end = this.ipToLong(endIp);
        
        for (let i = start; i <= end; i++) {
            ips.push(this.longToIp(i));
        }
        
        return ips;
    }

    ipToLong(ip) {
        const parts = ip.split('.');
        return (parseInt(parts[0]) << 24) + 
               (parseInt(parts[1]) << 16) + 
               (parseInt(parts[2]) << 8) + 
               parseInt(parts[3]);
    }

    longToIp(long) {
        return [
            (long >>> 24) & 0xFF,
            (long >>> 16) & 0xFF,
            (long >>> 8) & 0xFF,
            long & 0xFF
        ].join('.');
    }

    async saveResults() {
        if (this.liveProxies.length === 0) {
            console.log(`[!] No live proxies found`.red);
            return;
        }

        try {
            await fs.promises.writeFile(
                CONFIG.OUTPUT_FILE,
                this.liveProxies.join('\n') + '\n'
            );
            console.log(`[+] Results saved to ${CONFIG.OUTPUT_FILE}`.green);
        } catch (err) {
            console.error(`[ERROR] Failed to save results: ${err.message}`.red);
        }
    }

    stop() {
        this.isRunning = false;
        console.log(`[!] Scan stopped by user`.yellow);
    }
}

const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const net = require('net');

const { ips, ports, timeout } = workerData;

async function checkProxy(ip, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let resolved = false;

        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(false);
            }
        };

        socket.setTimeout(timeout, cleanup);

        socket.on('connect', () => {
            if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve(true);
            }
        });

        socket.on('error', cleanup);
        socket.on('timeout', cleanup);

        socket.connect(port, ip);
    });
}

async function scanIps() {
    let checked = 0;
    const total = ips.length * ports.length;

    for (const ip of ips) {
        for (const port of ports) {
            if (!parentPort) break;
            
            const isLive = await checkProxy(ip, port);
            
            if (isLive) {
                parentPort.postMessage({
                    type: 'live',
                    proxy: \`\${ip}:\${port}\`
                });
            }
            
            checked++;
            
            if (checked % 100 === 0) {
                parentPort.postMessage({
                    type: 'progress',
                    checked,
                    total
                });
            }
        }
    }
    
    parentPort.postMessage({
        type: 'progress',
        checked,
        total
    });
}

scanIps().catch(err => {
    console.error('Worker error:', err);
    process.exit(1);
});
`;

async function main() {
    try {
        await fs.promises.writeFile('proxy-worker.js', workerCode);
    } catch (err) {
        console.error(`[ERROR] Failed to create worker file: ${err.message}`.red);
        process.exit(1);
    }

    const checker = new ProxyChecker();
    
    process.on('SIGINT', () => {
        console.log('\n[!] Received SIGINT, stopping scan...'.yellow);
        checker.stop();
        process.exit(0);
    });

    try {
        await checker.scanIpRange('0.0.0.0', '225.225.225.225', CONFIG.PORTS);
    } catch (err) {
        console.error(`[ERROR] Scan failed: ${err.message}`.red);
        process.exit(1);
    }
}

if (typeof String.prototype.green === 'undefined') {
    String.prototype.green = function() {
        return `\x1b[32m${this}\x1b[0m`;
    };
}

if (typeof String.prototype.yellow === 'undefined') {
    String.prototype.yellow = function() {
        return `\x1b[33m${this}\x1b[0m`;
    };
}

if (typeof String.prototype.red === 'undefined') {
    String.prototype.red = function() {
        return `\x1b[31m${this}\x1b[0m`;
    };
}

if (typeof String.prototype.cyan === 'undefined') {
    String.prototype.cyan = function() {
        return `\x1b[36m${this}\x1b[0m`;
    };
}

if (require.main === module) {
    main().catch(err => {
        console.error(`[ERROR] Unhandled exception: ${err.message}`.red);
        process.exit(1);
    });
}
