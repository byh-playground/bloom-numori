const assert = require('node:assert/strict');
require('../math.js');
require('../vendor/gamekit-core.js');
require('../battle.js');
require('../economy.js');

const { num: n, op: o } = MathCore;
function game(seed = 100, difficulty = 'easy') {
    return new Economy({ seed, difficulty, battle: Battle.create(seed) });
}
function step(e, seconds) {
    for (let i = 0; i < Math.round(seconds * 20); i++) e.tick(0.05);
}
function integer(value) {
    if (value === 0) return o('sub', n(3), n(3));
    if (value < 10) return n(value);
    const tens = o('mul', integer(Math.floor(value / 10)), o('add', n(9), n(1)));
    return value % 10 ? o('add', tens, n(value % 10)) : tens;
}

// Delayed PvP starts must deploy the first paid wave behind the incoming enemy.
for (const side of [0, 1]) {
    const seed = 123, field = Battle.create(seed);
    const e = new Economy({ seed, battle: field, computerOpponent: false });
    const dir = side === 0 ? 1 : -1, opponent = 1 - side;
    const launch = (team) => {
        const result = e.produce(team, 'summon', e.sides[team].summonWitness);
        assert.equal(result.actual, 24);
        return field.effects.at(-1).x;
    };
    assert.equal(launch(opponent), 1500 + dir * 220);
    // Model the existing first wave having reached the defender's side of midfield.
    for (const u of field.units) u.x = 1500 - dir * 650;
    const foeX = field.units[0].x;
    launch(side);
    assert.ok(field.units.filter(u => u.side === side).every(u => (foeX - u.x) * dir >= 70 - 1e-8));
    assert.equal(launch(side), field.bases[side].x + dir * 115);
    step(e, 20);
    assert.equal(e.sides[opponent].stats.produced, 24);
}

