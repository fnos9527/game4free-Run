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

// 安装并启动 Xvfb 虚拟显示器（让浏览器以有头模式运行，绕过 CF 无头检测）
function startXvfb() {
    console.log('正在安装 Xvfb 虚拟显示器...');
    try {
        execSync('which Xvfb || (apt-get update -qq && apt-get install -y -qq xvfb)', { stdio: 'inherit', shell: true });
        // 关掉可能残留的旧实例
        try { execSync('pkill Xvfb', { stdio: 'ignore' }); } catch (e) {}
        execSync('sleep 1');
        // 启动虚拟显示器 :99，分辨率 1366x768，色深 24
        exec('Xvfb :99 -screen 0 1366x768x24 &', { stdio: 'ignore', shell: true }).unref();
        execSync('sleep 2');
        process.env.DISPLAY = ':99';
        console.log('✅ Xvfb 虚拟显示器已启动（DISPLAY=:99）');
        return true;
    } catch (e) {
        console.log('⚠️ Xvfb 启动失败，将继续用无头模式:', e.message);
        return false;
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

// Turnstile Managed Mode：不需要点击，只需等待 token 自动写入
// 若 token 迟迟不来（IP 被拒），则尝试 reset 后再等一次
async function handleTurnstile(page) {
    console.log('等待 Turnstile Managed Mode 自动完成验证（token 写入 input）...');

    const waitForToken = (timeout) => page.waitForFunction(() => {
        const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        for (const inp of inputs) {
            if (inp.value && inp.value.length > 10) return true;
        }
        return false;
    }, { timeout });

    // 第一次等待：45 秒
    try {
        await waitForToken(45000);
        console.log('🎉 Turnstile token 已自动写入，验证通过！');
        return true;
    } catch (e) {
        console.log('⚠️ 45 秒内未获得 token，尝试调用 turnstile.reset() 重置后再等...');
    }

    // 尝试 reset，让 Turnstile 重新评估
    await page.evaluate(() => {
        try {
            if (window.turnstile && window._captchaWidgetId !== undefined) {
                window.turnstile.reset(window._captchaWidgetId);
            }
        } catch (e) {}
    }).catch(() => {});

    await page.waitForTimeout(3000);

    // 第二次等待：45 秒
    try {
        await waitForToken(45000);
        console.log('🎉 reset 后 Turnstile token 写入成功！');
        return true;
    } catch (e) {
        console.log('❌ 两次等待均超时，IP 可能被 CF 拒绝。');
        return false;
    }
}

(async () => {
    installDeps();

    // 启动 Xvfb，让浏览器以有头模式运行
    const xvfbOk = startXvfb();

    const { chromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium.use(StealthPlugin());

    const vlessLink = process.env.MY_VLESS_PROXY;
    const isProxyActive = startXrayProxy(vlessLink);

    const launchOptions = {
        // Xvfb 成功时用有头模式，否则降级无头
        headless: !xvfbOk,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--blink-settings=imagesEnabled=true',
        ]
    };

    if (xvfbOk) {
        // 有头模式下明确指定显示器
        launchOptions.args.push('--display=:99');
        console.log('✅ 浏览器将以有头模式运行（Xvfb :99）');
    } else {
        console.log('⚠️ 浏览器将以无头模式运行');
    }

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

    // 只监听 g4f.gg 自身的 POST（排除 GA/广告）
    let renewApiCaptured = null;
    context.on('request', (req) => {
        const url = req.url();
        if (req.method() === 'POST' && url.includes('g4f.gg') && !url.includes('google')) {
            console.log(`📡 捕获到续期 POST: ${url}`);
            const body = req.postData();
            if (body) console.log(`   Body: ${body.substring(0, 400)}`);
            renewApiCaptured = { url, body };
        }
    });
    context.on('response', async (res) => {
        if (renewApiCaptured && res.url() === renewApiCaptured.url) {
            const text = await res.text().catch(() => '');
            console.log(`📨 续期 API 响应 [${res.status()}]: ${text.substring(0, 300)}`);
            renewApiCaptured.status = res.status();
            renewApiCaptured.response = text;
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
        console.log('已点击，等待 Turnstile 弹出...');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：等待 Cloudflare Turnstile 自动完成验证...');
        const captchaPassed = await handleTurnstile(page);
        console.log(`验证处理结果: ${captchaPassed ? '✅ 通过' : '❌ 未通过'}`);

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
                console.log('❌ 时间未明显增加，续期失败。');
                if (!renewApiCaptured) {
                    console.log('   续期 POST 请求未发出，说明 Turnstile 验证未通过。');
                }
            }
        }

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch (e) {}
        try { execSync('pkill Xvfb'); } catch (e) {}
    }
})();
