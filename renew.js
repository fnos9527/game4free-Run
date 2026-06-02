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
        
        // 【战略调整】不急着点操作，先挂起 20 秒，把弹窗底部的 15秒 强制倒计时给硬生生熬完！
        console.log('⏳ 监测到页面存在隐藏倒计时，正在原地挂起等待 20 秒让激活按钮生成...');
        await page.waitForTimeout(20000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：寻找倒计时结束后浮现的真实续期提交按钮...');
        
        // 扫射弹窗内所有可能变成了可点击状态的按钮 (包含 Renew, Submit, OK, Add, Click, 或者带主要颜色类的样式)
        let submitBtn = page.locator('.modal-dialog button:has-text("Renew"), .modal-dialog button:has-text("Submit"), .modal-dialog button:has-text("OK"), .modal-dialog button:has-text("Add")').first();
        
        if (await submitBtn.count() === 0 || !(await submitBtn.isVisible())) {
            // 后备：抓取模态框里所有高亮的 btn 类按钮
            submitBtn = page.locator('.modal-dialog .btn-success, .modal-dialog .btn-primary, .modal-footer button').first();
        }

        if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
            console.log('🚀 成功捕获到可用的提交按钮！正在模拟真人轨迹并执行最终确认点击...');
            const sBox = await submitBtn.boundingBox();
            if (sBox) {
                await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2, { steps: 10 });
                await page.mouse.click(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
            } else {
                await submitBtn.click({ force: true });
            }
            console.log('点击完成，等待 10 秒供后端时间刷新数据...');
            await page.waitForTimeout(10000);
        } else {
            console.log('⚠️ 倒计时走完后依然没找到按钮，尝试做最后一次弹窗下半区域的盲点尝试...');
            // 绝大多数弹窗按钮都在下半部分正中央，我们点一下试试
            await page.mouse.click(683, 420, { delay: 100 });
            await page.waitForTimeout(10000);
        }

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
