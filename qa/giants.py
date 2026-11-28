"""Play both routes using the shipped game and compare neutral giant recruitment."""
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright

from opening import CLOCK, OBSERVE, VISIBILITY
from two_fronts import SCREENS, choose_route, type_tree


WATCH = """() => {
    const {battle,economy} = Numori;
    const capture = new Map();
    const original = battle.recordDamage;
    const ledger = side => ({stock:{...side.inventory}, gathered:{...side.stats.gathered}, workers:side.stats.deliveries});
    window.giantDamage = [];
    window.giantDefended = [];
    battle.recordDamage = function(target,source,amount,...rest) {
        if (amount>0 && target.isStructure) {
            const type = source.giantKind ?? Object.keys(Battle.giants).find(key=>Battle.giants[key]===source.spec);
            if (type) giantDamage.push({tick:battle.tick,side:source.side,kind:type,target:target.kind,amount});
        } else if (amount>0 && target.giantKind && source.isStructure) {
            giantDefended.push({tick:battle.tick,side:target.side,kind:target.giantKind,style:rest[0],amount});
        }
        return original.call(this,target,source,amount,...rest);
    };
    const captureGiants = battle.capture;
    battle.capture = function(...args) {
        const station=this.station;
        const before=station.lastRecruit;
        const old=economy.sides.map(ledger);
        const result=captureGiants.apply(this,args);
        if(station.lastRecruit !== before) {
            const event=station.lastRecruit;
            capture.set(this.tick,{...event,tick:this.tick,before:old,after:economy.sides.map(ledger),
                nextSpawn:station.nextSpawn, units:this.units.filter(u=>u.giantKind).map(u=>({
                    side:u.side,giantKind:u.giantKind,id:u.id,route:u.route,x:u.x,y:u.y,hp:u.hp
                }))});
        }
        return result;
    };
    window.giantStep=({limit,stop})=>{
        const station=battle.station;
        while(battle.tick<limit && battle.winner<0) {
            Numori.match.step();
            if(stop && capture.get(battle.tick)?.side === 0)break;
        }
        return {tick:battle.tick,winner:battle.winner,captures:[...capture.values()], damage:giantDamage, defended:giantDefended,
            recruits:station.recruits.slice(), towers:battle.towers.map(side=>[side.bridge.hp,side.supply.hp]),
            bases:battle.bases.map(base=>base.hp), shots:battle.stats.defenseShots, blasts:battle.stats.defenseBlasts};
    };
}"""


def assert_box(page, selector, width, height):
    box = page.locator(selector).first.bounding_box()
    assert box and box['width']>0 and box['height']>0, selector
    assert -1<=box['x'] and box['x']+box['width']<=width+1, (selector,box)
    assert -1<=box['y'] and box['y']+box['height']<=height+1, (selector,box)


