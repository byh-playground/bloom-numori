const test = require('node:test');
const assert = require('node:assert/strict');

require('../vendor/gamekit-core.js');
require('../math.js');
require('../battle.js');
require('../ai-solver.js');
require('../economy.js');
require('../match-session.js');

function pair(seed = 123) {
    const outgoing = [];
    const errors = [];
    const starts = [];
    const receipts = [];
    const make = (role) =>
        NumoriMatch.create({
            role,
            seed,
            send(packet) {
                outgoing.push([role, structuredClone(packet)]);
                return true;
            },
            onStart: () => starts.push(role),
            onFailure: (reason) => errors.push([role, reason]),
            onProduce: (side, ast, outcome) =>
                receipts.push([role, side, MathCore.format(ast), outcome.actual]),
        });
    const host = make('host'),
        guest = make('guest');
    function flush() {
        while (outgoing.length) {
            const [source, packet] = outgoing.shift();
            (source === 'host' ? guest : host).receive(packet);
        }
    }
    function run(n) {
        for (let i = 0; i < n; i++) {
            host.step();
            flush();
            guest.step();
            flush();
        }
    }
    return {
        host,
        guest,
        flush,
        run,
        outgoing,
        errors,
        starts,
        receipts,
        close() {
            host.close();
            guest.close();
        },
    };
}
const exact = (match, side) => match.economy.sides[side].summonWitness;
function snapshot(m) {
    const b = m.battle,
        e = m.economy;
    return {
        tick: b.tick,
        winner: b.winner,
        units: b.units.map((u) => [
            u.id,
            u.type,
            u.giantKind,
            u.side,
            u.route,
            u.waypoint,
            u.x,
            u.y,
            u.hp,
            u.target?.id,
        ]),
        counts: b.counts,
        bases: b.bases.map((o) => o.hp),
        towers: b.towers.map((side) => [side.bridge.hp, side.supply.hp]),
        mines: b.mines.map((o) => [o.owner, o.claimant, o.progress]),
        station: structuredClone(b.station),
        sides: e.sides.map((s) => ({
            inventory: s.inventory,
            goal: s.targets.summon,
            spent: s.stats.spent,
            gathered: s.stats.gathered,
            allocation: s.workers.map((w) => [w.assigned, w.x, w.y, w.cargo]),
        })),
    };
}

test('AI and PvP share simulation and authorization; both startup orders work', () => {
    for (const slow of ['host', 'guest']) {
        const p = pair();
        try {
            const fast = slow === 'guest' ? 'host' : 'guest';
            p[fast].open();
            p.flush();
            assert(!p[fast].ready);
            p[slow].open();
            p.flush();
            assert(p.host.ready && p.guest.ready);
            assert.deepEqual(p.starts.sort(), ['guest', 'host']);
            assert.deepEqual(p.errors, []);
            p.run(1800);
            assert.deepEqual(snapshot(p.host), snapshot(p.guest));
            assert.equal(p.host.economy.sides[1].stats.produced, 0);
        } finally {
            p.close();
        }
    }
    for (const route of ['bridge', 'supply']) {
        const solo = NumoriMatch.create({ role: 'solo', seed: 123 });
        try {
            solo.open();
            for (let i = 0; i < 1800; i++) solo.step();
            assert.equal(solo.economy.sides[1].stats.produced, 0);
            assert.equal(solo.produce(MathCore.num(1), {}, route).ok, false);
            solo.step();
            assert.equal(solo.economy.sides[1].stats.produced, 0);
            const opening = solo.produce(exact(solo, 0), {}, route);
            assert.equal(opening.actual, 24);
            assert.equal(opening.route, route);
            const cpu = solo.economy.sides[1];
            solo.step();
            assert.equal(cpu.stats.byRoute[route], 0);
            assert.equal(solo.economy.aiWork.phase, 'solving');
            assert.equal(solo.economy.aiWork.route, route);
            const start = solo.battle.time;
            for (let i = 0; i < 150 && !solo.battle.stats.hits; i++) solo.step();
            assert.ok(solo.battle.stats.hits > 0 && solo.battle.stats.firstCombat - start < 5);
            assert.equal(cpu.stats.byRoute[route], 24);
            assert.equal(cpu.stats.spent['='], 1);
        } finally {
            solo.close();
        }
    }
});

