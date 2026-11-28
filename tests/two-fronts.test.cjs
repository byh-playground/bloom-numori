const test = require('node:test');
const assert = require('node:assert/strict');
require('../vendor/gamekit-core.js');
require('../math.js');
require('../battle.js');
require('../ai-solver.js');
require('../economy.js');

function play(route, side) {
    const seed = 9,
        battle = Battle.create(seed);
    const economy = new Economy({ seed, battle, computerOpponent: false });
    const results = [],
        dt = 1 / 30;
    let firstTowerHit, lowerTowerHit;
    const towers = battle.towers[1 - side];
    for (let tick = 0; tick < 90 * 30 && battle.winner < 0; tick++) {
        if (tick === 0 || tick === 180) {
            const dispatch = economy.produce(
                side,
                'summon',
                economy.summonHint(side),
                {},
                tick ? route : 'bridge',
            );
            assert.equal(dispatch.actual, 24);
            results.push(dispatch.route);
        }
        economy.tick(dt);
        battle.step(dt);
        if (firstTowerHit === undefined && towers.bridge.hp < towers.bridge.maxHp)
            firstTowerHit = battle.time;
        if (lowerTowerHit === undefined && towers.supply.hp < towers.supply.maxHp)
            lowerTowerHit = battle.time;
    }
    return { results, station: battle.station, firstTowerHit, lowerTowerHit, towers };
}

test('a paid detour recruits a giant while the direct route threatens the first tower earlier', () => {
    for (const side of [0, 1]) {
        const bridge = play('bridge', side),
            supply = play('supply', side);
        assert.deepEqual(bridge.results, ['bridge', 'bridge']);
        assert.deepEqual(supply.results, ['bridge', 'supply']);
        assert.equal(bridge.station.owner, -1);
        assert.deepEqual(bridge.station.recruits, [0, 0]);
        assert.equal(supply.station.lastRecruit.side, side);
        assert.equal(supply.station.recruits[side], 1);
        assert.ok(Number.isFinite(bridge.firstTowerHit));
        assert.ok(supply.station.lastRecruit.time > bridge.firstTowerHit);
        assert.ok(supply.lowerTowerHit > supply.station.lastRecruit.time);
        assert.equal(bridge.towers.supply.hp, bridge.towers.supply.maxHp);
    }
});

test('the AI can recruit when it wins a contested altar and still reinforces the bridge', () => {
    const seed = 123,
        battle = Battle.create(seed);
    const economy = new Economy({ seed, battle, difficulty: 'normal' });
    for (let tick = 0; tick < 90 * 30; tick++) {
        if (tick === 0 || tick === 180)
            assert.ok(
                economy.produce(0, 'summon', economy.summonHint(0), {}, tick ? 'supply' : 'bridge')
                    .ok,
            );
        economy.tick(1 / 30);
        battle.step(1 / 30);
    }
    assert.deepEqual(battle.station.recruits, [0, 1]);
    assert.equal(battle.station.lastRecruit.side, 1);
    assert.ok(economy.sides[1].stats.byRoute.bridge > economy.sides[1].stats.byRoute.supply);
});

