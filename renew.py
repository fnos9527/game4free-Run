import os
from seleniumbase import SB

def main():
    # 获取环境变量中的 SOCKS5 代理
    proxy_url = os.environ.get("SOCKS5_PROXY")
    print(f"使用的代理: {proxy_url if proxy_url else '直连'}")

    # uc=True 开启反检测隐形模式，配合服务器的 Xvfb 实现带界面的真实浏览器运行
    with SB(uc=True, proxy=proxy_url) as sb:
        try:
            print("1. 正在打开网址...")
            sb.open("https://game4free.net/my-game")
            sb.sleep(2) # 页面加载缓冲

            print("2. 正在输入框输入 ae86...")
            # 明确指定 ID 为 username-input
            sb.type("#username-input", "ae86")
            sb.sleep(1)

            print("3. 正在处理人机验证 (reCAPTCHA)...")
            # 切入 reCAPTCHA 所在的 iframe
            sb.switch_to_frame("iframe[title*='reCAPTCHA']")
            # 点击打勾
            sb.click(".recaptcha-checkbox-border")
            # 切回主页面
            sb.switch_to_default_content()

            print("等待人机验证通过 (最多等待60秒)...")
            # 从刚才的错误日志看出，按钮其实是 <input id="submit-button"> 
            # 验证通过后，它的 value 会从 Complete Verification 变成 Renew
            sb.wait_for_attribute("#submit-button", "value", "Renew", timeout=60)

            print("4. 验证通过，点击 Renew 按钮...")
            sb.click("#submit-button")

            print("5. 正在确认续期结果...")
            # 等待绿色成功提示出现
            sb.wait_for_text("The server has been renewed.", timeout=30)
            
            print("✅ 恭喜！The server has been renewed. 整个续期完成。")
            # 成功后截图留存
            sb.save_screenshot("success_screenshot.png")

        except Exception as e:
            print(f"❌ 运行过程中发生错误: {str(e)}")
            sb.save_screenshot("error_screenshot.png")
            raise e

if __name__ == "__main__":
    main()
