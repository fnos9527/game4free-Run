const { chromium } = require('playwright');

// 如果你有验证码平台的 API Key，可以填在这里，配合第三方库过 CF
const CAPTCHA_API_KEY = process.env.CAPTCHA_API_KEY || ''; 

(async () => {
    // 启动浏览器，隐藏自动化特征
    const browser = await chromium.launch({ 
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--blink-settings=imagesEnabled=true' // 必须加载图片/验证
        ]
    });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle' });
        
        // 截图记录初始状态
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        // 使用文本或选择器定位按钮
        const addBtn = page.locator('text="+ ADD 90 MIN"').first();
        await addBtn.click();
        
        // 等待弹窗和 Cloudflare 验证框加载
        await page.waitForTimeout(5000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：尝试处理 Cloudflare 验证...');
        
        /* * 【核心难点提示】
         * 如果是普通的 Cloudflare 无感验证，有时候等待几秒或者模拟点击 iframe 内部的 checkbox 即可。
         * 如果被判定为机器人（GitHub Actions 环境下极大概率），需要接入第三方的验证码解码服务。
         * * 以下为模拟点击 iframe 的标准尝试（不保证在 Actions 干净 IP 之外能直接成功）：
         */
        const iframe = page.frameLocator('iframe[src*="cloudflare"]');
        if (await iframe.locator('.mark').count() > 0) {
            console.log('检测到 CF 复选框，尝试点击...');
            await iframe.locator('.mark').click();
            await page.waitForTimeout(5000);
        } else {
            console.log('未直接检测到可点击复选框，可能需要高级识别或已被拦截。');
        }

        // 再次截图查看验证后结果
        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查时间是否增加...');
        // 获取倒计时文本作为反馈
        const timerText = await page.locator('text=SERVER TIME REMAINING').locator('xpath=../div').first().innerText().catch(() => '未获取到时间');
        console.log(`当前服务器剩余时间显示为: ${timerText}`);

    } catch (error) {
        console.error('脚本执行发生错误: ', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
    }
})();
