#!/usr/bin/env python3
"""
Gaming4Free keepalive — 使用 nodriver（最高 CF 绕过成功率）
"""
import asyncio
import re
import time as _time

TARGET = "https://g4f.gg/myserverbbr"

def parse_seconds(t: str) -> int:
    m = re.findall(r'\d+', t)
    if len(m) >= 3:
        return int(m[0]) * 3600 + int(m[1]) * 60 + int(m[2])
    return 0

async def get_timer(page) -> str:
    """抓取倒计时"""
    try:
        js = """
        (() => {
            // 找含 HH:MM:SS 格式的元素
            const all = document.querySelectorAll('*');
            for (const el of all) {
                const t = el.innerText || '';
                if (/\d{2}:\d{2}:\d{2}/.test(t) && el.children.length < 3) {
                    return t.trim();
                }
            }
            return '';
        })()
        """
        result = await page.evaluate(js)
        m = re.search(r'\d{2}:\d{2}:\d{2}', result or '')
        return m.group(0) if m else "未知"
    except Exception as e:
        return f"获取失败({e})"

async def main():
    import nodriver as uc

    print("=" * 55)
    print("🎮  Gaming4Free Server Keepalive  (nodriver)")
    print("=" * 55)

    browser = await uc.start(
        browser_args=[
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--window-size=1280,720",
        ],
        headless=True,          # nodriver 的 headless 绕过能力比普通 headless 强
    )

    try:
        page = await browser.get(TARGET)
        print(f"📂  已打开: {TARGET}")
        await asyncio.sleep(4)

        await page.save_screenshot("01_opened.png")
        time_before = await get_timer(page)
        print(f"⏱️   点击前时间: {time_before}")

        # ── 找并点击 +ADD 90 MIN ──────────────────────────────────
        print("\n🖱️   寻找 +ADD 90 MIN 按钮...")
        btn = None
        for sel in [
            "button[class*='add']",
            "//button[contains(.,'ADD 90 MIN')]",
            "//a[contains(.,'ADD 90 MIN')]",
            "//*[contains(.,'ADD 90 MIN')]",
        ]:
            try:
                el = await page.find(sel, timeout=4)
                if el:
                    btn = el
                    print(f"  ✅ 找到: {sel}")
                    break
            except:
                pass

        if btn is None:
            # fallback: 用 JS 找
            btn_found = await page.evaluate("""
                (() => {
                    const els = [...document.querySelectorAll('button,a')];
                    const el = els.find(e => e.innerText.includes('ADD 90 MIN'));
                    if (el) { el.click(); return true; }
                    return false;
                })()
            """)
            if btn_found:
                print("  ✅ JS fallback 点击成功")
            else:
                print("  ❌ 找不到按钮，退出")
                await page.save_screenshot("error_no_btn.png")
                return
        else:
            await btn.click()
            print("  ✅ 点击完成")

        await asyncio.sleep(3)
        await page.save_screenshot("02_after_click.png")

        # ── 检测 CF Turnstile ─────────────────────────────────────
        print("\n🔍  检测 CF Turnstile...")
        cf_detected = False
        for _ in range(10):
            html = await page.get_content()
            if 'challenges.cloudflare.com' in html or 'cf-turnstile' in html:
                cf_detected = True
                print("  ⚠️  检测到 CF Turnstile 弹窗")
                break
            await asyncio.sleep(2)

        if cf_detected:
            # nodriver 内置对 CF 的处理，等待它自动解决
            print("  ⏳ 等待 nodriver 自动处理 CF（最多90秒）...")
            solved = False
            for i in range(45):
                await asyncio.sleep(2)
                html = await page.get_content()
                # CF 消失说明通过了
                if 'challenges.cloudflare.com' not in html and 'cf-turnstile' not in html:
                    print(f"  ✅ CF 已通过！（耗时约 {(i+1)*2}s）")
                    solved = True
                    break
                if i % 5 == 4:
                    print(f"  ... 等待中 {(i+1)*2}s")
                    await page.save_screenshot(f"cf_wait_{(i+1)*2}s.png")

            if not solved:
                print("  ❌ CF 验证超时未通过")
                await page.save_screenshot("03_cf_failed.png")
        else:
            print("  ✅ 未检测到 CF 弹窗，继续...")

        # ── 检查结果 ──────────────────────────────────────────────
        await asyncio.sleep(3)
        await page.save_screenshot("04_final.png")
        time_after = await get_timer(page)

        before_s = parse_seconds(time_before)
        after_s  = parse_seconds(time_after)
        diff     = after_s - before_s

        print("\n" + "=" * 55)
        print(f"⏱️   操作前: {time_before}")
        print(f"⏱️   操作后: {time_after}")
        if diff >= 5000:
            print(f"🎉  SUCCESS！增加了约 {diff // 60} 分钟")
        elif diff > 60:
            print(f"⚠️   时间增加但不足90分钟: +{diff//60}m{diff%60}s")
        else:
            print(f"❌  时间未明显增加（差值 {diff}s），CF可能未通过")
        print("=" * 55)

    finally:
        await browser.stop()
        print("✅  浏览器已关闭")

if __name__ == "__main__":
    asyncio.run(main())
