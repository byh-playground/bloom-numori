"""Compare offline workbench layouts with real taps and native CDP touch gestures."""
import argparse, json, math
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT=Path(__file__).resolve().parent
SETS=[('320',320,568),('360',360,640),('390',390,844),('667',667,375),('844',844,390),('pc',1440,900)]
OPEN_KEYS={'8':'[data-number="8"]','add':'[data-op="add"]','produce':'[data-action="produce"]',
           'hud':'#armyHud','camera':'[data-camera="battle"]'}

GEOM="""e=>{const r=e.getBoundingClientRect(),w=innerWidth,h=innerHeight,style=getComputedStyle(e);
let left=Math.max(0,r.left),right=Math.min(w,r.right),top=Math.max(0,r.top),bottom=Math.min(h,r.bottom);
let ancestor=e.parentElement;
while(ancestor){const cs=getComputedStyle(ancestor);const b=ancestor.getBoundingClientRect();
 if(/auto|scroll|hidden|clip/.test(cs.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}
 if(/auto|scroll|hidden|clip/.test(cs.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}
 ancestor=ancestor.parentElement}
const x=r.left+r.width/2,y=r.top+r.height/2;
const hit=r.width>0 && r.height>0 && e.contains(document.elementFromPoint(x,y));
const full=hit && r.left>=-.5 && r.right<=w+.5 && r.top>=-.5 && r.bottom<=h+.5 &&
 [[x,r.top+1],[x,r.bottom-1],[r.left+1,y],[r.right-1,y],[r.left+6,r.top+6],[r.right-6,r.top+6],
 [r.left+6,r.bottom-6],[r.right-6,r.bottom-6]].every(([a,b])=>e.contains(document.elementFromPoint(a,b)));
return {x,y,width:r.width,height:r.height,visibleHeight:full?r.height:Math.max(0,bottom-top),hit,
full,visible:style.display!=='none' && style.visibility!=='hidden',enabled:!e.disabled}
}"""
SCROLL="""()=>({desk:document.querySelector('.desk').scrollTop,
   range:document.querySelector('.desk').scrollHeight-document.querySelector('.desk').clientHeight,
   world:[document.querySelector('#world').clientWidth,document.querySelector('#world').clientHeight],
   afterEditor:document.querySelector('.desk').getBoundingClientRect().bottom-document.querySelector('#editor').getBoundingClientRect().bottom,
   afterCta:document.querySelector('.desk').getBoundingClientRect().bottom-document.querySelector('[data-action=produce]').getBoundingClientRect().bottom,
   page:document.scrollingElement.scrollTop,width:document.documentElement.scrollWidth})"""

