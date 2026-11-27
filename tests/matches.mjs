import "../math.js";
import "../vendor/gamekit-core.js";
import "../battle.js";
import "../economy.js";
const data=[];
for(const [difficulty,seed] of [["easy",11],["normal",21],["normal",22],["hard",31]]){
    const b=Battle.create(seed), eco=new Economy({seed,difficulty,battle:b});
    let decisionTime=4, dt=1/30;
    for(let tick=0;tick<30*1200 && b.winner===-1;tick++) {
        eco.tick(dt);
        if(eco.time>=decisionTime){
            decisionTime+=eco.ai.interval;
            const next=eco.decisions(0);
            if(next)eco.produce(0,next.type,next.ast);
        }
        b.step(dt);
    }
    data.push({difficulty,seed,seconds:Math.round(b.time),winner:b.winner,peak:b.stats.peak,
        firstCombat:Math.round(b.stats.firstCombat??0),firstCapture:Math.round(b.stats.firstCapture??0),
        firstBaseHit:Math.round(b.stats.firstBaseHit??0),armyTotals:eco.sides.map(s=>s.stats.produced),
        suppliedBlocks:eco.sides.map(s=>s.stats.deliveries)});
    console.error(difficulty,seed,data.at(-1).seconds,data.at(-1).winner);
}
console.log(JSON.stringify(data,null,2));

