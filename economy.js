(() => {
    'use strict';
    const TYPES = Object.keys(Battle.types);
    const ACTIONS = ['summon'];
    const MINE_KEYS = ['mineral', 'gas'];
    const BASIC = ['add', 'sub', 'mul', 'div'];
    const CONFIG = {
        armyLimit: Battle.settings.armyLimit,
        initialWorkersPerMine: 5,
        speed: 166,
        digSeconds: 2,
        mineSlots: { mineral: 6, gas: 6 },
        initial: { 2: 2, 3: 2, 4: 2, 5: 1, 8: 2, add: 2, sub: 1, mul: 2, div: 1, '=': 4 },
        troopMultiplier: 3,
        nearMultiplier: 2,
        baseBatch: 8,
        gasWeights: {
            '=': 40,
            add: 15,
            sub: 15,
            mul: 15,
            div: 15,
        },
        mineralWeights: Object.fromEntries(MathCore.numbers.map((digit) => [digit, 1])),
        ai: {
            easy: { cards: 2, cardSeconds: 0.54, recovery: 11.6, counterWeight: 0.15 },
            normal: {
                cards: 3,
                cardSeconds: 0.43,
                recovery: 6.8,
                counterWeight: 0.35,
            },
            hard: {
                cards: 4,
                cardSeconds: 0.35,
                recovery: 4.2,
                counterWeight: 0.65,
            },
        },
    };
    const AI_SIDE = 1;
    const HAND_KEYS = [...MathCore.numbers, ...BASIC, '='];
    const AI_RECEIPT_SECONDS = 1.8;

    function seeded(seed) {
        const rng = new NumoriGameKit.SeededPRNG(seed >>> 0);
        return () => rng.nextUint32() / 4294967296;
    }

    function weighted(weights, rng) {
        const entries = Object.entries(weights);
        let roll = rng() * entries.reduce((sum, entry) => sum + entry[1], 0);
        for (const [key, weight] of entries) {
            roll -= weight;
            if (roll < 0) return key;
        }
        return entries.at(-1)[0];
    }
    function stats() {
        return {
            produced: 0,
            maxArmy: 0,
            byType: Object.fromEntries(TYPES.map((t) => [t, 0])),
            hits: 0,
            maxValue: 0,
            maxBatch: 0,
            waste: 0,
            operators: {},
            spent: {},
            gathered: {},
            deliveries: 0,
            byRoute: { bridge: 0, supply: 0 },
            lastDelivery: null,
            lastSupply: {},
            firstProduction: null,
            firstRoute: null,
        };
    }
    function increment(bag, key, n = 1) {
        bag[key] = (bag[key] || 0) + n;
    }

    const unitReasons = {
        spear: '10의 배수',
        charger: '두 자리 이상 완전제곱수',
        thrower: '두 자리 이상 소수(Prime)',
        shield: '3의 배수',
        archer: '나머지 양의 정수',
    };
    const integerTypes = new Map();
    function modularPower(base, exponent, modulus) {
        let value = 1n;
        for (; exponent > 0n; exponent >>= 1n) {
            if (exponent & 1n) value = (value * base) % modulus;
            base = (base * base) % modulus;
        }
        return value;
    }
    function prime(n) {
        if (n < 2) return false;
        for (const p of [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]) {
            if (n % p === 0) return n === p;
        }
        if (n < 1000000) {
            for (let d = 41; d * d <= n; d += 2) if (n % d === 0) return false;
            return true;
        }
        // These seven Miller–Rabin witnesses are deterministic below 2^64.
        const modulus = BigInt(n);
        let d = modulus - 1n,
            powers = 0;
        while (!(d & 1n)) {
            d >>= 1n;
            powers++;
        }
        for (const witness of [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n]) {
            const base = witness % modulus;
            if (base === 0n) continue;
            let x = modularPower(base, d, modulus);
            if (x === 1n || x === modulus - 1n) continue;
            for (let i = 1; i < powers && x !== modulus - 1n; i++) x = (x * x) % modulus;
            if (x !== modulus - 1n) return false;
        }
        return true;
    }
    function positiveInteger(result) {
        return (
            result.ok &&
            result.value > 0 &&
            Number.isSafeInteger(result.value) &&
            MathCore.matches(result, result.value)
        );
    }
    function classifyBasis(n) {
        if (integerTypes.has(n)) return integerTypes.get(n);
        const root = Math.floor(Math.sqrt(n));
        const type =
            n >= 16 && root * root === n
                ? 'charger'
                : n >= 11 && prime(n)
                  ? 'thrower'
                  : n % 10 === 0
                    ? 'spear'
                    : n % 3 === 0
                      ? 'shield'
                      : 'archer';
        if (integerTypes.size >= 1024) integerTypes.clear();
        integerTypes.set(n, type);
        return type;
    }
    function classify(result) {
        if (!positiveInteger(result)) return null;
        const unitType = classifyBasis(result.value);
        return { unitType, unitReason: unitReasons[unitType] };
    }
    function summonRange(goal) {
        if (!Number.isSafeInteger(goal) || goal < 1) return null;
        return { min: Math.max(1, goal - 2), max: Math.min(Number.MAX_SAFE_INTEGER, goal + 2) };
    }
    function troopPlan(result, classification, goal, range, config) {
        const plan = { ...classification, matched: false, raw: 0 };
        if (!range || result.value < range.min || result.value > range.max) return plan;
        const difference = Math.abs(result.value - goal);
        plan.matched = difference === 0;
        const multiplier = plan.matched
            ? config.troopMultiplier
            : difference === 1
              ? config.nearMultiplier
              : 1;
        plan.raw = config.baseBatch * multiplier;
        return plan;
    }

    const availableInventory = (bag, reserved) =>
        Object.fromEntries(Object.entries(bag).map(([key, n]) => [key, n - (reserved[key] || 0)]));

    // Iterate small grids completely. A seeded start and coprime stride samples larger grids
    // without replacement, bounded by the evaluation budget per operation depth.
    function* sampleIndices(size, budget, rng) {
        if (!size) return;
        let index = Math.floor(rng() * size),
            stride = Math.floor(rng() * size) || 1;
        for (;;) {
            let a = size,
                b = stride;
            while (b) [a, b] = [b, a % b];
            if (a === 1) break;
            stride++;
        }
        for (let i = 0; i < Math.min(size, budget); i++) {
            yield index;
            index = (index + stride) % size;
        }
    }
    function* basicCandidates(stock, rng, budget) {
        const M = globalThis.MathCore;
        const leaves = M.numbers
            .filter((k) => stock[k] > 0)
            .map((key) => {
                const ast = M.num(key);
                return { ast, r: M.evaluate(ast), key, depth: 0 };
            });
        const ops = BASIC.filter((op) => stock[op] > 0);
        yield* leaves;
        let previous = leaves;
        for (let depth = 1; depth <= 2; depth++) {
            const next = [],
                orders = depth === 1 ? 1 : 2;
            for (let index of sampleIndices(
                previous.length * leaves.length * ops.length * orders,
                budget,
                rng,
            )) {
                const swap = index % orders;
                index = Math.floor(index / orders);
                const op = ops[index % ops.length];
                index = Math.floor(index / ops.length);
                const leaf = leaves[index % leaves.length],
                    branch = previous[Math.floor(index / leaves.length)];
                if (
                    stock[leaf.key] < 1 + (branch.r.cost[leaf.key] || 0) ||
                    stock[op] < 1 + (branch.r.cost[op] || 0)
                )
                    continue;
                const ast = swap ? M.op(op, leaf.ast, branch.ast) : M.op(op, branch.ast, leaf.ast);
                const r = M.evaluate(ast);
                if (!r.ok) continue;
                const candidate = { ast, r, depth };
                if (depth === 1) next.push(candidate);
                yield candidate;
            }
            previous = next;
        }
    }

    class Economy {
        #aiView = null;
        #aiDraft = null;
        #lastAIInput = '';
        #lastAILaunch = -Infinity;

        constructor({
            seed = 1,
            difficulty = 'normal',
            battle,
            config = {},
            reservations = () => ({}),
            computerOpponent = true,
        }) {
            const allowedWeights = (overrides, defaults) => {
                const entries = Object.entries(overrides ?? {}).filter(
                    ([key, value]) =>
                        Object.hasOwn(defaults, key) && Number.isFinite(value) && value > 0,
                );
                return entries.length ? Object.fromEntries(entries) : defaults;
            };
            const initial = Object.fromEntries(
                Object.entries(config.initial ?? CONFIG.initial).filter(
                    ([key, count]) =>
                        Number.isSafeInteger(count) &&
                        count >= 0 &&
                        (MathCore.numbers.includes(key) || key === '=' || BASIC.includes(key)),
                ),
            );
            this.config = Object.freeze({
                ...CONFIG,
                ...config,
                initial,
                armyLimit: CONFIG.armyLimit,
                mineralWeights: allowedWeights(config.mineralWeights, CONFIG.mineralWeights),
                gasWeights: allowedWeights(config.gasWeights, CONFIG.gasWeights),
            });
            this.nextId = 1;
            this.battle = battle;
            this.rng = seeded(seed);
            this.reservations = reservations;
            this.difficulty = difficulty in this.config.ai ? difficulty : 'normal';
            this.computerOpponent = computerOpponent;
            this.ai = this.config.ai[this.difficulty];
            this.time = 0;
            this.bases = battle.bases;
            this.mines = this.bases.map((base, side) => {
                const sign = side ? -1 : 1;
                return {
                    mineral: { x: base.x - sign * 148, y: base.y - 110 },
                    gas: { x: base.x + sign * 150, y: base.y + 110 },
                };
            });
            this.supplyRandom = this.bases.map(() =>
                Object.fromEntries(
                    MINE_KEYS.map((name, i) => [
                        name,
                        seeded((seed >>> 0) ^ Math.imul(i + 1, 0x9e3779b9)),
                    ]),
                ),
            );
            this.sides = this.bases.map(() => ({
                inventory: { ...this.config.initial },
                workers: [],
                targets: {},
                summonWitness: null,
                stats: stats(),
            }));
            this.sides.forEach((_, side) => {
                for (const mine of ['mineral', 'gas']) {
                    for (let i = 0; i < this.config.initialWorkersPerMine; i++)
                        this.#startingWorker(side, mine, i * 0.4);
                }
                this.refreshTarget(side, {});
            });
            if (computerOpponent) this.#waitAI('opening');
        }
        get aiWork() {
            return this.#aiView;
        }
        allocation(side) {
            const result = { mineral: 0, gas: 0, idle: 0 };
            for (const w of this.sides[side].workers) result[w.assigned || 'idle']++;
            return result;
        }
        accessible(side, mine) {
            return MINE_KEYS.includes(mine);
        }
        assign(side, mine, delta) {
            if (this.battle.winner !== -1 || !MINE_KEYS.includes(mine) || ![1, -1].includes(delta))
                return false;
            const workers = this.sides[side].workers;
            if (
                delta > 0 &&
                (!this.accessible(side, mine) ||
                    this.allocation(side)[mine] >= this.config.mineSlots[mine])
            )
                return false;
            const worker = workers.find((w) => w.assigned === (delta > 0 ? null : mine));
            if (!worker) return false;
            worker.assigned = delta > 0 ? mine : null;
            return true;
        }
        #startingWorker(team, assigned, wait) {
            const base = this.bases[team],
                id = this.nextId++;
            const offset = ((id * 17) % 47) - 23;
            this.sides[team].workers.push({
                id,
                team,
                assigned,
                trip: null,
                walkDistance: 0,
                x: base.x + offset,
                y: base.y + 20,
                offset,
                phase: 'idle',
                cargo: null,
                cargoCount: 0,
                cargoTokens: [],
                wait,
            });
        }
        move(w, target, dt) {
            const x = target.x + w.offset,
                y = target.y + 15 + w.offset * 0.25;
            const dx = x - w.x,
                dy = y - w.y,
                d = Math.hypot(dx, dy),
                step = this.config.speed * dt;
            w.walkDistance += Math.min(d, step);
            if (d <= step) {
                w.x = x;
                w.y = y;
                return true;
            }
            w.x += (dx * step) / d;
            w.y += (dy * step) / d;
            return false;
        }
        updateWorker(w, dt) {
            const s = this.sides[w.team],
                base = this.bases[w.team];
            if (w.assigned && !this.accessible(w.team, w.assigned)) w.assigned = null;
            if (w.phase === 'idle') {
                w.wait -= dt;
                if (!w.assigned || w.wait > 0) return;
                w.trip = w.assigned;
                w.phase = 'out';
            }
            if ((w.phase === 'out' || w.phase === 'dig') && w.assigned !== w.trip) {
                w.phase = 'back';
            }
            if (w.phase === 'out') {
                if (this.move(w, this.mines[w.team][w.trip], dt)) {
                    w.phase = 'dig';
                    w.wait = this.config.digSeconds;
                }
            } else if (w.phase === 'dig') {
                w.wait -= dt;
                if (w.wait <= 0) {
                    const gas = w.trip === 'gas';
                    w.cargoCount = 1;
                    const weights = gas ? this.config.gasWeights : this.config.mineralWeights;
                    w.cargoTokens = Array.from({ length: w.cargoCount }, () =>
                        weighted(weights, this.supplyRandom[w.team][w.trip]),
                    );
                    w.cargo = w.cargoTokens[0];
                    w.phase = 'back';
                }
            } else if (this.move(w, base, dt)) {
                if (w.cargo !== null) {
                    for (const token of w.cargoTokens) {
                        increment(s.inventory, token);
                        increment(s.stats.gathered, token);
                    }
                    s.stats.deliveries++;
                    const event = {
                        token: w.cargo,
                        time: this.time,
                        mine: w.trip,
                        worker: w.id,
                        count: w.cargoCount,
                    };
                    s.stats.lastDelivery = event;
                    s.stats.lastSupply[w.trip] = event;
                    if (s.targets.summon === null)
                        this.refreshTarget(w.team, this.reservations(w.team));
                }
                w.cargo = null;
                w.cargoCount = 0;
                w.cargoTokens = [];
                w.trip = null;
                w.phase = 'idle';
                w.wait = 0;
            }
        }
        refreshTarget(side, reserved = {}) {
            const s = this.sides[side];
            const stock = availableInventory(s.inventory, reserved);
            const previous = s.targets.summon;
            let best = null,
                rank = -1,
                ties = 0;
            // Finish sampling before the tie-break draws from the same match RNG.
            const candidates = [...basicCandidates(stock, this.rng, 96)];
            for (const option of candidates) {
                const { r, depth } = option;
                if (!positiveInteger(r)) continue;
                const value = r.value;
                const held = stock[String(value)] > 0 || depth === 0;
                const score =
                    (value !== previous ? 64 : 0) +
                    (depth > 0 ? 8 : 0) +
                    (!held ? 4 : 0) +
                    (value >= 10 ? 2 : 0);
                if (score > rank) {
                    best = option;
                    rank = score;
                    ties = 1;
                } else if (score === rank && this.rng() < 1 / ++ties) best = option;
            }
            s.summonWitness = best?.ast ?? null;
            s.targets.summon = best?.r.value ?? null;
        }
        summonHint(side, reserved = {}) {
            const { inventory, targets, summonWitness } = this.sides[side];
            const goal = targets.summon;
            if (!summonRange(goal)) return null;

            const math = globalThis.MathCore;
            const stock = availableInventory(inventory, reserved);
            const witness = summonWitness && math.evaluate(summonWitness);
            if (
                math.matches(witness, goal) &&
                Object.entries(witness.cost).every(([key, n]) => stock[key] >= n)
            )
                return summonWitness;

            // At most three digit blocks and two operators. A fixed traversal keeps hints off the match RNG.
            for (const { ast, r } of basicCandidates(stock, () => 0, Infinity)) {
                if (r.value === goal && math.matches(r, goal)) return ast;
            }
            return null;
        }
        preview(side, type, ast, reserved = {}) {
            const M = globalThis.MathCore,
                s = this.sides[side];
            const result = M.evaluate(ast),
                target = s.targets[type] ?? null,
                room = this.config.armyLimit - this.battle.count(side);
            const preview = {
                ok: false,
                reason: '',
                value: result.value,
                target,
                matched: false,
                unitType: null,
                unitReason: '',
                raw: 0,
                actual: 0,
                waste: 0,
                cost: result.cost || {},
            };
            const fail = (reason) => ({ ...preview, reason });
            if (this.battle.winner === 0 || this.battle.winner === 1)
                return fail('종료된 전투입니다.');
            if (!reserved || Object.values(reserved).some((n) => !Number.isSafeInteger(n) || n < 0))
                return fail('자원 예약을 확인하세요.');
            if (!result.ok) return fail(result.error || '수식을 완성하세요.');
            if (!ACTIONS.includes(type)) return fail('생산 대상을 선택하세요.');
            const classification = classify(result);
            if (!classification) return fail('소환하려면 양의 정수로 이어서 만드세요.');
            const range = summonRange(target);
            Object.assign(preview, troopPlan(result, classification, target, range, this.config));
            if (!range) return fail('채집 후 소환 목표가 정해져요.');
            if (!preview.raw)
                return fail(`소환하려면 ${range.min}~${range.max} 사이의 정수를 만드세요.`);
            preview.actual = Math.min(Math.max(0, room), preview.raw);
            preview.waste = preview.raw - preview.actual;
            if (room <= 0) return fail('병력 상한 1,000마리에 도달했어요.');
            for (const [k, n] of Object.entries(result.cost)) {
                if ((s.inventory[k] || 0) - (reserved[k] || 0) < n)
                    return fail('사용할 수 있는 자원 블록이 부족합니다.');
            }
            if (!(s.inventory['='] > 0)) return fail('생산에 필요한 등호가 없습니다.');
            preview.ok = true;
            return preview;
        }
        produce(side, type, ast, reserved = {}, route = 'bridge') {
            const p = this.preview(side, type, ast, reserved);
            if (!p.ok) return p;
            if (!Object.hasOwn(Battle.routes, route))
                return { ...p, ok: false, reason: '출격 경로를 확인하세요.' };
            const s = this.sides[side],
                stats = s.stats;
            for (const [key, n] of Object.entries({ ...p.cost, '=': 1 })) {
                s.inventory[key] -= n;
                increment(stats.spent, key, n);
                if (globalThis.MathCore.ops[key]) increment(stats.operators, key, n);
            }
            const opening = stats.firstProduction === null;
            p.route = route;
            this.battle.spawn(side, p.unitType, p.actual, p.matched, {
                opening,
                route: p.route,
                equation:
                    side === 0 && p.matched
                        ? globalThis.MathCore.format(ast) + ' = ' + p.target
                        : null,
            });
            stats.firstProduction ??= this.time;
            stats.firstRoute ??= route;
            stats.produced += p.actual;
            stats.byRoute[p.route] += p.actual;
            stats.byType[p.unitType] += p.actual;
            stats.maxArmy = Math.max(stats.maxArmy, this.battle.count(side));
            stats.maxBatch = Math.max(stats.maxBatch, p.actual);
            stats.waste += p.waste;
            if (p.matched) {
                stats.hits++;
                this.refreshTarget(side, reserved);
            }
            stats.maxValue = Math.max(stats.maxValue, p.value);
            return p;
        }
        staffMines(side) {
            const crewSize = this.sides[side].workers.length;
            const gas = Math.min(
                this.config.mineSlots.gas,
                Math.floor(crewSize / 2) + (this.sides[side].inventory['='] < 2 ? 1 : 0),
            );
            const desired = { mineral: crewSize - gas, gas };
            const current = this.allocation(side);
            for (const mine of MINE_KEYS) {
                for (let i = desired[mine]; i < current[mine]; i++) this.assign(side, mine, -1);
            }
            for (const mine of MINE_KEYS) {
                for (let i = current[mine]; i < desired[mine]; i++) this.assign(side, mine, 1);
            }
        }
        chooseRoute(side) {
            const station = this.battle.station;
            const stats = this.sides[side].stats;
            if (stats.firstProduction === null)
                return this.sides[1 - side].stats.firstRoute ?? 'bridge';
            if (
                this.battle.threat[side] ||
                (station.nextSpawn !== null && station.nextSpawn - this.time > 20)
            )
                return 'bridge';
            // Keep the main approach staffed while a column heads towards the neutral giant.
            const onTheWay = this.battle.units.some(
                (u) =>
                    u.side === side &&
                    u.route === 'supply' &&
                    !u.giantKind &&
                    (side === 0 ? u.waypoint <= 3 : u.waypoint >= 3),
            );
            if (onTheWay || stats.byRoute.supply >= stats.byRoute.bridge * 0.65) return 'bridge';
            return 'supply';
        }
        decisions(
            side = AI_SIDE,
            stock = availableInventory(this.sides[side].inventory, this.reservations(side)),
        ) {
            this.staffMines(side);
            const army = this.battle.count(side),
                room = this.config.armyLimit - army;
            const goal = this.sides[side].targets.summon,
                range = summonRange(goal);
            if (!(stock['='] > 0) || room <= 0 || !range) return null;
            const enemy = this.battle.counts[1 - side],
                friendly = this.battle.counts[side];
            const enemyArmy = Math.max(1, this.battle.count(1 - side));
            const weights = Object.fromEntries(
                TYPES.map((type) => {
                    const balance = 1 / (1 + friendly[type] / Math.max(2, army / TYPES.length));
                    const enemyCount = Battle.roles[type].strongAgainst.reduce(
                        (sum, counter) => sum + enemy[counter],
                        0,
                    );
                    return [
                        type,
                        1 + balance * 0.2 + (enemyCount / enemyArmy) * this.ai.counterWeight,
                    ];
                }),
            );
            const rank = (_, result) => {
                const classification = classify(result);
                const plan = troopPlan(result, classification, goal, range, this.config);
                const actual = Math.min(room, plan.raw);
                const cost = Object.entries(result.cost).reduce(
                    (sum, [key, count]) => sum + count * (1 + 0.6 / stock[key]),
                    0,
                );
                return (
                    weights[classification.unitType] * actual -
                    (plan.raw - actual) * 0.25 +
                    (plan.matched ? 5 : 0) -
                    cost
                );
            };
            // Goals come from up to three digits. Easy prefers fewer cards, but may try a
            // longer draft when its preferred hand size yields no usable move.
            const opening = this.sides[side].stats.firstProduction === null;
            const cards = opening ? 3 : this.ai.cards;
            const solver = globalThis.NumoriAISolver;
            let solution = solver.solve(stock, goal, { cards }, rank);
            if (!solution && cards < 3) solution = solver.solve(stock, goal, { cards: 3 }, rank);
            return solution && { type: 'summon', ast: solution.ast, points: solution.score };
        }
        #waitAI(reason) {
            const target = this.sides[AI_SIDE].targets.summon ?? null;
            if (
                this.#aiView?.phase === 'waiting' &&
                this.#aiView.reason === reason &&
                this.#aiView.target === target
            )
                return;
            this.#aiView = {
                phase: 'waiting',
                reason,
                tokens: [],
                revealed: 0,
                target,
                value: null,
                route: null,
                count: 0,
                until: 0,
            };
        }
        #writeAI(draft, revealed, phase, until, count = draft.count) {
            this.#aiView = {
                phase,
                tokens: draft.tokens,
                revealed,
                target: draft.target,
                value: revealed === draft.tokens.length ? draft.value : null,
                route: draft.route,
                count,
                until,
            };
        }
        #advanceDraft() {
            const draft = this.#aiDraft;
            const revealed = Math.min(
                draft.tokens.length,
                1 + Math.floor((this.time - draft.started + 1e-8) / draft.cardSeconds),
            );
            if (this.time + 1e-8 < draft.ready) {
                if (this.#aiView.revealed !== revealed)
                    this.#writeAI(draft, revealed, 'solving', draft.ready);
                return;
            }
            this.#aiDraft = null;
            this.#lastAIInput = '';
            const sameGoal = this.sides[AI_SIDE].targets.summon === draft.target;
            const outcome =
                sameGoal &&
                this.produce(AI_SIDE, 'summon', draft.ast, this.reservations(AI_SIDE), draft.route);
            if (!outcome?.ok) {
                this.#waitAI(
                    this.battle.count(AI_SIDE) >= this.config.armyLimit ? 'space' : 'resources',
                );
                return;
            }
            this.#lastAILaunch = this.time;
            this.#writeAI(
                draft,
                draft.tokens.length,
                'launched',
                this.time + AI_RECEIPT_SECONDS,
                outcome.actual,
            );
        }
        #playAITurn() {
            if (this.sides[0].stats.firstProduction === null) return;
            if (this.#aiDraft) {
                this.#advanceDraft();
                return;
            }
            if (this.#aiView.phase === 'launched' && this.time < this.#aiView.until) return;
            const cpu = this.sides[AI_SIDE];
            const army = this.battle.count(AI_SIDE);
            const room = this.config.armyLimit - army;
            if (room <= 0) {
                this.#waitAI('space');
                return;
            }
            const underSiege = this.battle.threat[AI_SIDE];
            const usualBatch = this.config.baseBatch * this.config.troopMultiplier;
            const lead = (army - this.battle.count(0)) / Math.max(1, usualBatch * 2);
            const tempo = underSiege ? 0.55 : Math.min(1.35, Math.max(0.7, 1 + 0.2 * lead));
            if (this.time - this.#lastAILaunch < this.ai.recovery * tempo) {
                this.#waitAI('tactics');
                return;
            }
            const reserved = this.reservations(AI_SIDE);
            const stock = availableInventory(cpu.inventory, reserved);
            // Counts above the longest supported draft cannot make a blocked hand playable.
            const signature = [
                cpu.targets.summon,
                Math.min(usualBatch, room),
                ...HAND_KEYS.map((key) => Math.min(stock[key] || 0, key === '=' ? 1 : 4)),
            ].join('/');
            if (this.#lastAIInput === signature) {
                this.#waitAI('resources');
                return;
            }
            this.#lastAIInput = signature;
            const choice = this.decisions(AI_SIDE, stock);
            const preview = choice && this.preview(AI_SIDE, 'summon', choice.ast, reserved);
            if (!preview?.ok) {
                this.#waitAI('resources');
                return;
            }
            const tokens = Object.freeze(
                Array.from(MathCore.format(choice.ast).replaceAll(' ', '')),
            );
            const opening = cpu.stats.firstProduction === null;
            const cardSeconds = opening ? 0.16 : this.ai.cardSeconds;
            const hold = opening ? 0.22 : 0.62;
            const ready = this.time + (tokens.length - 1) * cardSeconds + hold;
            const draft = {
                ast: choice.ast,
                tokens,
                target: preview.target,
                value: preview.value,
                count: preview.actual,
                route: this.chooseRoute(AI_SIDE),
                started: this.time,
                cardSeconds,
                ready,
            };
            this.#aiDraft = draft;
            this.#writeAI(draft, 1, 'solving', ready);
        }
        tick(dt) {
            if (!(dt > 0) || !Number.isFinite(dt) || this.battle.winner !== -1) return;
            this.time += dt;
            for (const side of this.sides)
                for (const worker of side.workers) this.updateWorker(worker, dt);
            if (this.computerOpponent) this.#playAITurn();
        }
    }
    Economy.config = Object.freeze(CONFIG);
    Economy.types = TYPES;
    Economy.actions = ACTIONS;
    Economy.classify = classify;
    Economy.summonRange = summonRange;
    globalThis.Economy = Economy;
})();
