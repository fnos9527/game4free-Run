const { execSync, exec } = require('child_process');
const fs = require('fs');

// ─── 安装依赖（首次运行时执行）───────────────────────────────────────────────
function installDeps() {
    const needed = [
        'playwright-extra',
        'puppeteer-extra-plugin-stealth',
        '@playwright/browser-chromium'   // playwright-extra 需要独立的浏览器包
    ];
    console.log('正在安装反检测依赖包...');
    try {
        execSync(`npm install --save ${needed.join(' ')}`, { stdio: 'inherit' });
        // 确保 Chromium 浏览器已下载
        execSync('npx playwright install chromium', { stdio: 'inherit' });
        console.log('✅ 依赖安装完成。');
    } catch (e) {
        console.error('❌ 依赖安装失败:', e.message);
        process.exit(1);
    }
}

// ─── 启动 Xray 代理 ──────────────────────────────────────────────────────────
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

// ─── 提取页面时间字符串 ───────────────────────────────────────────────────────
async function extractServerTime(page) {
    try {
        const text = await page.innerText('body');
        const match = text.match(/\d{2}:\d{2}:\d{2}/);
        return match ? match[0] : '无法提取具体数字';
    } catch (e) {
        return '获取失败';
    }
}

// ─── 处理 Cloudflare Turnstile 验证 ──────────────────────────────────────────
async function handleTurnstile(page) {
    console.log('正在等待 Cloudflare Turnstile iframe 出现（最多 15 秒）...');

    const iframeHandle = await page.waitForSelector(
        'iframe[src*="challenges.cloudflare.com"]',
        { timeout: 15000 }
    ).catch(() => null);

    if (!iframeHandle) {
        console.log('✅ 未检测到 Turnstile iframe，已被直接放行。');
        return true;
    }

    console.log('检测到 Turnstile iframe，等待其完全渲染（3 秒）...');
    await page.waitForTimeout(3000);

    // 切入 iframe 内部
    const frame = await iframeHandle.contentFrame();
    if (!frame) {
        console.log('⚠️ 无法切入 iframe，改用外部坐标点击...');
        const box = await iframeHandle.boundingBox();
        if (box) {
            await page.mouse.click(box.x + box.width * 0.12, box.y + box.height / 2, { delay: 120 });
            console.log('已坐标点击，等待 25 秒...');
            await page.waitForTimeout(25000);
        }
        return false;
    }

    // 在 frame 内寻找 checkbox
    const checkbox = await frame.waitForSelector('input[type="checkbox"]', { timeout: 5000 }).catch(() => null);
    if (checkbox) {
        console.log('找到 checkbox，执行点击...');
        await checkbox.click({ delay: 100 });
    } else {
        // Turnstile 有时渲染为纯 div，点击 body 左侧
        console.log('未找到 checkbox，点击 widget 左侧...');
        const bodyBox = await frame.locator('body').boundingBox().catch(() => null);
        if (bodyBox) {
            await frame.locator('body').click({
                position: { x: Math.min(40, bodyBox.width * 0.12), y: bodyBox.height / 2 },
                delay: 100
            });
        }
    }

    console.log('已点击，等待验证结果（最多 35 秒）...');

    // 等待 iframe 消失（验证通过后模态框关闭，iframe 随之消失）
    await page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', {
        state: 'detached',
        timeout: 35000
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

// ─── 主流程 ──────────────────────────────────────────────────────────────────
(async () => {
    // 先安装依赖
    installDeps();

    // 动态 require（安装完成后才能 require）
    const { chromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');

    // 加载 stealth 插件（这是绕过 CF Turnstile 的关键）
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

    // 补充 stealth 未覆盖的细节
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

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        console.log('已成功触发点击动作。');

        await page.waitForTimeout(2000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare Turnstile 验证...');
        const captchaPassed = await handleTurnstile(page);
        console.log(`验证处理结果: ${captchaPassed ? '通过' : '未确认通过'}`);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

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
