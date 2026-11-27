const assert = require('node:assert/strict');
const test = require('node:test');
require('../math.js');
const { num, op, evaluate, matches, sameValue, format, cost } = MathCore;

test('registry contains only the four binary arithmetic operations and digits 1–9', () => {
    assert.deepEqual(Object.keys(MathCore.ops), ['add', 'sub', 'mul', 'div']);
    assert.deepEqual(MathCore.numbers, Array.from({ length: 9 }, (_, i) => String(i + 1)));
    assert.equal(Object.hasOwn(MathCore, 'angle'), false);
    for (const def of Object.values(MathCore.ops)) assert.equal(def.arity, 2);
});

test('nested arithmetic preserves grouping, consumed resources, and exact rational values', () => {
    const half = op('div', num(1), num(2));
    const twoFifths = op('div', num(2), num(5));
    const nested = op('div', num(8), op('sub', half, twoFifths));
    assert.equal(format(nested), '8 ÷ (1 ÷ 2 − 2 ÷ 5)');
    assert.ok(matches(evaluate(nested), 80));
    assert.deepEqual(cost(nested), { 1: 1, 2: 2, 5: 1, 8: 1, div: 3, sub: 1 });

    const composite = op('mul', op('sub', num(8), num(2)), op('add', num(5), num(3)));
    assert.equal(format(composite), '(8 − 2) × (5 + 3)');
    assert.ok(matches(evaluate(composite), 48));
    assert.ok(sameValue(evaluate(half), evaluate(op('div', num(2), num(4)))));
    const negative = op('div', op('sub', num(1), num(6)), num(2));
    assert.equal(evaluate(negative).floor, -3);
    assert.ok(matches(evaluate(op('sub', num(3), num(3))), 0));
    assert.ok(matches(evaluate(op('add', num(5), num(5))), 10));
    assert.equal(format(op('div', num(8), half)), '8 ÷ (1 ÷ 2)');
    assert.deepEqual(cost(op('add', num(2), null)), { add: 1, 2: 1 });
});

test('an exact near-integer is not matched by its rounded display value', () => {
    let tiny = num(1);
    for (let i = 0; i < 18; i++) tiny = op('div', tiny, num(9));
    const result = evaluate(op('sub', num(3), tiny));
    assert.equal(result.value, 3);
    assert.equal(result.floor, 2);
    assert.equal(result.exact, true);
    assert.equal(matches(result, 3), false);
    assert.equal(sameValue(result, evaluate(num(3))), false);
});

test('unsupported operators, angles, constants and invalid resources cannot enter a command', () => {
    const oldOps = ['neg', 'abs', 'pow', 'sqrt', 'log', 'sin', 'cos', 'tan'];
    const invalid = [
        ...oldOps.map((id) => op(id, num(2), num(3))),
        ...[0, '1.5', '89', 'π', 'e'].map(num),
        { type: 'angle', digits: '45' },
        op('mul', num(5), { type: 'angle', digits: '45' }),
        op('toString', num(2), num(3)),
    ];
    for (const ast of invalid) {
        assert.equal(evaluate(ast).ok, false);
        assert.deepEqual(cost(ast), {});
    }
});

test('division by zero, malformed trees, excessive size, depth and magnitude are rejected', () => {
    const zero = op('sub', num(4), num(4));
    assert.match(evaluate(op('div', num(8), zero)).error, /0으로/);
    assert.equal(evaluate(op('mul', num(2))).ok, false);
    const cyclic = op('add', num(1));
    cyclic.args.push(cyclic);
    assert.match(evaluate(cyclic).error, /중첩/);
    let wide = num(1);
    for (let i = 0; i < 8; i++) wide = op('add', wide, wide);
    assert.match(evaluate(wide).error, /길이/);
    let large = num(9);
    for (let i = 0; i < 18; i++) large = op('mul', large, num(9));
    assert.match(evaluate(large).error, /수치 범위/);
});

test('exact arithmetic for every ordered pair of collectible digits', () => {
    for (const x of MathCore.numbers) for (const y of MathCore.numbers) {
        const a = Number(x), b = Number(y);
        for (const [id, n, d] of [['mul', a*b, 1], ['add', a+b, 1], ['sub', a-b, 1], ['div', a, b]]) {
            const result = evaluate(op(id, num(x), num(y)));
            assert.equal(result.floor, Math.floor(n/d));
            assert.equal(result.exact, true);
            assert.equal(matches(result, result.floor), n%d === 0);
        }
    }
});
