from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto('http://localhost:3000/', wait_until='networkidle', timeout=30000)
    page.wait_for_timeout(1500)

    # Badge nguồn dữ liệu
    badge = page.locator('text=DATA').first
    print('BADGE:', badge.inner_text() if badge.count() else 'NOT FOUND')

    # Số liệu trên thẻ tổng quan
    body_text = page.locator('body').inner_text()
    for key in ['ANALYZED', 'run_2026', 'VĐV 1', 'VĐV 2']:
        print(f"contains '{key}':", key in body_text)

    page.screenshot(path='/tmp/frontend-overview.png', full_page=False)

    # Tab Phân tích Rally
    page.locator('text=Phân Tích').first.click()
    page.wait_for_timeout(800)
    print('rally tab ok, contains 16 Hiệp:', '16' in page.locator('body').inner_text())

    browser.close()
    print('CONSOLE ERRORS:', errors[:5] if errors else 'none')
