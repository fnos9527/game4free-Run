const { execSync, exec } = require('child_process');
const fs = require('fs');

// ─── 安装依赖 ─────────────────────────────────────────────────────────────────
function installDeps() {
    const needed = ['playwright-extra', 'puppeteer-extra-plugin-stealth'];
    console.log('正在安装依赖包...');
    try {
        execSync(`npm install --save ${needed.join(' ')}`, { stdio: 'inherit' });
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log('✅ 依赖安装完成。');
    } catch (e) {
        console.error('❌ 依赖安装失败:', e.message);
        process.exit(1);
    }
}

// ─── 启动 Xray 代理 ───────────────────────────────────────────────────────────
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
            inbounds: [{ port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true } }],
            outbounds: [{
                protocol: 'vless',
                settings: { vnext: [{ address: host, port: parseInt(port || '443'), users: [{ id: uuid, encryption: 'none' }] }] },
                streamSettings: {
                    network: params.get('type') || 'tcp',
                    security: params.get('security') || 'none',
                    tlsSettings: { serverName: params.get('sni') || host },
                    wsSettings: params.get('type') === 'ws' ? { path: decodeURIComponent(params.get('path') || '/') } : undefined
                }
            }]
        };
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    } catch (err) {
        console.error('❌ 换算配置失败:', err.message);
        return false;
    }

    console.log('在后台启动 Xray 服务...');
    exec('./xray -config config.json > xray.log 2>&1').unref();
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

// ─── 提取页面时间字符串 ────────────────────────────────────────────────────────
async function extractServerTime(page) {
    try {
        const text = await page.innerText('body');
        const match = text.match(/\d{2}:\d{2}:\d{2}/);
        return match ? match[0] : '无法提取具体数字';
    } catch (e) {
        return '获取失败';
    }
}

// ─── 拦截并重放续期 API 请求（核心方案） ──────────────────────────────────────
async function interceptAndReplay(page, isProxyActive) {
    let capturedRequest = null;

    // 监听所有网络请求，抓取续期相关的 API 调用
    page.on('request', (request) => {
        const url = request.url();
        const method = request.method();
        // 续期请求通常是 POST，且包含 renew / extend / add / timer 等关键词
        if (method === 'POST' && (
            url.includes('renew') ||
            url.includes('extend') ||
            url.includes('add') ||
            url.includes('timer') ||
            url.includes('vote') ||
            url.includes('bump') ||
            url.includes('keep') ||
            url.includes('g4f') ||
            url.includes('gaming4free') ||
            url.includes('api')
        )) {
            const postData = request.postData();
            const headers = request.headers();
            console.log(`📡 捕获到 API 请求: [${method}] ${url}`);
            if (postData) console.log(`   请求体: ${postData.substring(0, 200)}`);
            capturedRequest = { url, method, postData, headers };
        }
    });

    // 同时监听响应，确认哪个请求成功了
    page.on('response', async (response) => {
        const url = response.url();
        const status = response.status();
        if (capturedRequest && url === capturedRequest.url) {
            try {
                const body = await response.text();
                console.log(`📨 API 响应 [${status}]: ${body.substring(0, 300)}`);
                capturedRequest.responseStatus = status;
                capturedRequest.responseBody = body;
            } catch (e) {}
        }
    });

    return {
        getCaptured: () => capturedRequest
    };
}

