"""Standalone rendered frame benchmark. Synthetic formations, real engine, real Canvas."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

from formulas import ROOT


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--enable-precise-memory-info"])
        out = {"chromium":browser.version, "viewport":"1440×900, DPR 1", "seed":123,"runs":[]}
        for count in [100,500,1000,2000]:
            page = browser.new_page(viewport={"width":1440,"height":900})
            page.goto("about:blank")
            page.set_content("""<style>*{box-sizing:border-box}body{margin:0;display:flex}
                 #world{width:1000px;height:850px}#editor{width:440px;height:850px}</style>
                 <div id="world"></div><div id="editor"></div>""")
            for js in ["vendor/gamekit-core","math","battle","economy","world","editor"]:
                page.add_script_tag(path=ROOT/(js+".js"))
            for css in ["world","editor"]:
                page.add_style_tag(path=ROOT/(css+".css"))
            page.evaluate("""n=>{
              window.b=Battle.create(123);window.ec=new Economy({battle:b,seed:123});
              window.w=NumoriWorld.mount(document.querySelector('#world'));
              window.ed=NumoriEditor.mount(document.querySelector('#editor'),{
                inventory:()=>ec.sides[0].inventory,targetType:()=>'summon',targetName:()=>'병력 소환',targetGoal:()=>ec.sides[0].targets.summon,
                remaining:()=>Math.max(0,Economy.config.armyLimit-b.count(0)), preview:a=>ec.preview(0,'summon',a),produce:a=>ec.produce(0,'summon',a)
              });
              for(let side=0;side<2;side++){
                b.spawn(side,'shield',n/2);
                let i=0;const columns=Math.ceil(Math.sqrt(n/2));
                for(const u of b.units.filter(u=>u.side===side)){
                  u.x=1500+(side?1:-1)*(4+(i%columns)*9);u.y=900+(Math.floor(i/columns)-columns/2)*9;i++;
                }
              }
              w.render({battle:b,economy:ec});w.battle();
              const r=window.record={frame:[],sim:[],draw:[],candidates:[],search:[]};
              let last=0, acc=0;
              window.frames=0;window.recording=false;
              function update(now){
                const delta=last?now-last:16.7;last=now;
                acc+=Math.min(delta,100);
                const t=performance.now();
                while(acc>=1000/30){
                  const s=performance.now();ec.tick(1/30);b.step(1/30);
                  if(recording){r.sim.push(performance.now()-s);r.candidates.push(b.metrics.collisionCandidates);r.search.push(b.metrics.targetCandidates)}
                  acc-=1000/30;
                }
                const drawStart=performance.now();w.render({battle:b,economy:ec}, delta/1000);
                if(recording){r.frame.push(delta);r.draw.push(performance.now()-drawStart)}
                frames++;requestAnimationFrame(update)
              }requestAnimationFrame(update);
              document.addEventListener('click', e=>{
                if(e.target.closest('[data-number="8"]')){ const t=e.timeStamp;
                  requestAnimationFrame(()=>requestAnimationFrame(()=>window.paintMs=performance.now()-t));
                }
              },true);
            }""",count)
            page.wait_for_function("frames>=6")
            page.evaluate("window.recording=true")
            page.locator('[data-number="8"]').click(timeout=10000)
            page.wait_for_function("record.frame.length>=36 && window.paintMs>0")
            result=page.evaluate("""()=>{window.recording=false;const stat=a=>{
                const sorted=[...a].sort((a,b)=>a-b);
                return {median:+sorted[Math.floor(sorted.length/2)].toFixed(2),
                    p95:+sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))].toFixed(2)}
                };
                return {...Object.fromEntries(Object.entries(record).map(([k,v])=>[k,stat(v)])),
                    heapMB:+(performance.memory.usedJSHeapSize/2**20).toFixed(2),
                    inputToSecondRafMs:+paintMs.toFixed(2), observedUnits:b.units.length,
                    frames:record.frame.length, ticks:record.sim.length, editorValue:MathCore.evaluate(ed.ast()).value};
            }""")
            result["startingUnits"]=count
            print(count,result,flush=True)
            out["runs"].append(result)
            page.close()
        browser.close()
        (Path(__file__).parent/"browser-load-fixed-workers.json").write_text(json.dumps(out,indent=2,ensure_ascii=False),encoding="utf-8")


if __name__=="__main__":
    main()

