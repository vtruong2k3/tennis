from playwright.sync_api import sync_playwright
import json
import time
import urllib.request

BASE = 'http://localhost:3000'


def api(path, data=None):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={'Content-Type': 'application/json'},
        method='POST' if data is not None else 'GET',
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1700, 'height': 1000})
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE, wait_until='networkidle')
    page.wait_for_timeout(1000)

    panel = page.locator('text=Chạy phân tích mới')
    print('panel hiển thị:', panel.count() > 0)

    # Upload video ngắn qua panel (set_input_files)
    page.locator('input[type=file]').set_input_files('/tmp/short.mp4')
    print('đã chọn file — chờ upload + start...')
    page.wait_for_timeout(2500)

    body = page.locator('body').inner_text()
    print('phase UP/DONE:', ('ĐANG TẢI' in body.upper() or 'ĐANG PHÂN TÍCH' in body.upper()), '| log có nội dung:', 'video' in body.lower())

    # Chờ tới khi run thật bắt đầu (tối đa 30s)
    run_id = None
    for _ in range(30):
        t = page.locator('body').inner_text()
        if 'run_2026' in t:
            for tok in t.split():
                if tok.startswith('run_2026'):
                    run_id = tok.split('—')[0].strip().rstrip('.,;:)')
                    break
            if run_id:
                break
        time.sleep(1)
    print('run bắt đầu:', run_id)

    if run_id:
        time.sleep(4)
        body = page.locator('body').inner_text()
        print('log realtime có RallyClip:', 'RallyClip' in body or 'Rally' in body)
        print('log có dòng tiến trình frame:', 'frame' in body.lower())
        page.screenshot(path='/tmp/fe-sse.png')

        # Hủy qua nút trên panel
        try:
            page.locator('button:has-text("HỦY")').first.click(timeout=3000)
            print('đã bấm HỦY')
        except Exception:
            print('nút hủy không tìm thấy/bấm được')
        time.sleep(3)
        body = page.locator('body').inner_text()
        print('phase sau hủy — ĐÃ HỦY:', 'ĐÃ HỦY' in body.upper() or 'CANCELLED' in body.upper())

    b = browser.close()
    print('console errors:', errors[:3] if errors else 'none')
