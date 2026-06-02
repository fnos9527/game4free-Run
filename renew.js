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
    const xrayProcess = exec('./xray -config config.json > xray.log 2>&1');
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
        headless: false, // 配合 xvfb 运行真实浏览器
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
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'Europe/Amsterdam'
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
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
        
        // 抓取按钮坐标，为鼠标滑动轨迹做准备
        const btnBounds = await addBtn.boundingBox();
        await addBtn.click();
        console.log('已成功触发点击动作。');
        
        console.log('等待弹窗和 Cloudflare 验证组件加载（增加到12秒缓冲）...');
        await page.waitForTimeout(12000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证（坐标盲点对抗模式）...');
        
        const cfSelector = 'iframe[src*="cloudflare"], iframe[src*="challenges"], iframe[title*="Cloudflare"]';
        const cfElement = await page.$(cfSelector);
        
        if (cfElement) {
            console.log('成功检测到验证组件 DOM，尝试精确制导点击...');
            const box = await cfElement.boundingBox();
            if (box) {
                // 模拟真人平滑移动鼠标到复选框区
                await page.mouse.move(box.x + box.width / 4, box.y + box.height / 2, { steps: 10 });
                await page.mouse.click(box.x + box.width / 4, box.y + box.height / 2, { delay: 150 });
            }
        } else {
            console.log('⚠️ 未在 DOM 树中捕捉到标准 iframe，启动坐标盲补轰炸模式...');
            // 根据 1366x768 屏幕下 Bootstrap 居中弹窗的视觉常理：
            // 弹窗中心通常在 x: 683, y: 384 附近，转圈加载的位置大约在 x: 520~560, y: 320~380 之间
            // 模拟鼠标滑行过去
            if (btnBounds) {
                await page.mouse.move(btnBounds.x, btnBounds.y);
            }
            
            // 尝试在可能渲染验证码复选框的几个中心点区域连续盲点
            const targets = [
                {x: 550, y: 345},
                {x: 535, y: 345},
                {x: 565, y: 345}
            ];
            
            for (const target of targets) {
                console.log(`模拟真人轨迹划向绝对坐标 [X:${target.x}, Y:${target.y}] 并触发点击...`);
                await page.mouse.move(target.x, target.y, { steps: 8 });
                await page.waitForTimeout(200);
                await page.mouse.click(target.x, target.y, { delay: 100 });
            }
        }

        console.log('点击指令完全送达，挂起 15 秒等待后端时间入库...');
        await page.waitForTimeout(15000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查续期后的时间状态...');
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