test('neutral rotation uses every giant type before shuffling and recruits never claim another giant alone', () => {
    const run = (seed) => {
        const battle = Battle.create(seed);
        const camp = battle.station;
        const spawned = [];
        for (let round = 0; round < 6; round++) {
            const side = round % 2;
            const type = camp.giantKind;
            spawned.push(type);
            assert.ok(Battle.giants[type]);
            assert.equal(battle.spawn(side, 'shield', 1, false, { route: 'supply' }), 1);
            const unit = battle.units.at(-1);
            Object.assign(unit, { x: camp.x, y: camp.y, waypoint: 3 });
            for (let i = 0; i < 30 * 30 - 1; i++) battle.step(1 / 30);
            assert.equal(camp.giantKind, type);
            battle.step(1 / 30);
            assert.equal(camp.giantKind, null);
            assert.equal(camp.lastRecruit.side, side);
            assert.equal(camp.lastRecruit.giantKind, type);
            const recruited = battle.units.find((u) => u.side === side && u.giantKind === type);
            assert.ok(recruited);
            assert.equal(recruited.hp, Battle.giants[type].hp);
            assert.equal(battle.count(side), 2);
            assert.deepEqual(camp.recruits, [
                Math.ceil((round + 1) / 2),
                Math.floor((round + 1) / 2),
            ]);
            battle.damage(unit, battle.bases[1 - side], unit.hp, 0);
            // Leave only the recruited giant on the site during the next appearance.
            recruited.spec = { ...recruited.spec, speed: 0 };
            const appearance = camp.nextSpawn;
            while (battle.time < appearance + 5) battle.step(1 / 30);
            assert.equal(camp.progress, 0);
            assert.equal(camp.owner, -1);
            assert.ok(camp.giantKind);
            battle.damage(recruited, battle.bases[1 - side], recruited.hp, 0);
            battle.step(1 / 30);
        }
        for (const group of [spawned.slice(0, 3), spawned.slice(3, 6)])
            assert.deepEqual([...group].sort(), Object.keys(Battle.giants).sort());
        assert.notEqual(spawned[2], spawned[3]);
        return spawned;
    };
    assert.deepEqual(run(483), run(483));
});

test('a full army can advance while the giant waits for a free slot', () => {
    const battle = Battle.create(491);
    const camp = battle.station;
    const limit = Battle.settings.armyLimit;
    battle.spawn(0, 'archer', limit - 1);
    battle.units.forEach((u, i) => {
        u.x = 115 + (i % 39) * 17;
        u.y = 480 + Math.floor(i / 39) * 17;
    });
    battle.spawn(0, 'shield', 1, false, { route: 'supply' });
    const leader = battle.units.at(-1);
    Object.assign(leader, { x: camp.x, y: camp.y, waypoint: 3 });
    camp.claimant = 0;
    camp.progress = 1 - 1 / (30 * Battle.settings.captureSeconds);
    for (let i = 0; i < 7; i++) battle.step(1 / 30);
    assert.ok(camp.giantKind);
    assert.equal(camp.progress, 1);
    assert.equal(battle.count(0), limit);
    assert.ok(leader.waypoint > 3 && leader.x > camp.x);
    battle.damage(battle.units[0], battle.bases[1], 1000, 0);
    battle.step(1 / 30);
    assert.equal(camp.giantKind, null);
    assert.equal(battle.count(0), limit);
});

test('a one-unit advantage accrues a full thirty seconds, ties pause and an overtaking side starts over', () => {
    const battle = Battle.create(9),
        camp = battle.station;
    const step = 1 / 30;
    const campSeconds = (seconds) => {
        for (let i = 0; i < Math.round(seconds / step); i++) {
            battle.time += step;
            battle.capture(step);
        }
    };
    const addTroops = (side, count) => {
        const start = battle.units.length;
        battle.spawn(side, 'shield', count, false, { route: 'supply' });
        for (const unit of battle.units.slice(start))
            Object.assign(unit, { x: camp.x, y: camp.y, waypoint: 3 });
    };
    addTroops(0, 2);
    addTroops(1, 1);
    campSeconds(10);
    assert.equal(camp.claimant, 0);
    assert.ok(Math.abs(camp.progress - 1 / 3) < 1e-8);
    const lead = camp.progress;
    addTroops(1, 1);
    campSeconds(5);
    assert.equal(camp.progress, lead);
    assert.deepEqual(camp.presence, [2, 2]);
    addTroops(1, 1);
    campSeconds(1);
    assert.equal(camp.claimant, 1);
    assert.ok(Math.abs(camp.progress - 1 / 30) < 1e-8);
    campSeconds(29 - step);
    assert.deepEqual(camp.recruits, [0, 0]);
    campSeconds(step);
    assert.deepEqual(camp.recruits, [0, 1]);
    assert.ok(Math.abs(camp.lastRecruit.time - 45) < 1e-8);
});