def run(b, url, label, n, w, h):
    mobile=n!='pc'
    ctx=b.new_context(viewport={'width':w,'height':h},has_touch=mobile,is_mobile=mobile,offline=url.startswith('file:'))
    p=ctx.new_page();p.set_default_timeout(2500)
    errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
    c=ctx.new_cdp_session(p); p.goto(url)
    logs=[]; shots=[]; measures={}
    def geo(s):return p.locator(s).first.evaluate(GEOM)
    def capture(stage):
        fn=f'{label}-{n}-{stage}.png'
        p.screenshot(path=OUT/fn);shots.append(fn)
    def tap(s):
        g=geo(s); assert g['hit'] and g['enabled'],(s,g)
        x,y=g['x'],g['y']
        if mobile: p.touchscreen.tap(x,y)
        else:p.mouse.click(x,y)
    def touch_scroll(dist):
        r=p.locator('.desk').bounding_box()
        x=r['x']+r['width']*.47
        start=r['y']+r['height']*(.80 if dist>0 else .20)
        end=start-math.copysign(min(abs(dist)+15,r['height']*.58),dist)
        if mobile:
            def send(kind,y):
                c.send("Input.dispatchTouchEvent",{'type':kind,'touchPoints':
                    [] if kind=='touchEnd' else [{'x':x,'y':y,'id':1}]})
            send('touchStart', start)
            for j in range(1,9):
                send('touchMove',start+(end-start)*j/8);p.wait_for_timeout(18)
            p.wait_for_timeout(65);send('touchEnd',end)
        else:
            p.mouse.move(x,start);p.mouse.wheel(0,dist)
        p.wait_for_timeout(100)
    def reach(s,stage):
        for _ in range(7):
            g=geo(s)
            if g['hit'] and g['visibleHeight']>=min(26,g['height']):
                assert g['enabled'],(s,'disabled')
                tap(s);return
            before=p.evaluate(SCROLL)
            r=p.locator('.desk').bounding_box()
            dir=1 if g['y']>r['y']+r['height']/2 else -1
            if before['range']<1:raise AssertionError(('outside viewport without scrolling',s,g))
            touch_scroll(dir*max(64, min(r['height']*.57,abs(g['y']-(r['y']+r['height']*.5)))))
            after=p.evaluate(SCROLL)
            logs.append({'stage':stage,'target':s,'from':round(before['desk']),'to':round(after['desk'])})
            if abs(after['desk']-before['desk'])<1:raise AssertionError(('no scroll movement',s,g,before,after))
        raise AssertionError(('could not reach',s))
    def reset():
        tap('[data-act="menu"]');tap('[data-act="restart"]')
    def inspect_controls(stage):
        controls={s:geo(s) for s in [
            *[f'[data-number="{i}"]' for i in range(1,10)],
            *[f'[data-op="{op}"]' for op in ('add','sub','mul','div')],OPEN_KEYS['produce']]}
        digits=list(controls.values())[:9]
        assert not p.locator('[data-number="0"]').count()
        xs=[round(digits[i]['x']) for i in range(3)]
        ys=[round(digits[i]['y']) for i in (0,3,6)]
        assert xs[0]<xs[1]<xs[2] and ys[0]<ys[1]<ys[2],(stage,xs,ys)
        for i,d in enumerate(digits):
            assert abs(d['x']-xs[i%3])<2 and abs(d['y']-ys[i//3])<2, (stage,i,d)
        extent=p.evaluate(SCROLL)
        measures[stage]={'controls':controls,'extent':extent}
        assert all(d['full'] for d in controls.values()),(stage,[s for s,d in controls.items() if not d['full']])
        assert extent['desk']==0 and extent['range']<=1 and extent['page']==0, (stage,extent)
        bad=p.evaluate("""()=> [...document.querySelectorAll(
            '[data-number] b,[data-number] small,[data-op] b,[data-op] small,.ne-toolbar button,.ne-produce-label,.ne-equals')].filter(el=>{
            const box=el.closest('button').getBoundingClientRect(),r=document.createRange();r.selectNodeContents(el);
            const t=r.getBoundingClientRect();return t.width===0 || t.left<box.left-.5 || t.right>box.right+.5 || t.top<box.top-.5 || t.bottom>box.bottom+.5;
        }).map(el=>el.textContent)""")
        assert not bad,(stage,bad)
    try:
        tap('[data-level="easy"]');tap('[data-act="start"]')
        inspect_controls('empty')
        assert '수식 보관' in p.locator('[data-action="new"]').inner_text()
        assert p.locator('.ne-shelf').evaluate('e=>e.getBoundingClientRect().height') <= 1
        measures['emptyFooterHeight']=p.locator('.ne-foot').evaluate('e=>e.getBoundingClientRect().height')
        tap('[data-number="8"]')
        inspect_controls('outside')
        assert p.locator('[data-action="produce"]').is_disabled()
        tap('[data-action="clear"]')
        for action,keys in [('near',['8','mul','4','sub','2']),('exact',['8','mul','4'])]:
            if action=='exact':reset()
            m={'opening':p.evaluate(SCROLL), 'buttons':{k:geo(s) for k,s in OPEN_KEYS.items()}}
            if action=='near':capture('opening')
            for key in keys:
                reach(f'[data-number="{key}"]' if key.isdigit() else f'[data-op="{key}"]',action)
                if mobile and label!='baseline' and action=='near' and key=='mul':
                    capture('draft')
                    focus='[data-act="fieldFocus"]'
                    draft=p.evaluate('JSON.stringify(Numori.editor.ast())')
                    cam=p.evaluate('Numori.world.camera')
                    tap(focus);p.wait_for_timeout(120)
                    assert p.locator(focus).get_attribute('aria-expanded')=='true'
                    capture('field')
                    tap(focus);p.wait_for_timeout(120)
                    assert p.locator(focus).get_attribute('aria-expanded')=='false'
                    assert p.evaluate('JSON.stringify(Numori.editor.ast())')==draft
                    restored=p.evaluate('Numori.world.camera')
                    for k in ('x','y','zoom'):assert abs(restored[k]-cam[k])<1,(k,cam,restored)
            m['entered']=p.evaluate(SCROLL);m['produceBeforeSeeking']=geo(OPEN_KEYS['produce'])
            m['keypadAfterFormula']={
                s:geo(s) for s in [*[f'[data-number="{i}"]' for i in range(1,10)],
                *[f'[data-op="{i}"]' for i in ('add','sub','mul','div')],OPEN_KEYS['produce']]
            }
            inspect_controls(action+'-layout')
            if action=='exact':capture('formula')
            prev=p.evaluate('Numori.battle.count(0)')
            reach(OPEN_KEYS['produce'],action)
            m['after']=p.evaluate(SCROLL);m['spawned']=p.evaluate('Numori.battle.count(0)')-prev
            assert m['spawned']==(8 if action=='near' else 24),m
            measures[action]=m
        reset()
        assert p.locator('[data-tab="decimal"],[data-target="expand"]').count()==0
        for _ in range(30):
            if p.locator('[data-number]:enabled').count()==9:break
            p.evaluate('Numori.advance(60)')
        for i in range(1,10):
            # Alternate touching the face label and the stock count to exercise delegated input.
            tap(f'[data-number="{i}"] {"b" if i%2 else "small"}')
            assert p.evaluate('MathCore.evaluate(Numori.editor.ast()).value')==i
            tap('[data-action="clear"]')
        tap('[data-number="1"] b');tap('[data-op="add"] b');tap('[data-number="2"] small')
        assert p.evaluate('MathCore.evaluate(Numori.editor.ast()).value')==3
        saved=p.evaluate('JSON.stringify(Numori.editor.ast())')
        tap('[data-action="new"]')
        assert p.evaluate('Numori.editor.ast()') is None
        assert p.locator('[data-stored="0"]').inner_text()=='3'
        inspect_controls('stored-layout')
        measures['storedFooterHeight']=p.locator('.ne-foot').evaluate('e=>e.getBoundingClientRect().height')
        capture('stored')
        tap('[data-stored="0"]')
        assert p.evaluate('JSON.stringify(Numori.editor.ast())')==saved
        assert p.locator('.ne-shelf').evaluate('e=>e.getBoundingClientRect().height') <= 1
        tap('[data-action="clear"]')
        for key in ['[data-number="1"]','[data-op="div"]','[data-number="2"]']:
            tap(key)
        assert p.evaluate('MathCore.evaluate(Numori.editor.ast()).value')==.5
        tap('[data-op="mul"]');tap('[data-number="4"]')
        assert p.evaluate('MathCore.evaluate(Numori.editor.ast()).value')==2
        tap('[data-action="clear"]')
        assert p.locator('[data-tab="advanced"],.ne-extra-operators').count()==0
        assert set(p.locator('[data-op]').evaluate_all('(els)=>els.map(e=>e.dataset.op)'))=={'add','sub','mul','div'}
        # Combine a banked expression as an independent operand: (8+2)×(6−3)=30.
        for s in ['[data-number="6"]','[data-op="sub"]','[data-number="3"]','[data-action="new"]',
                  '[data-number="8"]','[data-op="add"]','[data-number="2"]','[data-op="mul"]','[data-stored="0"]']:
            tap(s)
        assert p.evaluate('MathCore.evaluate(Numori.editor.ast()).value')==30
        reach(OPEN_KEYS['produce'],'secondary')
        assert p.evaluate('Numori.battle.count(0)>0')
        tap('[data-act="labor"]')
        tap('[data-mine="mineral"] [data-delta="-1"]')
        tap('[data-mine="gas"] [data-delta="1"]')
        assert p.evaluate('Numori.economy.allocation(0).gas')==6
        tap('[data-act="labor"]')
        before=p.evaluate('Numori.world.camera.x')
        tap(OPEN_KEYS['camera']);assert abs(p.evaluate('Numori.world.camera.x')-before)>25
        tap('[data-camera="home"]')
        if mobile:
            reach('[data-number="3"]','rotate')
            saved=p.evaluate('JSON.stringify(Numori.editor.ast())')
            p.set_viewport_size({'width':h,'height':w});p.wait_for_timeout(100)
            before=p.evaluate('Numori.world.camera.x')
            tap(OPEN_KEYS['camera']);assert abs(p.evaluate('Numori.world.camera.x')-before)>25
            assert p.evaluate('document.documentElement.scrollWidth')==h
            assert p.evaluate('JSON.stringify(Numori.editor.ast())')==saved
    except Exception as exc:
        errors.append(str(exc));capture('failure')
    report={'screen':[w,h],'measure':measures,'scroll':logs,'errors':errors,'shots':shots}
    (OUT/f'{label}-{n}.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf8')
    print(n, 'near/exact gestures:',*[[(l['from'],l['to']) for l in logs if l['stage']==s] for s in ['near','exact']],errors,flush=True)
    ctx.close()
    return not errors

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('file');parser.add_argument('label')
    a=parser.parse_args()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        addr=a.file if a.file.startswith(('http://','https://')) else Path(a.file).resolve().as_uri()
        checks=[run(browser,addr+'?seed=123&debug=1',a.label,*s) for s in SETS]
        browser.close()
    raise SystemExit(0 if all(checks) else 1)
