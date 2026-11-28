"""Offline release scenario for fixed workers, the summon target, army HUD and rotation."""
from pathlib import Path
from os import environ
import re
from playwright.sync_api import expect, sync_playwright

from two_fronts import choose_route, type_tree

QA = Path(__file__).resolve().parent
GAME = (QA.parent / "numori-beta.html").as_uri() + "?debug=1&seed=123"
EXACT_SEQUENCE = "8 mul 4"
NEAR_SEQUENCE = "8 mul 4 sub 2"
EXACT_TYPE = "archer"


def run(browser, name, width, height, touch):
    context = browser.new_context(viewport={"width": width, "height": height},
                                  has_touch=touch, is_mobile=touch, offline=True)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(GAME)

    def press(selector):
        button = page.locator(selector).first
        (button.tap if touch else button.click)()

    def text(selector):
        return page.locator(selector).inner_text()

    def token(key):
        attr = "number" if key.isdigit() else "op"
        press(f'[data-{attr}="{key}"]')

    def shot(stage):
        if dest := environ.get("NUMORI_QA_SHOTS"):
            page.screenshot(path=Path(dest) / f"{name}-{stage}.png")

    def dispatch(count):
        assert text(".ne-dispatch-count").replace(" ", "") == f"{count}마리"
        launch=page.locator('[data-action="produce"]')
        enabled=count > 0
        assert launch.is_enabled() == enabled
        if enabled:
            assert re.search(rf"(?<!\d){count}\s*마리", launch.inner_text()), launch.inner_text()

    def scoreboard_fits():
        clipped = page.evaluate("""() => {
            const cells=['.ne-goal-cell span','.ne-result-cell span','.ne-dispatch-cell span',
                '.ne-goal','.ne-result','.ne-dispatch-count','.ne-produce-label'];
            return cells.filter(sel=>{
                const e=document.querySelector(sel);
                const r=document.createRange();r.selectNodeContents(e);
                const text=r.getBoundingClientRect(), parent=e.parentElement.getBoundingClientRect();
                return text.width<=0 || text.left<Math.max(parent.left,0)-1 ||
                    text.right>Math.min(parent.right,innerWidth)+1 || text.top<Math.max(parent.top,0)-1 ||
                    text.bottom>Math.min(parent.bottom,innerHeight)+1;
            });
        }""")
        assert not clipped, (name,clipped)

    press('[data-level="easy"]')
    press('[data-act="start"]')
    hud = page.get_by_text("병력 0/1,000", exact=True)
    assert hud.is_visible()
    assert text(".ne-result") == "—"
    dispatch(0)
    goal = float(text(".ne-goal"))
    assert goal == 32
    assert page.locator('[data-target="worker"],[data-target="expand"],[data-act="expand"]').count()==0
    assert page.evaluate("Numori.battle.units.length===0 && Numori.economy.sides.every(s=>s.workers.length===10)")
    assert page.evaluate("MathCore.numbers.join('')")== '123456789'
    assert set(page.locator("[data-op]").evaluate_all("(els)=>els.map(e=>e.dataset.op)"))=={"add","sub","mul","div"}
    assert page.locator('[data-tab="advanced"],[data-tab="basic"],.ne-extra-operators').count()==0
    if not touch:
        audit=page.evaluate("""()=>{
            const basic=['add','sub','mul','div'], safe=new Set([...MathCore.numbers,...basic,'=']);
            const n=MathCore.num('2'),e=Numori.economy,s=e.sides[0];
            const rejected=['neg','abs','sqrt','pow','log','sin','cos','tan'].map(id=>MathCore.op(id,n,n));
            rejected.push({type:'angle',digits:'30'});
            const before=JSON.stringify(s.inventory);
            if (!rejected.every(a=>!MathCore.evaluate(a).ok && !e.produce(0,'summon',MathCore.op('add',n,a)).ok))return false;
            if(before!==JSON.stringify(s.inventory) || Object.keys(MathCore.ops).sort().join()!==[...basic].sort().join())return false;
            const basicTree=a => a.type==='num' ? MathCore.numbers.includes(a.key) :
                a.type==='op' && basic.includes(a.id) && a.args.length===2 && a.args.every(basicTree);
            const results=[];
            for (const difficulty of ['easy','normal','hard']) {
                const battle=Battle.create(123),eco=new Economy({seed:123,difficulty,battle});
                const costs=Object.keys(eco.config.gasWeights).sort();
                if(costs.join()!==[...basic,'='].sort().join())return false;
                const opening=eco.produce(0,'summon',eco.sides[0].summonWitness);
                if(!opening.ok || opening.route!=='bridge')return false;
                let decisions=0;
                for (let tick=0;tick<30*75;tick++) {
                    eco.tick(1/30);battle.step(1/30);
                    if(tick%300===0){const p=eco.decisions(1);if(p){decisions++;if(!basicTree(p.ast))return false;}}
                }
                const enemy=eco.sides[1];
                if(!decisions || !enemy.stats.produced || ![enemy.inventory,enemy.stats.gathered,enemy.stats.spent]
                    .every(bag=>Object.keys(bag).every(k=>safe.has(k))))return false;
                results.push([difficulty,decisions,enemy.stats.produced]);
            }
            return results;
        }""")
        assert audit,audit
        print("PASS former operations and angle rejected; AI decisions and production", audit, flush=True)
    assert page.evaluate("""() => {
        const e=Numori.economy, side=e.sides[0], initial=JSON.stringify(side.inventory);
        const accepted=['worker','expand','attack','health'].some(m=>e.produce(0,m,MathCore.num('8')).ok);
        return !accepted && initial===JSON.stringify(side.inventory);
    }""")
    for side in (0,1):
        assert page.evaluate("side=>Numori.economy.allocation(side)",side) == {
            "mineral":5, "gas":5, "idle":0}
    # Trace the actual carry transition on every simulation tick. A stock increment must
    # coincide with a previously loaded unit unloading at the base.
    trace = page.evaluate("""() => {
        const sides=Numori.economy.sides, totals=()=>sides.map(s=>Object.values(s.inventory).reduce((a,b)=>a+b,0));
        const last=new Map(), measured=new Set(), periods={mineral:[],gas:[]};
        const digStart=new Map(), digWorkers=new Set(), digging={mineral:[],gas:[]}, speeds=[];
        let outbound=false, loadedAway=false;
        for (let tick=0;tick<480;tick++) {
            const prev=sides.map(s=>s.workers.map(w=>({x:w.x,y:w.y,phase:w.phase,cargo:w.cargo,trip:w.trip})));
            const before=totals();
            Numori.advance(1);
            const after=totals();
            sides.forEach((s,side)=>{
                const base=Numori.battle.bases[side];
                let deliveries=0;
                s.workers.forEach((w,j)=>{
                    const old=prev[side][j], distance=Math.hypot(w.x-base.x,w.y-base.y);
                    if ((w.x!==old.x || w.y!==old.y) && w.phase==='out') {
                        outbound=true;
                        speeds.push(30*Math.hypot(w.x-old.x,w.y-old.y));
                    }
                    if (w.phase==='dig' && old.phase!=='dig') digStart.set(w.id,tick);
                    if (old.phase==='dig' && w.phase==='dig' && (w.x!==old.x || w.y!==old.y))
                        throw Error('worker moved during digging');
                    if (old.phase==='dig' && w.phase==='back' && w.cargo!=null && digStart.has(w.id)) {
                        digging[old.trip].push((tick-digStart.get(w.id))/30);
                        digWorkers.add(w.id);
                        digStart.delete(w.id);
                    }
                    if (w.phase==='back' && w.cargo!=null && distance>100) loadedAway=true;
                    if (old.cargo!=null && w.cargo==null && distance<Battle.settings.hqRadius) {
                        deliveries++;
                        if (last.has(w.id)) {
                            periods[old.trip].push((tick-last.get(w.id))/30);
                            measured.add(w.id);
                        }
                        last.set(w.id,tick);
                    }
                });
                if (after[side]-before[side]!==deliveries) throw Error('stock changed independently of a return');
            });
        }
        return {outbound,loadedAway,workers:measured.size,periods,digging,digWorkers:digWorkers.size,
            slow:Math.min(...speeds),fast:Math.max(...speeds)};
    }""")
    assert trace["outbound"] and trace["loadedAway"] and trace["workers"]==20, trace
    assert trace["digWorkers"]==20 and max(abs(trace[k]-166) for k in ("slow","fast"))<1e-6, trace
    for mine_kind,periods in trace["periods"].items():
        digs=trace["digging"][mine_kind]
        assert len(digs)>=10 and all(x==2 for x in digs), (mine_kind,digs)
        assert len(periods)>=10 and all(x>max(digs) for x in periods), (mine_kind,periods)
        print(f"{name} {mine_kind}: stationary dig {min(digs):.3f}–{max(digs):.3f}s; full return interval "
              f"{min(periods):.3f}–{max(periods):.3f}s ({len(periods)} trips)",flush=True)
    press('[data-act="labor"]')
    def mine(kind,delta):
        return f'[data-mine="{kind}"] [data-delta="{delta}"]'
    assert set(page.locator('[data-mine]').evaluate_all("(els)=>els.map(e=>e.dataset.mine)"))=={'mineral','gas'}
    for kind in ("mineral","gas"):
        for _ in range(5): press(mine(kind,-1))
    page.evaluate("Numori.advance(120)")
    assert page.evaluate("Numori.economy.sides[0].workers.every(w=>w.phase==='idle' && w.cargo==null)")
    assert page.evaluate("""()=>{const s=Numori.economy.sides[0];const old=JSON.stringify(s.inventory);
        Numori.advance(180);return old===JSON.stringify(s.inventory)}""")
    press('[data-act="labor"]')
    def formula(sequence):
        if page.locator('[data-action="clear"]').is_enabled():
            press('[data-action="clear"]')
        for key in sequence.split():
            token(key)

    def produce():
        press('[data-action="produce"]')

    def fresh_units():
        return page.evaluate("Numori.battle.units.filter(u=>u.side===0).map(u=>u.id)")

    def verify_batch(before, kind, number, damage, hp):
        units = page.evaluate("""ids => Numori.battle.units.filter(u=>u.side===0 && !ids.includes(u.id))
            .map(u=>[u.type,u.spec.damage/Battle.types[u.type].damage,
                   u.maxHp/Battle.types[u.type].hp,u.hp/u.maxHp])""", before)
        assert len(units) == number, units
        for unit, attack_ratio, health_ratio, health_fraction in units:
            assert unit == kind
            assert abs(attack_ratio-damage)<1e-8 and abs(health_ratio-hp)<1e-8
            assert health_fraction == 1

    # All ingredients come from the match's own stock. A preview does not spend any.
    assert page.locator('[data-tab="decimal"],[data-number="π"],[data-number="e"]').count()==0
    assert page.locator('[data-number]').evaluate_all("(els)=>els.map(e=>e.dataset.number).sort().join('')")=="123456789"
    assert "30~34" in text(".ne-rule")
    snapshot = """() => JSON.stringify([Numori.economy.sides[0].inventory,Numori.economy.sides[0].targets,
        Numori.economy.sides[0].stats.spent,Numori.battle.count(0)])"""
    initial = page.evaluate(snapshot)
    for seq in ("8", "8 mul 4 sub 3", "8 mul 4 add 3"):
        formula(seq)
        dispatch(0)
        button=page.locator('[data-action="produce"]')
        assert button.is_disabled()
        button.scroll_into_view_if_needed()
        box=button.bounding_box()
        for _ in range(3):
            x,y=box["x"]+box["width"]/2,box["y"]+box["height"]/2
            if touch:page.touchscreen.tap(x,y)
            else:page.mouse.click(x,y)
            page.keyboard.press("Enter")
        assert page.evaluate(snapshot)==initial
        assert not page.evaluate("Numori.economy.produce(0,'summon',Numori.editor.ast()).ok")
        assert page.evaluate(snapshot)==initial
    formula("3 div 2")
    dispatch(0)
    assert text(".ne-result")=="1.5" and page.locator('[data-action="produce"]').is_disabled()
    for key in ("mul","4","mul","5"):
        token(key)
    assert text(".ne-result")=="30" and page.locator('[data-action="produce"]').is_enabled()
    # Restore active workers after checking repeated submissions with a quiescent inventory.
    press('[data-act="labor"]')
    for kind,amount in [("mineral",4),("gas",6)]:
        for _ in range(amount): press(mine(kind,1))
    assert page.evaluate("Numori.economy.allocation(0).gas")==6
    press('[data-act="labor"]')
    # Make each permitted non-exact value using the seed's opening inventory.
    for suffix,value,amount in [("sub 3 add 2",31,16),("add 3 sub 2",33,16),("add 2",34,8)]:
        formula("8 mul 4 "+suffix)
        assert int(text(".ne-result"))==value
        dispatch(amount)
        scoreboard_fits()
        before_count=len(fresh_units())
        produce()
        assert len(fresh_units())==before_count+amount and float(text(".ne-goal"))==goal
        press('[data-act="menu"]')
        press('[data-act="restart"]')
    # Exercise a near miss before playing the exact witness on a fresh match.
    formula(NEAR_SEQUENCE)
    assert float(text(".ne-result")) == goal - 2
    near_count = int(text(".ne-dispatch-count").removesuffix("마리"))
    assert near_count == 8
    dispatch(8)
    assert "2" in text(".ne-delta")
    before_count = len(fresh_units())
    produce()
    assert len(fresh_units()) == before_count + near_count
    assert float(text(".ne-goal")) == goal
    press('[data-act="menu"]')
    press('[data-act="restart"]')
    formula(EXACT_SEQUENCE)
    assert text(".ne-result") == text(".ne-goal") and float(text(".ne-result")) == goal
    assert "24마리" in text(".ne-delta")
    dispatch(24)
    scoreboard_fits()
    shot("exact")
    before=fresh_units()
    produce()
    verify_batch(before, EXACT_TYPE, 24, 1, 1)
    expect(page.get_by_text("병력 24/1,000",exact=True)).to_be_visible()
    next_goal = text(".ne-goal")
    assert float(next_goal)>0 and float(next_goal) != goal
    assert page.evaluate("""() => {
        const side = Numori.economy.sides[0];
        const witness = side.summonWitness;
        const validOps = node => node.type === 'num' ||
            (['add','sub','mul','div'].includes(node.id) && node.args.every(validOps));
        const r = MathCore.evaluate(witness);
        return r.ok && r.value === side.targets.summon && validOps(witness) &&
            Object.entries(r.cost).every(([key,n]) => side.inventory[key] >= n);
    }""")
    shot("rotated")

    # Select before writing the formula, then keep the route while replacing a partial draft.
    launch=page.locator('[data-action="produce"]')
    assert launch.is_disabled()
    produced="Numori.economy.sides[0].stats.produced"
    before_choice=page.evaluate(produced)
    press('[data-route="supply"]')
    assert page.locator('[data-route="supply"]').get_attribute('aria-pressed') == 'true'
    assert launch.is_disabled()
    witness=page.evaluate("Numori.economy.summonHint(0,{})")
    assert witness
    first_number=page.evaluate("""ast => {
        while (ast.type === 'op') ast = ast.args[0];
        return ast.key;
    }""",witness)
    token(first_number)
    assert page.locator('[data-route="supply"]').get_attribute('aria-pressed') == 'true'
    press('[data-action="clear"]')
    assert page.locator('[data-route="supply"]').get_attribute('aria-pressed') == 'true'
    assert launch.is_disabled()
    type_tree(press,witness)
    dispatch(24)
    assert launch.get_attribute('data-destination') == 'supply'
    draft=page.evaluate("JSON.stringify(Numori.editor.ast())")
    choose_route(page, press, 'bridge')
    choose_route(page, press, 'supply')
    assert before_choice==page.evaluate(produced)
    assert draft==page.evaluate("JSON.stringify(Numori.editor.ast())")
    dispatch(24)
    for selector in ('[data-action="produce"]','[data-route="bridge"]','[data-route="supply"]'):
        box=page.locator(selector).bounding_box()
        assert box and 0<=box['x'] and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,box
    shot("choose-route")
    if touch:
        produce()
    else:
        launch.focus()
        page.keyboard.press("Enter")
    assert page.evaluate("Numori.economy.sides[0].stats.byRoute.supply") == 24
    assert launch.is_disabled()
    assert page.locator('[data-route="bridge"]').get_attribute('aria-pressed') == 'true'

    # A separate match proves that recruiting a giant never changes the hand or worker roster.
    assert page.evaluate("""() => {
        const battle = Battle.create(123);
        const economy = new Economy({seed:123, battle, computerOpponent:false});
        const side = economy.sides[0];
        for (const mine of ['mineral','gas']) {
            for (let i=0; i<5; i++) economy.assign(0,mine,-1);
        }
        const before = JSON.stringify(side.inventory);
        const kind = battle.station.giantKind;
        if (!kind || !battle.spawn(0,'shield',8,false,{route:'supply'})) return false;
        let firstLead;
        for (let i=0; i<30*72 && battle.station.recruits[0]===0; i++) {
            economy.tick(1/30);
            battle.step(1/30);
            if (battle.station.claimant===0) firstLead ??= battle.tick;
        }
        return Battle.settings.captureSeconds===30 && battle.tick-firstLead+1===30*30 &&
            battle.station.recruits[0]===1 && battle.station.recruits[1]===0 &&
            battle.units.some(u=>u.side===0 && u.giantKind===kind) &&
            JSON.stringify(side.inventory)===before && side.workers.length===10 &&
            side.workers.every(w=>w.assigned===null) && side.stats.produced===0;
    }""")
    # Reproduce hard-to-reach population and inventory states in the loaded artifact.
    # The normal editor still handles both previews and the actual production click.
    press('[data-act="menu"]')
    press('[data-act="restart"]')
    formula(EXACT_SEQUENCE)
    page.evaluate("()=>{Numori.economy.sides[0].inventory['=']=0;Numori.advance(0)}")
    dispatch(0)
    assert text(".ne-result")==text(".ne-goal")=="32"
    page.evaluate("""()=>{Numori.economy.sides[0].inventory['=']=1;
        Numori.battle.spawn(0,'shield',995);Numori.advance(0)}""")
    dispatch(5)
    scoreboard_fits()
    shot("capped")
    produce()
    assert page.evaluate("Numori.battle.count(0)")==1000
    assert page.evaluate("Numori.economy.sides[0].stats.byType.archer")==5
    assert page.evaluate("document.documentElement.scrollWidth") == width
    assert not errors, errors
    print(f"PASS {name}: goal {goal}, actual 0/5/8/16/24, next {next_goal}; visible scoreboard and CTA match spawned units", flush=True)
    context.close()


if __name__ == "__main__":
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for args in [("pc", 1440, 900, False), ("portrait", 390, 844, True),
                     ("landscape", 844, 390, True), ("small", 360, 640, True),
                     ("tiny", 320, 568, True), ("short", 568, 320, True)]:
            run(browser, *args)
        browser.close()

