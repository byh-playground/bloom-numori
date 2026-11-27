"""Exercise the playable source with desktop and emulated touch input."""
import argparse
from pathlib import Path
from os import environ
from playwright.sync_api import sync_playwright
from multiplayer import ROOT, game_url, serve

def test_surface(browser, url, name, width, height, touch):
    ctx=browser.new_context(viewport={"width":width,"height":height},has_touch=touch,
        is_mobile=touch,device_scale_factor=1)
    page=ctx.new_page()
    page.set_default_timeout(4500)
    errors=[]
    page.on("pageerror",lambda error: errors.append(str(error)))
    page.goto(url)
    assert page.locator('#productVersion').inner_text() == 'v' + page.evaluate('NumoriVersion')
    def press(selector):
        elem=page.locator(selector).first
        (elem.tap if touch else elem.click)()
    def act(key):press(f'[data-act="{key}"]')
    def snapshot(key):
        if folder := environ.get("NUMORI_QA_SHOTS"):
            page.screenshot(path=Path(folder)/(key+".png"))
    def camera():return page.evaluate("Numori.world.camera")
    if not touch: snapshot("title")
    press('[data-level="easy"]')
    if not touch:
        act('audio');assert page.locator('#modal').is_visible();act('close')
        act('help');assert page.locator('#modal').is_visible();act('close')
    act('tutorial' if not touch else 'start')
    if not touch:
        assert "32" in page.locator('#guideText').inner_text()
        act('guideNext')
        example=page.evaluate("MathCore.format(Numori.economy.sides[0].summonWitness)")
        assert example in page.locator('#guideText').inner_text()
        for _ in range(4):
            if page.locator('#guide').is_visible(): act('guideNext')
        assert not page.locator('#guide').is_visible()
    assert page.evaluate("document.documentElement.scrollWidth")<=width
    assert page.locator('[data-target="worker"],[data-target="expand"]').count()==0
    if touch:
        for selector in ['[data-number="8"]','[data-op="mul"]','[data-number="4"]']:
            press(selector)
    else:
        # Use all four keyboard operators from the normal entry point, without selecting UI tabs.
        page.keyboard.type('8+4-2*3/5')
        assert page.evaluate("MathCore.evaluate(Numori.editor.ast()).value")==6
        press('[data-action="clear"]')
        page.keyboard.type('8*4')
    assert page.evaluate("MathCore.evaluate(Numori.editor.ast()).value")==32
    before=camera()
    press('[data-camera="battle"]')
    assert abs(before["x"]-camera()["x"])>50
    press('[data-camera="plus"]')
    pressed=camera()
    mini=page.locator('.nr-map').bounding_box()
    x=mini['x']+mini['width']*.85;y=mini['y']+mini['height']*.33
    if touch: page.touchscreen.tap(x,y)
    else: page.mouse.click(x,y)
    assert abs(pressed['x']-camera()['x'])>50
    press('[data-camera="home"]')
    if touch:
        field=page.locator('.nr-field').bounding_box()
        x=field['x']+field['width']*.55;y=field['y']+field['height']*.4
        before=camera()
        session=ctx.new_cdp_session(page)
        def gesture(kind,radius):
            touches=[] if not radius else [{"x":x-radius,"y":y,"id":1},{"x":x+radius,"y":y,"id":2}]
            session.send("Input.dispatchTouchEvent",{"type":kind,"touchPoints":touches})
        gesture("touchStart",20)
        for dist in (25,30,40,48):gesture("touchMove",dist)
        gesture("touchEnd",0)
        assert camera()['zoom']>before['zoom']*1.25
        press('[data-camera="home"]')
    if not touch:
        field=page.locator('.nr-field').bounding_box()
        x=field['x']+field['width']*.6;y=field['y']+field['height']*.5
        before=camera()
        page.mouse.move(x,y); page.mouse.down(); page.mouse.move(x-90,y+35,steps=5); page.mouse.up()
        assert abs(before['x']-camera()['x'])>20
        page.mouse.wheel(0,-100);page.wait_for_timeout(90)
        assert camera()['zoom']>before['zoom']
        press('[data-camera="home"]')
    predicted=int(page.locator(".ne-unit-count").inner_text().removesuffix("마리"))
    assert predicted == 24
    snapshot(name+"-editor")
    if touch: press('[data-action="produce"]')
    else: page.keyboard.press("Enter")
    assert page.evaluate("Numori.battle.count(0)")==predicted
    assert page.evaluate("Numori.economy.sides[0].stats.byType.archer")==predicted
    act('menu');act('pause')
    value=page.evaluate("Numori.battle.time")
    page.wait_for_timeout(140);assert page.evaluate("Numori.battle.time")==value
    act('pause')
    page.wait_for_timeout(140);assert page.evaluate("Numori.battle.time")>value
    if not touch:
        page.keyboard.press('8')
        page.keyboard.press('+')
        page.keyboard.press('3')
        assert page.evaluate("MathCore.evaluate(Numori.editor.ast()).value")==11
        page.keyboard.press('Control+z')
        assert not page.evaluate("MathCore.evaluate(Numori.editor.ast()).ok")
        page.locator('[data-action="clear"]').click()
        # Drive the unchanged simulation clock forward into a naturally contested scene.
        page.evaluate("Numori.advance(30*70)")
        press('[data-camera="battle"]')
        snapshot("battle")
        page.evaluate("Numori.advance(30*1200)")
        assert page.evaluate("Numori.battle.winner") in (0,1)
        assert page.locator('#modal').is_visible()
        outcome=page.locator('#modalTitle').inner_text()
        snapshot("result")
        act('restart')
        assert page.evaluate("Numori.battle.count(0)")==0
        act('menu');act('leave')
        assert page.locator('#titleScreen').is_visible()
        print(name,outcome)
    assert not errors,errors
    print('PASS',name,'errors',errors,flush=True)
    ctx.close()


if __name__=='__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('source', nargs='?', default=str(ROOT/'index.html'))
    opts = cli.parse_args()
    with serve(opts.source) as origin, sync_playwright() as p:
        url = game_url(origin, False)
        browser=p.chromium.launch()
        for args in [('pc',1440,900,False),('mobile',390,844,True),('landscape',844,390,True)]:
            test_surface(browser,url,*args)
        browser.close()
