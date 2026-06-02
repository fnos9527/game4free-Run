#!/usr/bin/env python3
"""
Gaming4Free keepalive
nodriver + xray socks5 代理（vmess→socks5）
"""
import asyncio
import re

TARGET = "https://g4f.gg/myserverbbr"
SOCKS5  = "socks5://127.0.0.1:10808"

def parse_seconds(t: str) -> int:
    m = re.findall(r'\d+', t)
    if len(m) >= 3:
        return int(m[0]) * 3600 + int(m[1]) * 60 + int(m[2])
    return 0

async def get_timer(page) -> str:
    try:
        result = await page.evaluate("""
        (() => {
            for (const el of document.querySelectorAll('*')) {
                const t = (el.innerText || '').trim();
                if (/^\d{2}:\d{2}:\d{2}$/.test(t)) return t;
            }
            const m = document.body.innerText.match(/\d{2}:\d{2}:\d{2}/);
            return m ? m[0] : '';
        })()
        """)
        m = re.search(r'\d{2}:\d{2}:\d{2}', result or '')
        return m.group(0) if m else "未知"
    except Exception as e:
        return f"获取失败({e})"

async def main():
    import nodriver as uc

    print("=" * 55)
    print("🎮  Gaming4Free Keepalive  (nodriver + vmess socks5)")
    print("=" * 55)

    browser = await uc.start(
        browser_args=[
            "--no-sandbox",                      # 修复 root 报错
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--window-size=1280,720",
            f"--proxy-server={SOCKS5}",          # 走 vmess 代理
        ],
        headless=True,
    )

    try:
        # ── 打开页面 ───────────────────────────────────────────
        print(f"\n📂  打开 {TARGET} ...")
        page = await browser.get(TARGET)
        await asyncio.sleep(5)
        await page.save_screenshot("01_opened.png")

        time_before = await get_timer(page)
        print(f"⏱️   点击前时间: {time_before}")

        # ── 点击 +ADD 90 MIN ───────────────────────────────────
        print("\n🖱️   寻找 +ADD 90 MIN 按钮...")

        clicked = await page.evaluate("""
        (() => {
            const el = [...document.querySelectorAll('button,a,[role=button]')]
                        .find(e => (e.innerText||'').includes('ADD 90 MIN'));
            if (el) { el.click(); return true; }
            return false;
        })()
        """)

        if not clicked:
            print("  ❌ 未找到按钮")
            await page.save_screenshot("error_no_btn.png")
            return
        print("  ✅ 已点击")
        await asyncio.sleep(3)
        await page.save_screenshot("02_after_click.png")

        # ── 等待 CF Turnstile 消失 ────────────────────────────
        print("\n🔍  检测 CF Turnstile...")
        cf_present = False
        for _ in range(8):
            html = await page.get_content()
            if 'challenges.cloudflare.com' in html or 'cf-turnstile' in html:
                cf_present = True
                break
            await asyncio.sleep(2)

        if cf_present:
            print("  ⚠️  检测到 CF Turnstile，等待自动通过（最多 90s）...")
            solved = False
            for i in range(45):
                await asyncio.sleep(2)
                html = await page.get_content()
                if 'challenges.cloudflare.com' not in html and 'cf-turnstile' not in html:
                    print(f"  ✅ CF 通过！（{(i+1)*2}s）")
                    solved = True
                    break
                if i % 7 == 6:
                    print(f"  ... 仍在等待 {(i+1)*2}s")
                    await page.save_screenshot(f"cf_{(i+1)*2}s.png")
            if not solved:
                print("  ❌ CF 验证超时")
                await page.save_screenshot("03_cf_failed.png")
        else:
            print("  ✅ 无 CF 弹窗，已直接通过")

        # ── 结果 ──────────────────────────────────────────────
        await asyncio.sleep(3)
        await page.save_screenshot("04_final.png")
        time_after = await get_timer(page)
        diff = parse_seconds(time_after) - parse_seconds(time_before)

        print("\n" + "=" * 55)
        print(f"⏱️   {time_before}  →  {time_after}")
        if diff >= 5000:
            print(f"🎉  SUCCESS！+{diff//60} 分钟")
        elif diff > 60:
            print(f"⚠️   增加了 {diff//60}m{diff%60}s（不足90分钟）")
        else:
            print(f"❌  未增加（差值 {diff}s）")
        print("=" * 55)

    finally:
        await browser.stop()
        print("✅  完成")

if __name__ == "__main__":
    asyncio.run(main())
