import os
import time
from playwright.sync_api import sync_playwright
from playwright_stealth import stealth_sync

def main():
    # 获取环境变量中的 SOCKS5 代理
    proxy_url = os.environ.get("SOCKS5_PROXY")
    
    proxy_settings = None
    if proxy_url:
        print("已检测到代理配置，将使用代理运行...")
        proxy_settings = {"server": proxy_url}
    else:
        print("未检测到 SOCKS5_PROXY 变量，将使用直连运行...")

    with sync_playwright() as p:
        # 启动 Chromium 浏览器
        # 针对反爬，添加了一些特定的 args
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
        
        # 创建上下文，模拟真实用户的 User-Agent 和视口大小
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        )
        
        page = context.new_page()
        
        # 应用 stealth 插件，隐藏 Playwright 的 WebDriver 特征
        stealth_sync(page)

        try:
            print("1. 正在打开网址...")
            page.goto("https://game4free.net/my-game", wait_until="networkidle")
            
            # 等待页面加载完成，寻找输入框
            print("2. 正在输入 ae86...")
            # 找到输入框并填入文字。这里使用 placeholder 或者 input 类型定位
            # 假设页面只有一个主要 input，如果报错可以根据实际 html 调整器
            page.locator("input[type='text']").fill("ae86")
            
            print("3. 正在处理 reCAPTCHA 人机验证...")
            # reCAPTCHA 是嵌套在 iframe 里的，必须先定位到 iframe
            recaptcha_frame = page.frame_locator("iframe[title*='reCAPTCHA']")
            # 点击验证码的复选框
            recaptcha_frame.locator(".recaptcha-checkbox-border").click()
            
            print("等待验证码完成 (可能需要几秒钟)...")
            # 等待按钮从 "Complete Verification" 变成 "Renew"
            # 设置较长的超时时间 (30秒)，因为代理网络可能慢
            renew_button = page.locator("button", has_text="Renew")
            renew_button.wait_for(state="visible", timeout=30000)
            
            print("4. 验证通过，正在点击 Renew 按钮...")
            renew_button.click()
            
            print("5. 正在确认续期结果...")
            # 等待绿色成功提示出现
            success_msg = page.locator("text=The server has been renewed.")
            success_msg.wait_for(state="visible", timeout=20000)
            
            print("✅ 恭喜！续期流程全部顺利完成。")
            
        except Exception as e:
            print(f"❌ 运行过程中发生错误: {str(e)}")
            # 出错时截图，方便在 GitHub Actions 日志中下载查看原因
            page.screenshot(path="error_screenshot.png", full_page=True)
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    main()
