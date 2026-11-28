"""Exercise both defensive lines through the UI and record the same v0.14.0 replay."""
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright

from opening import CLOCK, OBSERVE, VISIBILITY
from two_fronts import SCREENS, choose_route, type_tree


OBSERVE_DEFENSE = """() => {
    const b=Numori.battle;
    const damage=b.recordDamage;
    const state=window.defense={structures:{}, hits:[], losses:[], winner:null};
    b.recordDamage=function(target,source,amount,...extra) {
        if (amount>0) {
            if (target.isStructure || target.isBase) {
                const key=target.isBase?'base':target.route;
                const record={tick:this.tick,side:target.side,attacker:source.side,kind:key,amount,hp:target.hp};
                state.structures[[target.side,key]]??=record;
                if(target.hp===0)state.losses.push(record);
            } else if (source.isStructure||source.kind==='tower'||source.kind==='base'||extra[0]==='bolt') {
                state.hits.push({tick:this.tick, side:source.side, kind:source.kind,
                    target:target.id, amount, hp:target.hp});
            }
        }
        return damage.call(this,target,source,amount,...extra);
    };
    window.defenseStep=({limit,structure})=>{
        while (b.tick<limit&&b.winner<0&&!state.structures[structure]) Numori.match.step();
        return b.tick;
    };
}"""


