import assert from "node:assert/strict";
import "../vendor/gamekit-core.js";
import "../battle.js";

const near = (actual, expected) => assert.ok(
    Math.abs(actual - expected) < 1e-7, `expected ${expected}, observed ${actual}`
);

for (const [type, archetype] of Object.entries(Battle.types)) {
    const before = {...archetype};
    const field = Battle.create(77);
    field.spawn(0, type, 1);
    field.spawn(0, type, 2, true, {attackMultiplier: 1.5, hpMultiplier: 2.5});
    field.spawn(0, type, 1, true, {attackMultiplier: 2});
    field.spawn(0, type, 1);
    field.spawn(1, "spear", 2);
    const [plain, boosted, sameBatch, otherBatch, later, target, bystander] = field.units;
    for (const unit of [boosted, sameBatch]) {
        near(unit.hp, before.hp * 2.5);
        near(unit.maxHp, before.hp * 2.5);
    }
    near(plain.hp, before.hp);
    near(later.hp, before.hp);
    near(otherBatch.hp, before.hp);
    target.x = boosted.x + 5;
    target.y = boosted.y;
    bystander.x = target.x + 5;
    bystander.y = target.y;
    field.grid.insert(target, target.x, target.y, 1);
    field.grid.insert(bystander, bystander.x, bystander.y, 1);
    const victimHp = target.hp, bystanderHp = bystander.hp;
    field.strike(boosted, target);
    if (archetype.shot) near(target.hp, victimHp);
    field.advanceShots(2);
    near(victimHp - target.hp, before.damage * 1.5);
    const splash = before.blast ? before.damage * 1.5 * (1 - 0.45 * 5 / before.blast) : 0;
    near(bystanderHp - bystander.hp, splash);

    const base = field.bases[1], baseHp = base.hp;
    for (const shooter of [plain, boosted, otherBatch, later]) field.strike(shooter, base);
    field.advanceShots(60);
    near(baseHp - base.hp, before.damage * (1 + 1.5 + 2 + 1) * Battle.settings.siegeDamage);
    assert.deepEqual(archetype, before);
}
console.log("Five batch types passed HP, ordinary and boosted damage, projectile impact, splash and HQ damage checks.");

for (const [kind, spec] of Object.entries(Battle.giants)) {
    const field = Battle.create(77);
    field.deployUnit(0,spec.unitType,spec,1480,1220,{route:"supply",waypoint:4,giantKind:kind});
    field.spawn(1,"shield",3,false,{route:"supply"});
    field.spawn(0,"shield",1,false,{route:"supply"});
    const [giant, primary, secondary, outside, ally] = field.units;
    for (const [unit, x, y] of [[primary,1510,1220],[secondary,1510,1240],
        [outside,1510+spec.blast+1,1220],[ally,1510,1200]]) {
        Object.assign(unit,{x,y});
        field.grid.insert(unit,x,y,unit.side);
    }
    field.strike(giant,primary);
    if(spec.shot) near(primary.hp,primary.maxHp);
    field.advanceShots(2);
    near(primary.maxHp-primary.hp,spec.damage);
    near(secondary.maxHp-secondary.hp,spec.damage);
    near(outside.hp,outside.maxHp);
    near(ally.hp,ally.maxHp);
    const blast = field.effects.findLast(effect => effect.kind === "giantBlast");
    assert.equal(blast.giantKind,kind);
    assert.equal(blast.radius,spec.blast);

    const tower = field.towers[1].supply;
    field.strike(giant,tower);
    field.advanceShots(60);
    near(tower.maxHp-tower.hp,spec.damage*(spec.siegePower ?? 1));
}
console.log("All three giants damage multiple enemies in their splash radius without friendly fire.");
