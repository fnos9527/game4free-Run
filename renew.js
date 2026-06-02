const { chromium } = require('playwright');
const path = require('path');

// 你的凭证，依然从环境变量读（如果你想在本地测，可以直接把那一长串 Cookie 贴在引号里）
const COOKIE_STRING = process.env.MY_WEBSITE_COOKIE || ``;

async function run() {
    console.log('🤖 启动完美高精续期脚本...');
    
    // 启动浏览器，如果配置了本地代理（比如 xray 跑在 10808），Actions 里会自动走代理
    const browser = await chromium.launch({
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 }
    });

    // 注入你抓到的 Cookie，这样免登录直接进页面
    if (COOKIE_STRING) {
        const cookies = COOKIE_STRING.split(';').map(pair => {
            const [name, value] = pair.trim().split('=');
            return {
                name: name,
                value: value,
                domain: 'g4f.gg',
                path: '/'
            };
        });
        await context.addCookies(cookies);
        console.log('🔑 Cookie 凭证注入成功');
    }

    const page = await context.newPage();

    // 监控核心的 POST 请求，一旦发现目标发出去了，就说明成了！
    page.on('request', request => {
        if (request.url().includes('/myserverbbr') && request.method() === 'POST') {
            console.log('🚀 检测到关键续期 POST 请求已发出！');
        }
    });

    page.on('response', async response => {
        if (response.url().includes('/myserverbbr') && response.method() === 'POST') {
            console.log(`📡 收到后端响应状态码: ${response.status()}`);
        }
    });

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 60000 });

        // 打印初始时间
        const initialTime = await page.evaluate(() => document.body.innerText.match(/(\d{2}):(\d{2}):(\d{2})/)?.[0]);
        console.log(`⏱️ 网页初始剩余时间: ${initialTime || '未检测到'}`);

        console.log('第二步：点击 + ADD 90 MIN 按钮唤出弹窗...');
        const addBtn = await page.locator('button:has-text("+ ADD 90 MIN")');
        await addBtn.click();
        
        console.log('第三步：等待 Cloudflare Turnstile 验证码组件加载...');
        // 等待嵌入验证码的 iframe 出现
        await page.waitForTimeout(5000); // 稳妥起见先歇 5 秒

        // 穿透 Iframe 寻找 Cloudflare 的打勾框
        const frames = page.frames();
        let targetFrame = null;
        for (const frame of frames) {
            if (frame.url().includes('cloudflare')) {
                targetFrame = frame;
                break;
            }
        }

        if (targetFrame) {
            console.log('🎯 成功锁定 Cloudflare 验证码框架，尝试模拟点击打勾...');
            // 尝试点击 Cloudflare 的那个神秘的小方框（它的 id 或 class 经常带 checkbox）
            const checkbox = await targetFrame.locator('#challenge-stage, .mark, input[type="checkbox"]');
            if (await checkbox.count() > 0) {
                await checkbox.first().click({ timeout: 5000 });
                console.log('👆 已点击打勾复选框！');
            } else {
                console.log('⚠ 锁定了框架但没找到方框，可能它在尝试自动通过...');
            }
        } else {
            console.log('⚠ 未在弹窗中发现 Cloudflare 框架，可能它直接加载在主页或被拦截了。');
        }

        // 原地等待 15 秒，给验证码通过、广告倒计时以及最终提交请求留出充足时间
        console.log('⏳ 正在等待后端处理与数据入库...');
        await page.waitForTimeout(15000);

        // 刷新页面查看最终状态
        console.log('第四步：重新刷新页面查看最终状态...');
        await page.reload({ waitUntil: 'networkidle' });
        
        const finalTime = await page.evaluate(() => document.body.innerText.match(/(\d{2}):(\d{2}):(\d{2})/)?.[0]);
        console.log(`🎉 脚本执行完毕。更新后的服务器剩余时间为: ${finalTime || '未检测到'}`);

    } catch (error) {
        console.error('❌ 脚本执行发生错误:', error);
    } finally {
        await browser.close();
    }
}

run();
