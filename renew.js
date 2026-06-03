const { execSync, exec } = require('child_process');
const fs = require('fs');

function installDeps() {
    console.log('正在安装依赖包...');
    try {
        execSync('npm install --save camoufox@latest', { stdio: 'inherit' });
        execSync('npx camoufox fetch', { stdio: 'inherit' });
        execSync('chmod -R 755 /home/runner/.cache/camoufox 2>/dev/null || true', { stdio: 'ignore', shell: true });
        console.log('✅ 依赖安装完成。');
    } catch (e) {
        console.error('❌ 依赖安装失败:', e.message);
        process.exit(1);
    }
}

function startXvfb() {
    try {
        execSync('which Xvfb || (apt-get update -qq && apt-get install -y -qq xvfb)', { stdio: 'inherit', shell: true });
        try { execSync('pkill Xvfb', { stdio: 'ignore' }); } catch (e) {}
        execSync('sleep 1');
        exec('Xvfb :99 -screen 0 1366x768x24 &', { stdio: 'ignore', shell: true }).unref();
        execSync('sleep 2');
        process.env.DISPLAY = ':99';
        console.log('✅ Xvfb 已启动（DISPLAY=:99）');
        return true;
    } catch (e) {
        console.log('⚠️ Xvfb 失败:', e.message);
        return false;
    }
}

function startXrayProxy(vlessLink) {
    if (!vlessLink) { console.log('⚠️ 未检测到代理变量。'); return false; }
    console.log('正在下载 Xray-core...');
    try {
        execSync('curl -L -o xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip', { stdio: 'ignore' });
        execSync('unzip -o xray.zip xray && chmod +x xray', { stdio: 'ignore' });
    } catch (err) { console.error('❌ Xray 下载失败:', err.message); return false; }
    try {
        const url = new URL(vlessLink);
        const uuid = url.username;
        const [host, port] = url.host.split(':');
        const params = url.searchParams;
        const config = {
            inbounds: [{ port: 10808, listen: '127.0.0.1', protocol: 'socks', settings: { auth: 'noauth', udp: true } }],
            outbounds: [{ protocol: 'vless', settings: { vnext: [{ address: host, port: parseInt(port||'443'), users: [{ id: uuid, encryption: 'none' }] }] }, streamSettings: { network: params.get('type')||'tcp', security: params.get('security')||'none', tlsSettings: { serverName: params.get('sni')||host }, wsSettings: params.get('type')==='ws' ? { path: decodeURIComponent(params.get('path')||'/') } : undefined } }]
        };
        fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    } catch (err) { console.error('❌ 配置失败:', err.message); return false; }
    exec('./xray -config config.json > xray.log 2>&1').unref();
    execSync('sleep 3');
    try {
        execSync('curl --socks5-hostname 127.0.0.1:10808 -m 5 https://www.cloudflare.com/cdn-cgi/trace', { stdio: 'ignore' });
        console.log('✅ 代理建立成功！'); return true;
    } catch (e) { console.log('⚠️ 代理测试失败，继续。'); return true; }
}

async function extractServerTime(page) {
    try {
        const text = await page.innerText('body');
        const match = text.match(/\d{2}:\d{2}:\d{2}/);
        return match ? match[0] : '无法提取';
    } catch (e) { return '获取失败'; }
}

async function waitForToken(page, timeout) {
    return page.waitForFunction(() => {
        const inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
        for (const inp of inputs) if (inp.value && inp.value.length > 10) return true;
        return false;
    }, { timeout });
}

async function handleTurnstile(page) {
    console.log('等待 Turnstile 自动验证（最多 50 秒）...');
    try { await waitForToken(page, 50000); console.log('🎉 验证通过！'); return true; } catch (e) {}
    console.log('⚠️ 超时，reset 后再等 50 秒...');
    await page.evaluate(() => { try { window.turnstile?.reset(window._captchaWidgetId); } catch(e){} }).catch(()=>{});
    await page.waitForTimeout(2000);
    try { await waitForToken(page, 50000); console.log('🎉 reset 后验证通过！'); return true; } catch (e) {}
    console.log('❌ 验证失败。'); return false;
}

