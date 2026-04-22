import os
from seleniumbase import SB

def main():
    proxy_url = os.environ.get("SOCKS5_PROXY")
    
    # 获取 Buster 插件的绝对路径 (工作流已经提取好)
    ext_dir = os.path.abspath("buster_ext") if os.path.exists("buster_ext") else None
    print(f"使用的代理: {proxy_url if proxy_url else '直连'}")
    if ext_dir:
        print("🧩 已成功挂载 Buster 免费 AI 自动打码插件！")

    # 启动隐形浏览器，并加载 Buster 插件
    with SB(uc=True, proxy=proxy_url, extension_dir=ext_dir) as sb:
        try:
            # 插件安装后可能会自动打开一个欢迎页，停顿3秒让它加载完
            sb.sleep(3)
            if len(sb.driver.window_handles) > 1:
                # 强制切回第一个标签页，防止被 Buster 欢迎页抢占焦点
                sb.switch_to_window(0)
            
            print("1. 正在打开网址...")
            sb.open("https://game4free.net/my-game")
            
            print("等待页面加载...")
            sb.wait_for_element_visible("#username-input", timeout=30)
            
            print("2. 正在输入框输入 ae86...")
            sb.type("#username-input", "ae86")
            
            print("3. 正在点击 reCAPTCHA 人机验证...")
            iframe_selector = "iframe[title*='reCAPTCHA']"
            sb.wait_for_element_visible(iframe_selector, timeout=30)
            sb.switch_to_frame(iframe_selector)
            
            # 点击复选框
            sb.click(".recaptcha-checkbox-border")
            sb.switch_to_default_content()
            
            # 等待 3 秒钟，看看谷歌是直接给绿勾，还是弹出图片验证码
            sb.sleep(3)

            print("检查是否被谷歌拦截并弹出图片验证码...")
            challenge_iframe = "iframe[title*='recaptcha challenge']"
            try:
                # 尝试寻找弹出的图片挑战框（最多等8秒）
                sb.wait_for_element_visible(challenge_iframe, timeout=8)
                print("⚠️ 糟糕，弹出了图片验证码！启动 Buster 插件自动破解...")
                
                # 切入图片验证码的 iframe
                sb.switch_to_frame(challenge_iframe)
                
                # 等待 Buster 插件注入的小黄人按钮出现并点击
                sb.wait_for_element_visible("#solver-button", timeout=10)
                print("▶️ 点击自动语音打码按钮...")
                sb.click("#solver-button")
                
                print("🤖 Buster 正在进行 AI 语音听写破解，请耐心等待 (约需10-20秒)...")
                sb.switch_to_default_content()
                
                # 多等一会儿让 AI 听写完成
                sb.sleep(10)
            except Exception:
                print("✅ 运气不错！未检测到图片验证码，当前 IP 直接绿勾通过！")
                sb.switch_to_default_content()

            print("等待人机验证最终通过 (最多等待60秒)...")
            # 验证通过后，按钮的值会变为 Renew
            sb.wait_for_attribute("#submit-button", "value", "Renew", timeout=60)

            print("4. 验证通过，点击 Renew 按钮...")
            sb.click("#submit-button")

            print("5. 正在确认续期结果...")
            sb.wait_for_text("The server has been renewed.", timeout=30)
            
            print("🎉 恭喜！The server has been renewed. 整个续期完成。")
            sb.save_screenshot("success_screenshot.png")

        except Exception as e:
            print(f"❌ 运行过程中发生错误: {str(e)}")
            try:
                sb.switch_to_default_content()
            except:
                pass
            sb.save_screenshot("error_screenshot.png")
            raise e

if __name__ == "__main__":
    main()
