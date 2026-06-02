const { chromium } = require('playwright');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 启动 Xray 代理中转
function startXrayProxy(vlessLink) {
    if (!vlessLink) {
        console.log('⚠️ 未检测到 MY_VLESS_PROXY 变量，将不使用代理，直接用 GitHub IP 运行。');
        return false;
    }

    console.log('正在下载 Xray-core...');
    try {
        execSync('curl -L -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip', { stdio: 'inherit' });
        execSync('unzip -o xray.zip xray', { stdio: 'inherit' });
        execSync('chmod +x xray', { stdio: 'inherit' });
    } catch (err) {
        console.error('❌ 下载或解压 Xray 失败:', err.message);
        return false;
    }

    console.log('正在解析 VLESS 链接并生成 config.json...');
    try {
        const url = new URL(vlessLink);
        const uuid = url.username;
        const [host, port] = url.host.split(':');
        const params = url.searchParams;

        const config = {
            inbounds: [{
                port: 10808,
                listen: "127.0.0.1",
                protocol: "socks",
                settings: { auth: "noauth", udp: true }
            }],
            outbounds: [{
                protocol: "vless",
                settings: {
                    vnext: [{
                        address: host,
                        port: parseInt(port || "443"),
                        users: [{ id: uuid, encryption: "none" }]
                    }]
                },
                streamSettings: {
                    network: params.get("type") || "tcp",
                    security: params.get("security") || "none",
                    tlsSettings: { serverName: params.get("sni") || host },
                    wsSettings: params.get("type") === "ws" ? { path: decodeURIComponent(params.get("path") || "/") } : undefined
                }
            }]
        };

        fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('❌ 解析 VLESS 链接失败，请检查格式是否正确:', err.message);
        return false;
    }

    console.log('在后台启动 Xray 服务...');
    const xrayProcess = exec('./xray -config config.json > xray.log 2>&1');
    xrayProcess.unref(); // 让它在后台独立运行

    // 等待 3 秒确保端口起来
    execSync('sleep 3');
    console.log('验证代理是否成功畅通...');
    try {
        execSync('curl --socks5-hostname 127.0.0.1:10808 -m 5 https://www.cloudflare.com/cdn-cgi/trace', { stdio: 'inherit' });
        console.log('✅ Xray 代理通道建立成功！');
        return true;
    } catch (e) {
        console.log('⚠️ 代理联通测试失败，可能是节点问题。将尝试继续执行脚本。');
        return true; 
    }
}

(async () => {
    const vlessLink = process.env.MY_VLESS_PROXY;
    // 调用启动代理函数
    const isProxyActive = startXrayProxy(vlessLink);

    const launchOptions = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--blink-settings=imagesEnabled=true']
    };

    if (isProxyActive) {
        console.log('配置 Playwright 浏览器走本地代理: socks5://127.0.0.1:10808');
        launchOptions.proxy = { server: 'socks5://127.0.0.1:10808' };
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        const addBtn = page.locator('text="+ ADD 90 MIN"').first();
        await addBtn.click();
        
        await page.waitForTimeout(5000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证打勾...');
        await page.waitForSelector('iframe[src*="cloudflarechallenge.com"]', { timeout: 10000 }).catch(() => null);
        const cfFrame = page.frames().find(f => f.url().includes('cloudflarechallenge.com'));
        
        if (cfFrame) {
            console.log('发现 Cloudflare 验证框，正在定位点击区域...');
            const checkbox = cfFrame.locator('#challenge-stage, .cb-i, input[type="checkbox"]').first();
            
            if (await checkbox.count() > 0) {
                console.log('成功锁定复选框，正在模拟人工点击...');
                const box = await checkbox.boundingBox();
                if (box) {
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                } else {
                    await checkbox.click({ force: true });
                }
                console.log('点击完成，等待 8 秒让验证生效...');
                await page.waitForTimeout(8000);
            } else {
                console.log('未能锁定内部点击元素。');
            }
        } else {
            console.log('没有检测到验证码 iframe，可能已经直接通过。');
        }

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查时间是否增加...');
        const timerText = await page.locator('text=SERVER TIME REMAINING').locator('xpath=../div').first().innerText().catch(() => '未获取到');
        console.log(`当前服务器剩余时间显示为: ${timerText}`);

    } catch (error) {
        console.error('运行过程中发生异常:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
        // 脚本结束前强行杀死 xray 进程防止残留
        try { execSync('pkill -f xray'); } catch(e){}
    }
})();
