"""Click the actual editor with a fixed mineral/gas stock for reproducible examples."""

from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

CASES = [
    ("8 mul 5", 40),
    ("8 add 4 mul 3", 36),
    ("8 mul 4 sub 2", 30),
    ("5 add 3 new 8 sub 2 mul bank", 48),
    ("3 div 2 mul 2", 3),
    ("8 div 4 sub 3", -1),
    ("1 div 2 new 8 div bank", 16),
    ("9 sub 3 new 8 add 4 div bank", 2),
]

ERROR_CASES = ["1 sub 1 new 8 div bank"]


def click_script(page, source):
    for word in source.split():
        if word == "bank":
            selector = '[data-stored="0"]'
        elif word in ("new", "clear", "undo", "produce", "split", "remove"):
            selector = f'[data-action="{word}"]'
        elif word[0].isdigit():
            selector = f'[data-number="{word}"]'
        else:
            selector = f'[data-op="{word}"]'
        loc = page.locator(selector).first
        loc.click(timeout=1800)


def editor_setup(page):
    page.set_content('<meta charset="utf-8"><div id="fixture" style="width:440px"></div>')
    for name in ("vendor/gamekit-core.js", "math.js", "ai-solver.js", "battle.js", "economy.js", "editor.js"):
        page.add_script_tag(path=ROOT / name)
    if (ROOT / "editor.css").is_file():
        page.add_style_tag(path=ROOT / "editor.css")
    page.evaluate("""() => {
        window.combat = Battle.create(123);
        window.eco = new Economy({battle:combat, seed:123});
        window.stock = eco.sides[0].inventory;
        Object.assign(stock,Object.fromEntries([...MathCore.numbers,...Object.keys(MathCore.ops),'='].map(k=>[k,8])));
        const kind = 'summon';
        eco.sides[0].targets.summon = 30;
        window.widget = NumoriEditor.mount(document.querySelector('#fixture'), {
            inventory:()=>stock,
            preview:(ast,other)=>eco.preview(0,kind,ast,other),
            produce:(ast,other)=>eco.produce(0,kind,ast,other),
            targetType:()=>kind, targetName:()=>'병력 소환',
            targetGoal:()=>eco.sides[0].targets[kind], remaining:()=>Economy.config.armyLimit-combat.count(0)
        });
    }""")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900},
                                      reduced_motion="reduce")
        page = context.new_page()
        failures = []
        for sequence, expected in CASES + [(s,None) for s in ERROR_CASES]:
            try:
                editor_setup(page)
                click_script(page, sequence)
                result = page.evaluate("""() => {const r=MathCore.evaluate(widget.ast()); 
                    return {ok:r.ok,value:r.value,error:r.error};}""")
                if expected is None:
                    assert not result["ok"], result
                    assert page.locator('[data-action="produce"]').is_disabled()
                    assert page.evaluate("stock['=']")==8
                else:
                    assert result["ok"] and abs(result["value"] - expected) < 1e-9, result
                print(f"PASS {sequence} -> {result}")
            except Exception as error:
                print(f"FAIL {sequence}: {error}")
                failures.append(sequence)
            finally:
                page.close()
                page = context.new_page()
        editor_setup(page)
        page.evaluate("()=>combat.spawn(0,'shield',986)")
        click_script(page, "5 new 8 mul 4 sub 2")
        assert page.evaluate("""() => {
            const {raw,actual,waste}=eco.preview(0,'summon',widget.ast());
            return [raw,actual,waste];
        }""") == [24,14,10]
        click_script(page, "produce")
        assert page.evaluate("() => [combat.counts[0].spear, stock['='],stock['5'],stock['8'], stock.mul,stock.sub]") == [14,7,8,7,7,7]
        assert page.locator('[data-stored="0"]').count() == 1
        assert page.locator('[data-action="undo"]').is_disabled()
        click_script(page, "bank")
        assert page.evaluate("() => widget.reservations()") == {"5":1}
        click_script(page, "clear")
        assert page.evaluate("() => widget.reservations()") == {}
        print("PASS at 986/1,000, matched 30 -> raw 24, 14 spears, 10 overflow; costs, stored block, undo boundary")
        click_script(page, "8 mul 5")
        page.locator('[data-path="1"]').click()
        click_script(page, "3")
        assert page.evaluate("() => MathCore.evaluate(widget.ast()).value") == 24
        page.evaluate("() => {stock['5']++;widget.refresh()}")
        click_script(page, "undo")
        assert page.evaluate("() => [MathCore.evaluate(widget.ast()).value,stock['5']]") == [40,9]
        page.locator('[data-path=""]').click()
        click_script(page, "split")
        assert page.evaluate("() => widget.reservations()").get("5",0) == 0
        print("PASS edit, undo preserves new deposit, split releases chosen number")
        if page.locator('[data-action="clear"]').is_enabled():
            click_script(page,"clear")
        page.evaluate("()=>{stock['8']=1;stock.mul=1;stock['=']=0;widget.refresh()}")
        click_script(page,"8 mul")
        assert page.locator('[data-number="8"]').is_disabled()
        assert page.locator('[data-op="mul"]').is_disabled()
        click_script(page,"5")
        assert page.locator('[data-action="produce"]').is_disabled()
        assert page.evaluate("stock['8']")==1
        click_script(page,"clear 8 5")
        assert page.evaluate("() => MathCore.evaluate(widget.ast()).value")==5
        print("PASS over-reservation, missing equals, no concatenation")
        assert page.evaluate("eco.sides[0].workers.length")==10
        assert page.evaluate("combat.count(0)")==1000
        before=page.evaluate("JSON.stringify(stock)")
        assert not page.evaluate("eco.produce(0,'summon',MathCore.num('3')).ok")
        assert page.evaluate("JSON.stringify(stock)")==before
        print("PASS full army at 1,000 rejects additional summons without spending")
        # A legitimate fallback target can be a single held digit with no operators at all.
        for digit, unit, band in [(1, "archer", "1~3"), (8, "archer", "6~10")]:
            page.evaluate("""key=>{
                window.combat=Battle.create(123);
                window.eco=new Economy({battle:combat,seed:123,config:{initial:{[key]:1,'=':1}}});
                window.stock=eco.sides[0].inventory;widget.reset();widget.refresh();
            }""",str(digit))
            assert page.locator(".ne-goal").inner_text()==str(digit)
            assert band in page.locator(".ne-rule").inner_text()
            click_script(page,f"{digit} produce")
            assert page.evaluate("kind=>combat.counts[0][kind]",unit)==24
            assert page.evaluate("key=>[stock[key],stock['=']]",str(digit))==[0,0]
        print("PASS positive range floor at 1; holding only 1 or 8 permits exact 24-unit production")
        browser.close()
        assert not failures, failures


if __name__ == "__main__":
    main()

