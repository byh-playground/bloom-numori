/* Search the CPU's hand using the same arithmetic and costs as the formula editor. */
globalThis.NumoriAISolver = (() => {
    'use strict';

    const keyOf = ({ n, d }) => n + '/' + d;
    const ordered = new Set(['sub', 'div']);
    const maximumLongCandidates = 1600;

    function costOf(left, right, operator, hand) {
        const cost = [];
        for (let index = 0; index < hand.length; index++) {
            const count = left.cost[index] + right.cost[index] + Number(index === operator);
            if (count > hand[index]) return null;
            cost.push(count);
        }
        return cost;
    }

    function solve(stock, goal, limits, rank) {
        if (!Number.isSafeInteger(goal) || goal < 1) return null;
        const { numbers, ops, num, op, evaluate, matches } = globalThis.MathCore;
        const keys = [...numbers, ...Object.keys(ops)];
        const hand = keys.map((key) => Math.max(0, stock[key] ?? 0));
        const operators = Object.keys(ops)
            .map((id) => ({ id, index: keys.indexOf(id), calc: ops[id].calc }))
            .filter(({ index }) => hand[index] > 0);
        const digits = [];
        for (const [index, digit] of numbers.entries()) {
            if (hand[index] === 0) continue;
            const cost = hand.map((_, card) => Number(card === index));
            digits.push({ ast: num(digit), raw: { n: BigInt(digit), d: 1n }, cost });
        }
        const capacity = (from, to) => hand.slice(from, to).reduce((sum, count) => sum + count, 0);
        const cards = Math.min(
            limits.cards,
            4,
            capacity(0, numbers.length),
            1 + capacity(numbers.length),
        );
        // |numerator| + denominator of a subtree is bounded by the product
        // of those sums at its leaves. The largest leaf contributes 9 + 1.
        const largestLeaf = Number(numbers.at(-1)) + 1;
        if (!digits.length || goal - 2 > largestLeaf ** cards) return null;
        const targets = [goal, goal - 1, goal + 1, goal - 2, goal + 2]
            .filter((value) => value > 0 && Number.isSafeInteger(value))
            .map((value) => ({ n: BigInt(value), d: 1n }));
        const wanted = new Set(targets.map(({ n }) => n));

        let best = null;
        function consider(ast, raw) {
            if (raw.d !== 1n || !wanted.has(raw.n)) return;
            const result = evaluate(ast);
            if (!matches(result, Number(raw.n))) return;
            const score = rank(ast, result);
            if (Number.isFinite(score) && (!best || score > best.score)) {
                best = { ast, result, score };
            }
        }
        for (const digit of digits) consider(digit.ast, digit.raw);
        if (cards < 2) return best;

        // Each ordered pair of affordable cards is visited once. Keep
        // fractional, zero and negative results for compound expressions.
        const pairValues = new Map();
        for (let a = 0; a < digits.length; a++) {
            const left = digits[a];
            for (let b = a; b < digits.length; b++) {
                const right = digits[b];
                for (const { id, index, calc } of operators) {
                    const cost = costOf(left, right, index, hand);
                    if (!cost) continue;
                    add(left, right);
                    if (left !== right && ordered.has(id)) add(right, left);

                    function add(first, second) {
                        const raw = calc(first.raw, second.raw);
                        const value = keyOf(raw);
                        const ast = op(id, first.ast, second.ast);
                        const expression = { ast, raw, cost };
                        if (!pairValues.has(value)) pairValues.set(value, []);
                        pairValues.get(value).push(expression);
                        consider(ast, raw);
                    }
                }
            }
        }
        if (cards < 3) return best;

        // Solve for the remaining operand and find it in the exact-value index.
        // Look up 3-card expressions as needed, instead of building every triple.
        const inverse = {
            add: [[false, (a, goal) => ops.sub.calc(goal, a)]],
            sub: [
                [false, ops.sub.calc],
                [true, ops.add.calc],
            ],
            mul: [[false, (a, goal) => (a.n !== 0n ? ops.div.calc(goal, a) : null)]],
            div: [
                [false, (a, goal) => (a.n !== 0n && goal.n !== 0n ? ops.div.calc(a, goal) : null)],
                [true, (a, goal) => (a.n !== 0n ? ops.mul.calc(goal, a) : null)],
            ],
        };
        function* joins(groups, lookup, target, seen = new Set()) {
            for (const lefts of groups) {
                const exact = lefts[0].raw;
                for (const { id, index } of operators) {
                    for (const [reverse, required] of inverse[id]) {
                        const value = required(exact, target);
                        if (!value) continue;
                        const rights = lookup(value);
                        if (!rights?.length) continue;
                        for (const left of lefts) {
                            if (left.cost[index] >= hand[index]) continue;
                            for (const right of rights) {
                                const cost = costOf(left, right, index, hand);
                                if (!cost) continue;
                                const key = cost.join(',');
                                if (seen.has(key)) continue;
                                seen.add(key);
                                const ast = reverse
                                    ? op(id, right.ast, left.ast)
                                    : op(id, left.ast, right.ast);
                                yield { ast, cost };
                            }
                        }
                    }
                }
            }
        }
        const digitValues = digits.map((digit) => [digit]);
        const lookupPair = (value) => pairValues.get(keyOf(value));
        const tripleValues = new Map();
        const tripleLimit = BigInt(largestLeaf ** 3);
        const lookupTriple = (value) => {
            if ((value.n < 0n ? -value.n : value.n) + value.d > tripleLimit) return undefined;
            const key = keyOf(value);
            if (!tripleValues.has(key))
                tripleValues.set(key, [...joins(digitValues, lookupPair, value)]);
            return tripleValues.get(key);
        };
        for (const target of targets) {
            for (const { ast } of lookupTriple(target) ?? []) consider(ast, target);
        }
        if (cards < 4) return best;

        // Four cards can finish as 1+3 or 2+2. Share the budget between
        // those root splits so long chains and balanced trees both compete.
        let budget = Math.min(maximumLongCandidates, limits.budget ?? maximumLongCandidates);
        for (const target of targets) {
            const seen = new Set();
            const nested = joins(digitValues, lookupTriple, target, seen);
            const balanced = joins(pairValues.values(), lookupPair, target, seen);
            while (budget > 0) {
                const a = nested.next();
                const b = balanced.next();
                if (a.done && b.done) break;
                for (const candidate of [a, b]) {
                    if (candidate.done || budget <= 0) continue;
                    consider(candidate.value.ast, target);
                    budget--;
                }
            }
            if (budget <= 0) break;
        }
        return best;
    }

    return Object.freeze({ solve });
})();
