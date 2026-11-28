// Match the player inventories and change only the route of the second blue wave.
const assert = require('node:assert/strict');
const fs = require('node:fs');
require('../vendor/gamekit-core.js');
require('../math.js');
require('../battle.js');
require('../ai-solver.js');
require('../economy.js');

const rate = 30;
const seeds = [3, 9, 18, 77, 100, 123];
const round = (value) => Math.round(value * 100) / 100;
const seconds = (tick) => round(tick / rate);
const kinds = Object.keys(Battle.giants);

function match(seed, solo = false) {
    const field = Battle.create(seed);
    const economy = new Economy({
        battle: field,
        seed,
        difficulty: 'normal',
        computerOpponent: solo,
    });
    const contribution = { troopDamage: 0, towerDamage: 0, baseDamage: 0, damageTaken: 0 };
    const damage = field.damage.bind(field);
    field.damage = (target, source, ...args) => {
        const previous = target.hp;
        damage(target, source, ...args);
        const delta = previous - target.hp;
        if (target.side === 0 && target.giantKind) contribution.damageTaken += delta;
        if (
            source.side === 0 &&
            (source.giantKind || kinds.some((kind) => source.spec === Battle.giants[kind]))
        ) {
            if (target.isBase) contribution.baseDamage += delta;
            else if (target.isStructure) contribution.towerDamage += delta;
            else contribution.troopDamage += delta;
        }
    };
    return { field, economy, contribution };
}

function step({ field, economy }) {
    economy.tick(1 / rate);
    field.step(1 / rate);
}

function exact(game, side, route) {
    const { field, economy } = game;
    const ast = economy.summonHint(side);
    assert.ok(ast, 'Expected a feasible target in this scenario');
    const firstId = field.nextId;
    const result = economy.produce(side, 'summon', ast, {}, route);
    assert.ok(result.ok, result.reason);
    return {
        formula: MathCore.format(ast),
        type: result.unitType,
        size: result.actual,
        firstId,
        lastId: field.nextId - 1,
        route: result.route,
    };
}

function compare(seed) {
    const games = [match(seed), match(seed)];
    const waves = [];
    const firstAction = [null, null];
    const firstTowerDamage = [null, null];
    let recruitment = null;

    for (let tick = 0; tick < rate * 110 && games.every((g) => g.field.winner < 0); tick++) {
        if (tick === 4 * rate || tick === 10 * rate) {
            const inputs = games.map((g, i) => [
                exact(g, 0, i && tick === 10 * rate ? 'supply' : 'bridge'),
                exact(g, 1, 'bridge'),
            ]);
            for (let side = 0; side < 2; side++) {
                assert.equal(inputs[0][side].formula, inputs[1][side].formula);
                assert.equal(inputs[0][side].size, inputs[1][side].size);
            }
            waves.push(inputs[0].map(({ formula, size, type }) => ({ formula, size, type })));
            for (let i = 0; i < games.length; i++) games[i].selected = inputs[i][0];
        }

        games.forEach(step);
        if (tick < 10 * rate) continue;
        for (let i = 0; i < games.length; i++) {
            const game = games[i],
                { firstId, lastId } = game.selected;
            const group = game.field.units.filter(
                (unit) => unit.id >= firstId && unit.id <= lastId,
            );
            if (
                firstAction[i] === null &&
                group.some((u) => u.hp < u.maxHp || u.windup > 0 || u.attack > 0)
            )
                firstAction[i] = seconds(tick + 1);
            const tower = game.field.towers[1][game.selected.route];
            if (firstTowerDamage[i] === null && tower.hp < tower.maxHp)
                firstTowerDamage[i] = seconds(tick + 1);
        }
        const [direct, detour] = games;
        const { field } = detour;
        const { station } = field;
        if (!recruitment && station.lastRecruit?.side === 0) {
            const giant = field.units.find(
                (u) => u.side === 0 && u.giantKind === station.lastRecruit.giantKind,
            );
            assert.ok(giant, 'Securing the lower lane must deploy one actual giant');
            assert.equal(giant.route, 'supply');
            assert.equal(field.count(0), field.units.filter((u) => u.side === 0).length);
            recruitment = {
                time: seconds(tick + 1),
                kind: giant.giantKind,
                hp: giant.hp,
                bridgeTroops: games.map(
                    (g) =>
                        g.field.units.filter(
                            (u) =>
                                u.side === 0 && u.route === 'bridge' && Math.abs(u.x - 1500) < 330,
                        ).length,
                ),
                respawnAt: round(station.nextSpawn),
            };
            const directSide = direct.economy.sides[0],
                detourSide = detour.economy.sides[0];
            assert.deepEqual(detourSide.stats.gathered, directSide.stats.gathered);
            assert.deepEqual(detourSide.stats.spent, directSide.stats.spent);
            assert.deepEqual(
                detourSide.inventory,
                directSide.inventory,
                'A recruited giant must not add a hand or mining reward',
            );
            assert.equal(
                detourSide.stats.produced,
                directSide.stats.produced,
                'The guardian must not count as formula-produced troops',
            );
        }
    }

    assert.equal(games[0].field.station.recruits[0], 0, 'A direct wave must not recruit the giant');
    assert.ok(recruitment, 'An unopposed lower wave should recruit a giant');
    return {
        seed,
        waves,
        recruitment,
        firstAction,
        firstTowerDamage,
        giantContribution: Object.fromEntries(
            Object.entries(games[1].contribution).map(([key, value]) => [key, round(value)]),
        ),
        enemyTowerHP: games.map(({ field }) => [
            round(field.towers[1].bridge.hp),
            round(field.towers[1].supply.hp),
        ]),
        enemyBaseHP: games.map(({ field }) => round(field.bases[1].hp)),
    };
}

