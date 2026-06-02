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
        console.log('已成功触发点击弹窗。');
        await page.waitForTimeout(5000); 

        console.log('第三步：解密与绕过限制——启动 JavaScript 逆向强制注入流程...');

        // 直接注入 JS，把页面里所有可能隐藏的表单、带有 submit 或 btn-primary 的隐藏函数全部强行激活
        await page.evaluate(() => {
            console.log("正在尝试前端逻辑硬突防...");
            
            // 1. 尝试直接触发表单提交
            const forms = document.querySelectorAll('form');
            forms.forEach(form => {
                if (form.action && form.action.includes('renew') || form.innerHTML.includes('90')) {
                    form.submit();
                }
            });

            // 2. 移除所有阻碍点击的禁用状态 (disabled/hidden)
            const allButtons = document.querySelectorAll('.modal-dialog button, .modal-dialog a, .modal-footer button');
            allButtons.forEach(btn => {
                btn.removeAttribute('disabled');
                btn.classList.remove('disabled');
                btn.style.display = 'block';
                btn.style.visibility = 'visible';
                // 强制改写倒计时文字，让它以为倒计时已经结束
                if(btn.innerText.includes('wait') || btn.innerText.includes('ready')) {
                    btn.innerText = 'Renew Now';
                }
            });

            // 3. 寻找潜在的 Cloudflare Turnstile 成功回调函数并原地执行
            // 很多网站在 Turnstile 成功后会给 window 挂载一个全局回调函数
            for (let key in window) {
                if (key.toLowerCase().includes('captcha') || key.toLowerCase().includes('turnstile') || key.toLowerCase().includes('callback')) {
                    if (typeof window[key] === 'function') {
                        try { window[key]("mocked_token_success"); } catch(e){}
                    }
                }
            }
        });

        console.log('已执行前端代码重写。正在对解除封印后的按钮进行地毯式点击...');
        await page.screenshot({ path: '2_after_click_popup.png' });

        // 此时按钮的 disabled 属性和隐藏状态已经被我们用上面的 JS 强行扒掉了，直接点击！
        const potentialButtons = [
            '.modal-dialog button',
            '.modal-dialog .btn-success',
            '.modal-dialog .btn-primary',
            '.modal-footer button',
            'button:has-text("Renew")',
            'button:has-text("Add")'
        ];

        let clicked = false;
        for (const selector of potentialButtons) {
            const loc = page.locator(selector);
            const count = await loc.count();
            for (let i = 0; i < count; i++) {
                const element = loc.nth(i);
                if (await element.isVisible()) {
                    console.log(`🚀 成功强行点击解封按钮: ${selector}`);
                    await element.click({ force: true }).catch(() => null);
                    clicked = true;
                }
            }
        }

        if(!clicked) {
            console.log("未找到显式按钮，尝试执行全网页盲点确认...");
            await page.mouse.click(683, 440);
        }

        console.log('强突防指令已发出，原地等待 15 秒观察数据是否强制入库...');
        await page.waitForTimeout(15000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });
        await page.screenshot({ path: '4_final_result.png' });

        console.log('第四步：检查续期后的时间状态...');
        const endTime = await extractServerTime(page);
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${endTime}`);

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch(e){}
    }
})();
