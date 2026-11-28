"""Replay real AI card reveals and check each payment against the public formula."""

import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright

from multiplayer import serve
from opening import CLOCK, OBSERVE, OPENING_VIEWS, VISIBILITY


CLASH_VISIBILITY = VISIBILITY.replace("#targetHint')", "#targetHint,.nr-ai-equation')")


AUDIT = """() => {
    const {battle, economy} = Numori;
    const produce = economy.produce.bind(economy);
    window.aiPayments = [];
    economy.produce = function(side, type, ast, reserved, route) {
        if (side !== 1) return produce(side, type, ast, reserved, route);
        const team = economy.sides[1], before = {...team.inventory}, spent = {...team.stats.spent};
        const work = structuredClone(economy.aiWork ?? null);
        const formula = MathCore.format(ast);
        const evaluation = MathCore.evaluate(ast);
        const result = produce(side, type, ast, reserved, route);
        if (result.ok) {
            const cost = {...evaluation.cost, '=': 1};
            const keys = new Set([...Object.keys(before), ...Object.keys(team.inventory), ...Object.keys(cost)]);
            for (const key of keys) {
                const delta = (before[key] || 0) - (team.inventory[key] || 0);
                const recorded = (team.stats.spent[key] || 0) - (spent[key] || 0);
                if (delta !== (cost[key] || 0) || recorded !== delta || delta > (before[key] || 0))
                    throw Error('AI paid a different hand for ' + formula + ' at ' + key);
            }
            window.aiPayments.push({
                tick: battle.tick, formula, value:evaluation.value, cost, before,
                work, target:result.target, count:result.actual, route:result.route
            });
        }
        return result;
    };
}"""


READ = """() => {
    const {battle, economy, world} = Numori;
    const card = document.querySelector('.nr-ai-equation');
    if (!card || card.hidden || !card.getClientRects().length) return null;
    const box = card.getBoundingClientRect();
    const field = document.querySelector('.nr-field').getBoundingClientRect();
    const {x,y,zoom,width,height} = world.camera;
    const base = battle.bases[1];
    const k = new NumoriGameKit.OrthographicProjection({degrees:48}).K;
    const roof = {
        x: field.left + width/2 + (base.x-x)*zoom,
        y: field.top + height/2 + ((base.y-y)*k-106)*zoom
    };
    const text = selector => card.querySelector(selector)?.textContent?.trim() || '';
    const result = card.dataset.phase;
    let affordable = true;
    if (result === 'solving') {
        const cards = {'=':1}, inventory = economy.sides[1].inventory;
        const operators = Object.fromEntries(Object.entries(MathCore.ops).map(([id,def])=>[def.symbol,id]));
        for (const token of economy.aiWork.tokens) {
            const key = /^[1-9]$/.test(token) ? token : operators[token];
            if (key) cards[key] = (cards[key] || 0) + 1;
        }
        affordable = Object.entries(cards).every(([key,n])=>inventory[key]>=n);
    }
    return {
        tick:battle.tick, work:economy.aiWork, phase:result, placement:card.dataset.placement,
        tokens:[...card.querySelectorAll('.nr-ai-token')].map(e=>e.textContent.trim()),
        target:text('.nr-ai-target'), value:text('.nr-ai-value'), summary:text('.nr-ai-summary'),
        inside:box.left >= field.left && box.right <= field.right &&
            box.top >= field.top && box.bottom <= field.bottom,
        aboveBase:Math.abs((box.left+box.right)/2-roof.x) < 50 && box.top < roof.y,
        affordable, roof, camera:world.camera,
        backend:world.renderStats.backend, draws:world.renderStats.drawCalls,
    };
}"""


