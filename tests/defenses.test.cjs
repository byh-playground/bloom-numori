const test = require('node:test');
const assert = require('node:assert/strict');
require('../vendor/gamekit-core.js');
require('../battle.js');

function stepUntil(battle, condition, seconds = 100) {
    for (let tick = 0; tick < seconds * 30 && !condition(); tick++) battle.step(1 / 30);
    assert.ok(condition());
}

test('mirror towers and HQs stop isolated attackers on both lanes', () => {
    for (const side of [0, 1]) {
        for (const route of Object.keys(Battle.routes)) {
            const battle = Battle.create(13);
            // The camp was emptied earlier, leaving a lone stray to reach the defense.
            battle.station.giantKind = null;
            battle.station.nextSpawn = Infinity;
            const enemy = 1 - side;
            const base = battle.bases[enemy];
            const tower = battle.towers[enemy][route];
            assert.equal(base.maxHp, 1400);
            battle.spawn(side, 'charger', 1, false, {route});
            stepUntil(battle, () => battle.count(side) === 0);
            assert.ok(tower.lastShot !== null && tower.hp > 0);
            assert.equal(base.lastShot, null);
            assert.equal(base.hp, 1400);
            assert.equal(battle.stats.firstCombat, null);
            assert.ok(battle.stats.defenseHits > 0);

            // A second straggler enters a lane that already lost its first line.
            tower.hp = 0;
            battle.spawn(side, 'archer', 1, false, {route});
            stepUntil(battle, () => battle.count(side) === 0);
            assert.ok(base.lastShot !== null && base.hp > 0);
            assert.equal(battle.winner, -1);
        }
    }
});

test('successive mixed batches break their own lane and the HQ without touching the other tower', () => {
    for (const side of [0, 1]) {
        for (const route of Object.keys(Battle.routes)) {
            const battle = Battle.create(13);
            const enemy = 1 - side;
            const frontLine = battle.towers[enemy][route];
            const otherLine = battle.towers[enemy][route === 'bridge' ? 'supply' : 'bridge'];
            const base = battle.bases[enemy];
            let sawTowerFall = false;
            while (battle.tick < 110 * 30 && battle.winner < 0) {
                if (battle.tick % 180 === 0) {
                    const type = ['shield', 'archer', 'charger', 'spear'][(battle.tick / 180) % 4];
                    battle.spawn(side, type, 24, false, {route});
                }
                battle.step(1 / 30);
                if (!sawTowerFall && frontLine.hp === 0) {
                    assert.equal(base.hp, 1400);
                    assert.ok(battle.effects.some(effect => effect.kind === 'towerDestroy' && effect.route === route));
                    sawTowerFall = true;
                }
            }
            assert.ok(sawTowerFall);
            assert.equal(battle.winner, side);
            assert.equal(base.hp, 0);
            assert.equal(otherLine.hp, otherLine.maxHp);
            assert.equal(battle.stats.towerLosses[enemy], 1);
        }
    }
});

test('every structure fires four direct bolts then a full-power ground splash at six-tick intervals', () => {
    for (const side of [0, 1]) {
        for (const route of ['bridge', 'supply', 'base']) {
            const battle = Battle.create(21);
            const source = route === 'base' ? battle.bases[side] : battle.towers[side][route];
            const road = route === 'base' ? 'bridge' : route;
            const power = route === 'base' ? 24 : 22;
            const x = source.x + (side === 0 ? 120 : -120);
            const place = (team, offset) => {
                battle.spawn(team, 'archer', 1, false, {route: road});
                const unit = battle.units.at(-1);
                Object.assign(unit, {x, y: source.y + offset, hp: 5000,
                    spec: {...unit.spec, speed: 0, range: 0, damage: 0, resist: 1}});
                return unit;
            };
            const target = place(1 - side, 0);
            const nearby = place(1 - side, 24);
            const far = place(1 - side, 60);
            const ally = place(side, -24);
            const shots = [];
            const damage = battle.damage.bind(battle);
            const splash = [];
            battle.damage = (unit, shooter, amount, push, style, burst) => {
                if (style === 'defenseBlast') splash.push({id: unit.id, amount});
                return damage(unit, shooter, amount, push, style, burst);
            };
            for (let i = 0; i < 75; i++) {
                battle.step(1 / 30);
                const launched = battle.projectiles.find(p => p.sourceId === source.id && p.age === 0);
                if (launched) shots.push({kind: launched.kind,tick: battle.tick,damage: launched.spec.damage});
            }
            assert.deepEqual(shots.slice(0, 10).map(shot => shot.kind),
                ['bolt', 'bolt', 'bolt', 'bolt', 'mortar', 'bolt', 'bolt', 'bolt', 'bolt', 'mortar']);
            assert.ok(shots.slice(1).every((shot, i) => shot.tick - shots[i].tick === 6));
            assert.ok(shots.every(shot => shot.damage === power));
            assert.equal(battle.stats.defenseBlasts, 2);
            assert.deepEqual(splash.map(hit => hit.id).sort(), [target.id, target.id, nearby.id, nearby.id].sort());
            assert.ok(splash.every(hit => hit.amount === power));
            assert.equal(far.hp, 5000);
            assert.equal(ally.hp, 5000);
        }
    }
});
