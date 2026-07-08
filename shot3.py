from playwright.sync_api import sync_playwright
import time
B="http://localhost:3742"
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={"width":1400,"height":800})
    pg.goto(B+"/login.html",wait_until="networkidle")
    pg.fill("input[name=username]","admin"); pg.fill("input[name=password]","Admin!2026")
    pg.click("button[type=submit]"); pg.wait_for_url("**/admin.html"); time.sleep(1)
    pg.screenshot(path="shot_import.png")
    b.close()
print("done")