// At 999, a paid exact summon creates one unit. At 1000, stock and target stay intact.
{
    const e = game(),
        s = e.sides[0];
    assert.deepEqual(Object.keys(s.targets), ['summon']);
    assert.equal(Economy.config.armyLimit, 1000);
    assert.equal(Object.hasOwn(s, 'cap'), false);
    assert.equal(s.workers.length, 10);
    e.battle.spawn(0, 'shield', 999);
    s.targets.summon = 30;
    const ast = o('sub', o('mul', n(8), n(4)), n(2)),
        before = { ...s.inventory };
    const paid = e.produce(0, 'summon', ast);
    assert.deepEqual(
        [paid.value, paid.unitType, paid.raw, paid.actual, paid.waste, paid.matched],
        [30, 'spear', 24, 1, 23, true],
    );
    assert.equal(e.battle.count(0), 1000);
    for (const [k, q] of Object.entries({ ...paid.cost, '=': 1 })) assert.equal(s.inventory[k], before[k] - q);
    const stock = { ...s.inventory },
        goal = s.targets.summon,
        witness = s.summonWitness;
    const full = e.produce(0, 'summon', witness);
    assert.deepEqual([full.ok, full.actual, full.raw, full.waste], [false, 0, 24, 24]);
    assert.deepEqual(s.inventory, stock);
    assert.equal(s.targets.summon, goal);
    assert.equal(s.summonWitness, witness);
    e.battle.damage(e.battle.units[0], { side: 1, x: 1000, y: 900 }, 100000, 0);
    assert.equal(e.battle.count(0), 999);
    assert.equal(e.produce(0, 'summon', witness).actual, 1);
    assert.equal(e.battle.count(0), 1000);
}
{
    const e = game(),
        s = e.sides[0],
        ast = s.summonWitness,
        goal = s.targets.summon,
        before = { ...s.inventory };
    assert.equal(e.preview(0, 'summon', ast).actual, 24);
    e.battle.spawn(0, 'archer', 1000);
    assert.equal(e.produce(0, 'summon', ast).ok, false);
    assert.equal(s.targets.summon, goal);
    assert.deepEqual(s.inventory, before);
}
{
    const cases = [
        [1, 'archer'],
        [2, 'archer'],
        [3, 'shield'],
        [4, 'archer'],
        [5, 'archer'],
        [7, 'archer'],
        [9, 'shield'],
        [10, 'spear'],
        [11, 'thrower'],
        [13, 'thrower'],
        [16, 'charger'],
        [20, 'spear'],
        [30, 'spear'],
        [36, 'charger'],
        [49, 'charger'],
        [100, 'charger'],
        [35, 'archer'],
        [2147483647, 'thrower'],
        [341550071728321, 'archer'],
        [9007199254740881, 'thrower'],
        [9007199254740991, 'archer'],
    ];
    for (const [value, type] of cases) assert.equal(Economy.classify(MathCore.evaluate(integer(value))).unitType, type);
    const tiny = Array.from({ length: 18 }, () => o('div', n(1), n(9))).reduce((left, right) => o('mul', left, right));
    for (const ast of [o('add', n(8), tiny), integer(0), o('sub', n(1), n(4)), o('div', n(3), n(2))]) {
        assert.equal(MathCore.evaluate(ast).ok, true);
        assert.equal(Economy.classify(MathCore.evaluate(ast)), null);
    }
}
{
    const e = game(),
        s = e.sides[0];
    assert.deepEqual(Economy.summonRange(1), { min: 1, max: 3 });
    assert.deepEqual(Economy.summonRange(6), { min: 4, max: 8 });
    for (const goal of [0, null, 1.5, -1]) assert.equal(Economy.summonRange(goal), null);
    for (const [digit, qty] of [
        [3, 0],
        [4, 8],
        [5, 16],
        [6, 24],
        [7, 16],
        [8, 8],
        [9, 0],
    ]) {
        const fixture = game(),
            side = fixture.sides[0];
        side.targets.summon = 6;
        side.inventory[digit] = 3;
        const stock = { ...side.inventory };
        const result = fixture.produce(0, 'summon', n(digit));
        assert.deepEqual([result.ok, result.raw, result.actual, result.matched], [qty > 0, qty, qty, digit === 6]);
        assert.equal(fixture.battle.count(0), qty);
        if (digit === 6) assert.notEqual(side.targets.summon, 6);
        else assert.equal(side.targets.summon, 6);
        if (!qty) {
            for (let i = 0; i < 4; i++) assert.equal(fixture.produce(0, 'summon', n(digit)).ok, false);
            assert.deepEqual(side.inventory, stock);
        } else {
            assert.deepEqual(side.inventory, { ...stock, [digit]: stock[digit] - 1, '=': stock['='] - 1 });
        }
    }
    // The command revalidates the current target and free army space, regardless of an older preview.
    s.targets.summon = 8;
    const before = { ...s.inventory };
    assert.equal(e.preview(0, 'summon', n(8)).ok, true);
    s.targets.summon = 30;
    assert.equal(e.produce(0, 'summon', n(8)).ok, false);
    assert.equal(s.targets.summon, 30);
    s.targets.summon = null;
    assert.equal(e.produce(0, 'summon', n(8)).raw, 0);
    assert.equal(s.targets.summon, null);
    assert.deepEqual(s.inventory, before);
    s.targets.summon = 3;
    const frac = o('div', n(3), n(2));
    assert.equal(MathCore.evaluate(frac).value, 1.5);
    const unchanged = { ...s.inventory };
    for (const [mode, ast, res] of [
        ['worker', n(8), {}],
        ['expand', n(8), {}],
        ['attack', n(8), {}],
        ['health', n(8), {}],
        ['infantry', n(8), {}],
        ['summon', n(8), { 8: 2 }],
        ['summon', n(9), {}],
        ['summon', null, {}],
        ['summon', frac, {}],
        ['summon', n(9), { 9: -1 }],
        ['summon', n(0), {}],
        ['summon', o('div', n(8), integer(0)), {}],
    ]) {
        assert.equal(e.produce(0, mode, ast, res).ok, false);
        assert.deepEqual(s.inventory, unchanged);
    }
    assert.equal(e.preview(0, 'summon', frac).unitType, null);
    const valid = e.produce(0, 'summon', o('mul', frac, n(2)));
    assert.deepEqual([valid.ok, valid.value, valid.unitType], [true, 3, 'shield']);
    s.inventory['='] = 0;
    assert.equal(e.produce(0, 'summon', n(8)).ok, false);
}
// Workers physically return home with their cargo.
{
    const e = game(),
        p = e.sides[0],
        w = p.workers[0];
    assert.deepEqual(e.allocation(0), { mineral: 5, gas: 5, idle: 0 });
    for (const mine of ['mineral', 'gas']) while (e.assign(0, mine, -1)) {}
    step(e, 20);
    assert.equal(p.stats.deliveries, 0);
    assert.deepEqual(p.inventory, Economy.config.initial);
    e.assign(0, 'mineral', 1);
    step(e, 0.5);
    assert.equal(w.phase, 'out');
    assert.notEqual(w.x, e.bases[0].x + w.offset);
    function until(test, limit = 750) {
        for (let i = 0; i < limit && !test(); i++) e.tick(0.05);
        assert.equal(test(), true);
    }
    until(() => w.phase === 'dig');
    assert.equal(p.stats.deliveries, 0);
    const digStart = e.time;
    const minePosition = [w.x, w.y];
    for (let tick = 0; tick < 59; tick++) {
        e.tick(1 / 30);
        assert.equal(w.phase, 'dig');
        assert.equal(w.cargo, null);
        assert.deepEqual([w.x, w.y], minePosition);
    }
    e.tick(1 / 30);
    assert.equal(w.phase, 'back');
    assert.ok(Math.abs(e.time - digStart - 2) < 1e-9);
    assert.equal(p.stats.deliveries, 0);
    const first = w.cargo;
    assert.equal(w.cargoCount, 1);
    e.assign(0, 'mineral', -1);
    assert.equal(e.assign(0, 'centerMineral', 1), false);
    assert.equal(w.trip, 'mineral');
    assert.equal(w.cargo, first);
    until(() => p.stats.deliveries === 1);
    assert.equal(p.stats.gathered[first], 1);
    e.assign(0, 'gas', 1);
    until(() => w.phase === 'dig');
    e.assign(0, 'gas', -1);
    until(() => w.phase === 'idle');
    assert.equal(p.stats.deliveries, 1);
    const snapshots = e.sides.map((s) => JSON.stringify(s));
    e.battle.winner = 1;
    step(e, 20);
    assert.deepEqual(
        e.sides.map((s) => JSON.stringify(s)),
        snapshots,
    );
}
{
    const e = game(5, 'hard'), station = e.battle.station;
    for (const side of [0, 1]) for (const kind of ['mineral', 'gas'])
        while (e.assign(side, kind, -1)) {}
    e.sides[0].inventory = {'=':2};
    e.refreshTarget(0);
    const stock = e.sides.map(side => ({...side.inventory}));
    e.battle.spawn(0, 'shield', 1, false, {route:'supply'});
    Object.assign(e.battle.units[0], {x:station.x, y:station.y, waypoint:3});
    for(let i=0;i<45*30;i++){
        e.tick(1/30);
        e.battle.step(1/30);
    }
    assert.deepEqual(station.recruits, [1, 0]);
    assert.deepEqual(e.sides.map(side=>side.inventory), stock);
    assert.equal(e.sides[0].targets.summon, null);
}
// Every chosen witness must fit the unreserved hand and use only basic operators.
{
    function verify(e, reserved = {}) {
        const s = e.sides[0],
            r = MathCore.evaluate(s.summonWitness);
        assert.equal(r.ok, true);
        for (const [k, q] of Object.entries(r.cost)) assert.ok(q + (reserved[k] || 0) <= (s.inventory[k] || 0));
        assert.equal(e.preview(0, 'summon', s.summonWitness, reserved).matched, true);
        assert.ok(Object.keys(r.cost).every((k) => !MathCore.ops[k] || ['add', 'sub', 'mul', 'div'].includes(k)));
        const ops = Object.keys(MathCore.ops).reduce((a, k) => a + (r.cost[k] || 0), 0);
        assert.ok(ops <= 2);
        return ops;
    }
    for (let seed = 0; seed < 48; seed++) {
        const e = game(seed),
            s = e.sides[0];
        assert.ok(verify(e) >= 1);
        assert.ok(s.targets.summon >= 10);
        assert.equal(s.inventory[String(s.targets.summon)] || 0, 0);
    }
    const reserved = { 3: 1, mul: 1 };
    const e = new Economy({
        battle: Battle.create(5),
        seed: 5,
        reservations: () => reserved,
        config: { mineralWeights: { 7: 100 }, gasWeights: { '=': 100 } },
    });
    const s = e.sides[0];
    s.inventory = { 3: 2, 8: 1, mul: 1, sub: 1, '=': 2 };
    e.refreshTarget(0, reserved);
    assert.equal(s.targets.summon, 5);
    verify(e, reserved);
    assert.equal(e.produce(0, 'summon', s.summonWitness, reserved).actual, 24);
    assert.equal(s.targets.summon, null);
    assert.equal(s.summonWitness, null);
    const neutral = e.preview(0, 'summon', n(3), reserved);
    assert.deepEqual([neutral.ok, neutral.raw, neutral.matched], [false, 0, false]);
    for (let i = 0; i < 300 && !s.stats.gathered['7']; i++) e.tick(1 / 30);
    assert.equal(s.targets.summon, 7);
    verify(e, reserved);
    assert.deepEqual([s.inventory[3], s.inventory.mul], [1, 1]);
    assert.deepEqual(Economy.actions, ['summon']);
    assert.deepEqual(Object.keys(Economy.config.mineralWeights), MathCore.numbers);
    assert.equal(new Set(Object.values(Economy.config.mineralWeights)).size, 1);
    const w = Economy.config.gasWeights;
    assert.equal(
        Object.values(w).reduce((a, b) => a + b),
        100,
    );
    assert.equal(w['='], 40);
    assert.deepEqual(w, { '=': 40, add: 15, sub: 15, mul: 15, div: 15 });
}
// Stale zero-stock settings cannot reintroduce zero, but arithmetic tens still summon spear units.
{
    const e = new Economy({
        battle: Battle.create(42),
        seed: 42,
        config: { initial: { 0: 100, 5: 2, add: 1, '=': 1 }, mineralWeights: { 0: 100, 5: 1 } },
    });
    const s = e.sides[0];
    assert.equal(Object.hasOwn(s.inventory, '0'), false);
    assert.deepEqual(e.config.mineralWeights, { 5: 1 });
    s.targets.summon = 10;
    const summon = e.produce(0, 'summon', o('add', n(5), n(5)));
    assert.deepEqual([summon.ok, summon.value, summon.unitType, summon.actual], [true, 10, 'spear', 24]);
    step(e, 10);
    assert.ok(s.stats.gathered[5] > 0);
    assert.equal(Object.hasOwn(s.stats.gathered, '0'), false);
}
// Every AI summon is funded by ordinary deliveries and the initial hand.
{
    const e = game(9, 'easy');
    step(e, 4);
    e.produce(0, 'summon', e.sides[0].summonWitness);
    step(e, 0.05);
    const cpu = e.sides[1];
    assert.equal(cpu.stats.spent['='], 1);
    // This seed previously missed six consecutive affordable waves with the easy search budget.
    for (let wave = 2; wave <= 7; wave++) {
        step(e, e.ai.interval);
        assert.equal(cpu.stats.spent['='], wave);
    }
}
{
    const e = new Economy({
        battle: Battle.create(1),
        config: {
            initial: { 3: 2, 2: 1, '=': 2, pow: 2, sin: 1 },
            gasWeights: { pow: 90, mul: 10 },
        },
    });
    const s = e.sides[0];
    assert.deepEqual(s.inventory, { 3: 2, 2: 1, '=': 2 });
    assert.deepEqual(e.config.gasWeights, { mul: 10 });
    s.targets.summon = 9;
    s.inventory.pow = 1;
    const before = { ...s.inventory };
    assert.equal(e.produce(0, 'summon', o('pow', n(3), n(2))).ok, false);
    assert.deepEqual(s.inventory, before);
    assert.equal(s.stats.produced, 0);
    step(e, 12);
    assert.ok(s.stats.gathered.mul > 0);
    assert.equal(s.stats.gathered.pow, undefined);
}
{
    const e = game(17, 'hard'),
        s = e.sides[1];
    s.inventory = { 2: 4, '=': 4 };
    s.targets.summon = 8;
    assert.equal(e.decisions(1), null);
    s.inventory[6] = 1;
    let d = e.decisions(1);
    assert.equal(e.produce(1, d.type, d.ast).actual, 8);
    s.inventory[8] = 1;
    d = e.decisions(1);
    const exact = e.produce(1, d.type, d.ast);
    assert.deepEqual([exact.matched, exact.actual], [true, 24]);
    s.targets.summon = null;
    assert.equal(e.decisions(1), null);
}
{
    const withHint = game(123);
    const control = game(123);
    const side = withHint.sides[0];
    assert.deepEqual(withHint.summonHint(0), side.summonWitness);
    const snapshot = JSON.stringify(withHint.sides);
    withHint.summonHint(0, side.inventory);
    assert.equal(JSON.stringify(withHint.sides), snapshot);
    step(withHint, 50);
    step(control, 50);
    assert.deepEqual(withHint.sides, control.sides);

    side.targets.summon = 25;
    side.inventory = { 2: 1, 3: 1, 5: 1, add: 1, mul: 1 };
    const hint = withHint.summonHint(0);
    assert.equal(MathCore.matches(MathCore.evaluate(hint), 25), true);
    assert.equal(withHint.summonHint(0, { 2: 1 }), null);
}
function auditAI(difficulty) {
    const e = game(712, difficulty),
        s = e.sides[1];
    e.produce(0, 'summon', e.sides[0].summonWitness);
    step(e, 300);
    const resourceKeys = [...MathCore.numbers, '=', 'add', 'sub', 'mul', 'div'];
    for (const bag of [s.inventory, s.stats.spent, s.stats.gathered]) {
        assert.ok(Object.keys(bag).every((key) => resourceKeys.includes(key)));
        assert.equal(Object.hasOwn(bag, '0'), false);
    }
    for (const k of new Set([...Object.keys(s.inventory), ...Object.keys(s.stats.spent)])) {
        assert.equal(
            s.inventory[k] || 0,
            (Economy.config.initial[k] || 0) + (s.stats.gathered[k] || 0) - (s.stats.spent[k] || 0),
        );
        assert.ok(s.inventory[k] >= 0);
    }
    assert.ok(s.stats.produced > 0 && s.stats.hits > 0);
    assert.ok(e.battle.count(1) <= 1000);
    assert.ok(s.stats.deliveries > 400);
    assert.equal(
        s.stats.deliveries,
        Object.values(s.stats.gathered).reduce((sum, count) => sum + count, 0),
    );
    assert.equal(s.workers.length, 10);
    return [s.stats.produced, s.stats.hits, s.stats.spent, s.targets];
}
for (const difficulty of ['easy', 'normal', 'hard']) assert.deepEqual(auditAI(difficulty), auditAI(difficulty));
console.log(
    'PASS economy: army limit, integer production, physical gathering, reassignment, giant recruitment without free cargo, goals, AI spending and replay',
);