// ─── 处理 Cloudflare Turnstile 验证 ───────────────────────────────────────────
async function handleTurnstile(page) {
    console.log('正在等待 Cloudflare Turnstile iframe 出现（最多 20 秒）...');

    const iframeHandle = await page.waitForSelector(
        'iframe[src*="challenges.cloudflare.com"]',
        { timeout: 20000 }
    ).catch(() => null);

    if (!iframeHandle) {
        console.log('✅ 未检测到 Turnstile iframe，已被直接放行。');
        return true;
    }

    console.log('检测到 Turnstile iframe，等待完全渲染（4 秒）...');
    await page.waitForTimeout(4000);

    const frame = await iframeHandle.contentFrame();
    if (!frame) {
        console.log('⚠️ 无法切入 iframe，改用外部坐标点击...');
        const box = await iframeHandle.boundingBox();
        if (box) {
            await page.mouse.click(box.x + box.width * 0.12, box.y + box.height / 2, { delay: 120 });
            await page.waitForTimeout(30000);
        }
        return false;
    }

    const checkbox = await frame.waitForSelector('input[type="checkbox"]', { timeout: 6000 }).catch(() => null);
    if (checkbox) {
        console.log('找到 checkbox，执行点击...');
        await checkbox.click({ delay: 100 });
    } else {
        console.log('未找到 checkbox，点击 widget 左侧...');
        const bodyBox = await frame.locator('body').boundingBox().catch(() => null);
        if (bodyBox) {
            await frame.locator('body').click({
                position: { x: Math.min(40, bodyBox.width * 0.12), y: bodyBox.height / 2 },
                delay: 100
            });
        }
    }

    console.log('已点击，等待验证结果（最多 40 秒）...');

    await page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', {
        state: 'detached',
        timeout: 40000
    }).catch(() => null);

    const stillThere = await page.$('iframe[src*="challenges.cloudflare.com"]');
    if (!stillThere) {
        console.log('🎉 Cloudflare Turnstile 验证通过！');
        return true;
    } else {
        console.log('⚠️ 验证框依然存在，验证未通过。');
        return false;
    }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
(async () => {
    installDeps();

    const { chromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium.use(StealthPlugin());

    const vlessLink = process.env.MY_VLESS_PROXY;
    const isProxyActive = startXrayProxy(vlessLink);

    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--blink-settings=imagesEnabled=true',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
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
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
        javaScriptEnabled: true,
        hasTouch: false,
        isMobile: false,
    });

    await context.addInitScript(() => {
        if (!window.chrome) window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        const origQuery = navigator.permissions?.query?.bind(navigator.permissions);
        if (origQuery) {
            navigator.permissions.query = (p) =>
                p.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : origQuery(p);
        }
    });

    const page = await context.newPage();

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(3000);

        const initialTime = await extractServerTime(page);
        console.log(`⏱️ 网页初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        // 开始监听网络请求
        const { getCaptured } = await interceptAndReplay(page, isProxyActive);

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        console.log('已成功触发点击动作。');

        // 等久一点让 iframe 有时间注入
        await page.waitForTimeout(4000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare Turnstile 验证...');
        const captchaPassed = await handleTurnstile(page);
        console.log(`验证处理结果: ${captchaPassed ? '通过' : '未确认通过'}`);

        // 等待可能的后续 API 请求完成
        await page.waitForTimeout(5000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        // 打印捕获到的 API 请求信息（用于下一步分析）
        const captured = getCaptured();
        if (captured) {
            console.log('\n════════════════════════════════════════');
            console.log('📋 捕获到续期 API 请求，详情如下:');
            console.log(`   URL: ${captured.url}`);
            console.log(`   Method: ${captured.method}`);
            console.log(`   Body: ${captured.postData || '(无请求体)'}`);
            console.log(`   响应状态: ${captured.responseStatus || '未知'}`);
            console.log(`   响应内容: ${captured.responseBody || '未知'}`);
            console.log('════════════════════════════════════════\n');
        } else {
            console.log('\n⚠️ 未捕获到续期 API 请求，可能验证未通过或请求 URL 特征未匹配。');
        }

        console.log('第四步：检查续期后的时间状态...');
        await page.waitForTimeout(3000);
        const endTime = await extractServerTime(page);
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${endTime}`);

        const parseSeconds = (t) => t.split(':').map(Number).reduce((a, v, i) => a + v * [3600, 60, 1][i], 0);
        if (initialTime !== '无法提取具体数字' && endTime !== '无法提取具体数字') {
            const diff = parseSeconds(endTime) - parseSeconds(initialTime);
            if (diff > 60) {
                console.log(`✅ 续期成功！时间增加了约 ${Math.round(diff / 60)} 分钟。`);
            } else {
                console.log('❌ 时间未明显增加，续期可能失败，请检查截图。');
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
