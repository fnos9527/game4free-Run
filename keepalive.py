#!/usr/bin/env python3
import asyncio
import os
import re
import shutil

TARGET = "https://g4f.gg/myserverbbr"
SOCKS5 = "socks5://127.0.0.1:10808"


def find_chrome() -> str:
    candidates = [
        os.environ.get("CHROME_BIN", ""),
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
    ]
    for p in candidates:
        if p and os.path.isfile(p):
            print(f"  找到浏览器: {p}")
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
        p = shutil.which(name)
        if p:
            print(f"  找到浏览器(which): {p}")
            return p
    raise FileNotFoundError("找不到 Chrome/Chromium")


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
            const m = (document.body.innerText || '').match(/\d{2}:\d{2}:\d{2}/);
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
    print("🎮  Gaming4Free Keepalive  (nodriver + xray socks5)")
    print("=" * 55)

    chrome_path = find_chrome()

    browser = await uc.start(
        sandbox=False,
        headless=True,
        browser_executable_path=chrome_path,
        browser_args=[
            "--disable-gpu",
            "--window-size=1280,720",
            f"--proxy-server={SOCKS5}",
        ],
    )

    page = None
    try:
        print(f"\n📂  打开 {TARGET} ...")
        page = await browser.get(TARGET)

        # 等页面完全加载
        await asyncio.sleep(6)
        await page.save_screenshot("01_opened.png")

        # 打印页面所有按钮文字，方便调试
        btns = await page.evaluate("""
        (() => {
            return [...document.querySelectorAll('button,a,[role=button]')]
                .map(e => e.innerText.trim())
                .filter(t => t.length > 0)
                .slice(0, 20);
        })()
        """)
        print(f"  页面按钮列表: {btns}")

        time_before = await get_timer(page)
        print(f"⏱️   点击前时间: {time_before}")

        # ── 点击 +ADD 90 MIN ──────────────────────────────────
        print("\n🖱️   点击 +ADD 90 MIN ...")
        clicked = await page.evaluate("""
        (() => {
            // 忽略大小写、空白，宽泛匹配
            const el = [...document.querySelectorAll('button,a,[role=button],div')]
                .find(e => {
                    const t = (e.innerText || '').replace(/\s+/g, ' ').toUpperCase();
                    return t.includes('ADD 90') || t.includes('ADD90');
                });
            if (el) {
                console.log('找到按钮:', el.innerText);
                el.click();
                return el.innerText.trim();
            }
            return null;
        })()
        """)

        if not clicked:
            print("  ❌ 未找到按钮，打印页面文字调试...")
            body = await page.evaluate("document.body.innerText")
            print("  页面文字（前500字）:", body[:500] if body else "(空)")
            await page.save_screenshot("error_no_btn.png")
            return

        print(f"  ✅ 已点击: [{clicked}]")
        await asyncio.sleep(3)
        await page.save_screenshot("02_after_click.png")

        # ── 检测并等待 CF Turnstile ───────────────────────────
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
                    print(f"  ✅ CF 已通过！（{(i+1)*2}s）")
                    solved = True
                    break
                if i % 7 == 6:
                    print(f"  ... 等待中 {(i+1)*2}s")
                    await page.save_screenshot(f"cf_{(i+1)*2}s.png")
            if not solved:
                print("  ❌ CF 验证超时")
                await page.save_screenshot("03_cf_failed.png")
        else:
            print("  ✅ 无 CF 弹窗")

        # ── 结果 ──────────────────────────────────────────────
        await asyncio.sleep(3)
        await page.save_screenshot("04_final.png")
        time_after = await get_timer(page)
        diff = parse_seconds(time_after) - parse_seconds(time_before)

        print("\n" + "=" * 55)
        print(f"⏱️   {time_before}  →  {time_after}")
        if diff >= 5000:
            print(f"🎉  SUCCESS！+{diff // 60} 分钟")
        elif diff > 60:
            print(f"⚠️   增加了 {diff//60}m{diff%60}s")
        else:
            print(f"❌  未增加（差值 {diff}s）")
        print("=" * 55)

    finally:
        # nodriver 的 stop 不是协程，直接调用
        try:
            browser.stop()
        except Exception:
            pass
        print("✅  完成")


if __name__ == "__main__":
    asyncio.run(main())
