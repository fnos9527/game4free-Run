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

// 在全局页面提取类似 05:23:12 的时间字符串
async function extractServerTime(page) {
    try {
        const pageText = await page.innerText('body');
        const match = pageText.match(/\d{2}:\d{2}:\d{2}/);
        return match ? match[0] : '无法提取具体数字';
    } catch (e) {
        return '获取失败';
    }
}

// 处理 Cloudflare Turnstile 验证
async function handleTurnstile(page) {
    console.log('正在等待 Cloudflare Turnstile iframe 出现...');

    // 直接等待 Turnstile iframe，不依赖任何文字匹配（避免大小写/措辞差异）
    const iframeHandle = await page.waitForSelector(
        'iframe[src*="challenges.cloudflare.com"]',
        { timeout: 12000 }
    ).catch(() => null);

    if (!iframeHandle) {
        console.log('✅ 未检测到 Turnstile iframe，可能已被直接放行。');
        return true;
    }

    console.log('✅ 找到 Turnstile iframe，切入 frame 内部点击复选框...');

    // 获取 iframe 对应的 Frame 对象
    const frame = await iframeHandle.contentFrame();
    if (!frame) {
        console.log('⚠️ 无法切入 iframe frame context，改用坐标兜底点击...');
        const box = await iframeHandle.boundingBox();
        if (box) {
            // 复选框固定在 Turnstile widget 左侧约 1/6 宽度处
            await page.mouse.click(box.x + box.width * 0.15, box.y + box.height / 2, { delay: 100 });
            console.log('已对 iframe 坐标位置点击，等待 20 秒...');
            await page.waitForTimeout(20000);
        }
        return false;
    }

    // 等待 frame 内部内容渲染完毕
    await frame.waitForTimeout(2000);

    // 尝试方式1：直接找并点击 input[type="checkbox"]
    const checkbox = await frame.$('input[type="checkbox"]');
    if (checkbox) {
        console.log('找到 checkbox 元素，执行点击...');
        await checkbox.click({ delay: 80 });
    } else {
        // 尝试方式2：点击 body 左侧区域（Turnstile widget 的勾选区域固定在左边）
        console.log('未找到 checkbox 元素，点击 widget 左侧区域...');
        const bodyBox = await frame.locator('body').boundingBox().catch(() => null);
        if (bodyBox) {
            await frame.locator('body').click({
                position: { x: Math.min(35, bodyBox.width * 0.15), y: bodyBox.height / 2 },
                delay: 80
            });
        }
    }

    console.log('已点击，等待 Turnstile 自动核验（最多 30 秒）...');

    // 等待 iframe 消失或不再可见，说明验证通过、模态框关闭
    const iframeGone = await page.waitForSelector(
        'iframe[src*="challenges.cloudflare.com"]',
        { state: 'hidden', timeout: 30000 }
    ).catch(() => null);

    // 再次确认 iframe 是否还在
    const stillThere = await page.$('iframe[src*="challenges.cloudflare.com"]');
    if (!stillThere) {
        console.log('🎉 Cloudflare Turnstile 验证通过，模态框已关闭！');
        return true;
    } else {
        console.log('⚠️ 验证框依然存在，验证可能未通过。');
        return false;
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
            '--disable-blink-features=AutomationControlled',
            // 额外增强反检测
            '--disable-features=IsolateOrigins,site-per-process',
            '--flag-switches-begin',
            '--flag-switches-end'
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
        timezoneId: 'Europe/Amsterdam',
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9',
        },
        javaScriptEnabled: true,
        hasTouch: false,
        isMobile: false,
    });

    // 更完整的反自动化检测抹除
    await context.addInitScript(() => {
        // 抹除 webdriver 标志
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // 伪造插件数量（无头浏览器通常为 0，会被识别）
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const arr = [1, 2, 3, 4, 5];
                arr.item = (i) => arr[i];
                arr.namedItem = () => null;
                arr.refresh = () => {};
                return arr;
            }
        });
        // 伪造语言列表
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        // 修复 chrome 对象（无头模式下有时缺失）
        if (!window.chrome) {
            window.chrome = { runtime: {} };
        }
        // 修复 permissions（无头下 query 返回行为异常）
        const originalQuery = window.navigator.permissions?.query;
        if (originalQuery) {
            window.navigator.permissions.query = (parameters) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters);
        }
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
        // 确保按钮在视口内再点击
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        console.log('已成功触发点击动作。');

        await page.waitForTimeout(3000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare Turnstile 验证...');
        const captchaPassed = await handleTurnstile(page);
        console.log(`验证处理结果: ${captchaPassed ? '通过' : '未确认通过'}`);

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查续期后的时间状态...');
        await page.waitForTimeout(3000);
        const endTime = await extractServerTime(page);
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${endTime}`);

        // 简单判断是否续期成功
        const parseSeconds = (t) => {
            const parts = t.split(':').map(Number);
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        };
        if (initialTime !== '无法提取具体数字' && endTime !== '无法提取具体数字') {
            const diff = parseSeconds(endTime) - parseSeconds(initialTime);
            if (diff > 0) {
                console.log(`✅ 续期成功！时间增加了约 ${Math.round(diff / 60)} 分钟。`);
            } else {
                console.log('❌ 时间未增加，续期可能失败，请检查截图。');
            }
        }

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch (e) {}
    }
})();
