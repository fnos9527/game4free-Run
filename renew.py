import os
import time
from seleniumbase import SB

def solve_recaptcha(sb):
    """处理 reCAPTCHA，返回 True=成功, False=被封锁"""
    iframe_selector = "iframe[title*='reCAPTCHA']"
    sb.wait_for_element_visible(iframe_selector, timeout=30)
    sb.switch_to_frame(iframe_selector)
    sb.click(".recaptcha-checkbox-border")
    sb.switch_to_default_content()
    
    print("等待谷歌验证码响应...")
    challenge_iframe = "iframe[title*='recaptcha challenge']"
    
    try:
        sb.wait_for_element_visible(challenge_iframe, timeout=8)
        print("⚠️ 弹出了图片验证码，准备使用 Buster 破解...")
        sb.switch_to_frame(challenge_iframe)

        # ✅ 优先检测是否已经被 Google 封锁（Try again later 弹窗）
        if sb.is_element_visible(".rc-doscaptcha-header") or \
           sb.is_text_visible("Try again later") or \
           sb.is_text_visible("sending automated queries"):
            print("🚫 当前 IP 已被 Google 封锁！显示 'Try again later'")
            sb.save_screenshot("blocked_by_google.png")
            sb.switch_to_default_content()
            return False

        buster_host_container = ".help-button-holder"
        sb.wait_for_element_visible(buster_host_container, timeout=15)
        print("▶️ 成功锁定 Buster 按钮，点击中...")
        sb.click(buster_host_container)
        print("🤖 Buster AI 语音识别中，动态等待最多 50 秒...")

        # 动态等待：每秒检测一次封锁状态 + 完成状态
        for i in range(50):
            sb.sleep(1)
            # 先检测是否被封锁
            try:
                sb.switch_to_frame(challenge_iframe)
                if sb.is_element_visible(".rc-doscaptcha-header") or \
                   sb.is_text_visible("Try again later"):
                    print(f"🚫 第{i+1}秒：Buster 触发了 Google 封锁！IP 已被拉黑。")
                    sb.save_screenshot("blocked_after_buster.png")
                    sb.switch_to_default_content()
                    return False
                sb.switch_to_default_content()
            except Exception:
                pass

            # 检测 challenge iframe 是否消失（验证通过标志）
            sb.switch_to_default_content()
            if not sb.is_element_visible(challenge_iframe):
                print(f"✅ 第{i+1}秒：Buster 验证完成！")
                return True

        print("⏰ 50秒超时，Buster 未能完成验证")
        sb.switch_to_default_content()
        return False

    except Exception:
        print("✅ 未弹出图片验证码，直接绿勾通过！")
        sb.switch_to_default_content()
        return True


def main():
    proxy_url = os.environ.get("SOCKS5_PROXY")
    ext_dir = os.path.abspath("buster_ext") if os.path.exists("buster_ext") else None
    
    print(f"使用的代理: {proxy_url if proxy_url else '直连'}")
    if ext_dir:
        print("🧩 已成功挂载 Buster 插件！")

    MAX_RETRIES = 3  # IP被封时最多重试次数（换代理后有意义）

    with SB(uc=True, proxy=proxy_url, extension_dir=ext_dir) as sb:
        try:
            sb.sleep(3)
            if len(sb.driver.window_handles) > 1:
                sb.switch_to_window(0)
            
            print("1. 正在打开网址...")
            sb.open("https://game4free.net/my-game")
            sb.wait_for_element_visible("#username-input", timeout=30)
            
            print("2. 输入用户名 ae86...")
            sb.type("#username-input", "ae86")
            
            print("3. 处理 reCAPTCHA...")
            captcha_passed = solve_recaptcha(sb)

            if not captcha_passed:
                # ✅ IP被封时，给出明确提示而非死等
                print("=" * 60)
                print("❌ 验证失败：当前出口 IP 已被 Google reCAPTCHA 封锁！")
                print("   解决办法：")
                print("   1. 更换住宅代理 IP（Residential Proxy）")
                print("   2. 等待 GitHub Actions 分配新 IP 后重试")
                print("   3. 接入 2captcha 等付费打码服务")
                print("=" * 60)
                sb.save_screenshot("ip_blocked_final.png")
                raise Exception("IP 被 Google 封锁，无法完成 reCAPTCHA 验证")

            # 检查按钮状态
            sb.wait_for_element_visible("#submit-button", timeout=15)
            btn_value = sb.get_attribute("#submit-button", "value")
            print(f"当前按钮状态: {btn_value}")

            if btn_value == "Complete Verification":
                print("🖱️ 点击 Complete Verification...")
                sb.click("#submit-button")
                sb.sleep(3)

            print("4. 等待按钮变为 Renew（最多60秒）...")
            sb.wait_for_attribute("#submit-button", "value", "Renew", timeout=60)

            print("5. 点击 Renew 按钮...")
            sb.click("#submit-button")

            sb.wait_for_text("The server has been renewed.", timeout=30)
            print("🎉 续期成功！The server has been renewed.")
            sb.save_screenshot("success_screenshot.png")

        except Exception as e:
            print(f"❌ 致命错误: {str(e)}")
            try:
                sb.switch_to_default_content()
            except:
                pass
            sb.save_screenshot("error_screenshot.png")
            raise e

if __name__ == "__main__":
    main()
