import assert from 'node:assert/strict';
import '../vendor/gamekit-core.js';
import '../battle.js';
import '../combat-fx.js';

const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);

// Arrow release is not a hit. A bodyguard receives the mitigated damage when the arrow arrives.
const b = Battle.create(42);
b.spawn(0, 'archer', 1);
b.spawn(1, 'shield', 1);
b.spawn(1, 'thrower', 1);
const [archer, shield, target] = b.units;
Object.assign(archer, { x: 100, y: 500 });
Object.assign(shield, { x: 162, y: 500, facing: -1 });
Object.assign(target, { x: 180, y: 500 });
b.grid.insert(shield, shield.x, shield.y, 1);
const shieldHp = shield.hp,
    protectedHp = target.hp;
b.strike(archer, target);
assert.equal(b.damageFx.size, 0);
b.advanceShots(1 / 60);
assert.equal(b.damageFx.size, 0);
b.advanceShots(1);
const blocked = [...b.damageFx.values()][0];
assert.equal(blocked.style, 'blocked');
assert.equal(blocked.targetId, shield.id);
almost(blocked.amount, shieldHp - shield.hp);
almost(blocked.amount, archer.spec.damage * shield.spec.guard);
assert.equal(target.hp, protectedHp);

// All three victims share one projectile impact number, including only the actual remaining health of a dying target.
const area = Battle.create(7);
area.spawn(0, 'thrower', 1);
area.spawn(1, 'spear', 3);
const [thrower, ...victims] = area.units;
Object.assign(thrower, { x: 100, y: 500 });
victims.forEach((victim, i) => {
    Object.assign(victim, { x: 120 + i * 3, y: 500 });
    area.grid.insert(victim, victim.x, victim.y, 1);
});
victims[1].hp = 0.4;
const before = victims.reduce((hp, v) => hp + v.hp, 0);
area.strike(thrower, victims[0]);
assert.equal(area.damageFx.size, 0);
area.advanceShots(1);
const burst = [...area.damageFx.values()][0];
assert.equal(burst.style, 'blast');
assert.equal(burst.hits, 3);
assert.equal(burst.kills, 1);
almost(burst.amount, before - victims.reduce((hp, v) => hp + v.hp, 0));
assert.equal(area.damageFx.size, 1);
const hq = area.bases[1];
hq.hp = 0.8;
area.damage(hq, thrower, 500, 0, 'blast');
const siege = [...area.damageFx.values()].find((n) => n.base);
almost(siege.amount, 0.8);
assert.equal(siege.kills, 1);
assert.equal(NumoriCombatFx.numberText(0.032), '<0.1');

// A real charge stopped by a planted spear produces measured counter damage.
const f = Battle.create(4);
f.spawn(0, 'charger', 1);
f.spawn(1, 'spear', 1);
const [ram, pike] = f.units;
Object.assign(ram, { x: 100, y: 100, travel: 70 });
Object.assign(pike, { x: 120, y: 100, facing: -1, braced: true });
const ramHp = ram.hp;
f.strike(ram, pike);
const counter = [...f.damageFx.values()].find((n) => n.style === 'brace');
assert.equal(counter.targetId, ram.id);
almost(counter.amount, ramHp - ram.hp);
assert.equal(f.stats.braces[1], 1);

// Presentation records neither accumulate indefinitely nor keep processing dead targets.
const stress = Battle.create(17);
stress.spawn(0, 'spear', 1);
stress.spawn(1, 'shield', 250);
for (const victim of stress.units.slice(1)) stress.damage(victim, stress.units[0], 1, 0, 'thrust');
assert.ok(stress.damageFx.size <= 112);
for (let i = 0; i < 30; i++) stress.step(1 / 30);
assert.equal(stress.damageFx.size, 0);
console.log('PASS causal projectile timing, blocked/overkill/area/HQ/brace damage numbers, record caps and expiry');
