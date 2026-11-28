"""Compare direct reinforcements and a neutral giant recruitment with real game controls.

python qa/two_fronts.py numori-beta.html --out <evidence-directory>
python qa/two_fronts.py old.html --baseline --out <baseline-directory>
"""
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright
from opening import CLOCK, OBSERVE, VIEWS, VISIBILITY

SCREENS={**VIEWS,"compact":(360,640),"narrow":(667,375),"short":(568,320)}


# Compare opening positions with the actual camera, then observe fixed simulation ticks.
# The worker and troop simulation, route choices, capture and payments remain untouched.
SAMPLE = """() => {
    const b=Numori.battle,s=Numori.economy.sides[0],st=b.station;
    const group=b.units.filter(u=>window.waveIds?.has(u.id));
    const mean=key=>group.length?Math.round(group.reduce((sum,u)=>sum+u[key],0)/group.length):null;
    const recruited=b.units.find(u=>u.side===0 && u.giantKind);
    return {tick:b.tick, time:b.time, group:group.length, x:mean('x'),y:mean('y'),
        route:group[0]?.route, owner:st?.owner, bank:{...s.inventory}, hp:b.bases.map(base=>base.hp),
        gathered:{...s.stats.gathered}, spent:{...s.stats.spent},
        recruits:st?.recruits?.slice(), recruitment:st?.lastRecruit && {...st.lastRecruit},
        giant:recruited && {id:recruited.id,kind:recruited.giantKind,side:recruited.side,
            route:recruited.route,x:recruited.x,y:recruited.y,hp:recruited.hp}};
}"""

ADVANCE = """({limit,watch}) => {
    const b=Numori.battle;
    const sample=window.roadSample;
    const marks=[];
    let last=sample(), recruitment=null;
    while (b.tick<limit && b.winner<0) {
        Numori.match.step();
        const next=sample();
        if (next.owner!==last.owner || next.tick%90===0) marks.push(next);
        if (next.recruits?.[0]>last.recruits?.[0] && !recruitment) {
            recruitment={before:last,after:next};
            if(watch) break;
        }
        last=next;
    }
    return {marks,recruitment,end:sample()};
}"""


def type_tree(press, ast):
    if ast["type"] == "num":
        press(f'[data-number="{ast["key"]}"]')
    else:
        press(f'[data-op="{ast["id"]}"]')
        for child in ast["args"]:
            type_tree(press, child)


def choose_route(page, press, route):
    selector = f'[data-route="{route}"]'
    press(selector)
    assert page.locator(selector).get_attribute('aria-pressed') == 'true'
    launch = page.locator('[data-action="produce"]')
    assert launch.is_enabled() and launch.get_attribute('data-destination') == route
    assert ('중앙 다리' if route == 'bridge' else '거인 전선') in launch.inner_text()


