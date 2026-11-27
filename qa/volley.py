"""Measure both defense tower types and HQ using the shipped game in Chrome."""
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from playwright.sync_api import sync_playwright

from opening import CLOCK
from two_fronts import SCREENS


FIXTURE = """kind => {
    const {battle, economy} = Numori;
    economy.computerOpponent = false;
    const building = kind === 'base' ? battle.bases[0] : battle.towers[0][kind];
    for (const other of battle.defenders) {
        if (other !== building && !other.isBase) other.hp = 0;
    }
    const route = kind === 'supply' ? 'supply' : 'bridge';
    battle.spawn(1, 'shield', 3, false, {route});
    battle.spawn(0, 'shield', 1, false, {route});
    const positions = [[83,0],[100,18],[105,65],[100,-18]];
    const roles = ['target','nearby','outside','ally'];
    battle.units.forEach((unit, index) => {
        const [x, y] = positions[index];
        Object.assign(unit, {x:building.x+x, y:building.y+y, hp:5000, maxHp:5000});
        unit.spec = {...unit.spec, speed:0, damage:0, range:0};
    });
    const labels = new Map(battle.units.map((unit, index) => [unit.id, roles[index]]));
    const snapshot = window.volley = {
        building: {id:building.id, hp:building.hp}, shots:[], impacts:[], arcSamples:[],
        hp:{}, tick:0
    };
    const original = battle.recordDamage;
    battle.recordDamage = function(target, source, amount, ...rest) {
        if (source.side === building.side && amount > 0 && labels.has(target.id)) {
            snapshot.impacts.push({tick:this.tick, role:labels.get(target.id), amount, style:rest[0]});
        }
        return original.call(this, target, source, amount, ...rest);
    };
    window.stepVolley = () => {
        Numori.match.step();
        for (const shot of battle.projectiles) {
            if (shot.sourceId !== building.id) continue;
            if (shot.age === 0) {
                snapshot.shots.push({tick:battle.tick, kind:shot.kind, z:shot.z,
                    damage:shot.spec.damage, x:shot.x, y:shot.y, serial:shot.serial});
            }
            if (shot.kind === 'mortar') {
                snapshot.arcSamples.push({tick:battle.tick, serial:shot.serial, z:shot.z, x:shot.x, y:shot.y});
            }
        }
        snapshot.hp = Object.fromEntries(battle.units.map(unit => [labels.get(unit.id), unit.hp]));
        snapshot.tick = battle.tick;
    };
    return {x:building.x+55, y:building.y};
}"""


def replay(browser, source, out, view, kind, baseline):
    width, height = SCREENS[view]
    touch = view != 'desktop'
    context = browser.new_context(viewport={'width':width,'height':height},is_mobile=touch,has_touch=touch)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.goto(source, timeout=75000)

    def press(selector):
        button = page.locator(selector).first
        (button.tap if touch else button.click)(timeout=5500)

    def capture(stage):
        stats = page.evaluate("""() => {
            Numori.world.render({battle:Numori.battle,economy:Numori.economy},1/30);
            return Numori.world.renderStats;
        }""")
        assert stats['backend']=='webgl2' and stats['drawCalls']==1, stats
        page.screenshot(path=out/f'{view}-{kind}-{stage}.png',timeout=25000)
        return stats

    page.evaluate(CLOCK)
    press('[data-act="start"]')
    page.wait_for_function("!!window.Numori?.world",polling=40)
    page.evaluate("restoreOpeningRaf()")
    focus = page.evaluate(FIXTURE,kind)
    press('[data-camera="overview"]')
    mini = page.locator('.nr-map').bounding_box()
    point = (mini['x']+mini['width']*focus['x']/3000,mini['y']+mini['height']*focus['y']/1800)
    (page.touchscreen.tap if touch else page.mouse.click)(*point)

    page.evaluate("() => {for(let i=0;i<3;i++)stepVolley()}")
    stats = capture('direct')
    if not baseline:
        page.evaluate("""() => {
            const b=Numori.battle;
            while(b.tick<75 && !b.projectiles.some(p=>p.kind==='mortar' &&
                p.age / p.duration >= 0.43 && p.z > 83))stepVolley();
            if(b.tick>=75)throw Error('Mortar arc was not visible above a direct shot');
        }""")
        capture('arc')
        page.evaluate("""() => {
            const b=Numori.battle;
            while(b.tick<90 && !b.effects.some(e=>e.kind==='defenseBlast'))stepVolley();
            if(b.tick>=90)throw Error('No defensive splash effect landed');
            for(let i=0;i<3;i++)stepVolley();
        }""")
        capture('impact')

    result = page.evaluate("""() => {
        for(let i=0;i<150;i++)stepVolley();
        return volley;
    }""")
    sequence = result['shots'][:10]
    assert len(sequence)>4, result
    intervals = [shot['tick']-prev['tick'] for prev,shot in zip(sequence,sequence[1:])]
    expected_damage = 24 if kind=='base' else 22
    assert all(shot['damage']==expected_damage for shot in sequence),sequence
    assert result['building']['hp']==(1400 if kind=='base' else 720)
    assert result['hp']['ally']==5000 and result['hp']['outside']==5000, result['hp']
    assert result['hp']['target']<5000
    if baseline:
        assert all(shot['kind']=='bolt' for shot in sequence)
        assert all(interval>=30 for interval in intervals), intervals
        assert result['hp']['nearby']==5000
    else:
        assert len(sequence)==10 and all(interval==6 for interval in intervals), sequence
        assert [shot['kind'] for shot in sequence]==['bolt']*4+['mortar']+['bolt']*4+['mortar'], sequence
        splash_hits = [hit for hit in result['impacts'] if hit['style']=='defenseBlast']
        impact_ticks = {hit['tick'] for hit in splash_hits if hit['role']=='nearby'}
        assert impact_ticks, result['impacts']
        assert all(any(hit['tick']==tick and hit['role']=='target' for hit in splash_hits)
                   for tick in impact_ticks), splash_hits
        assert all(hit['amount']==expected_damage for hit in splash_hits), splash_hits
        assert result['hp']['nearby']<5000

    assert not errors, errors
    result.update(view=view,kind=kind,intervals=intervals,drawCalls=stats['drawCalls'])
    print(view,kind,[shot['kind'] for shot in sequence[:5]],intervals[:4],result['hp'],flush=True)
    context.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--out',required=True,type=Path)
    parser.add_argument('--baseline',action='store_true')
    parser.add_argument('--views',nargs='+',choices=SCREENS,default=['portrait','landscape','desktop'])
    args = parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    raw = urlsplit(args.source if '://' in args.source else Path(args.source).resolve().as_uri())
    query = dict(parse_qsl(raw.query),debug='1',seed='123')
    source = urlunsplit((*raw[:3],urlencode(query),''))
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome')
        for view in args.views:
            for kind in ('bridge','supply','base'):
                rows.append(replay(browser,source,args.out,view,kind,args.baseline))
                (args.out/'trials.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()


if __name__=='__main__':
    main()
