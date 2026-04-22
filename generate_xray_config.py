import os, json, urllib.parse

url = os.environ["VLESS_NODE"]
parsed = urllib.parse.urlparse(url)
params = dict(urllib.parse.parse_qsl(parsed.query))

uuid = parsed.username
host = parsed.hostname
port = parsed.port or 443
security = params.get("security", "none")
net_type = params.get("type", "tcp")
ws_path = urllib.parse.unquote(params.get("path", "/"))
sni = params.get("sni", params.get("host", host))
ws_host = params.get("host", host)

stream = {"network": net_type}

if net_type == "ws":
    stream["wsSettings"] = {
        "path": ws_path,
        "headers": {"Host": ws_host}
    }

if security == "tls":
    stream["security"] = "tls"
    stream["tlsSettings"] = {"serverName": sni, "allowInsecure": False}
elif security == "reality":
    stream["security"] = "reality"
    stream["realitySettings"] = {
        "serverName": sni,
        "fingerprint": params.get("fp", "chrome"),
        "shortId": params.get("sid", ""),
        "publicKey": params.get("pbk", ""),
        "spiderX": params.get("spx", "")
    }

config = {
    "log": {"loglevel": "warning"},
    "inbounds": [{
        "port": 10808,
        "listen": "127.0.0.1",
        "protocol": "socks",
        "settings": {"auth": "noauth", "udp": True}
    }],
    "outbounds": [{
        "protocol": "vless",
        "settings": {
            "vnext": [{
                "address": host,
                "port": port,
                "users": [{"id": uuid, "encryption": "none"}]
            }]
        },
        "streamSettings": stream
    }]
}

with open("xray_config.json", "w") as f:
    json.dump(config, f, indent=2)

print(f"✅ Xray 配置生成成功！{net_type}/{security} → {host}:{port}")
