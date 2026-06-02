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
        headless: false, 
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
        await addBtn.click();
        console.log('已成功触发点击动作。');
        
        console.log('等待弹窗和 Cloudflare 验证组件加载...');
        await page.waitForTimeout(10000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证（原生指引与动态坐标融合模式）...');
        
        // 针对原生渲染和嵌入式 Turnstile 组件的混合选择器
        const captchaSelector = '.cf-turnstile, [class*="cf-turnstile"], #cf-turnstile, [id*="cf-"]';
        
        // 先看看能不能直接抓到这个原生组件元素
        const captchaElement = await page.$(captchaSelector);
        
        if (captchaElement) {
            console.log('🎯 成功在 DOM 树中捕捉到原生的 Turnstile 验证组件。');
            const box = await captchaElement.boundingBox();
            if (box) {
                // 根据视觉原理，整个验证横条中，勾选方块位于偏左侧大约 30 到 40 像素的位置
                // 咱们通过盒模型算出相对精准的左侧中心坐标
                const targetX = box.x + 35; 
                const targetY = box.y + (box.height / 2);
                
                console.log(`计算得出验证方块精准坐标: [X:${targetX.toFixed(1)}, Y:${targetY.toFixed(1)}]`);
                
                // 模拟真人平滑滑过去，并开火点击
                await page.mouse.move(targetX, targetY, { steps: 12 });
                await page.waitForTimeout(200);
                await page.mouse.click(targetX, targetY, { delay: 150 });
                console.log('精准打击指令已发出。');
            }
        } else {
            console.log('⚠️ 未能找到原生组件类名，启动后备弹窗视觉相对坐标轰炸...');
            // 既然在模态框里，我们获取当前弹窗里那个显示了“Loading...”或者验证区域的大区块位置
            const modalBody = await page.$('.modal-body, [class*="modal-content"]');
            if (modalBody) {
                const mBox = await modalBody.boundingBox();
                if (mBox) {
                    // Turnstile 通常位于 modal 内部靠下的水平居中偏左侧
                    const targetX = mBox.x + (mBox.width / 2) - 110; 
                    const targetY = mBox.y + (mBox.height / 2) + 15;
                    console.log(`通过模态框算出的相对坐标: [X:${targetX}, Y:${targetY}]`);
                    await page.mouse.move(targetX, targetY, { steps: 10 });
                    await page.mouse.click(targetX, targetY, { delay: 120 });
                }
            }
        }

        console.log('等待 15 秒让 Cloudflare 校验完成并写入后端...');
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
