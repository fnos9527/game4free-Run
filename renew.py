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
            sb.click(".recaptcha-checkbox-border")
            sb.switch_to_default_content()
            
            print("等待谷歌验证码响应...")
            challenge_iframe = "iframe[title*='recaptcha challenge']"
            
            try:
                sb.wait_for_element_visible(challenge_iframe, timeout=8)
                print("⚠️ 糟糕，弹出了图片验证码！准备使用 Buster 破解...")
                
                sb.switch_to_frame(challenge_iframe)
                
                try:
                    buster_host_container = ".help-button-holder"
                    sb.wait_for_element_visible(buster_host_container, timeout=15)
                    print("▶️ 成功锁定小黄人外部容器！施展'隔山打牛'点击...")
                    sb.click(buster_host_container)
                    
                    print("🤖 Buster 正在调用 AI 听写语音，请耐心等待 (约需 30~40 秒)...")
                    
                    # ✅ 改进1：动态等待验证完成，而非固定sleep
                    # Buster 成功后，挑战框会消失；超时则截图存档
                    for i in range(40):
                        sb.sleep(1)
                        try:
                            # 如果 challenge iframe 已经不可见，说明验证通过了
                            sb.switch_to_default_content()
                            if not sb.is_element_visible(challenge_iframe):
                                print(f"✅ Buster 在第 {i+1} 秒完成了验证！")
                                break
                            sb.switch_to_frame(challenge_iframe)
                        except Exception:
                            # iframe 消失会抛异常，也代表通过了
                            sb.switch_to_default_content()
                            print(f"✅ Buster 在第 {i+1} 秒完成了验证（iframe 已消失）！")
                            break
                    else:
                        print("⏰ 40秒等待结束，Buster 可能未完成，继续尝试后续步骤...")
                        sb.switch_to_default_content()

                except Exception as e:
                    print(f"❌ 找不到小黄人容器！详细原因: {str(e)}")
                    sb.save_screenshot("error_no_buster_button.png")
                    sb.switch_to_default_content()
                
            except Exception:
                print("✅ 运气不错！未检测到图片验证码，当前 IP 似乎直接绿勾通过！")
                sb.switch_to_default_content()

            # ✅ 改进2：处理 "Complete Verification" 按钮状态
            # 如果按钮是 "Complete Verification"，主动点击它触发最终提交
            print("检查提交按钮状态...")
            sb.wait_for_element_visible("#submit-button", timeout=15)
            
            btn_value = sb.get_attribute("#submit-button", "value")
            print(f"当前按钮状态: {btn_value}")
            
            if btn_value == "Complete Verification":
                print("🖱️ 检测到 'Complete Verification' 按钮，主动点击以触发验证提交...")
                sb.click("#submit-button")
                sb.sleep(3)

            print("等待人机验证最终通过 (最多等待60秒)...")
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
