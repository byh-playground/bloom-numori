import assert from "node:assert/strict";
import "../vendor/gamekit-core.js";
import "../battle.js";

const types = Object.keys(Battle.types);
const ticksPerSecond = 30;

function clash(left, right, gap = 230) {
    const field = Battle.create(9);
    [left, right].forEach((composition, side) => {
        for (const [type, count] of composition) field.spawn(side, type, count);
        const units = field.units.filter(unit => unit.side === side);
        const columns = Math.min(8, Math.ceil(Math.sqrt(units.length) * 1.2));
        units.forEach((unit, index) => {
            const row = Math.floor(index / columns);
            const lateral = index % columns - (columns - 1) / 2;
            unit.x = 1500 + (2 * side - 1) * (gap / 2 + row * 19);
            unit.y = 900 + lateral * 19;
            unit.offset = lateral * 18;
        });
    });
    for (let tick = 0; tick < 56 * ticksPerSecond && field.count(0) && field.count(1); tick++) {
        field.step(1 / ticksPerSecond);
    }
    return field;
}
const survivors = field => [field.count(0), field.count(1)];

const matchups = [];
for (let i = 0; i < types.length; i++) {
    for (const opponent of types.slice(i + 1)) {
        const host = types[i];
        const field = clash([[host, 24]], [[opponent, 24]]);
        const [left, right] = survivors(field);
        matchups.push({left: host, right: opponent, leftSurvivors: left, rightSurvivors: right});
    }
}
console.table(matchups);

for (const gap of [160, 230, 300]) {
    const spears = [["spear", 16]];
    const chargers = [["charger", 24]];
    const left = clash(spears, chargers, gap);
    const right = clash(chargers, spears, gap);
    assert.ok(left.count(0) >= 8 && left.count(1) === 0 && left.stats.braces[0] > 0);
    assert.ok(right.count(1) >= 8 && right.count(0) === 0 && right.stats.braces[1] > 0);
    console.log({gap, spearsLeft: survivors(left), spearsRight: survivors(right), braces: [left.stats.braces[0], right.stats.braces[1]]});
}
const ranged = [["archer", 24]];
const guarded = clash([["shield", 8], ["archer", 16]], ranged);
assert.equal(guarded.count(1), 0);
assert.ok(guarded.count(0) >= 16 && guarded.stats.blocks[0] > 0);
assert.equal(guarded.stats.blocks[1], 0);
const cavalry = clash([["charger", 24]], ranged);
assert.ok(cavalry.count(0) > 0 && cavalry.count(1) === 0 && cavalry.stats.charges[0] > 0);
console.log({guardedArchers: survivors(guarded), blocks: guarded.stats.blocks[0], chargingArchers: survivors(cavalry), charges: cavalry.stats.charges[0]});

const clusteredShields = [["shield", 24]];
const stoneVolley = [["thrower", 24]];
for (const gap of [160, 230, 300]) {
    const left = clash(stoneVolley, clusteredShields, gap);
    const right = clash(clusteredShields, stoneVolley, gap);
    assert.ok(left.count(0) > left.count(1) && right.count(1) > right.count(0),
        "Throwers should retain their advantage over massed shields at the faster march speed.");
}
