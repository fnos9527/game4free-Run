# game4free-Run
思路是：VLESS节点 → 用 xray 在本地转换为 SOCKS5 → Python脚本使用本地SOCKS5
GitHub Actions Runner
    ↓
xray-core 监听 127.0.0.1:10808 (SOCKS5)
    ↓
VLESS 节点 (你的服务器)
    ↓
Google reCAPTCHA

Secret名称
VLESS_NODE

示例值
vless://uuid@your-server.com:443?encryption=none&security=tls&type=ws&path=%2Fpath&host=your-server.com#MyNode

