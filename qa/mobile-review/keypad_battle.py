"""Capture the same user production and match time across keypad revisions."""
import sys, json, argparse
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
OUT=Path(__file__).resolve().parent
sys.path.insert(0,str(OUT.parent/'field-review'))
from record import SIZES,open_game,command,step,render,STATE

def run(b,src,label,w,h):
 name=f'battle-{w}';SIZES[name]=(w,h)
 c,p,press=open_game(b,src,name);step(p,120)
 command(p,press,{'mode':'summon','a':'8','op':'mul','b':'4'})
 frames=[];details=[]
 for stage,t in [('march',18),('clash',48)]:
  step(p,t*30);render(p);press('[data-camera="battle"]');render(p)
  s=p.evaluate(STATE);assert s['units'][0]>0 and s['units'][1]>0
  if stage=='clash':assert s['hits']>0
  p.screenshot(path=OUT/f'{label}-{w}-{stage}.png')
  old=p.evaluate('Numori.world.camera')
  draft=p.evaluate('JSON.stringify(Numori.editor.ast())')
  press('[data-act="fieldFocus"]');render(p)
  if stage=='clash':p.screenshot(path=OUT/f'{label}-{w}-{stage}-wide.png')
  press('[data-act="fieldFocus"]');render(p)
  restored=p.evaluate('Numori.world.camera')
  for k in ('x','y','zoom'):assert abs(restored[k]-old[k])<2,(w,stage,k,restored[k],old[k])
  assert p.evaluate('JSON.stringify(Numori.editor.ast())')==draft
  details.append({'stage':stage,'time':s['time'],'units':s['units'],'hits':s['hits'],
   'shots':s['shots'],'camera':s['camera'],'world':p.locator('#world').bounding_box()})
 # Two seconds at 10 frames/s; same combat episode, camera command stays active.
 if w==390:
  import io
  for i in range(20):
   step(p,1440+i*3);render(p);frames.append(Image.open(io.BytesIO(p.locator('#world').screenshot())).convert('RGB'))
  frames[0].save(OUT/f'{label}-{w}-clash.webp',save_all=True,append_images=frames[1:],duration=100,loop=0,quality=80)
 (OUT/f'{label}-{w}-battle.json').write_text(json.dumps(details,indent=2),encoding='utf8')
 print(label,w,[(s['stage'],s['units'],s['hits']) for s in details],flush=True)
 c.close()
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('source',type=Path);ap.add_argument('label');a=ap.parse_args()
 with sync_playwright() as pw:
  b=pw.chromium.launch(channel='chrome')
  for w,h in [(390,844),(667,375),(844,390)]:run(b,a.source.resolve().as_uri(),a.label,w,h)
  b.close()

