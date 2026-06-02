const { chromium } = require('playwright');
const { exec, execSync } = require('child_process');
const fs = require('fs');

// 启动 Xray 代理中转
function startXrayProxy(vlessLink) {
    if (!vlessLink) {
        console.log('⚠️ 未检测到 MY_VLESS_PROXY 变量，将不使用代理运行。');
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
        console.error('❌ 换算配置失败:', err.message);
        return false;
    }

    console.log('在后台启动 Xray 服务...');
    const xrayProcess = exec('./xray -config config.json > xray.log 2>&1');
    xrayProcess.unref();

    execSync('sleep 3');
    console.log('验证代理是否成功畅通...');
    try {
        execSync('curl --socks5-hostname 127.0.0.1:10808 -m 5 https://www.cloudflare.com/cdn-cgi/trace', { stdio: 'inherit' });
        console.log('✅ Xray 代理通道建立成功！');
        return true;
    } catch (e) {
        console.log('⚠️ 代理联通测试失败，尝试继续运作。');
        return true; 
    }
}

(async () => {
    const vlessLink = process.env.MY_VLESS_PROXY;
    const isProxyActive = startXrayProxy(vlessLink);

    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--blink-settings=imagesEnabled=true',
            '--disable-infobars'
        ]
    };

    if (isProxyActive) {
        console.log('配置 Playwright 浏览器走本地代理: socks5://127.0.0.1:10808');
        launchOptions.proxy = { server: 'socks5://127.0.0.1:10808' };
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'Europe/Amsterdam'
    });
    
    const page = await context.newPage();

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        
        // 稍微等待确保数字完全显示
        await page.waitForTimeout(3000);
        // 通过寻找包含文本的元素来确保准确定位
        const initialTime = await page.locator('text=SERVER TIME REMAINING').locator('xpath=../div').first().innerText().catch(() => '未知');
        console.log(`网页初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        
        // 分级、安全的独立定位器策略：先尝试最直接的文本点击
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) {
            // 如果不可行，寻找普通的包含该文本的按钮
            addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        }
        
        await addBtn.click();
        console.log('已成功触发点击动作。');
        
        await page.waitForTimeout(6000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证打勾...');
        await page.waitForSelector('iframe[src*="cloudflare"]', { timeout: 15000 }).catch(() => null);
        
        const allFrames = page.frames();
        const cfFrame = allFrames.find(f => f.url().includes('cloudflare') && f.url().includes('turnstile')) || allFrames.find(f => f.url().includes('challenges'));
        
        if (cfFrame) {
            console.log('成功捕获到 Cloudflare 校验帧，开始探测点击热区...');
            // 分立合法选择器，避免合并使用特殊 token
            let checkbox = cfFrame.locator('#challenge-stage').first();
            if (await checkbox.count() === 0) {
                checkbox = cfFrame.locator('input[type="checkbox"]').first();
            }
            
            if (await checkbox.count() > 0) {
                console.log('锁定验证方框，执行真人跨域点击模拟...');
                await checkbox.click({ force: true, delay: 150 });
                console.log('指令已发送，保持等待 10 秒等待验证闭环...');
                await page.waitForTimeout(10000);
            } else {
                console.log('未能提取到有效的 checkbox 点击点。');
            }
        } else {
            console.log('未检测到验证框架，可能已被代理 IP 直接放行。');
        }

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查续期后的时间状态...');
        const endTime = await page.locator('text=SERVER TIME REMAINING').locator('xpath=../div').first().innerText().catch(() => '获取失败');
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${endTime}`);

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch(e){}
    }
})();
