import os
from seleniumbase import SB

def main():
    # 获取环境变量中的 SOCKS5 代理
    proxy_url = os.environ.get("SOCKS5_PROXY")
    print(f"使用的代理: {proxy_url if proxy_url else '直连'}")

    # uc=True 开启反检测隐形模式
    with SB(uc=True, proxy=proxy_url) as sb:
        try:
            print("1. 正在打开网址...")
            sb.open("https://game4free.net/my-game")
            
            print("等待页面加载...")
            # 等待输入框出现，最多等 30 秒
            sb.wait_for_element_visible("#username-input", timeout=30)
            
            print("2. 正在输入框输入 ae86...")
            sb.type("#username-input", "ae86")
            
            print("3. 正在寻找 reCAPTCHA 人机验证模块...")
            # 等待 iframe 出现，最多等 30 秒
            iframe_selector = "iframe[title*='reCAPTCHA']"
            sb.wait_for_element_visible(iframe_selector, timeout=30)
            
            # 切入 iframe
            sb.switch_to_frame(iframe_selector)
            
            print("正在等待复选框加载 (代理网络可能较慢，请耐心等待)...")
            # 【核心修复】：将默认的 7 秒超时强制改为 30 秒
            checkbox_selector = ".recaptcha-checkbox-border"
            sb.wait_for_element_visible(checkbox_selector, timeout=30)
            
            print("点击人机验证打勾...")
            sb.click(checkbox_selector)
            
            # 操作完切回主页面
            sb.switch_to_default_content()

            print("等待人机验证通过 (由于代理网络延迟，最多等待60秒)...")
            # 验证通过后，按钮的值会变为 Renew
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
            # 出错时确保切回主页面截图，方便排查
            try:
                sb.switch_to_default_content()
            except:
                pass
            sb.save_screenshot("error_screenshot.png")
            raise e

if __name__ == "__main__":
    main()
