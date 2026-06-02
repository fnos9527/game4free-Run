const { chromium } = require('playwright');

(async () => {
    // 检查是否开启代理变量
    const useProxy = process.env.USE_PROXY === 'true';
    
    const launchOptions = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--blink-settings=imagesEnabled=true'
        ]
    };

    // 如果开启代理，让 Chromium 走本地 Xray 转出来的 Socks5
    if (useProxy) {
        console.log('配置浏览器代理至 -> socks5://127.0.0.1:10808');
        launchOptions.proxy = { server: 'socks5://127.0.0.1:10808' };
    }

    const browser = await chromium.launch(launchOptions);
    
    // 设置隐蔽的 UserAgent，伪装成正常 Windows 桌面浏览器
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });
    
    const page = await context.newPage();

    try {
        console.log('第一步：正在打开目标网页...');
        await page.goto('https://g4f.gg/myserverbbr', { waitUntil: 'networkidle', timeout: 45000 });
        await page.screenshot({ path: '1_initial_status.png' });

        console.log('第二步：点击 + ADD 90 MIN 按钮...');
        const addBtn = page.locator('text="+ ADD 90 MIN"').first();
        await addBtn.click();
        
        // 等待弹窗加载
        await page.waitForTimeout(5000); 
        await page.screenshot({ path: '2_after_click_popup.png' });

        console.log('第三步：处理 Cloudflare 验证打勾...');
        
        // 精准定位 Cloudflare 的验证 iframe
        await page.waitForSelector('iframe[src*="cloudflarechallenge.com"]', { timeout: 10000 }).catch(() => null);
        const cfFrame = page.frames().find(f => f.url().includes('cloudflarechallenge.com'));
        
        if (cfFrame) {
            console.log('发现 Cloudflare 验证框，正在定位点击区域...');
            // 定位复选框元素
            const checkbox = cfFrame.locator('#challenge-stage, .cb-i, input[type="checkbox"]').first();
            
            if (await checkbox.count() > 0) {
                console.log('成功锁定复选框，正在模拟人工点击...');
                const box = await checkbox.boundingBox();
                if (box) {
                    // 稍微偏移到中心点点击
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                } else {
                    await checkbox.click({ force: true });
                }
                console.log('点击完成，等待 8 秒让验证生效...');
                await page.waitForTimeout(8000);
            } else {
                console.log('未能锁定内部点击元素，可能节点 IP 足够干净已经直接通过。');
            }
        } else {
            console.log('没有检测到验证码 iframe，可能已经直接通过。');
        }

        await page.screenshot({ path: '3_after_captcha_attempt.png' });

        console.log('第四步：检查时间是否增加...');
        const timerText = await page.locator('text=SERVER TIME REMAINING').locator('xpath=../div').first().innerText().catch(() => '未获取到');
        console.log(`当前服务器剩余时间显示为: ${timerText}`);

    } catch (error) {
        console.error('运行过程中发生异常:', error);
        await page.screenshot({ path: 'error_screenshot.png' });
    } finally {
        await browser.close();
    }
})();
