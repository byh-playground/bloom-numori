"""Check normal WebGL2, restoration and a context-unavailable mobile GL fallback."""
import argparse
import io
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright


def run(browser, source, out, deny):
    ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,
                            has_touch=True,device_scale_factor=2,offline=True)
    page=ctx.new_page()
    errors=[]
    page.on("pageerror", lambda ex: errors.append(str(ex)))
    page.add_init_script('''(deny => {
      const real=HTMLCanvasElement.prototype.getContext;
      window.__seenGL=[];
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        if(type==='webgl2' && deny)return null;
        const g=real.call(this,type,...args);
        if(type==='webgl2' && g && !window.__seenGL.includes(g))window.__seenGL.push(g);
        return g;
      };
    })('''+json.dumps(deny)+')')
    page.goto(source)
    page.evaluate('window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{}')
    press=lambda s:page.locator(s).tap(force=True)
    press('[data-act=start]')
    page.wait_for_function('!!window.Numori?.world',polling=50)
    render="""()=>{const n=Numori;n.world.render({battle:n.battle,economy:n.economy},1/30);
          return n.world.renderStats?.backend ?? document.querySelector('#world').dataset.renderer}"""
    mode=page.evaluate(render)
    assert mode==('canvas2d' if deny else 'webgl2'), mode
    for sel in ('[data-number="8"]','[data-op=mul]','[data-number="4"]','[data-action=produce]'):press(sel)
    page.evaluate('Numori.advance(30*45)')
    press('[data-camera=battle]')
    page.evaluate(render)
    def capture(name):
        png=page.locator('#world').screenshot()
        image=Image.open(io.BytesIO(png)).convert('RGB')
        image.save(out/(name+'.png'))
        w,h=image.size;center=image.crop((w//5,h//5,4*w//5,4*h//5))
        assert min(ImageStat.Stat(center).stddev)>5, (name, ImageStat.Stat(center).stddev)
        return center
    def wait_event(kind):
        page.wait_for_function('kind=>window.__seenGL.some(g=>g.canvas.dataset[kind]==="yes")',
                               arg=kind,polling=35,timeout=10000)
    if deny:
        capture('fallback')
        assert not page.evaluate('window.__seenGL.length')
    else:
        capture('hardware-before')
        page.evaluate("""()=>{
          let gl=window.__seenGL.find(g=>g.canvas.matches('.nr-gpu'));
          if(!gl)throw Error('Missing battlefield WebGL canvas');
          window.__fieldGL=gl;window.__extLoss=gl.getExtension('WEBGL_lose_context');
          gl.canvas.addEventListener('webglcontextlost',()=>gl.canvas.dataset.lost='yes',{once:true});
          gl.canvas.addEventListener('webglcontextrestored',()=>gl.canvas.dataset.restored='yes',{once:true});
          window.__extLoss.loseContext();
        }""")
        wait_event('lost')
        assert page.evaluate(render)=='canvas2d'
        lost=capture('lost-fallback')
        before=page.evaluate('Numori.battle.tick')
        page.evaluate('Numori.advance(12)')
        assert page.evaluate('Numori.battle.tick')==before+12
        # Freeze all match-time and camera changes while comparing fallback/restored imagery.
        press('[data-camera=home]');page.evaluate(render)
        home=capture('lost-home')
        page.evaluate('window.__extLoss.restoreContext()')
        wait_event('restored')
        mode=page.evaluate(render)
        assert mode=='webgl2', mode
        restored=capture('restored-home')
        difference=ImageStat.Stat(ImageChops.difference(home,restored)).mean
        assert max(difference)<34, ('Visible mismatch on recovery',difference)
        print('restored mean RGB absolute difference', [round(v,2) for v in difference])
        press('[data-act=menu]');press('[data-act=restart]')
        page.wait_for_function('Numori.battle?.tick===0',polling=100,timeout=5000)
        assert page.evaluate(render)=='webgl2'
        assert page.locator('#world canvas.nr-gpu').count()==1
        assert page.evaluate('Numori.battle.count(0)===0')
    assert not errors, errors
    ctx.close()
    print('PASS', 'context-unavailable fallback' if deny else 'loss+restore+restart', flush=True)


if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('build',type=Path)
    ap.add_argument('--out',type=Path,required=True)
    ns=ap.parse_args();ns.out.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome')
        for denied in [False,True]:run(browser,ns.build.resolve().as_uri()+'?seed=123&debug=1',ns.out,denied)
        browser.close()
