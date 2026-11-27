"""Play a seeded easy match by pressing the same production buttons as a player."""
import json
from os import environ
from pathlib import Path
from playwright.sync_api import sync_playwright
from play import HERE,URL
from formulas import click_script

with sync_playwright() as pw:
    browser=pw.chromium.launch()
    page=browser.new_page(viewport={"width":1440,"height":900},offline=True)
    page.goto(URL)
    page.locator('[data-level="easy"]').click()
    page.locator('[data-act="start"]').click()
    log=[]
    for turn in range(75):
        if page.evaluate("Numori.battle.winner>=0"):break
        # Rank available two-number integer combinations by actual troop gain.
        pick=page.evaluate("""()=>{
          const eco=Numori.economy, stock=eco.sides[0].inventory;

          let choice=null;
          const target='summon';
          for(const a of ['2','3','4','5','6','7','8','9']){
           for(const op of ['mul','add','sub','div']){
            for(const b of ['2','3','4','5','6','7','8','9']){
             if(!stock[a] || !stock[b] || !stock[op] || (a===b && stock[a]<2))continue;
             const ast=MathCore.op(op,MathCore.num(a),MathCore.num(b));
             const p=eco.preview(0,target,ast);if(!p.ok)continue;
             const score=p.actual-p.waste*.001;
             if(!choice || score>choice.score)choice={target,score,a,b,op};
            }
           }
          }
          return choice;
        }""")
        if pick:
            click_script(page, f'{pick["a"]} {pick["op"]} {pick["b"]} produce')
            log.append(pick["target"])
        page.evaluate("Numori.advance(30*12)")
    data=page.evaluate("""()=>({winner:Numori.battle.winner,seconds:Numori.battle.time,combat:Numori.battle.stats,
        production:Numori.economy.sides.map(s=>s.stats.produced),armyLimit:Economy.config.armyLimit})""")
    data["uiActions"]=log
    print(data)
    assert data["winner"]==0, data
    assert page.locator('#modalTitle').inner_text().startswith('승리')
    if folder := environ.get("NUMORI_QA_SHOTS"):
        page.screenshot(path=Path(folder)/"victory.png")
        (Path(folder)/"match.json").write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding="utf-8")
    browser.close()
