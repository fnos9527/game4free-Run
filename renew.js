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
        
        console.log('等待弹窗和广告加载...');
        await page.waitForTimeout(10000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：核心突破——定位并点击弹窗内的广告以激活链接...');
        
        // 匹配各种可能包裹广告的常见选择器
        const adSelectors = [
            '.modal-body iframe', 
            '.modal-body ins', 
            '.modal-dialog iframe',
            'iframe[src*="googleads"]',
            'iframe[title*="Advertisement"]',
            '.modal-body a[href*="http"]'
        ];
        
        let adElement = null;
        for (const selector of adSelectors) {
            adElement = await page.$(selector);
            if (adElement && await adElement.isVisible()) {
                console.log(`🎯 成功锁定广告元素选择器: ${selector}`);
                break;
            }
        }

        if (adElement) {
            const box = await adElement.boundingBox();
            if (box) {
                console.log(`计算广告位置: [X:${box.x + box.width/2}, Y:${box.y + box.height/2}]，准备模拟点击...`);
                
                // 监听可能因为点广告弹出来的新页面，防止它卡住
                const pagePromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
                
                // 点击广告正中心
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
                await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                console.log('👉 广告已点击！');
                
                // 如果弹出了新标签页，悄悄把它关掉，回到主界面
                const newPage = await pagePromise;
                if (newPage) {
                    console.log('检测到广告弹窗页面，正在自动将其关闭以维持主流程...');
                    await newPage.close().catch(() => null);
                }
            }
        } else {
            console.log('⚠️ 未检测到明显的广告容器，启动降维打击：直接点击弹窗正中央偏上区域！');
            // 弹窗正中心偏上往往是放广告或者横幅的地方
            await page.mouse.click(683, 300, { delay: 100 });
        }

        console.log('等待 15 秒让网页感知到广告被点击，并等待后端刷新数据...');
        await page.waitForTimeout(15000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        // 第四步：检查是否有衍生出现的提交按钮
        console.log('第四步：检查是否需要点击确认续期...');
        let submitBtn = page.locator('.modal-dialog button:has-text("Renew"), .modal-dialog button:has-text("Submit"), .modal-dialog button:has-text("OK")').first();
        if (await submitBtn.count() === 0) {
            submitBtn = page.locator('.modal-dialog .btn-primary, .modal-footer .btn').first();
        }

        if (await submitBtn.count() > 0 && await submitBtn.isVisible()) {
            console.log('🚀 发现确认提交按钮，执行最终确认...');
            await submitBtn.click();
            await page.waitForTimeout(10000);
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
