import os
from seleniumbase import SB

def main():
    proxy_url = os.environ.get("SOCKS5_PROXY")
    ext_dir = os.path.abspath("buster_ext") if os.path.exists("buster_ext") else None
    
    print(f"使用的代理: {proxy_url if proxy_url else '直连'}")
    if ext_dir:
        print("🧩 已成功挂载 Buster 免费 AI 自动打码插件！")

    with SB(uc=True, proxy=proxy_url, extension_dir=ext_dir) as sb:
        try:
            # 插件欢迎页处理：等待3秒让欢迎页弹完，然后强制切回主网页
            sb.sleep(3)
            if len(sb.driver.window_handles) > 1:
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
            
            # 等待 4 秒钟，观察谷歌是直接给绿勾，还是弹出图片验证码
            sb.sleep(4)

            print("检查是否被谷歌拦截并弹出图片验证码...")
            challenge_iframe = "iframe[title*='recaptcha challenge']"
            
            # 使用精准的可见性判断，代替之前的 try...except
            if sb.is_element_visible(challenge_iframe):
                print("⚠️ 糟糕，弹出了图片验证码！准备使用 Buster 破解...")
                # 切入图片验证码的 iframe
                sb.switch_to_frame(challenge_iframe)
                
                # 【关键修复】：强制等待 3 秒钟，给 Buster 插件时间把小黄人按钮注入到页面中！
                sb.sleep(3)
                
                if sb.is_element_visible("#solver-button"):
                    print("▶️ 成功找到小黄人按钮，点击启动 AI 自动打码...")
                    sb.click("#solver-button")
                    print("🤖 Buster 正在听写语音，请耐心等待 (约需 15 秒)...")
                    sb.sleep(15) # 给 AI 听写留足时间
                else:
                    print("❌ 错误：找不到 Buster 小黄人按钮！(可能是插件未生效或页面未完全加载)")
                    sb.save_screenshot("error_no_buster_button.png")
                
                # 操作完毕切回主页面
                sb.switch_to_default_content()
            else:
                print("✅ 运气不错！未检测到图片验证码，当前 IP 似乎直接绿勾通过！")

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
            print(f"❌ 运行过程中发生致命错误: {str(e)}")
            try:
                sb.switch_to_default_content()
            except:
                pass
            sb.save_screenshot("error_screenshot.png")
            raise e

if __name__ == "__main__":
    main()
