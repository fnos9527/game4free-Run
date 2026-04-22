import os
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync

def main():
    # 获取环境变量中的 SOCKS5 代理
    proxy_url = os.environ.get("SOCKS5_PROXY")
    
    proxy_settings = None
    if proxy_url:
        print(f"已检测到代理配置，将使用代理运行: {proxy_url}")
        proxy_settings = {"server": proxy_url}
    else:
        print("未检测到 SOCKS5_PROXY 变量，将使用直连运行...")

    with sync_playwright() as p:
        # 启动 Chromium 浏览器，添加防检测参数
        browser = p.chromium.launch(
            headless=True,
            proxy=proxy_settings,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        )
        
        # 模拟真实用户的视口和 User-Agent
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        )
        
        page = context.new_page()
        # 应用 stealth 插件，隐藏机器特征
        stealth_sync(page)

        try:
            print("1. 正在打开网址...")
            page.goto("https://game4free.net/my-game", wait_until="networkidle", timeout=60000)
            
            print("2. 正在输入框输入 ae86...")
            # 修复报错：明确指定 id 为 username-input 的输入框
            page.locator("#username-input").fill("ae86")
            
            # 模拟真人停顿1秒钟，再点击验证码
            page.wait_for_timeout(1000)

            print("3. 正在点击人机验证四方框打勾...")
            # reCAPTCHA 是嵌套在 iframe 里的，定位到该 iframe 并点击复选框
            recaptcha_frame = page.frame_locator("iframe[title*='reCAPTCHA']")
            recaptcha_frame.locator(".recaptcha-checkbox-border").click()
            
            print("等待人机验证通过 (最多等待60秒)...")
            # 验证通过后，按钮的文本会从 Complete Verification 变成 Renew
            renew_button = page.locator("button", has_text="Renew")
            renew_button.wait_for(state="visible", timeout=60000)
            
            print("4. 验证通过，点击 Renew 按钮...")
            renew_button.click()
            
            print("5. 正在确认续期结果...")
            # 等待绿色成功提示 "The server has been renewed." 出现
            success_msg = page.locator("text=The server has been renewed.")
            success_msg.wait_for(state="visible", timeout=30000)
            
            print("✅ 恭喜！The server has been renewed. 整个续期完成。")
            
        except Exception as e:
            print(f"❌ 运行过程中发生错误 (可能是代理网络慢或弹出了图片验证码): {str(e)}")
            # 出错时截图，方便在 GitHub Actions 日志中下载查看原因
            page.screenshot(path="error_screenshot.png", full_page=True)
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    main()
