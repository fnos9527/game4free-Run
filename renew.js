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
        execSync('curl -L -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip', { stdio: 'ignore' });
        execSync('unzip -o xray.zip xray', { stdio: 'ignore' });
        execSync('chmod +x xray', { stdio: 'ignore' });
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
    const xrayProcess = exec('././xray -config config.json > xray.log 2>&1');
    xrayProcess.unref();

    execSync('sleep 3');
    console.log('验证代理是否成功畅通...');
    try {
        execSync('curl --socks5-hostname 127.0.0.1:10808 -m 5 https://www.cloudflare.com/cdn-cgi/trace', { stdio: 'ignore' });
        console.log('✅ Xray 代理通道建立成功！');
        return true;
    } catch (e) {
        console.log('⚠️ 代理联通测试失败，尝试继续运作。');
        return true; 
    }
}

// 在全局页面提取时间字符串
async function extractServerTime(page) {
    try {
        const pageText = await page.innerText('body');
        const match = pageText.match(/\d{2}:\d{2}:\d{2}/);
        return match ? match[0] : '无法提取具体数字';
    } catch (e) {
        return '获取失败';
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
            '--disable-blink-features=AutomationControlled'
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

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    
    const page = await context.newPage();

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        
        await page.waitForTimeout(4000);
        const initialTime = await extractServerTime(page);
        console.log(`⏱️ 网页初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) {
            addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        }
        await addBtn.click();
        console.log('已成功触发点击动作。');
        
        // 【关键升级】给弹窗动画留出充足的加载与显现时间
        console.log('等待弹窗和 Cloudflare 验证组件加载中...');
        await page.waitForTimeout(8000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证...');
        
        // 覆盖主流的 Cloudflare iframe 选择标记
        const cfSelector = 'iframe[src*="cloudflare"], iframe[src*="challenges"], iframe[title*="Cloudflare"]';
        
        // 强制确保元素被渲染出来
        await page.waitForSelector(cfSelector, { timeout: 15000 }).catch(() => null);
        
        const cfElement = await page.$(cfSelector);
        if (cfElement) {
            console.log('已精确定位到 Cloudflare 验证框架。');
            
            // 策略 A：直接定位 iframe 内部的复选框区域点击
            const cfFrame = page.frames().find(f => f.url().includes('cloudflare') || f.url().includes('challenge'));
            let clickedInside = false;
            
            if (cfFrame) {
                const innerBox = cfFrame.locator('#challenge-stage, input[type="checkbox"], #rc-anchor-container, .content').first();
                if (await innerBox.count() > 0) {
                    console.log('正在执行内部特定节点穿透点击...');
                    await innerBox.click({ force: true, timeout: 5000 }).catch(() => null);
                    clickedInside = true;
                }
            }
            
            // 策略 B：如果内部节点没点到，对整个容器进行正中心宏观点击（双保险）
            const box = await cfElement.boundingBox();
            if (box) {
                console.log('正在执行容器宏观中心点模拟点击...');
                // 往中心偏左移动一点，完美命中勾选框中心
                await page.mouse.click(box.x + box.width / 2.3, box.y + box.height / 2, { delay: 120 });
            }
            
            console.log('点击指令完全送达，保持挂起状态 15 秒（等待 Cloudflare 响应完成）...');
            await page.waitForTimeout(15000);
            
        } else {
            console.log('⚠️ 依然未能捕获到验证码 iframe，请确认弹窗中是否展示了验证框。');
        }

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查续期后的时间状态...');
        // 再次等待2秒，确保网页上的数据刷新完毕
        await page.waitForTimeout(2000);
        const endTime = await extractServerTime(page);
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${endTime}`);

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch(e){}
    }
})();