def run_trial(browser, source, out, view, route, baseline, weak=None):
    width, height = SCREENS[view]
    touch = view != 'desktop'
    ctx = browser.new_context(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.goto(source, timeout=75000)

    def press(selector):
        button = page.locator(selector).first
        (button.tap if touch else button.click)(timeout=4500)

    def show():
        page.evaluate("""() => {
            Numori.advance(0);
            const {world,battle,economy,routeCue}=Numori;
            world.render({battle,economy,routeCue},1/30);
        }""")

    def shot(label):
        show()
        page.screenshot(path=out/f'{view}-{route}-{label}.png',timeout=20000)

    def focus(x, y):
        press('[data-camera="overview"]')
        mini = page.locator('.nr-map').bounding_box()
        point = (mini['x']+mini['width']*x/3000,mini['y']+mini['height']*y/1800)
        (page.touchscreen.tap if touch else page.mouse.click)(*point)
        show()

    def step(tick, stop_on=None):
        return page.evaluate('defenseStep',{'limit':tick,'structure':stop_on})

    def pay(lane):
        ast = page.evaluate("() => Numori.economy.summonHint(0,{})")
        if not ast or not page.evaluate("() => Numori.economy.sides[0].inventory['=']>0"):
            return None
        if baseline and lane=='supply':
            press('[data-route="supply"]')
        type_tree(press,ast)
        assert page.locator(".ne-unit-count").inner_text().strip().startswith('24')
        if not baseline:
            choose_route(page, press, lane)
        press('[data-action="produce"]')
        return ast

    press('[data-level="normal"]')
    page.evaluate(CLOCK)
    start=page.locator('[data-act="start"]').first
    (start.tap if touch else start.click)(force=True)
    page.wait_for_function("!!window.Numori?.world",polling=40)
    page.evaluate("restoreOpeningRaf()")
    page.evaluate(OBSERVE)
    page.evaluate(OBSERVE_DEFENSE)
    hq = page.evaluate('Numori.battle.bases.map(base=>base.maxHp)')
    assert hq==([14000]*2 if baseline else [1400]*2),hq
    if not baseline:
        towers = page.evaluate("Numori.battle.towers.map(side=>Object.keys(side).sort())")
        assert towers==[['bridge','supply']]*2,towers
    if weak:
        x,y=page.evaluate("""weak => {
            const {battle:b,economy:e}=Numori;
            e.computerOpponent=false;
            const target=weak==='base'?b.bases[0]:b.towers?.[0]?.[weak];
            const x=target?.x??875,y=target?.y??(weak==='supply'?1163.918:900);
            if(weak==='base'&&b.towers)b.towers[0].bridge.hp=0;
            b.spawn(1,'charger',1,false,{route:weak==='supply'?'supply':'bridge'});
            const soldier=b.units[0];
            soldier.x=x+258;
            soldier.y=y;
            soldier.waypoint=weak==='supply'?2:0;
            window.weak={x,y};
            return [x,y];
        }""",weak)
        focus(x,y)
        if not baseline:
            page.evaluate("""() => {
                const b=Numori.battle;
                while(b.tick<360 && !b.projectiles.some(p=>p.kind==='bolt')) Numori.match.step();
                for(let i=0;i<4;i++)Numori.match.step();
            }""")
            assert page.evaluate("Numori.battle.projectiles.some(p=>p.kind==='bolt')"), weak
            shot('bolt')
        step(480)
        shot('weak')
        snapshot = page.evaluate("""() => ({
            attacker:Numori.battle.count(1), hits:defense.hits, structures:defense.structures,
            stats:Numori.battle.stats, webgl:Numori.world.renderStats,
        })""")
        assert not errors,errors
        assert snapshot['webgl']['backend']=='webgl2' and snapshot['webgl']['drawCalls']==1,snapshot
        if baseline:
            assert snapshot['attacker']==1
        else:
            assert snapshot['attacker']==0 and snapshot['stats']['defenseHits']>0,snapshot
        snapshot.update(view=view, weak=weak, hq=hq)
        print(view,'weak',weak,snapshot['attacker'],'alive',snapshot['stats'].get('defenseHits'),flush=True)
        ctx.close()
        return snapshot
    step(120)
    show()
    for button in ['[data-number="8"]','[data-op="mul"]','[data-number="4"]']:
        press(button)
    assert page.locator(".ne-unit-count").inner_text().strip().startswith('24')
    press('[data-action="produce"]')
    page.evaluate("() => {while(!window.firstUnitHit && Numori.battle.tick<270) openingFrame()}")
    first = page.evaluate(VISIBILITY)
    assert first['hit'] and (first['hit']['tick']-120)/30<=5,first
    assert first['hit']['sourceScreen']['visible'] and first['hit']['targetScreen']['visible'],first
    shot('opening')
    press('[data-camera="overview"]')
    shot('map')

    inputs=[]
    shot_tags=set()
    for tick in range(300,30*162,180):
        step(tick)
        show()
        if page.evaluate('Numori.battle.winner>=0'):
            break
        ast=pay(route)
        if ast:
            inputs.append({'tick':tick,'formula':ast})
        marks=page.evaluate('defense')
        attack_key=f'1,{route}'
        if attack_key in marks['structures'] and 'siege' not in shot_tags:
            point=page.evaluate("(route)=>Numori.battle.towers?.[1]?.[route]",route)
            if point:
                focus(point['x'],point['y'])
                shot('siege')
                shot_tags.add('siege')
        if any(event['side']==1 and event['kind']==route for event in marks['losses']) and 'wreck' not in shot_tags:
            point=page.evaluate("(route)=>Numori.battle.towers[1][route]",route)
            focus(point['x'],point['y'])
            shot('wreck')
            shot_tags.add('wreck')
        if '1,base' in marks['structures'] and 'base' not in shot_tags:
            focus(2640,900)
            shot('base')
            shot_tags.add('base')
    result=page.evaluate("""() => ({
        state:defense,tick:Numori.battle.tick,winner:Numori.battle.winner,
        produced:Numori.economy.sides.map(side=>side.stats.produced),
        stock:Numori.battle.bases.map(base=>base.hp),stats:Numori.battle.stats,
        webgl:Numori.world.renderStats,
    })""")
    assert not errors,errors
    assert result['webgl']['backend']=='webgl2' and result['webgl']['drawCalls']==1,result['webgl']
    if not baseline:
        losses=result['state']['losses']
        tower_loss=next((event for event in losses if event['side']==1 and event['kind']==route),None)
        hq_hit=result['state']['structures'].get('1,base')
        assert result['winner']==0 and tower_loss and hq_hit and tower_loss['tick']<hq_hit['tick'],result
    result.update(view=view, route=route, first=(first['hit']['tick']-120)/30, hq=hq, inputs=inputs)
    print(view,route,'first',round(result['first'],3),'winner',result['winner'],
          'targets',result['state']['structures'],'losses',result['state']['losses'],flush=True)
    ctx.close()
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--baseline',action='store_true')
    parser.add_argument('--views',nargs='+',choices=SCREENS,default=['portrait','landscape','desktop'])
    parser.add_argument('--routes',nargs='+',choices=['bridge','supply'],default=['bridge','supply'])
    parser.add_argument('--weak',nargs='+',choices=['bridge','supply','base'])
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    raw=urlsplit(args.source if '://' in args.source else Path(args.source).resolve().as_uri())
    query=dict(parse_qsl(raw.query),debug='1',seed='123')
    source=urlunsplit((*raw[:3],urlencode(query),''))
    runs=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome')
        for view in args.views:
            for route in args.weak or args.routes:
                runs.append(run_trial(browser,source,args.out,view,route,args.baseline,weak=route if args.weak else None))
                (args.out/'trials.json').write_text(json.dumps(runs,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()


if __name__=='__main__':
    main()