(async () => {
    installDeps();
    const xvfbOk = startXvfb();
    const vlessLink = process.env.MY_VLESS_PROXY;
    const isProxyActive = startXrayProxy(vlessLink);

    let browser, page;

    try {
        console.log('正在用 Camoufox (NewBrowser) 启动...');
        const { NewBrowser } = require('camoufox');

        const opts = {
            headless: !xvfbOk,
            os: 'windows',
        };
        if (isProxyActive) opts.proxy = 'socks5://127.0.0.1:10808';

        browser = await NewBrowser(opts);
        page = await browser.newPage();
        console.log('✅ Camoufox 启动成功！');

    } catch (e) {
        console.log('⚠️ Camoufox 失败:', e.message);
        console.log('降级使用 playwright-extra Firefox...');

        try {
            const { firefox } = require('playwright-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            // stealth 的 user-agent-override 插件在 Firefox 下有 bug，只加其他插件
            const stealth = StealthPlugin();
            stealth.enabledEvasions.delete('user-agent-override');
            firefox.use(stealth);

            execSync('npx playwright install firefox', { stdio: 'inherit' });

            const launchOpts = { headless: !xvfbOk };
            if (isProxyActive) launchOpts.proxy = { server: 'socks5://127.0.0.1:10808' };

            browser = await firefox.launch(launchOpts);
            const ctx = await browser.newContext({
                viewport: { width: 1366, height: 768 },
                locale: 'en-US',
                timezoneId: 'Europe/Amsterdam',
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
            });
            page = await ctx.newPage();
            console.log('✅ playwright-extra Firefox 启动成功');
        } catch (e2) {
            console.log('⚠️ Firefox 失败:', e2.message, '降级 Chromium...');
            const { chromium } = require('playwright-extra');
            const StealthPlugin = require('puppeteer-extra-plugin-stealth');
            chromium.use(StealthPlugin());
            execSync('npx playwright install chromium', { stdio: 'inherit' });
            const launchOpts = { headless: !xvfbOk, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'] };
            if (isProxyActive) launchOpts.proxy = { server: 'socks5://127.0.0.1:10808' };
            browser = await chromium.launch(launchOpts);
            const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', viewport: { width: 1366, height: 768 }, locale: 'en-US' });
            page = await ctx.newPage();
        }
    }

    // 只监听 g4f.gg 自身的 POST（排除广告域名）
    let renewApiCaptured = null;
    const adDomains = ['3lift', 'google', 'doubleclick', 'amazon-adsystem', 'intergient', 'rapidedge', 'id5-sync', 'crwdcntrl', 'fastclick', 'hadronid'];
    page.on('request', (req) => {
        const url = req.url();
        if (req.method() === 'POST' && url.includes('g4f.gg') && !adDomains.some(d => url.includes(d))) {
            console.log(`📡 续期 POST: ${url}`);
            const body = req.postData();
            if (body) console.log(`   Body: ${body.substring(0, 400)}`);
            renewApiCaptured = { url, body };
        }
    });
    page.on('response', async (res) => {
        if (renewApiCaptured && res.url() === renewApiCaptured.url) {
            const text = await res.text().catch(() => '');
            console.log(`📨 响应 [${res.status()}]: ${text.substring(0, 300)}`);
            renewApiCaptured.status = res.status();
        }
    });

    try {
        console.log('第一步：打开目标网页...');
        // 用 domcontentloaded 而非 networkidle，避免广告脚本导致超时
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'domcontentloaded', timeout: 30000 });
        // 等页面主体内容渲染完成（等到计时器出现）
        await page.waitForSelector('text=/\\d{2}:\\d{2}:\\d{2}/', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const initialTime = await extractServerTime(page);
        console.log(`⏱️ 初始剩余时间: ${initialTime}`);
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN...');
        let addBtn = page.locator('text="+ ADD 90 MIN"').first();
        if (await addBtn.count() === 0) addBtn = page.locator('button:has-text("ADD 90 MIN")').first();
        await addBtn.scrollIntoViewIfNeeded();
        await addBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Turnstile 验证...');
        const passed = await handleTurnstile(page);
        console.log(`验证结果: ${passed ? '✅ 通过' : '❌ 未通过'}`);

        await page.waitForTimeout(5000);
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查时间...');
        await page.waitForTimeout(2000);
        const endTime = await extractServerTime(page);
        console.log(`更新后剩余时间: ${endTime}`);

        const toSec = (t) => t.split(':').map(Number).reduce((a, v, i) => a + v * [3600, 60, 1][i], 0);
        if (initialTime !== '无法提取' && endTime !== '无法提取') {
            const diff = toSec(endTime) - toSec(initialTime);
            if (diff > 60) console.log(`✅ 续期成功！增加约 ${Math.round(diff/60)} 分钟。`);
            else console.log('❌ 时间未增加，续期失败。');
        }
    } catch (err) {
        console.error('异常:', err.message);
        await page.screenshot({ path: 'error_screenshot.png' }).catch(()=>{});
    } finally {
        await browser.close().catch(() => {});
        try { execSync('pkill -f xray'); } catch (e) {}
        try { execSync('pkill Xvfb'); } catch (e) {}
    }
})();