def trial(browser, source, out, view, route, baseline):
    width, height = SCREENS[view]
    touch = view != "desktop"
    ctx = browser.new_context(viewport={"width":width,"height":height},is_mobile=touch,
                              has_touch=touch,device_scale_factor=1)
    page=ctx.new_page()
    errors=[]
    page.on("pageerror",lambda e:errors.append(str(e)))
    page.goto(source,timeout=90000)
    stem=f"{view}-{route}"
    def press(selector):
        button=page.locator(selector).first
        (button.tap if touch else button.click)(timeout=4500)
    def shot(name):
        page.evaluate("""() => {
            const {world,battle,economy,routeCue}=Numori;
            world.render({battle,economy,routeCue},0);
        }""")
        page.screenshot(path=out/f"{stem}-{name}.png",timeout=20000)
    def frame(tick):
        page.evaluate("tick=>{while(Numori.battle.tick<tick && Numori.battle.winner<0)openingFrame()}",tick)
    press('[data-level="normal"]')
    page.evaluate(CLOCK)
    # Playwright actionability waits for native animation frames; start once with force
    # while GameKit binds the deterministic frame source, then return it to Playwright.
    start=page.locator('[data-act="start"]').first
    (start.tap if touch else start.click)(force=True)
    page.wait_for_function("!!window.Numori?.world",polling=40)
    page.evaluate("restoreOpeningRaf()")
    page.evaluate(OBSERVE)
    page.evaluate("window.roadSample="+SAMPLE)
    frame(120)
    launch=page.locator('[data-action="produce"]')
    if not baseline:
        assert launch.is_disabled()
    for key in ['[data-number="8"]','[data-op="mul"]','[data-number="4"]']:
        press(key)
    press('[data-action="produce"]')
    assert page.evaluate("Numori.economy.sides[0].stats.produced") == 24
    page.evaluate("()=>{while(!window.firstUnitHit && Numori.battle.tick<600) openingFrame()}")
    first=page.evaluate(VISIBILITY)
    assert first['hit'] and (first['hit']['tick']-120)/30<=5, first
    assert first['hit']['sourceScreen']['visible'] and first['hit']['targetScreen']['visible'],first
    frame(262)
    if not baseline:
        assert launch.is_disabled()
    frame(270)
    witness=page.evaluate("Numori.economy.summonHint(0,{})")
    goal=page.evaluate("Numori.economy.sides[0].targets.summon")
    type_tree(press,witness)
    assert page.locator(".ne-unit-count").inner_text().strip().startswith("24"), page.locator('#editor').inner_text()
    if not baseline:
        assert launch.is_disabled()
        ready=page.evaluate("""() => JSON.stringify({
            draft:Numori.editor.ast(), bank:Numori.economy.sides[0].inventory,
            produced:Numori.economy.sides[0].stats.produced
        })""")
        for chosen in ('bridge' if route == 'supply' else 'supply', route):
            choose_route(page, press, chosen)
            assert page.evaluate('Numori.routeCue') == {'route':chosen,'state':'selected'}
            assert page.evaluate("""() => JSON.stringify({
                draft:Numori.editor.ast(), bank:Numori.economy.sides[0].inventory,
                produced:Numori.economy.sides[0].stats.produced
            })""")==ready
    assert page.evaluate("!document.documentElement.scrollLeft && document.documentElement.scrollWidth<=innerWidth")
    page.evaluate("window.waveFirst=Numori.battle.nextId")
    def box(sel):
        return page.locator(sel).first.bounding_box()
    boxes={key:box(key) for key in ['.nr-field','.ne-goal','.ne-unit-count','[data-number="1"]','[data-number="9"]','[data-action="produce"]']}
    if not baseline:
        for key in ['[data-route="supply"]','[data-route="bridge"]']:
            boxes[key]=box(key)
        assert all(r and r['height'] and r['x']>=-1 and r['x']+r['width']<=width+1 and
                   r['y']>=-1 and r['y']+r['height']<=height+1 for r in boxes.values()), boxes
    shot('ready')
    press('[data-action="produce"]')
    sample=page.evaluate("""() => {
        window.waveIds=new Set(Numori.battle.units.filter(u=>u.id>=waveFirst&&u.side===0).map(u=>u.id));
        return roadSample();
    }""")
    assert sample['group']==24, sample
    if not baseline:
        assert sample['route']==route, sample
        assert page.evaluate('Numori.routeCue') == {'route':route,'state':'dispatched'}
        assert launch.is_disabled()
    frame(345)
    if route=='supply':
        visible_wave=page.evaluate("""() => {
            const c=Numori.world.camera,k=new NumoriGameKit.OrthographicProjection({degrees:48}).K;
            return Numori.battle.units.filter(u=>waveIds.has(u.id) &&
                Math.abs(u.x-c.x)*c.zoom<c.width/2-10 && Math.abs(u.y-c.y)*k*c.zoom<c.height/2-10).length
        }""")
        assert visible_wave>0, "New supply reinforcement is off screen during its march"
        shot('march')
    # The normal overview is exposed by the game's camera button in every build.
    press('[data-camera="overview"]')
    frame(350)
    marks=[]
    recruitment=None
    # The longer capture needs follow-up waves against a normal opponent.
    # Both trials pay the same schedule and vary only the chosen route.
    follow_up=(17, 23, 29, 35, 41, 47, 53, 59, 65, 71, 77) if not baseline else (23,)
    for seconds in (*follow_up,80):
        result=page.evaluate(ADVANCE,{'limit':30*seconds,'watch':True})
        marks.extend(result['marks'])
        recruitment=result['recruitment']
        page.evaluate("""() => {
            Numori.advance(0);
            const {world,battle,economy,routeCue}=Numori;
            world.render({battle,economy,routeCue},1/30);
        }""")
        if seconds==23:
            shot('map')
        if recruitment or seconds==80 or page.evaluate("Numori.battle.winner>=0"):
            break
        if baseline:
            continue
        reinforcement=page.evaluate("Numori.economy.summonHint(0,{})")
        if reinforcement and page.evaluate("Numori.economy.sides[0].inventory['=']>0"):
            type_tree(press,reinforcement)
            choose_route(page, press, route)
            press('[data-action="produce"]')
    if recruitment:
        result['recruitment']=recruitment
        frame(page.evaluate('Numori.battle.tick')+8)
        shot('recruitment')
        before, after = recruitment['before'], recruitment['after']
        event, giant = after['recruitment'], after['giant']
        assert event['side']==giant['side']==0 and giant['route']=='supply', recruitment
        assert giant['kind']==event['giantKind'] and not before.get('giant'), recruitment
        # Normal worker deposits can share a simulation tick with the recruitment.
        # Only worker deposits may add stock here. No formula was purchased on this tick.
        for key in set(before['bank']) | set(after['bank']):
            assert after['bank'].get(key,0)-before['bank'].get(key,0)==(
                after['gathered'].get(key,0)-before['gathered'].get(key,0)
            ), recruitment
        assert after['spent']==before['spent'], recruitment
    end=page.evaluate("Numori.world.renderStats")
    assert not errors,errors
    assert end['backend']=='webgl2' and end['drawCalls']==1,end
    result['marks']=marks
    result.update(view=view,route=route,first=first,dispatch=sample,goal=goal,
        formula=witness,boxes=boxes,errors=errors,webgl=end)
    print(stem, 'first',round((first['hit']['tick']-120)/30,3),
          'second',goal, 'giant',recruitment and recruitment['after']['recruitment'],flush=True)
    ctx.close()
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--views",choices=list(SCREENS),nargs="+",default=list(VIEWS))
    parser.add_argument("--baseline",action="store_true")
    parser.add_argument("--seed",type=int,default=123)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    url=urlsplit(args.source if '://' in args.source else Path(args.source).resolve().as_uri())
    query=dict(parse_qsl(url.query),debug='1',seed=str(args.seed))
    source=urlunsplit((*url[:3],urlencode(query),''))
    rows=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(channel="chrome")
        for view in args.views:
            rounds=['bridge'] if args.baseline else ['bridge','supply']
            for route in rounds:
                row=trial(browser,source,args.out,view,route,args.baseline)
                rows.append(row)
                (args.out/'trials.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf8')
        browser.close()
    if not args.baseline:
        for a,b in zip(rows[::2],rows[1::2]):
            assert a['formula']==b['formula'] and a['goal']==b['goal']
            assert b['recruitment'] and not a['recruitment'], (a['view'],a['recruitment'],b['recruitment'])


if __name__=='__main__':
    main()
