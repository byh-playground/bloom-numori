// Reproducible comparisons with simulated controllers. Times are simulated seconds.
const { performance } = require('node:perf_hooks');
require('../math.js');
require('../vendor/gamekit-core.js');
require('../battle.js');
require('../ai-solver.js');
require('../economy.js');
const dt = 1 / 30;
const seed = 100;
const mode = process.argv[2] || 'matches';
function run(difficulty, choose = null) {
    const b = Battle.create(seed),
        e = new Economy({ battle: b, seed, difficulty });
    let next = 15,
        maxStep = 0;
    while (e.time < 900 && b.winner < 0) {
        if (choose && e.time >= next) {
            next += 13;
            const p = choose(e);
            if (p) e.produce(0, p.type, p.ast);
        }
        const start = performance.now();
        e.tick(dt);
        b.step(dt);
        maxStep = Math.max(maxStep, performance.now() - start);
    }
    return {
        difficulty,
        winner: b.winner,
        seconds: Math.round(e.time),
        firstFight: b.stats.firstCombat === null ? null : Math.round(b.stats.firstCombat),
        firstBaseHit: b.stats.firstBaseHit === null ? null : Math.round(b.stats.firstBaseHit),
        peak: b.stats.peak,
        maxTickMs: Math.round(maxStep),
        armyLimit: e.config.armyLimit,
        workerDeliveries: e.sides.map((s) => s.stats.deliveries),
        playerTroops: e.sides[0].stats.produced,
        aiTroops: e.sides[1].stats.produced,
        targetHits: e.sides[0].stats.hits,
        waste: e.sides[0].stats.waste,
        captures: b.stats.captures[0],
    };
}
// Same opening, input cadence, candidate budget and AI opponent for the three priorities.
if (mode === 'strategies') {
    for (const strategy of ['rush', 'targets', 'maximum']) {
        const outcome = run('normal', (e) => {
            const s = e.sides[0];
            const nums = MathCore.numbers.filter((k) => s.inventory[k] > 0);
            const candidates = nums.map(MathCore.num);
            // All two-block arithmetic trees in the current resource pool.
            for (const op of ['add', 'sub', 'mul', 'div']) {
                if (!s.inventory[op]) continue;
                for (const a of nums)
                    for (const b of nums) {
                        if (a === b && s.inventory[a] < 2) continue;
                        candidates.push(MathCore.op(op, MathCore.num(a), MathCore.num(b)));
                    }
            }
            let best = null;
            const store = (type, ast, score) => {
                if (!best || score > best.score) best = { type, ast, score };
            };
            for (const ast of candidates) {
                const r = MathCore.evaluate(ast);
                if (!r.ok || r.value <= 0) continue;
                const cost = Object.values(r.cost).reduce((n, c) => n + c, 0);
                const p = e.preview(0, 'summon', ast);
                if (!p.ok) continue;
                let score = p.actual - cost * 0.125;
                if (strategy === 'targets' && p.matched) score += 2000;
                if (strategy === 'maximum') score += Math.log(1 + p.raw);
                if (strategy === 'rush' && p.unitType === 'charger') score += 3;
                store('summon', ast, score);
            }
            return best;
        });
        console.log(JSON.stringify({ strategy, ...outcome }));
    }
}
if (mode === 'matches') {
    for (const difficulty of ['easy', 'normal', 'hard']) {
        console.log(JSON.stringify({ controller: 'inactive', ...run(difficulty) }));
        console.log(
            JSON.stringify({ controller: 'mixed', ...run(difficulty, (e) => e.decisions(0)) }),
        );
    }
}
if (mode === 'mining') {
    const allocations = [
        { mineral: 5, gas: 5 },
        { mineral: 4, gas: 6 },
        { mineral: 6, gas: 4 },
        {},
    ];
    for (const allocation of allocations) {
        const b = Battle.create(seed);
        const e = new Economy({ battle: b, seed, difficulty: 'easy' });
        const current = e.allocation(0);
        for (const kind of ['mineral', 'gas'])
            for (let remaining = current[kind]; remaining > 0; remaining--) e.assign(0, kind, -1);
        for (const [kind, count] of Object.entries(allocation)) {
            for (let i = 0; i < count; i++) e.assign(0, kind, 1);
        }
        for (let i = 0; i < 120 / dt; i++) e.tick(dt);
        const { gathered, deliveries } = e.sides[0].stats;
        const numbers = MathCore.numbers.reduce((sum, key) => sum + (gathered[key] || 0), 0);
        const blocks = Object.values(gathered).reduce((sum, n) => sum + n, 0);
        if (!Object.keys(allocation).length && blocks)
            throw Error('Idle workers should deposit nothing');
        console.log(
            JSON.stringify({
                allocation,
                workers: e.sides[0].workers.length,
                deliveries,
                numbers,
                gas: blocks - numbers,
            }),
        );
    }
}
