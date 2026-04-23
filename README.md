# game4free-Run
cron-job.org触发URL 填：
```
https://api.github.com/repos/fnos9527/game4free-Run/actions/workflows/renew.yml/dispatches
```
Header 加：

Authorization: Bearer 你的GitHub_Token

Content-Type: application/json

Body 填：
```
{"ref":"main"}
```

流程图
```
每天凌晨0点(定时触发) 或 手动触发
         ↓
1. 检出代码 (把仓库文件下载到运行环境)
         ↓
2. 安装 xvfb (虚拟显示器，让无头服务器能跑Chrome)
         ↓
3. 下载 Xray + 解析你的VLESS节点 → 在本地启动SOCKS5代理
   目的：让Chrome的流量通过你的代理出去
   避免：GitHub Actions的IP被Google/目标网站封锁
         ↓
4. 下载 Buster插件
   目的：自动破解 reCAPTCHA 图片验证码
         ↓
5. 安装Python + 依赖 + ChromeDriver
         ↓
6. 执行 renew.py 核心脚本：
   ├─ 打开 game4free.net/my-game
   ├─ 输入用户名 ae86
   ├─ 点击 reCAPTCHA 复选框
   │   ├─ 如果直接绿勾通过 → 继续
   │   └─ 如果弹出图片验证码 → Buster自动语音识别破解
   ├─ 点击 Complete Verification (如果需要)
   ├─ 等待按钮变成 Renew
   ├─ 点击 Renew
   └─ 确认出现 "The server has been renewed."
         ↓
7. 上传截图到 Artifacts (成功或失败都保存，方便排查)
```

唯一变量Secret名称
VLESS_NODE

示例值
vless://uuid@your-server.com:443?encryption=none&security=tls&type=ws&path=%2Fpath&host=your-server.com#MyNode

