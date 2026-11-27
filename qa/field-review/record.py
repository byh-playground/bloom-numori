"""Use real production controls; preserve the seed, input ticks and camera targets for visual comparison."""
import argparse, io, json, math
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
from PIL import Image, ImageOps, ImageDraw

BASE = Path(__file__).resolve().parent
PLAN = BASE/'playback-arithmetic.json'
SIZES = {'phone':(390,844),'landscape':(844,390),'pc':(1440,900)}
# Plan uses exactly the live inventory and production previews. It never spawns a troop directly.
CHOOSE="""turn=>{
 const eco=Numori.economy;
 const mode='summon';
 const roles=Object.keys(Battle.types), requested=roles[turn%roles.length];
 let best=null;
 for(const a of ['2','3','4','5','6','7','8','9'])for(const op of ['mul','add','sub','div'])
 for(const b of ['2','3','4','5','6','7','8','9']){
   const ast=MathCore.op(op,MathCore.num(a),MathCore.num(b)), p=eco.preview(0,mode,ast);
   if(!p.ok)continue;
   const score=p.actual+(p.unitType===requested?6:0)-p.waste*.01;
   if(!best||score>best.score)best={mode,a,b,op,score,actual:p.actual,unit:p.unitType};
 }return best;
}"""
STATE="""()=>{
 const b=Numori.battle,e=Numori.economy,s=b.stats, first=b.units.find(u=>u.side===0);
 return {tick:Math.round(b.time*30),time:+b.time.toFixed(3),winner:b.winner,units:[b.count(0),b.count(1)],
         types:b.counts,attacks:s.attacks,hits:s.hits,shots:s.shots,blasts:s.blasts,
         mines:b.mines.map(m=>({owner:m.owner,progress:m.progress,presence:m.presence,x:m.x,y:m.y})),
         bases:b.bases.map(v=>({hp:v.hp,max:v.maxHp,x:v.x,y:v.y})),focus:b.focus,
         first:first?{x:first.x,y:first.y}:null,
         moving:b.units.filter(u=>u.moving).length,windups:b.units.filter(u=>u.windup>0).length,
         projectileCount:b.projectiles.length,deaths:s.deaths,captures:s.captures,
         production:e.sides.map(s=>s.stats.produced),deposits:e.sides.map(s=>s.stats.deliveries),
         workers:e.sides.map(s=>s.workers.length),armyLimit:e.config.armyLimit,
         camera:Numori.world.camera};
}"""

def open_game(browser,source,name):
    w,h=SIZES[name]; touch=name!='pc'
    ctx=browser.new_context(viewport={'width':w,'height':h},is_mobile=touch,has_touch=touch,device_scale_factor=1)
    page=ctx.new_page();page.set_default_timeout(4000)
    page.clock.install(time='2026-11-27T00:00:00Z')
    page.clock.pause_at('2026-11-27T00:00:01Z')
    page.goto(source+'?seed=123&debug=1')
    def press(selector):
        loc=page.locator(selector).first
        (loc.tap if touch else loc.click)(force=True)
    press('[data-level="normal"]');press('[data-act="start"]')
    return ctx,page,press

def command(p,press,m):
    assert m["mode"] == "summon", "Use a playback plan recorded for the current summon rules."
    for attr,key in [('number',m['a']),('op',m['op']),('number',m['b'])]:
        press(f'[data-{attr}="{key}"]')
    loc=p.locator('[data-action="produce"]')
    assert loc.is_enabled(),m
    press('[data-action="produce"]')

def step(p, tick):
    p.evaluate('n=>Numori.advance(n-Math.round(Numori.battle.time*30))',tick)
def render(p):
    p.evaluate('()=>Numori.world.render({battle:Numori.battle,economy:Numori.economy},1/30)')

