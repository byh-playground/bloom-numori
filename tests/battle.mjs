import assert from "node:assert/strict";
import {cpus, platform} from "node:os";
import "../vendor/gamekit-core.js";
import "../battle.js";

const armyTypes=Object.keys(Battle.types);
const step=1/30;
function simulate(b,seconds) {
    for(let i=0;i<seconds/step && b.winner===-1;i++) b.step(step);
}
function readyArmies(n,seed=23) {
    const b=Battle.create(seed);
    for(let side=0;side<2;side++){
        for(let i=0;i<armyTypes.length;i++){
            const count=Math.floor(n/(2*armyTypes.length))+(i < (n/2)%armyTypes.length ? 1:0);
            if(count)b.spawn(side,armyTypes[i],count);
        }
        const army=b.units.filter(u=>u.side===side), cols=Math.ceil(Math.sqrt(army.length));
        army.forEach((u,i)=>{
            u.x=1500+(2*side-1)*(10+Math.floor(i/cols)*15);
            u.y=900+(i%cols-cols/2)*15;
        });
    }
    assert.equal(b.units.length,n);
    return b;
}
const clash=readyArmies(120);
simulate(clash,70);
assert.ok(clash.stats.hits && clash.stats.shots && clash.stats.blasts);
assert.ok(clash.stats.deaths.every(n=>n>0));
for(let s=0;s<2;s++)assert.equal(clash.count(s),60-clash.stats.deaths[s]);
const replay=readyArmies(120);
simulate(replay,70);
assert.deepEqual(replay.units.map(u=>[u.id,u.x,u.y,u.hp]),clash.units.map(u=>[u.id,u.x,u.y,u.hp]));
const reversals=[];
for(const side of [0,1]){
    const b=Battle.create(13);
    const wave=["shield","archer","charger","spear"];
    for(let i=0;i<18 && b.winner===-1;i++) {
        b.spawn(side,wave[i%wave.length],24,false,{route:"supply"});
        simulate(b,6);
    }
    assert.equal(b.winner,side);
    assert.equal(b.bases[1-side].hp,0);
    assert.ok(b.station.recruits[side]>0);
    reversals.push({winner:side,endSeconds:+b.time.toFixed(1),captureSeconds:+b.stats.firstCapture.toFixed(1)});
}
const capped=Battle.create(42);
const limit=Battle.settings.armyLimit;
assert.equal(limit,1000);
assert.equal(capped.spawn(0,"shield",limit-2),limit-2);
assert.equal(capped.spawn(0,"archer",12),2);
assert.equal(capped.spawn(0,"shield",1),0);
assert.equal(capped.spawn(1,"spear",limit*4),limit);
const casualty=capped.units[0], attacker=capped.units.find(u=>u.side===1);
capped.damage(casualty,attacker,casualty.hp,0);
capped.step(step);
assert.equal(capped.count(0),limit-1);
assert.equal(capped.count(1),limit);
assert.equal(capped.spawn(1,"charger",1),0);
assert.equal(capped.spawn(0,"thrower",100),1);
assert.equal(capped.units.length,2*limit);
const perf=[];
for(const n of [100,500,1000,2*limit]){
    const b=readyArmies(n);
    simulate(b,0.5);
    let ticks=[],collision=0,search=0;
    for(let i=0;i<60;i++){
        const start=performance.now(); b.step(step);
        ticks.push(performance.now()-start);
        collision+=b.metrics.collisionCandidates;search+=b.metrics.targetCandidates;
    }
    ticks.sort((a,b)=>a-b);
    perf.push({units:n,endUnits:b.units.length,meanMs:+(ticks.reduce((a,b)=>a+b)/ticks.length).toFixed(2),
        p95Ms:+ticks[Math.ceil(ticks.length*0.95)-1].toFixed(2),collisionCandidatesPerTick:Math.round(collision/60),
        searchCandidatesPerTick:Math.round(search/60),heapUsedMiB:+(process.memoryUsage().heapUsed/1048576).toFixed(1)});
}
console.log(JSON.stringify({environment:[platform(),cpus()[0].model,process.version],reversals,perf},null,2));
