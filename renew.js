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
                port: 10808, listen: "127.0.0.1", protocol: "socks", settings: { auth: "noauth", udp: true }
            }],
            outbounds: [{
                protocol: "vless",
                settings: {
                    vnext: [{ address: host, port: parseInt(port || "443"), users: [{ id: uuid, encryption: "none" }] }]
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

        console.log('第二步：点击 + ADD 90 MIN 按钮唤出弹窗...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) {
            addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        }
        await addBtn.click();
        await page.waitForTimeout(4000); // 等待弹窗完全展开
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：解密封印！强行注入重写前端倒计时与隐藏组件...');
        
        // 🌟 在网页环境执行“降维打击”：直接把阻碍我们点击的遮罩层、广告倒计时在前端干掉
        await page.evaluate(() => {
            console.log("开始强制扫描并清除全网页的广告等待限制...");
            
            // 1. 如果有隐藏的按钮（比如类名里带有 renew, submit, confirm, ad-button 的），强行让它们显示出来
            const allElements = document.querySelectorAll('button, a, div, input, form');
            allElements.forEach(el => {
                const text = (el.innerText || "").toLowerCase();
                const idOrClass = ((el.id || "") + " " + (el.className || "")).toLowerCase();
                
                // 解锁可能被禁用的按钮
                if (el.hasAttribute('disabled')) {
                    el.removeAttribute('disabled');
                    el.style.border = "5px solid red"; // 加上红框标记
                }
                
                // 如果隐藏了，强行展开
                if (el.style.display === 'none' || el.style.visibility === 'hidden') {
                    el.style.setProperty('display', 'block', 'important');
                    el.style.setProperty('visibility', 'visible', 'important');
                }
            });

            // 2. 很多网站是通过 setTimeout 或者 setInterval 倒计时的，我们尝试寻找并清除它们
            // 或者直接寻找可能存在的全局变量（比如叫 counter, timeLeft, seconds 等）直接改成 0
            for (let i = 1; i < 1000; i++) {
                window.clearInterval(i);
                window.clearTimeout(i);
            }

            // 3. 强行模拟广告“加载完成”后可能调用的通用方法
            const typicalCallbacks = ['onAdLoaded', 'showRenewBtn', 'unlockButton', 'adComplete', 'startRenewal'];
            typicalCallbacks.forEach(funcName => {
                if (typeof window[funcName] === 'function') {
                    console.log(`发现潜在解禁函数: ${funcName}，正在强制执行...`);
                    try { window[funcName](); } catch(e){}
                }
            });
        });

        console.log('全面破坏前端限制后，尝试地毯式轰炸点击可能新出现的真实续期按钮...');
        // 寻找弹窗中所有看起来像续期、提交、确认或者带有数字的按钮进行盲点
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
            btns.forEach(b => {
                const text = b.innerText || b.value || "";
                // 排除最开始的主按钮，只点弹窗里的新按钮
                if (!text.includes("+ ADD 90 MIN")) {
                    console.log(`正在盲点按钮: ${text}`);
                    b.click();
                }
            });
        });

        console.log('原地等待 15 秒观察数据是否刷新入库...');
        await page.waitForTimeout(15000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        // 重新刷新一下页面，确保看到的是最干净、最新写入的时间
        console.log('重新刷新页面查看最终状态...');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(4000);
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
