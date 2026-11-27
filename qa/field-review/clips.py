"""Capture normal-speed arena animation as timed frames from a repeatable UI-driven match."""
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
import argparse, json, io, sys
from record import BASE, PLAN, open_game, command, STATE, step

def render(page,dt=1/15):
    page.evaluate('dt=>Numori.world.render({battle:Numori.battle,economy:Numori.economy},dt)',dt)

def run(browser,source,label,follow,check):
    plan=json.loads(PLAN.read_text());out=BASE/label;out.mkdir(exist_ok=True)
    ctx,p,press=open_game(browser,source,'landscape')
    moves={a['tick']:a for a in plan['commands']}
    # A clip starts just after a production command, with four uninterrupted seconds before the next one.
    starts={}
    for phase in ('advance','combat','siege'):
        tick=plan['events'][phase]['tick']
        interruptions=[t for t in moves if tick<t<tick+120]
        starts[phase]=max(interruptions,default=tick)+1

    # Each frame is two normal 30 Hz simulation steps. 67/67/66 ms mirrors 15 Hz over time.
    frames={};meta={}
    event_at={k+2*i:(n,i) for n,k in starts.items() for i in range(1 if check else 60)}
    for t in sorted(set(moves)|set(event_at)):
        if t>max(event_at):break
        step(p,t)
        if t in moves:command(p,press,moves[t])
        if t not in event_at:continue
        phase,i=event_at[t];render(p)
        if i==0:
            press('[data-act="fieldFocus"]');render(p)
            press('[data-camera="battle"]');render(p)
            followed=p.evaluate(STATE)
            followed['horizontalMiddle']=p.evaluate("""()=>{
                const c=Numori.world.camera;
                return [0,1].map(side=>Numori.battle.units.filter(u=>u.side===side &&
                  Math.abs(u.x-c.x)*c.zoom < c.width/4).length);
            }""")
            p.screenshot(path=out/f'landscape-{phase}-front.png')
            if check:
                meta[phase]={'button':followed}
                print(label,phase,'camera x',round(followed['camera']['x']),'units in middle half',
                      followed['horizontalMiddle'],flush=True)
                press('[data-act="fieldFocus"]');render(p)
                continue
            m=plan['events'][phase]['coords'];frame_box=p.locator('.nr-map').bounding_box()
            if not follow:
                p.touchscreen.tap(frame_box['x']+frame_box['width']*m['x']/3000,
                                  frame_box['y']+frame_box['height']*m['y']/1800)
                render(p)
                for _ in range(2):press('[data-camera="plus"]');render(p)
            frames[phase]=[];meta[phase]={'button':followed,'start':p.evaluate(STATE)}
        area=p.locator('#world').bounding_box()
        im=Image.open(io.BytesIO(p.screenshot(clip=area))).convert('RGB')
        frames[phase].append(im)
        if i==59:
            meta[phase]['end']=p.evaluate(STATE)
            imgs=frames[phase]
            file=out/f'landscape-{phase}-{"follow" if follow else "watch"}.webp'
            imgs[0].save(file,save_all=True,append_images=imgs[1:],
                duration=[67,67,66]*20,loop=0,method=3,quality=82)
            with Image.open(file) as decoded:
                meta[phase]['encodedFrames']=decoded.n_frames;meta[phase]['size']=list(decoded.size)
            print(label,phase,meta[phase]['encodedFrames'],'frames',flush=True)
            press('[data-act="fieldFocus"]');render(p)
    (out/('front-state.json' if check else 'follow-state.json' if follow else 'clips-state.json')).write_text(json.dumps(meta,indent=2),encoding='utf8')
    ctx.close()
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('source');ap.add_argument('label')
    ap.add_argument('--follow',action='store_true');ap.add_argument('--check',action='store_true')
    a=ap.parse_args();s=a.source if a.source.startswith(('https://','http://')) else Path(a.source).resolve().as_uri()
    with sync_playwright() as pw:
        b=pw.chromium.launch();run(b,s,a.label,a.follow,a.check);b.close()
