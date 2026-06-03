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

// ─── 诊断函数：打印页面所有 iframe 和所有网络请求 ──────────────────────────────
async function diagnose(page) {
    // 1. 打印所有 iframe 的 src
    const iframeSrcs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('iframe')).map(f => f.src || f.getAttribute('src') || '(no src)');
    });
    console.log('\n════ 页面中所有 iframe ════');
    if (iframeSrcs.length === 0) {
        console.log('  (未发现任何 iframe)');
    } else {
        iframeSrcs.forEach((src, i) => console.log(`  [${i}] ${src}`));
    }
    console.log('════════════════════════════\n');

    // 2. 打印页面 HTML 中包含 "turnstile" / "cloudflare" / "challenge" 的片段
    const html = await page.content();
    const lines = html.split('\n');
    const keywords = ['turnstile', 'cloudflare', 'challenge', 'cf-', 'cfturnstile'];
    console.log('════ HTML 中含关键词的行 ════');
    let found = 0;
    lines.forEach((line, i) => {
        if (keywords.some(k => line.toLowerCase().includes(k))) {
            console.log(`  L${i + 1}: ${line.trim().substring(0, 200)}`);
            found++;
        }
    });
    if (found === 0) console.log('  (未发现相关关键词)');
    console.log('════════════════════════════\n');
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
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--blink-settings=imagesEnabled=true', '--disable-blink-features=AutomationControlled']
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
    });

    await context.addInitScript(() => {
        if (!window.chrome) window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    // 监听所有网络请求（不过滤，全部打印）
    const allRequests = [];
    context.on('request', (req) => {
        allRequests.push({ method: req.method(), url: req.url() });
    });

    const page = await context.newPage();

    try {
        console.log('第一步：打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(3000);

        const initialTime = await extractServerTime(page);
        console.log(`⏱️ 网页初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        // 诊断：点击前的页面状态
        console.log('\n【点击按钮前的页面诊断】');
        await diagnose(page);

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        console.log('已点击，等待 6 秒让弹窗和 iframe 完全加载...');

        await page.waitForTimeout(6000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        // 诊断：点击后的页面状态（最关键）
        console.log('\n【点击按钮后的页面诊断】');
        await diagnose(page);

        // 打印截至目前所有网络请求
        console.log('\n════ 截至目前所有网络请求 ════');
        allRequests.forEach(r => console.log(`  [${r.method}] ${r.url}`));
        console.log('════════════════════════════\n');

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

    } catch (error) {
        console.error('流程中遭遇异常中止:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
        try { execSync('pkill -f xray'); } catch (e) {}
    }
})();