def trial(browser, origin, view, output, baseline):
    width, height = OPENING_VIEWS[view]
    touch = view != "desktop"
    context = browser.new_context(
        viewport={"width": width, "height": height}, is_mobile=touch, has_touch=touch
    )
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin, timeout=90000)

    def press(selector):
        control = page.locator(selector).first
        (control.tap if touch else control.click)(force=True)

    def show():
        return page.evaluate("""() => {
            const {world,battle,economy,routeCue}=Numori;
            world.render({battle,economy,routeCue},0);
        }""")

    def capture(name, placement, phase):
        show()
        card = page.evaluate(READ)
        assert card and card["inside"] and card["placement"] == placement, card
        assert card["phase"] == phase and card["work"]["phase"] == phase, card
        assert card["tokens"] == card["work"]["tokens"][:card["work"]["revealed"]], card
        assert card["affordable"], card
        assert str(card["work"]["target"]) in card["target"], card
        assert card["draws"] == 1 and card["backend"] == "webgl2", card
        if card["work"]["value"] is None:
            assert not card["value"], card
        else:
            assert str(card["work"]["value"]) in card["value"], card
        if placement == "base":
            assert card["aboveBase"], card
        page.screenshot(path=output / f"{view}-{name}.png", timeout=20000)
        return card

    def until(test, ticks):
        ok = page.evaluate("""([test,ticks])=>{
            const check = Function('return ('+test+')')();
            while (!check() && ticks-- > 0 && Numori.battle.winner === -1) openingFrame();
            return check();
        }""", [test, ticks])
        assert ok, (test, page.evaluate("Numori.battle.tick"), page.evaluate("Numori.economy.aiWork"))

    press('[data-level="normal"]')
    page.evaluate(CLOCK)
    press('[data-act="start"]')
    page.wait_for_function("!!window.Numori?.world", polling=40)
    page.evaluate("restoreOpeningRaf()")
    page.evaluate(OBSERVE)
    page.evaluate(AUDIT)
    until("()=>Numori.battle.tick>=120", 130)
    assert page.evaluate("Numori.economy.sides[1].stats.produced") == 0
    assert not page.evaluate(READ)
    unspent = page.evaluate("({...Numori.economy.sides[1].inventory})")
    launch = page.locator('[data-action="produce"]')
    for key in ('[data-number="8"]', '[data-op="mul"]', '[data-number="4"]'):
        press(key)
    assert launch.get_attribute("data-destination") == "bridge"
    press('[data-action="produce"]')

    cards = {}
    if not baseline:
        partial = """()=>{const w=Numori.economy.aiWork;
            return w?.phase==='solving' && w.revealed>0 && w.revealed<w.tokens.length}"""
        until(partial, 80)
        assert not page.evaluate("window.aiPayments.length"), "AI paid before its equation was visible"
        stock = page.evaluate("({...Numori.economy.sides[1].inventory})")
        assert all(stock.get(key, 0) >= count for key, count in unspent.items()), (stock, unspent)
        cards["field"] = capture("solving-offscreen", "field", "solving")
        # Leave enough screen space above the HQ roof for its bubble in short layouts.
        for _ in range(6):
            if page.evaluate("Numori.world.camera.zoom") <= 0.7:
                break
            press('[data-camera="minus"]')
        mini = page.locator(".nr-map").bounding_box()
        x = mini["x"] + mini["width"] * 0.88
        fraction = page.evaluate("""() => {
            const {battle,world} = Numori, {zoom,height} = world.camera;
            const k = new NumoriGameKit.OrthographicProjection({degrees:48}).K;
            return (battle.bases[1].y - (174+height*0.08/zoom)/k) / Battle.settings.height;
        }""")
        y = page.evaluate("""([x,top,height,fraction]) => {
            const map = document.querySelector('.nr-map');
            for (let f = fraction; f >= 0.18; f -= 0.04)
                if (document.elementFromPoint(x,top+height*f) === map) return top+height*f;
            return null;
        }""", [x, mini["y"], mini["height"], fraction])
        assert y is not None, mini
        # Touch target adjustment otherwise snaps very small minimap taps to the nearby home control.
        page.mouse.click(x, y)
        cards["base"] = capture("solving-at-base", "base", "solving")
        until("()=>{const w=Numori.economy.aiWork;return w.phase==='solving' && w.value!=null}", 90)
        cards["solved"] = capture("solved-at-base", "base", "solving")
        assert not page.evaluate("window.aiPayments.length"), "AI paid before its solution was displayed"
        until("()=>window.aiPayments.length>=1", 90)
        cards["deployed"] = capture("deployed-at-base", "base", "launched")
        first = page.evaluate("window.aiPayments[0]")
        assert "".join(first["formula"].split()) == "".join(cards["deployed"]["tokens"]), (first, cards)
        assert cards["base"]["tokens"] == cards["deployed"]["tokens"][:len(cards["base"]["tokens"])]
        assert cards["deployed"]["work"]["value"] == first["value"]
        assert cards["deployed"]["work"]["count"] == first["count"]
        assert cards["deployed"]["work"]["route"] == first["route"]
        assert f'{first["count"]}' in cards["deployed"]["summary"], cards["deployed"]
        assert {"bridge":"중앙 다리", "supply":"거인 전선"}[first["route"]] in cards["deployed"]["summary"]
        press('[data-camera="battle"]')

    until("()=>!!window.firstUnitHit", 160)
    hit = page.evaluate(CLASH_VISIBILITY)
    seconds = (hit["hit"]["tick"] - 120) / 30
    assert seconds <= 5 and hit["hit"]["sourceScreen"]["visible"] and hit["hit"]["targetScreen"]["visible"], hit
    if baseline:
        page.screenshot(path=output / f"{view}-baseline-contact.png", timeout=20000)
    page.evaluate("""()=>{ while(Numori.battle.tick<1350 && Numori.battle.winner===-1) Numori.advance(1) }""")
    payments = page.evaluate("window.aiPayments")
    assert len(payments) >= 2 and not errors, (payments, errors)
    if not baseline:
        for paid in payments:
            assert paid["work"]["phase"] == "solving"
            assert "".join(paid["formula"].split()) == "".join(paid["work"]["tokens"]), paid
            assert paid["work"]["revealed"] == len(paid["work"]["tokens"]), paid
    context.close()
    print(view, f"first hit {seconds:.3f}s", "payments", [p["tick"] for p in payments], flush=True)
    return {"view": view, "firstHitSeconds": round(seconds, 3), "cards": cards, "payments": payments}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Raw index.html, packed game file, or public play URL")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--views", nargs="+", choices=OPENING_VIEWS, default=("portrait", "short", "desktop"))
    parser.add_argument("--baseline", action="store_true", help="Capture a build before AI card UI")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    with serve(args.source) as origin, sync_playwright() as pw:
        scheme, host, path, query, fragment = urlsplit(origin)
        query = urlencode(dict(parse_qsl(query), seed="123", debug="1"))
        url = urlunsplit((scheme, host, path, query, fragment))
        browser = pw.chromium.launch(channel="chrome")
        rows = []
        for view in args.views:
            rows.append(trial(browser, url, view, args.out, args.baseline))
            (args.out / "scenario.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf8")
        browser.close()


if __name__ == "__main__":
    main()
