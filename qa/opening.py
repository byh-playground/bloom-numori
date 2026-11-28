"""Replay a paid opening through the normal UI and capture its first visible clash.

python qa/opening.py numori-beta.html --out /path/to/evidence --max-wait 7
Omit --max-wait to record an older build even if its opening is off screen.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright


VIEWS = {"portrait": (390, 844), "landscape": (844, 390), "desktop": (1440, 900)}
OPENING_VIEWS = {**VIEWS, "short": (568, 320)}

# GameKit binds the frame source when the match starts. A fixed clock makes the
# input tick and camera easing reproducible while the actual game loop renders.
CLOCK = """() => {
    const native = requestAnimationFrame.bind(window);
    const callbacks = new Map();
    let next = 0, index = 0;
    window.requestAnimationFrame = callback => (callbacks.set(++next, callback), next);
    window.restoreOpeningRaf = () => { window.requestAnimationFrame = native; };
    window.openingFrame = () => {
        const current = [...callbacks.values()];
        callbacks.clear();
        const timestamp = 1000 + (++index) * (1000 / 30);
        for (const callback of current) callback(timestamp);
    };
}"""

OBSERVE = """() => {
    const {battle} = Numori;
    const original = battle.recordDamage;
    battle.recordDamage = function(target, source, amount, ...rest) {
        if (!window.firstUnitHit && !target.isBase && target.side !== source.side && amount > 0) {
            window.firstUnitHit = {tick:battle.tick, target:{x:target.x,y:target.y,side:target.side},
                source:{x:source.x,y:source.y,side:source.side},amount};
        }
        return original.call(this, target, source, amount, ...rest);
    };
}"""

VISIBILITY = """() => {
    const {battle,world} = Numori, c = world.camera;
    const field = document.querySelector('.nr-field').getBoundingClientRect();
    const k = new NumoriGameKit.OrthographicProjection({degrees:48}).K;
    function project(point) {
        const x = (point.x - c.x) * c.zoom + c.width / 2;
        const y = (point.y - c.y) * c.zoom * k + c.height / 2 - 8 * c.zoom;
        const covered = [...document.querySelectorAll('.nr-map,.nr-camera,#launchReceipt,#guide,#enemyForces,#targetHint')]
            .some(node => {
                const r=node.getBoundingClientRect();
                return r.width && r.height && field.left+x>=r.left && field.left+x<=r.right &&
                    field.top+y>=r.top && field.top+y<=r.bottom;
            });
        return {x:Math.round(x), y:Math.round(y), visible: !covered && x>=8 && y>=8 && x<c.width-8 && y<c.height-8};
    }
    const hit=window.firstUnitHit;
    return {tick:battle.tick,camera:c,backend:world.renderStats.backend,draws:world.renderStats.drawCalls,
        visibleUnits:[0,1].map(side=>battle.units.filter(u=>u.side===side&&project(u).visible).length),
        hit:hit && {...hit, sourceScreen:project(hit.source),targetScreen:project(hit.target)}};
}"""


def replay(browser, source, view, args):
    width, height = OPENING_VIEWS[view]
    touch = view != "desktop"
    context = browser.new_context(viewport={"width":width, "height":height},
        is_mobile=touch, has_touch=touch, device_scale_factor=1)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(source, timeout=90000)

    def press(selector):
        control = page.locator(selector).first
        (control.tap if touch else control.click)(force=True)

    press('[data-level="normal"]')
    page.evaluate(CLOCK)
    press('[data-act="start"]')
    page.wait_for_function("!!window.Numori?.world", polling=50)
    page.evaluate("restoreOpeningRaf()")
    page.evaluate(OBSERVE)

    def run_to(tick, stop_at_hit=False):
        return page.evaluate("""([tick, stop]) => {
            let frames = 0;
            while (Numori.battle.tick < tick && Numori.battle.winner === -1 &&
                (!stop || !window.firstUnitHit) && ++frames <= tick + 8) openingFrame();
            return Numori.battle.tick;
        }""", [tick, stop_at_hit])

    dispatch_tick = args.dispatch_tick
    assert run_to(dispatch_tick) == dispatch_tick
    if args.route == "supply":
        supply = page.locator('[data-route="supply"]')
        assert supply.is_enabled()
        assert page.locator('[data-route="bridge"]').get_attribute("aria-pressed") == "true"
        assert page.locator('[data-action="produce"]').is_disabled()
        press('[data-route="supply"]')
        assert supply.get_attribute("aria-pressed") == "true"
        assert page.evaluate("Numori.routeCue") == {"route": "supply", "state": "selected"}
        assert page.evaluate("Numori.economy.sides[0].stats.produced") == 0
        page.evaluate("()=>{ const {world,battle,economy,routeCue}=Numori; world.render({battle,economy,routeCue},0); }")
        page.screenshot(path=args.out / f"{view}-before-formula.png", timeout=20000)
    for selector in ('[data-number="8"]', '[data-op="mul"]', '[data-number="4"]'):
        press(selector)
    assert page.locator(".ne-unit-count").inner_text().strip().startswith("24")
    if args.route == "supply":
        launch = page.locator('[data-action="produce"]')
        assert launch.get_attribute("data-destination") == "supply"
        assert "거인 전선" in launch.inner_text()
        page.screenshot(path=args.out / f"{view}-before-launch.png", timeout=20000)
    press('[data-action="produce"]')
    assert page.evaluate("Numori.economy.sides[0].stats.produced") == 24
    if args.route == "supply":
        assert page.evaluate("Numori.economy.sides[0].stats.byRoute.supply") == 24
        assert page.locator('[data-route="bridge"]').get_attribute("aria-pressed") == "true"
        assert page.locator('#launchReceipt').get_attribute("data-kind") == "supply"
    assert not page.evaluate("!!window.firstUnitHit")
    page.evaluate("openingFrame()")

    def snapshot(label):
        page.screenshot(path=args.out / f"{view}-{label}.png", timeout=20000)
        return page.evaluate(VISIBILITY)

    launch = snapshot("launch")
    deadline = dispatch_tick + 30 * 60
    run_to(dispatch_tick + 120, stop_at_hit=True)
    hit = None
    if page.evaluate("!!window.firstUnitHit"):
        hit = snapshot("contact")
    run_to(dispatch_tick + 120)
    four = snapshot("4s")
    if hit is None:
        run_to(deadline, stop_at_hit=True)
        hit = snapshot("contact")
    assert hit.get("hit"), "No opposing troop lost HP in 60 seconds"
    hit_record = hit["hit"]
    delay = (hit_record["tick"] - dispatch_tick) / 30
    row = {"view":view,"route":args.route,"seed":args.seed,"dispatchTick":dispatch_tick,"secondsToDamage":round(delay,3),
        "launch":launch,"afterFourSeconds":four,"firstContact":hit, "errors":errors}
    print(view, round(delay, 3), "s; visible source/target",
        hit_record["sourceScreen"]["visible"], hit_record["targetScreen"]["visible"], flush=True)
    assert not errors, errors
    context.close()
    return row


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("source", help="Packed game HTML file or public URL")
    cli.add_argument("--out", required=True, type=Path)
    cli.add_argument("--views", choices=OPENING_VIEWS, nargs="+", default=list(VIEWS))
    cli.add_argument("--route", choices=("bridge", "supply"), default="bridge")
    cli.add_argument("--seed", type=int, default=123)
    cli.add_argument("--dispatch-tick", type=int, default=120)
    cli.add_argument("--max-wait", type=float, help="Require both participants on screen and damage within this many seconds")
    args = cli.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    source = args.source if "://" in args.source else Path(args.source).resolve().as_uri()
    url = urlsplit(source)
    query = dict(parse_qsl(url.query), debug="1", seed=str(args.seed))
    source = urlunsplit((*url[:3], urlencode(query), ""))
    with sync_playwright() as chrome:
        browser = chrome.chromium.launch(channel="chrome")
        rows = [replay(browser, source, view, args) for view in args.views]
        browser.close()
    (args.out / "opening.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    if args.max_wait is not None:
        for row in rows:
            hit = row["firstContact"]["hit"]
            assert row["secondsToDamage"] <= args.max_wait, row
            assert hit["sourceScreen"]["visible"] and hit["targetScreen"]["visible"], row


if __name__ == "__main__":
    main()
