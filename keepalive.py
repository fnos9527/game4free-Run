#!/usr/bin/env python3
"""
Gaming4Free myserver keepalive
使用 DrissionPage (Chromium) 自动点击 +ADD 90 MIN 并过 CF Turnstile
"""

import re
import time
import sys

TARGET_URL = "https://g4f.gg/myserverbbr"

def parse_seconds(t: str) -> int:
    """把 HH:MM:SS 转成秒数"""
    parts = re.findall(r'\d+', t)
    if len(parts) == 3:
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    return 0

def get_time_text(page) -> str:
    """获取倒计时文字"""
    try:
        # 尝试多种选择器
        for sel in [
            '.time', '.timer', '[class*="timer"]',
            '[class*="countdown"]', '[class*="remaining"]'
        ]:
            el = page.ele(sel, timeout=2)
            if el:
                txt = el.text.strip()
                if re.search(r'\d{2}:\d{2}:\d{2}', txt):
                    return txt
        # fallback: 从整页搜索时间格式
        html = page.html
        match = re.search(r'(\d{2}:\d{2}:\d{2})', html)
        return match.group(1) if match else "未知"
    except Exception as e:
        print(f"  获取时间失败: {e}")
        return "未知"

def run():
    from DrissionPage import ChromiumPage, ChromiumOptions

    print("=" * 50)
    print("🎮 Gaming4Free Server Keepalive")
    print("=" * 50)

    # --- 配置 Chromium ---
    opts = ChromiumOptions()
    opts.set_argument('--no-sandbox')
    opts.set_argument('--disable-dev-shm-usage')
    opts.set_argument('--disable-gpu')
    opts.set_argument('--window-size=1280,720')
    # 不加 headless，让 Xvfb 承担显示，这样 CF 检测不到 headless
    # opts.headless()  ← 故意不开 headless

    # 指定系统 chromium
    import shutil
    chromium_path = shutil.which("chromium-browser") or shutil.which("chromium")
    if chromium_path:
        opts.set_browser_path(chromium_path)
        print(f"🌐 使用浏览器: {chromium_path}")

    page = ChromiumPage(addr_or_opts=opts)

    try:
        # --- Step 1: 打开页面 ---
        print(f"\n📂 正在打开 {TARGET_URL} ...")
        page.get(TARGET_URL)
        time.sleep(3)

        # 截图留底
        page.get_screenshot(path='01_opened.png')
        print("📸 截图: 01_opened.png")

        # 记录点击前时间
        time_before = get_time_text(page)
        print(f"⏱️  点击前剩余时间: {time_before}")

        # --- Step 2: 点击 +ADD 90 MIN ---
        print("\n🖱️  寻找 +ADD 90 MIN 按钮...")
        
        btn = None
        # 尝试多种方式找按钮
        selectors = [
            'x://button[contains(text(),"ADD 90 MIN")]',
            'x://a[contains(text(),"ADD 90 MIN")]',
            'x://*[contains(text(),"ADD 90 MIN")]',
            '@text():ADD 90 MIN',
        ]
        for sel in selectors:
            try:
                btn = page.ele(sel, timeout=3)
                if btn:
                    print(f"  ✅ 找到按钮: {sel}")
                    break
            except:
                continue

        if not btn:
            print("  ❌ 未找到按钮，保存截图退出")
            page.get_screenshot(path='error_no_button.png')
            sys.exit(1)

        btn.click()
        print("  ✅ 已点击！")
        time.sleep(2)

        page.get_screenshot(path='02_after_click.png')
        print("📸 截图: 02_after_click.png")

        # --- Step 3: 处理 CF Turnstile ---
        print("\n🔍 检测 Cloudflare Turnstile 验证框...")
        
        # 最多等 30 秒让 CF 弹窗出现
        cf_appeared = False
        for i in range(15):
            html = page.html
            if 'challenges.cloudflare.com' in html or 'turnstile' in html.lower():
                cf_appeared = True
                print(f"  ✅ 检测到 CF 验证框 (第 {i+1} 次检测)")
                break
            time.sleep(2)

        if cf_appeared:
            print("  🤖 尝试点击 CF Turnstile checkbox...")
            
            # 等 iframe 加载
            time.sleep(3)
            
            # 方法1：直接找 iframe 内的 checkbox
            try:
                iframe = page.get_frame('iframe[src*="challenges.cloudflare.com"]')
                if iframe:
                    cb = iframe.ele('tag:input', timeout=5)
                    if cb:
                        cb.click()
                        print("  ✅ 点击了 iframe 内 checkbox")
            except Exception as e:
                print(f"  方法1失败: {e}")

            # 方法2：用 JS 触发
            try:
                page.run_js("""
                    var frames = document.querySelectorAll('iframe');
                    frames.forEach(f => {
                        try {
                            var cb = f.contentDocument.querySelector('input[type=checkbox]');
                            if(cb) cb.click();
                        } catch(e) {}
                    });
                """)
                print("  ✅ JS 注入完成")
            except Exception as e:
                print(f"  方法2失败: {e}")

            # 等待验证完成（最多 60 秒）
            print("  ⏳ 等待验证通过（最多 60 秒）...")
            for i in range(30):
                time.sleep(2)
                html = page.html
                # 检查弹窗是否消失
                if 'challenges.cloudflare.com' not in html:
                    print(f"  ✅ CF 验证已通过！（等待了 {(i+1)*2} 秒）")
                    cf_appeared = False
                    break
                if i % 5 == 4:
                    print(f"  ... 还在等 ({(i+1)*2}s)")

            page.get_screenshot(path='03_after_cf.png')
            print("📸 截图: 03_after_cf.png")

            if cf_appeared:
                print("  ⚠️  CF 验证未通过，可能需要人工介入")

        else:
            print("  ✅ 未检测到 CF 验证框，可能已自动通过")

        # --- Step 4: 检查结果 ---
        time.sleep(3)
        time_after = get_time_text(page)
        print(f"\n⏱️  操作后剩余时间: {time_after}")

        before_s = parse_seconds(time_before)
        after_s  = parse_seconds(time_after)
        diff = after_s - before_s

        print("\n" + "=" * 50)
        if diff >= 5000:   # 90分钟 = 5400秒，留点误差
            print(f"🎉 SUCCESS！增加了约 {diff // 60} 分钟")
            print(f"   {time_before} → {time_after}")
        elif diff > 0:
            print(f"⚠️  时间有所增加但不足90分钟: +{diff//60}分{diff%60}秒")
            print(f"   {time_before} → {time_after}")
        else:
            print(f"❌ 时间未增加（差值: {diff}秒）")
            print(f"   {time_before} → {time_after}")
            print("   可能原因: CF验证未通过 / 已达每日上限")
        print("=" * 50)

        page.get_screenshot(path='04_final.png')

    finally:
        page.quit()
        print("\n✅ 浏览器已关闭")

if __name__ == "__main__":
    run()