def generate(browser,src):
    ctx,p,press=open_game(browser,src,'pc'); events={};commands=[];turn=0
    for t in range(0,30*901,30):
        step(p,t)
        s=p.evaluate(STATE)
        if s['winner']!=-1:
            events['result']={'tick':s['tick'],'coords':s['focus']};break
        if t>=120 and (t-120)%240==0:
            m=p.evaluate(CHOOSE,turn);turn+=1
            if m:
                command(p,press,m);commands.append({'tick':t,**m})
        if t==30: events['home']={'tick':t,'coords':s['bases'][0]}
        if t==540: events['advance']={'tick':t,'coords':s['first']}
        if 'capture' not in events and any(x['owner']==0 for x in s['mines']):
            events['capture']={'tick':t,'coords':next(m for m in s['mines'] if m['owner']==0)}
        if 'combat' not in events and s['hits']>25 and sum(s['units'])>=38:
            events['combat']={'tick':t,'coords':s['focus']}
        if 'siege' not in events and any(0<q['hp']<q['max']*.94 for q in s['bases']):
            events['siege']={'tick':t,'coords':min(s['bases'],key=lambda q:q['hp']/q['max'])}
    assert {'home','advance','capture','combat','siege','result'}<=events.keys(),events
    plan={'seed':123,'difficulty':'normal','events':events,'commands':commands}
    PLAN.write_text(json.dumps(plan,indent=2),encoding='utf8');print('plan',[(k,v['tick']) for k,v in events.items()],flush=True)
    ctx.close();return plan

def replay(browser,src,name,label,plan):
    ctx,p,press=open_game(browser,src,name); out=BASE/label;out.mkdir(exist_ok=True)
    errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
    series={};frames={}
    cmds={m['tick']:m for m in plan['commands']}
    times={}
    for kind,event in plan['events'].items():
        for offset in ([0] if kind=='result' else [0,8,16]):
            times.setdefault(event['tick']+offset,[]).append((kind,offset,event))
    current_cam=None
    for t in sorted(set(times)|set(cmds)):
        step(p,t)
        if t in cmds: command(p,press,cmds[t])
        if t not in times:continue
        for kind,offset,event in times[t]:
            render(p)
            view_modes=['split','wide'] if name=='phone' and kind!='result' else ['split']
            for view in view_modes:
                if view=='wide':press('[data-act="fieldFocus"]');render(p)
                current_cam=(kind,view)
                if kind!='result':
                    # Reposition with the visible minimap at a fixed world coordinate.
                    coord=event['coords'];mini=p.locator('.nr-map').bounding_box()
                    x=mini['x']+mini['width']*coord['x']/3000;y=mini['y']+mini['height']*coord['y']/1800
                    if name=='pc':p.mouse.click(x,y)
                    else:p.touchscreen.tap(x,y)
                    render(p)
                state=p.evaluate(STATE);series.setdefault(kind+'-'+view,[]).append(state)
                path=out/f'{name}-{kind}-{view}'
                if offset==0:p.screenshot(path=str(path)+'.png')
                if kind!='result':
                    pic=Image.open(io.BytesIO(p.locator('#world').screenshot())).convert('RGB')
                    frames.setdefault(str(path),[]).append((pic,t))
                if view=='wide':press('[data-act="fieldFocus"]');render(p)
    for pref,seq in frames.items():
        if len(seq)!=3:continue
        panels=[]; maxw=480 if name=='pc' else 360
        for pic,t in seq:
            pic.thumbnail((maxw,400))
            panel=Image.new('RGB',(pic.width,pic.height+23),'#193b30')
            panel.paste(pic,(0,0));ImageDraw.Draw(panel).text((8,pic.height+4),f't={t/30:.2f}s',fill='#fff8df');panels.append(panel)
        strip=Image.new('RGB',(sum(z.width for z in panels),max(z.height for z in panels)),'#193b30')
        x=0
        for z in panels:strip.paste(z,(x,0));x+=z.width
        strip.save(pref+'-motion.webp',quality=92)
    assert not errors,errors
    final=series['result-split'][0];assert final['winner']!=-1 and sum(final['units'])>0
    (out/f'{name}-state.json').write_text(json.dumps(series,indent=2),encoding='utf8')
    print(name,label,'end',final['time'],'produced',final['production'],'combat',series['combat-split'][0]['hits'],flush=True)
    ctx.close()

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('label');ap.add_argument('--plan',action='store_true');ap.add_argument('--screens',nargs='+',default=list(SIZES))
    a=ap.parse_args();src=a.source if a.source.startswith(('http://','https://')) else Path(a.source).resolve().as_uri()
    with sync_playwright() as pw:
        b=pw.chromium.launch()
        plan=generate(b,src) if a.plan else json.loads(PLAN.read_text())
        for screen in a.screens:replay(b,src,screen,a.label,plan)
        b.close()