def run_trial(browser, source, out, view, route):
    width,height=SCREENS[view]
    touch=view!='desktop'
    ctx=browser.new_context(viewport={'width':width,'height':height},has_touch=touch,is_mobile=touch)
    page=ctx.new_page()
    errors=[]
    page.on('pageerror',lambda err: errors.append(str(err)))
    page.goto(source,timeout=75000)

    def press(selector, force=False):
        button=page.locator(selector).first
        (button.tap if touch else button.click)(timeout=6000,force=force)

    def refresh():
        return page.evaluate("""() => {
            Numori.advance(0);
            const {world,battle,economy,routeCue}=Numori;
            world.render({battle,economy,routeCue},1/30);
            return Numori.world.renderStats;
        }""")

    def capture(label):
        stats=refresh()
        assert stats['backend']=='webgl2' and stats['drawCalls']==1,stats
        page.screenshot(path=out/f'{view}-{route}-{label}.png',timeout=25000)

    def focus_altar():
        press('[data-route="supply"]')

    def step(limit,stop=False):
        return page.evaluate('giantStep',dict(limit=limit,stop=stop))

    def pay(witness, lane='bridge'):
        type_tree(press,witness)
        assert page.locator('.ne-unit-count').inner_text().strip().startswith('24')
        if page.evaluate("Numori.economy.sides[0].stats.firstProduction!==null"):
            choose_route(page, press, lane)
        press('[data-action="produce"]')

    press('[data-level="normal"]')
    page.evaluate(CLOCK)
    press('[data-act="start"]',force=True)
    page.wait_for_function('!!window.Numori?.world',polling=40)
    page.evaluate('restoreOpeningRaf()')
    page.evaluate(OBSERVE)
    page.evaluate(WATCH)
    assert page.locator('[data-action="produce"]').is_disabled()
    assert page.locator('#stationEta,#stationReward,#stationOwner').count()==0
    initial=page.evaluate("Numori.battle.station.giantKind")
    assert initial in ('bulwark','breaker','lobber'),initial
    capture('initial')
    assert step(120)['tick']==120
    refresh()
    pay({'type':'op','id':'mul','args':[{'type':'num','key':'8'},{'type':'num','key':'4'}]})
    page.evaluate("() => {while(!window.firstUnitHit && Numori.battle.tick<270) openingFrame()}")
    first=page.evaluate(VISIBILITY)
    assert first['hit'] and first['hit']['tick']-120==88,first
    assert first['hit']['sourceScreen']['visible'] and first['hit']['targetScreen']['visible'],first
    assert step(270)['tick']==270
    refresh()
    witness=page.evaluate('Numori.economy.summonHint(0,{})')
    assert witness
    type_tree(press,witness)
    assert page.locator('.ne-unit-count').inner_text().strip().startswith('24')
    choose_route(page, press, route)
    for selector in ('[data-route="supply"]','#giantName','.ne-unit-count',
                     '[data-route="bridge"]','[data-action="produce"]'):
        assert_box(page,selector,width,height)
    capture('selected')
    press('[data-action="produce"]')
    assert page.evaluate("(route) => Numori.economy.sides[0].stats.byRoute[route]",route)==(24 if route=='supply' else 48)

    capture('march')
    first_recruit=None
    seen_recruits=set()
    end_tick=30*180
    for tick in range(30*17,end_tick,30*6):
        state=step(tick,stop=True)
        own=next((event for event in state['captures']
                  if event['side']==0 and event['tick'] not in seen_recruits),None)
        if own:
            seen_recruits.add(own['tick'])
            if first_recruit is None:
                first_recruit=own
            assert any(u['side']==0 and u['giantKind']==own['giantKind'] and u['route']=='supply' for u in own['units']),own
            assert own['before']==own['after'],own
            assert abs(own['nextSpawn']-own['time']-28)<1e-7,own
            focus_altar()
            capture('recruit-'+own['giantKind'])
            assert '아군' in page.locator('#giantPhaseLabel').inner_text()
            press('[data-route="bridge"]')
        state=step(tick)
        if state['winner']>=0:
            break
        refresh()
        if page.evaluate("Numori.economy.sides[0].inventory['=']>0"):
            witness=page.evaluate("Numori.economy.summonHint(0,{})")
            if witness:
                pay(witness,route)
    state=step(end_tick)
    kinds=[event['giantKind'] for event in state['captures']]
    assert all(left!=right for left,right in zip(kinds,kinds[1:])),kinds
    if len(kinds)>=3:
        assert len(set(kinds[:3]))==3,kinds
    if route=='supply':
        assert first_recruit and state['recruits'][0]>0,state
    else:
        assert state['recruits'][0]==0,state
    capture('late')
    assert not errors,errors
    result={**state,'view':view,'route':route,'first':(first['hit']['tick']-120)/30,
        'initial':initial,'firstRecruit':first_recruit}
    print(view,route,'first',round(result['first'],3),'recruits',state['recruits'],
          'towers',state['towers'],'HQs',state['bases'],'winner',state['winner'],flush=True)
    ctx.close()
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--views',nargs='+',choices=SCREENS,default=['portrait','landscape','desktop'])
    parser.add_argument('--routes',nargs='+',choices=['bridge','supply'],default=['bridge','supply'])
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    raw=urlsplit(args.source if '://' in args.source else Path(args.source).resolve().as_uri())
    query=dict(parse_qsl(raw.query),debug='1',seed='123')
    source=urlunsplit((*raw[:3],urlencode(query),''))
    result=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome')
        for view in args.views:
            for route in args.routes:
                result.append(run_trial(browser,source,args.out,view,route))
                (args.out/'trials.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()


if __name__=='__main__':
    main()
