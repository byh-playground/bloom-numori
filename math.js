/* NUMORI resource-owned expression trees. Raw arithmetic values never cross the command boundary. */
globalThis.MathCore = (() => {
    'use strict';
    const limits = Object.freeze({
        nodes: 256,
        depth: 64,
        bits: 448,
        magnitude: Number.MAX_SAFE_INTEGER,
    });
    const numbers = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    const num = (key) => ({ type: 'num', key: String(key) });
    const op = (id, ...args) => ({ type: 'op', id, args });
    const fail = (message) => {
        throw new Error(message);
    };
    const rangeError = () => fail('계산 가능한 수치 범위를 넘었어요.');
    const absBig = (n) => (n < 0n ? -n : n);
    function gcd(a, b) {
        a = absBig(a);
        b = absBig(b);
        while (b) [a, b] = [b, a % b];
        return a;
    }
    // A bounded exact numerator and denominator convert to IEEE doubles without overflowing.
    function rational(n, d = 1n) {
        if (!d) fail('0으로 나눌 수 없어요.');
        if (d < 0n) {
            n = -n;
            d = -d;
        }
        const divisor = gcd(n, d);
        n /= divisor;
        d /= divisor;
        if (
            absBig(n).toString(2).length > limits.bits ||
            d.toString(2).length > limits.bits ||
            absBig(n) > BigInt(limits.magnitude) * d
        )
            rangeError();
        return { n, d, v: Number(n) / Number(d) };
    }
    const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
    const sub = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
    const mul = (a, b) => rational(a.n * b.n, a.d * b.d);
    const div = (a, b) => rational(a.n * b.d, a.d * b.n);
    const defs = [
        ['add', '+', '덧셈', ['왼쪽', '오른쪽'], 1, add, '모든 실수', '두 값을 더해요.', '3 + 4 = 7'],
        ['sub', '−', '뺄셈', ['왼쪽', '오른쪽'], 1, sub, '모든 실수', '왼쪽 값에서 오른쪽 값을 빼요.', '8 − 2 = 6'],
        ['mul', '×', '곱셈', ['왼쪽', '오른쪽'], 2, mul, '모든 실수', '두 값을 곱해요.', '8 × 4 = 32'],
        ['div', '÷', '나눗셈', ['분자', '분모'], 2, div, '분모 ≠ 0', '분자를 분모로 나눠요.', '3 ÷ 2 = 1½'],
    ];
    const ops = Object.freeze(
        Object.fromEntries(
            defs.map(([id, symbol, name, slots, precedence, calc, domain, help, example]) => [
                id,
                Object.freeze({
                    id,
                    symbol,
                    name,
                    slots,
                    arity: slots.length,
                    precedence,
                    calc,
                    domain,
                    help,
                    example,
                    associativity: 'left',
                    cost: { [id]: 1 },
                    notation: id,
                    slotTypes: ['expression', 'expression'],
                }),
            ]),
        ),
    );
    const leaves = new Map(numbers.map((digit) => [digit, rational(BigInt(digit))]));
    function inspect(ast, compute) {
        const counts = {};
        let nodes = 0;
        const count = (key) => (counts[key] = (counts[key] || 0) + 1);
        function visit(node, depth) {
            if (++nodes > limits.nodes || depth > limits.depth) fail('수식의 기술적 길이 또는 중첩 한도를 넘었어요.');
            if (node == null && !compute) return;
            if (node?.type === 'num' && leaves.has(node.key)) {
                count(node.key);
                return leaves.get(node.key);
            }
            if (node?.type !== 'op' || !Object.hasOwn(ops, node.id) || !Array.isArray(node.args))
                fail('숫자 또는 수식 블록을 선택해 주세요.');
            const def = ops[node.id];
            if (node.args.length > def.arity || (compute && node.args.length !== def.arity))
                fail('빈 입력 칸을 채워 주세요.');
            count(node.id);
            const args = Array.from(node.args, (child) => visit(child, depth + 1));
            return compute ? def.calc(...args) : undefined;
        }
        const result = visit(ast, 1);
        return { result, counts };
    }
    const raw = new WeakMap();
    function evaluate(ast) {
        try {
            const { result: a, counts } = inspect(ast, true);
            const floor = Number(a.n / a.d - (a.n < 0n && a.n % a.d !== 0n ? 1n : 0n));
            const result = { ok: true, value: a.v, floor, exact: true, cost: counts };
            raw.set(result, a);
            return result;
        } catch (e) {
            return { ok: false, error: e.message, cost: {} };
        }
    }
    function matches(result, target) {
        if (!result?.ok || !Number.isSafeInteger(target)) return false;
        const a = raw.get(result);
        return !!a && BigInt(target) * a.d === a.n;
    }
    function sameValue(left, right) {
        if (!left?.ok || !right?.ok) return false;
        const a = raw.get(left),
            b = raw.get(right);
        return !!a && !!b && a.n === b.n && a.d === b.d;
    }
    function cost(ast) {
        try {
            return inspect(ast, false).counts;
        } catch {
            return {};
        }
    }
    function format(ast) {
        let remaining = limits.nodes;
        function render(node, parent, side, depth) {
            if (--remaining < 0 || depth > limits.depth) return '…';
            if (node?.type === 'num') return leaves.has(node.key) ? node.key : '□';
            if (node?.type !== 'op' || !Object.hasOwn(ops, node.id) || !Array.isArray(node.args)) return '□';
            const def = ops[node.id];
            const child = (i) => render(node.args[i], def, i, depth + 1);
            const body = child(0) + ' ' + def.symbol + ' ' + child(1);
            const group = parent && (def.precedence < parent.precedence ||
                (def.precedence === parent.precedence && side === 1));
            return group ? '(' + body + ')' : body;
        }
        return render(ast, null, 0, 1);
    }
    return Object.freeze({ numbers, ops, num, op, evaluate, matches, sameValue, cost, format, limits });
})();