function cycle(seed) {
    const game = match(seed);
    // The second side arrives after the first recruit and the 28-second respawn.
    const schedule = new Map([
        [4, [0, 'bridge']],
        [10, [0, 'supply']],
        [30, [1, 'bridge']],
        [78, [1, 'supply']],
        [94, [1, 'supply']],
        [122, [1, 'supply']],
    ]);
    const appearances = [];
    const recruits = [];
    let seenRotation = 0,
        seenRecruits = 0;
    for (let tick = 0; tick < rate * 190 && game.field.winner < 0; tick++) {
        const order = schedule.get(tick / rate);
        if (order) {
            const [side, route] = order;
            const ast = game.economy.summonHint(side);
            if (ast && game.economy.preview(side, 'summon', ast).ok) exact(game, side, route);
        }
        step(game);
        const camp = game.field.station;
        if (camp.rotation !== seenRotation) {
            appearances.push({ time: seconds(tick + 1), kind: camp.giantKind });
            seenRotation = camp.rotation;
        }
        const total = camp.recruits[0] + camp.recruits[1];
        if (total !== seenRecruits) {
            recruits.push({ ...camp.lastRecruit, time: seconds(tick + 1) });
            seenRecruits = total;
        }
    }
    return { seed, appearances, recruits };
}

function solo(seed) {
    const game = match(seed, true),
        routed = new Set();
    for (let tick = 0; tick < rate * 110 && game.field.winner < 0; tick++) {
        if (tick === 4 * rate) exact(game, 0, 'bridge');
        if (tick === 10 * rate) exact(game, 0, 'supply');
        step(game);
        for (const unit of game.field.units)
            if (unit.side === 1 && !unit.giantKind) routed.add(unit.route);
    }
    return { seed, enemyRoutes: [...routed], recruits: game.field.station.recruits };
}

const report = { paired: seeds.map(compare), cycles: seeds.map(cycle), solo: seeds.map(solo) };
assert.ok(
    report.paired.some(
        (row) =>
            row.firstAction[0] !== null &&
            row.firstAction[1] !== null &&
            row.firstAction[0] < row.firstAction[1],
    ),
    'Diverting a wave should delay its first combat action',
);
assert.ok(
    report.paired.some((row) => row.giantContribution.towerDamage > 0),
    'The recruited giant should deliver measurable combat value against the tower',
);
assert.ok(
    report.cycles.some((row) => new Set(row.appearances.slice(0, 3).map((v) => v.kind)).size === 3),
    'The first three appearances must cycle through all kinds',
);
assert.ok(
    report.cycles.some((row) => new Set(row.recruits.map((v) => v.side)).size === 2),
    'Each side should be able to secure a giant after a previous recruit',
);
assert.ok(
    report.solo.some((row) => row.enemyRoutes.includes('supply')),
    'The AI must contest the giant route',
);

const json = JSON.stringify(report, null, 2);
if (process.argv[2]) fs.writeFileSync(process.argv[2], json);
console.log(json);
