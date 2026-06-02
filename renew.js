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

    // 🌟 【黑科技核心】建立全网流量拦截监听器，抓取核心 API 接口
    const interceptedRequests = [];
    page.on('request', request => {
        const url = request.url();
        // 过滤掉广告、无用静态资源，专门拦截发给自身域名的关键 API 或后台请求
        if (url.includes('g4f.gg') && (url.includes('renew') || url.includes('add') || url.includes('update') || request.method() === 'POST')) {
            console.log(`📡 抓包捕获到关键后端请求 [${request.method()}]: ${url}`);
            interceptedRequests.push({
                url: url,
                method: request.method(),
                headers: request.headers(),
                postData: request.postData()
            });
        }
    });

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        
        await page.waitForTimeout(4000);
        const initialTime = await extractServerTime(page);
        console.log(`⏱️ 网页初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮并激活抓包...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) {
            addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        }
        await addBtn.click();
        
        // 给它 10 秒时间发包
        await page.waitForTimeout(10000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：执行 API 逆向伪造发射...');
        if (interceptedRequests.length > 0) {
            console.log(`发现 ${interceptedRequests.length} 个潜在续期请求，正在尝试跨过前端限制，直接强行重放 API...`);
            
            // 循环使用浏览器底层上下文重新发射捕获到的网络请求
            for (const req of interceptedRequests) {
                try {
                    console.log(`正在后台强行越狱发送 API -> ${req.url}`);
                    const response = await page.evaluate(async (fetchData) => {
                        const res = await fetch(fetchData.url, {
                            method: fetchData.method,
                            headers: fetchData.headers,
                            body: fetchData.postData
                        });
                        return await res.text();
                    }, req);
                    console.log(`服务器响应结果预览: ${response.substring(0, 100)}`);
                } catch (e) {
                    console.log(`重放请求失败: ${e.message}`);
                }
            }
        } else {
            console.log('⚠️ 未直接抓到显式 renew 请求，尝试执行终极表单/原生链接激活...');
            // 如果它不是 ajax 请求，而是隐藏的超链接或按钮点击，我们直接在前端点击所有可能隐藏的提交路径
            await page.evaluate(() => {
                const links = document.querySelectorAll('a, button');
                links.forEach(l => {
                    if (l.innerText.includes('90') || l.href?.includes('renew')) {
                        l.click();
                    }
                });
            });
        }

        console.log('等待 10 秒让后端数据入库刷新...');
        await page.waitForTimeout(10000);
        
        // 重新刷新一下页面，确保看到的是最干净、最新写入的时间
        console.log('重新刷新页面查看最终入库状态...');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(4000);
        
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