test('same tick actions, stale targets and duplicate packets settle atomically', async () => {
    const p = pair();
    try {
        p.guest.open();
        p.host.open();
        p.flush();
        const ours = exact(p.host, 0),
            theirs = exact(p.guest, 1);
        const guestRequest = p.guest.produce(theirs, {});
        const request = structuredClone(p.outgoing[0][1]);
        const ignored = await p.guest.assign('gas', -1);
        assert.equal(ignored.ok, false);
        p.host.produce(ours, {});
        p.host.receive(request); // Original and duplicate request delivered at same tick.
        p.flush();
        assert.equal((await guestRequest).actual, 24);
        assert.equal(p.host.battle.count(0), 24);
        assert.equal(p.host.battle.count(1), 24);
        assert.deepEqual(snapshot(p.host), snapshot(p.guest));
        assert.equal(p.receipts.length, 4);
        const spend = structuredClone(p.host.economy.sides[1].stats.spent);
        const stale = p.guest.produce(exact(p.guest, 1));
        p.outgoing[0][1].command.goal += 1;
        p.flush();
        assert.equal((await stale).ok, false);
        assert.deepEqual(p.host.economy.sides[1].stats.spent, spend);
        const assign = p.guest.assign('gas', -1);
        p.flush();
        assert((await assign).ok);
        assert.deepEqual(p.host.economy.allocation(1), p.guest.economy.allocation(1));
        p.run(2310);
        assert.deepEqual(snapshot(p.host), snapshot(p.guest));
        assert.deepEqual(p.errors, []);
    } finally {
        p.close();
    }
});

test('guest recruits a giant on the lower lane and both peers agree on its kind and next spawn', async () => {
    const p = pair();
    try {
        p.host.open();
        p.guest.open();
        p.flush();
        const invalid = await p.guest.produce(exact(p.guest, 1), {}, 'elsewhere');
        assert.equal(invalid.ok, false);
        assert.equal(p.guest.economy.sides[1].stats.produced, 0);
        const opening = p.guest.produce(exact(p.guest, 1), {}, 'supply');
        p.flush();
        assert.equal((await opening).route, 'supply');
        assert.ok(
            p.guest.battle.units.every((unit) => unit.route === 'supply' && unit.waypoint === 3),
        );
        assert.deepEqual(snapshot(p.host), snapshot(p.guest));
        p.host.produce(exact(p.host, 0));
        p.flush();
        p.run(240);
        const reinforcements = p.guest.produce(exact(p.guest, 1), {}, 'supply');
        p.flush();
        assert.equal((await reinforcements).route, 'supply');
        for (let i = 0; i < 60 && !p.host.battle.station.recruits[1]; i++) p.run(30);
        assert.equal(p.host.battle.station.recruits[1], 1);
        assert.equal(p.host.battle.station.lastRecruit.side, 1);
        const giant = p.host.battle.units.find((unit) => unit.giantKind);
        assert.equal(giant.side, 1);
        assert.equal(giant.giantKind, p.host.battle.station.lastRecruit.giantKind);
        assert.deepEqual(snapshot(p.host), snapshot(p.guest));
        assert.deepEqual(p.errors, []);
    } finally {
        p.close();
    }
});

test('host bounds guest backlog and guest catches up using ordered checkpoints', () => {
    const p = pair();
    try {
        p.host.open();
        p.guest.open();
        p.flush();
        for (let i = 0; i < 400; i++) {
            p.host.step();
            p.flush();
        }
        assert.equal(p.host.battle.tick, 120);
        assert.equal(p.guest.battle.tick, 0);
        for (let i = 0; i < 15; i++) {
            p.guest.step();
            p.flush();
        }
        assert.equal(p.guest.battle.tick, 120);
        assert.deepEqual(snapshot(p.host), snapshot(p.guest));
        p.run(30);
        assert.equal(p.host.battle.tick, 150);
        assert.deepEqual(p.errors, []);
    } finally {
        p.close();
    }
});

test('divergence or lost transport terminates both matches and settles pending inputs', async () => {
    const p = pair();
    try {
        p.host.open();
        p.guest.open();
        p.flush();
        p.guest.economy.sides[1].inventory.mul += 1;
        p.run(60);
        assert.equal(p.host.ready, false);
        assert.equal(p.guest.ready, false);
        assert.equal(p.errors.length, 2);
    } finally {
        p.close();
    }
    const q = pair();
    q.host.open();
    q.guest.open();
    q.flush();
    const pending = q.guest.produce(exact(q.guest, 1));
    q.guest.disconnect();
    assert.equal((await pending).ok, false);
    assert.equal(q.guest.pending, false);
    q.close();
});

test('surrender commits at authoritative tick with opposite winner', async () => {
    for (const role of ['guest', 'host']) {
        const p = pair();
        try {
            p.host.open();
            p.guest.open();
            p.flush();
            const result = p[role].surrender();
            p.flush();
            assert((await result).ok);
            assert.equal(p.host.battle.winner, role === 'guest' ? 0 : 1);
            assert.equal(p.guest.battle.winner, p.host.battle.winner);
            assert.equal(p.host.battle.tick, 0);
            assert.deepEqual(p.errors, []);
        } finally {
            p.close();
        }
    }
});
