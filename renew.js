const { execSync, exec } = require('child_process');
const fs = require('fs');

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

async function extractServerTime(page) {
    try {
        const text = await page.innerText('body');
        const match = text.match(/\d{2}:\d{2}:\d{2}/);
        return match ? match[0] : '无法提取具体数字';
    } catch (e) {
        return '获取失败';
    }
}

// ─── 处理 Turnstile：等待 captcha-widget 内的 iframe 动态注入，然后点击 ─────────
async function handleTurnstile(page) {
    console.log('等待 #captcha-widget 容器出现...');

    // 等待 captcha 容器出现（模态框打开时已存在，但 iframe 是动态注入的）
    await page.waitForSelector('#captcha-widget', { timeout: 15000 }).catch(() => null);

    // 等待 Turnstile 在 #captcha-widget 内动态注入 iframe
    console.log('等待 Turnstile 在 #captcha-widget 内注入 iframe（最多 20 秒）...');
    const iframeHandle = await page.waitForSelector(
        '#captcha-widget iframe',
        { timeout: 20000 }
    ).catch(() => null);

    if (!iframeHandle) {
        console.log('⚠️ #captcha-widget 内未注入 iframe，尝试直接点击容器...');
        const box = await page.locator('#captcha-widget').boundingBox().catch(() => null);
        if (box) {
            await page.mouse.click(box.x + box.width * 0.12, box.y + box.height / 2, { delay: 120 });
            console.log('已点击容器，等待 30 秒...');
            await page.waitForTimeout(30000);
        }
        return false;
    }

    console.log('✅ 找到 #captcha-widget 内的 iframe，等待完全渲染（3 秒）...');
    await page.waitForTimeout(3000);

    // 切入 iframe
    const frame = await iframeHandle.contentFrame().catch(() => null);

    if (frame) {
        console.log('切入 iframe frame context，寻找 checkbox...');
        const checkbox = await frame.waitForSelector('input[type="checkbox"]', { timeout: 6000 }).catch(() => null);
        if (checkbox) {
            console.log('找到 checkbox，点击...');
            await checkbox.click({ delay: 100 });
        } else {
            console.log('未找到 checkbox，点击 body 左侧...');
            const bodyBox = await frame.locator('body').boundingBox().catch(() => null);
            if (bodyBox) {
                await frame.locator('body').click({
                    position: { x: Math.min(40, bodyBox.width * 0.12), y: bodyBox.height / 2 },
                    delay: 100
                });
            }
        }
    } else {
        // frame context 不可用，用外部坐标点击 iframe 左侧
        console.log('无法切入 frame，用外部坐标点击 iframe 左侧...');
        const box = await iframeHandle.boundingBox().catch(() => null);
        if (box) {
            await page.mouse.click(box.x + box.width * 0.12, box.y + box.height / 2, { delay: 120 });
        }
    }

    // ── 关键改变：等待隐藏 input 被填入 token，而不是等待 iframe 消失 ──────────
    console.log('等待 Turnstile token 写入 input（最多 40 秒）...');
    try {
        await page.waitForFunction(() => {
            // vote-turnstile-token 或任意 cf-turnstile-response input 有值即视为通过
            const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
            for (const inp of inputs) {
                if (inp.value && inp.value.length > 10) return true;
            }
            return false;
        }, { timeout: 40000 });
        console.log('🎉 Turnstile token 已写入，验证通过！');
        return true;
    } catch (e) {
        console.log('⚠️ 40 秒内未检测到 token 写入，验证可能未通过。');
        return false;
    }
}

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

    // 监听续期 API 请求（验证通过后会自动触发 form submit）
    let renewApiCaptured = null;
    context.on('request', (req) => {
        const url = req.url();
        const method = req.method();
        // 排除已知的广告/分析请求，只关注 g4f.gg 或 gaming4free 的 POST
        if (method === 'POST' && (url.includes('g4f.gg') || url.includes('gaming4free'))) {
            console.log(`📡 捕获到目标 POST: ${url}`);
            console.log(`   Body: ${req.postData()?.substring(0, 300) || '(empty)'}`);
            renewApiCaptured = { url, body: req.postData() };
        }
    });
    context.on('response', async (res) => {
        if (renewApiCaptured && res.url() === renewApiCaptured.url) {
            const body = await res.text().catch(() => '');
            console.log(`📨 API 响应 [${res.status()}]: ${body.substring(0, 300)}`);
            renewApiCaptured.response = body;
            renewApiCaptured.status = res.status();
        }
    });

    const page = await context.newPage();

    try {
        console.log('第一步：打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(3000);

        const initialTime = await extractServerTime(page);
        console.log(`⏱️ 网页初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        console.log('已点击，等待弹窗...');

        await page.waitForTimeout(3000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare Turnstile 验证...');
        const captchaPassed = await handleTurnstile(page);
        console.log(`验证处理结果: ${captchaPassed ? '✅ 通过' : '❌ 未通过'}`);

        // 验证通过后等待 form 自动提交和页面响应
        await page.waitForTimeout(5000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查续期后的时间状态...');
        await page.waitForTimeout(2000);
        const endTime = await extractServerTime(page);
        console.log(`更新后的服务器剩余时间: ${endTime}`);

        const parseSeconds = (t) => t.split(':').map(Number).reduce((a, v, i) => a + v * [3600, 60, 1][i], 0);
        if (initialTime !== '无法提取具体数字' && endTime !== '无法提取具体数字') {
            const diff = parseSeconds(endTime) - parseSeconds(initialTime);
            if (diff > 60) {
                console.log(`✅ 续期成功！时间增加了约 ${Math.round(diff / 60)} 分钟。`);
            } else {
                console.log('❌ 时间未明显增加，续期可能失败。');
                if (renewApiCaptured) {
                    console.log(`\n捕获到的 API: ${renewApiCaptured.url}`);
                    console.log(`响应状态: ${renewApiCaptured.status}`);
                    console.log(`响应内容: ${renewApiCaptured.response}`);
                } else {
                    console.log('未捕获到 g4f.gg 的 POST 请求，说明验证未通过或 form 未提交。');
                }
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
