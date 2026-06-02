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
        return false;
    }

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
        return false;
    }

    const xrayProcess = exec('./xray -config config.json > xray.log 2>&1');
    xrayProcess.unref();
    execSync('sleep 3');
    return true;
}

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
        
        console.log('等待弹窗和 Cloudflare 验证组件加载...');
        await page.waitForTimeout(10000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证...');
        const captchaSelector = '.cf-turnstile, [class*="cf-turnstile"], #cf-turnstile, [id*="cf-"]';
        const captchaElement = await page.$(captchaSelector);
        
        if (captchaElement) {
            console.log('🎯 成功在 DOM 树中捕捉到原生的 Turnstile 验证组件。');
            const box = await captchaElement.boundingBox();
            if (box) {
                const targetX = box.x + 35; 
                const targetY = box.y + (box.height / 2);
                
                await page.mouse.move(targetX, targetY, { steps: 12 });
                await page.waitForTimeout(200);
                await page.mouse.click(targetX, targetY, { delay: 150 });
                console.log('👉 已成功点击验证码复选框，等待 6 秒让绿勾生成...');
                await page.waitForTimeout(6000);
            }
        }

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        // 【关键修复】人机验证变绿后，点击弹窗里的最终提交/续期按钮
        console.log('第四步：寻找并点击弹窗提交按钮...');
        // 尝试匹配常见的提交按钮文本，如 "Renew", "Submit", "Confirm", "OK" 或者带有 btn-primary 属性的按钮
        let submitBtn = page.locator('.modal-dialog button:has-text("Renew"), .modal-dialog button:has-text("Submit"), .modal-dialog button:has-text("OK")').first();
        
        if (await submitBtn.count() === 0) {
            // 如果找不到特定文本，就找模态框里的主按钮
            submitBtn = page.locator('.modal-dialog .btn-primary, .modal-footer .btn').first();
        }

        if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
            console.log('🚀 检测到确认提交按钮，正在点击以完成续期...');
            await submitBtn.click();
            // 给后端入库留出 10 秒刷新时间
            await page.waitForTimeout(10000);
        } else {
            console.log('ℹ️ 未发现额外的提交按钮，可能绿勾后会自动提交，多等待 5 秒...');
            await page.waitForTimeout(5000);
        }

        await page.screenshot({ path: '4_final_result.png' });

        console.log('第五步：检查续期后的时间状态...');
        const endTime = await extractServerTime(page);
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${endTime}`);

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch(e){}
    }
})();
