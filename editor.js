(() => {
    'use strict';
    const escapeHtml = (value) =>
        String(value ?? '').replace(
            /[&<>"']/g,
            (char) =>
                ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
        );
    function decimalText(value) {
        if (!Number.isFinite(value)) return '—';
        const rounded = Number(value.toPrecision(9));
        if (!Number.isInteger(value) && Number.isInteger(rounded)) return String(value);
        return rounded.toLocaleString('ko-KR', { maximumSignificantDigits: 9 });
    }
    function resultText(result) {
        const text = decimalText(result.value);
        return result.exact &&
            Number.isSafeInteger(result.value) &&
            !MathCore.matches(result, result.value)
            ? '≈ ' + text
            : text;
    }
    const branch = (path, index) => (path === '' ? String(index) : path + '.' + index);
    function subtree(root, path) {
        if (!path) return root;
        return path.split('.').reduce((node, index) => node?.args?.[Number(index)], root);
    }
    function replace(root, path, next) {
        if (!path) return next;
        const indices = path.split('.').map(Number);
        const index = indices.shift();
        const args = root.args.slice();
        args[index] = replace(args[index], indices.join('.'), next);
        return { ...root, args };
    }
    function nextHole(node, path = '') {
        if (!node) return path;
        if (node.type === 'op') {
            for (let i = 0; i < node.args.length; i++) {
                const hole = nextHole(node.args[i], branch(path, i));
                if (hole !== null) return hole;
            }
        }
        return null;
    }
    function sumCosts(nodes) {
        const used = {};
        for (const node of nodes) {
            if (!node) continue;
            for (const [key, amount] of Object.entries(MathCore.cost(node)))
                used[key] = (used[key] || 0) + amount;
        }
        return used;
    }
    function fresh() {
        return { root: null, stored: [], selected: null };
    }

    function mount(element, options) {
        let state = fresh();
        let history = [];
        let awaitingHost = false,
            destroyed = false;
        let notice = '';
        let lastPortrait = '';
        let lastSelectable = null;
        const cache = new Map();
        const M = globalThis.MathCore;
        element.classList.add('numori-editor');
        element.innerHTML = `
      <div class="ne-score">
        <div class="ne-pair">
          <div class="ne-goal-cell"><span class="ne-goal-label">목표 숫자</span><strong class="ne-goal"></strong><button class="ne-hint" data-act="hint" aria-label="수식 힌트" aria-controls="targetHint" aria-expanded="false">힌트</button></div>
          <div class="ne-result-cell"><span>내 수식값</span><strong class="ne-result"></strong></div>
          <div class="ne-dispatch-cell"><span class="ne-dispatch-label">출격 병력</span><strong class="ne-dispatch-count ne-unit-count">0마리</strong></div>
        </div>
        <div class="ne-rule"></div><div class="ne-delta"></div>
        <div class="ne-unit" hidden><canvas width="72" height="72" aria-hidden="true"></canvas><div><b class="ne-unit-name"></b><span class="ne-unit-reason"></span></div></div>
      </div>
      <div class="ne-work">
        <div class="ne-kicker"><span>수식</span><div class="ne-toolbar"><button type="button" data-action="new" title="현재 수식을 보관한 뒤 새 수식을 만듭니다" aria-label="수식 보관, 현재 수식을 보관하고 새로 시작">수식 보관</button><button type="button" data-action="undo" title="마지막 입력 취소" aria-label="마지막 입력 되돌리기">되돌림</button><button type="button" data-action="clear" title="모든 블록 반환">초기화</button></div></div>
        <div class="ne-sheet">
          <div class="ne-expression"></div>
        </div>
      </div>
      <div class="ne-keyboard"><div class="ne-palette">
        <div class="ne-section"><div class="ne-heading"><span class="ne-group">숫자 블록</span></div><div class="ne-numbers"></div></div>
        <div class="ne-section"><div class="ne-heading"><span class="ne-group">연산 블록</span></div><div class="ne-operators ne-basic-operators"></div></div>
      </div>
      <div class="ne-deploy"><div class="ne-preview"></div><button type="button" data-action="produce" class="ne-produce"><b class="ne-produce-arrow" aria-hidden="true">=</b><span class="ne-produce-label">출격 대기</span><small class="ne-produce-detail"></small></button><div class="ne-notice" role="status"></div></div></div>
      <div class="ne-foot" hidden><div class="ne-context"></div><div class="ne-shelf" role="group" aria-label="보관한 식"></div><div class="ne-actions"></div></div>`;
        const find = (selector) => element.querySelector(selector);
        const write = (selector, html) => {
            if (cache.get(selector) === html) return;
            cache.set(selector, html);
            find(selector).innerHTML = html;
        };
        const rootPath = () => state.selected ?? nextHole(state.root);
        const reservations = () => sumCosts([state.root, ...state.stored]);
        const otherCosts = () => sumCosts(state.stored);
        const firstDispatch = () => options.firstDispatch?.() ?? true;
        const dispatchRoute = () =>
            firstDispatch() ? 'bridge' : (options.selectedRoute?.() ?? null);
        const routeName = (route) =>
            options.routeName?.(route) ?? (route === 'supply' ? '거인 전선' : '중앙 다리');
        const snapshot = () => {
            history.push({ ...state, stored: state.stored.slice() });
            if (history.length > 80) history.shift();
            notice = '';
        };
        const hint = (text) => {
            notice = text;
            render();
        };
        function setNode(path, node) {
            state.root = replace(state.root, path, node);
            state.selected = nextHole(state.root);
        }
        function canPay(nodeList) {
            const counts = options.inventory() || {};
            if (nodeList.some((node) => node && !Object.keys(M.cost(node)).length)) return false;
            return Object.entries(sumCosts(nodeList)).every(
                ([key, amount]) => amount <= (counts[key] || 0),
            );
        }
        function putNumber(key) {
            const path = rootPath();
            const node = M.num(key);
            const bank = path === null && state.root ? [...state.stored, state.root] : state.stored;
            const updated = path === null ? node : replace(state.root, path, node);
            if (!canPay([updated, ...bank])) {
                hint('사용 가능한 숫자가 부족합니다.');
                return;
            }
            snapshot();
            state.stored = bank;
            state.root = updated;
            state.selected = nextHole(updated);
            render();
        }
        function putOperator(id) {
            const path = rootPath() ?? '';
            const old = subtree(state.root, path);
            const swapping = state.selected !== null && old?.type === 'op';
            const args = swapping ? old.args : [old, null];
            const updated = replace(state.root, path, M.op(id, ...args));
            if (!canPay([updated, ...state.stored])) {
                hint('사용 가능한 연산자가 부족합니다.');
                return;
            }
            snapshot();
            state.root = updated;
            state.selected = nextHole(updated);
            render();
        }
        function takeStored(i) {
            const path = rootPath();
            const selected = state.stored[i];
            if (!selected) return;
            snapshot();
            const bank = state.stored.slice();
            bank.splice(i, 1);
            if (path === null) {
                if (state.root) bank.push(state.root);
                state.root = selected;
            } else setNode(path, selected);
            state.stored = bank;
            state.selected = nextHole(state.root);
            render();
        }
        function unitName(preview) {
            return globalThis.Battle?.types?.[preview?.unitType]?.name || '병력';
        }
        function summonReceipt(outcome) {
            const multiplier =
                options.troopMultiplier?.() ?? globalThis.Economy?.config?.troopMultiplier ?? 3;
            const bonus = outcome.matched
                ? ` · 목표 ${decimalText(outcome.target)} 달성 (${multiplier}배)`
                : '';
            return `${routeName(outcome.route)} · ${unitName(outcome)} ${decimalText(outcome.actual)}마리 출격${bonus}`;
        }
        async function action(name) {
            if (name === 'produce') {
                const route = dispatchRoute();
                if (!state.root || !route) return;
                let outcome = options.produce(state.root, otherCosts(), route);
                if (outcome && typeof outcome.then === 'function') {
                    awaitingHost = true;
                    element.setAttribute('aria-busy', 'true');
                    render();
                    try {
                        outcome = await outcome;
                    } catch {
                        outcome = { ok: false, reason: '상대와 연결을 확인하세요.' };
                    } finally {
                        awaitingHost = false;
                        if (!destroyed) element.removeAttribute('aria-busy');
                    }
                    if (destroyed) return;
                }
                if (!outcome?.ok) {
                    hint(outcome?.reason || outcome?.error || '지금은 생산할 수 없습니다.');
                    return;
                }
                const bank = state.stored.slice();
                state = { ...fresh(), stored: bank };
                history = [];
                notice = summonReceipt(outcome);
            } else if (name === 'undo') {
                if (!history.length) return;
                state = history.pop();
                notice = '';
            } else if (name === 'new') {
                if (!state.root) return;
                snapshot();
                state = { ...fresh(), stored: [...state.stored, state.root] };
            } else if (name === 'clear') {
                snapshot();
                state = fresh();
            } else if (name === 'cancelEdit') {
                state.selected = nextHole(state.root);
            } else if (name === 'remove' || name === 'split') {
                const path = state.selected ?? '';
                const node = subtree(state.root, path);
                if (!node) return;
                snapshot();
                if (name === 'split' && node.type === 'op') {
                    // Completed compound ingredients remain available as independent blocks.
                    state.stored = [...state.stored, ...node.args.filter((n) => n?.type === 'op')];
                }
                setNode(path, null);
            }
            render();
        }
        function tile(node, path = '', hint = '입력') {
            const selected = path === state.selected;
            const token = (text, kind = '') =>
                `<button type="button" data-path="${path}" class="ne-token ${kind}${selected ? ' is-selected' : ''}" title="${escapeHtml(hint)}">${escapeHtml(text)}</button>`;
            if (!node) return token('□', 'ne-hole');
            if (node.type === 'num') return token(node.key, 'ne-number');
            const op = M.ops[node.id];
            const child = (i, label) => tile(node.args[i], branch(path, i), label || op.name);
            const sign = (text) => token(text, 'ne-op');
            const arg = (i) => {
                const n = node.args[i],
                    html = child(i);
                if (n?.type !== 'op') return html;
                const inner = M.ops[n.id].precedence;
                return inner < op.precedence || (inner === op.precedence && i === 1)
                    ? '(' + html + ')'
                    : html;
            };
            if (node.id === 'div')
                return `<span class="ne-frac"><span>${child(0, '분자')}</span><button type="button" data-path="${path}" class="ne-bar${selected ? ' is-selected' : ''}" aria-label="나눗셈 교체"></button><span>${child(1, '분모')}</span></span>`;
            return `${arg(0)}${sign(op.symbol)}${arg(1)}`;
        }
        function render() {
            const inventory = options.inventory() || {};
            const used = reservations();
            const result = state.root && M.evaluate(state.root);
            const complete = !!result?.ok;
            const preview = complete ? options.preview(state.root, otherCosts()) : null;
            const target = preview ? preview.target : options.targetGoal?.();
            const delta = complete && Number.isFinite(target) ? target - result.value : 0;
            const valid = !!preview?.ok;
            const base = globalThis.Economy?.config?.baseBatch ?? 8;
            const multiplier =
                options.troopMultiplier?.() ?? globalThis.Economy?.config?.troopMultiplier ?? 3;
            const maximum = base * multiplier;
            const range = Economy.summonRange(target);
            const hasTarget = range !== null;
            const qualified = complete && hasTarget && preview?.matched;
            write('.ne-goal', hasTarget ? escapeHtml(decimalText(target)) : '—');
            const band = hasTarget
                ? `${decimalText(range.min)}~${decimalText(range.max)} 출격`
                : '';
            const near = base * (globalThis.Economy?.config?.nearMultiplier ?? 2);
            const actual = valid ? preview.actual : 0;
            const selectable = !firstDispatch() && valid;
            if (lastSelectable !== selectable) {
                lastSelectable = selectable;
                options.selectable?.(selectable);
            }
            const route = dispatchRoute();
            const destination = route ? routeName(route) : '';
            const awaitingRoute = valid && !route;
            write('.ne-dispatch-label', valid && route ? escapeHtml(destination) : '출격 병력');
            write('.ne-dispatch-count', decimalText(actual) + '마리');
            const dispatch = find('.ne-dispatch-cell');
            dispatch.classList.toggle('ready', actual > 0);
            dispatch.dataset.destination = valid ? (route ?? '') : '';
            const tiers = [
                ['차이 2', base],
                ['차이 1', near],
                ['일치', maximum],
            ];
            const rule = hasTarget
                ? '<span class="ne-range">' +
                  escapeHtml(band) +
                  '</span><span class="ne-tiers">' +
                  tiers
                      .map(
                          ([key, count]) =>
                              `<span><small>${key}</small> <b>${decimalText(count)}마리</b></span>`,
                      )
                      .join('') +
                  '</span>'
                : '다음 목표를 기다리는 중';
            let difference = '';
            if (complete && hasTarget) {
                if (valid) {
                    const tier = qualified ? '목표 일치' : `차이 ${Math.abs(delta)}`;
                    difference = preview.waste
                        ? `${tier} · 보상 ${preview.raw}마리 중 ${actual}마리 출격`
                        : `${tier} → ${actual}마리`;
                } else if (result.value < range.min || result.value > range.max) {
                    const lower = result.value < range.min;
                    const gap = lower ? range.min - result.value : result.value - range.max;
                    difference = `${band} · ${decimalText(gap)} ${lower ? '더하면' : '줄이면'} 출격 가능`;
                } else if (!preview?.unitType) difference = '양의 정수로 완성하세요';
                else difference = preview?.reason || '출격 대기';
            }
            write('.ne-delta', escapeHtml(difference));
            const showUnit = !!preview?.unitType && complete && result.value > 0;
            find('.ne-unit').hidden = !showUnit;
            if (showUnit) {
                if (lastPortrait !== preview.unitType && globalThis.NumoriWorld?.portrait) {
                    NumoriWorld.portrait(find('.ne-unit canvas'), preview.unitType, 0);
                    lastPortrait = preview.unitType;
                }
                write('.ne-unit-name', escapeHtml(unitName(preview)));
                const matchup = options.unitMatchup?.(preview.unitType) || '';
                const context = find('.ne-unit-reason');
                const reason = matchup || preview.unitReason;
                context.title = matchup ? preview.unitReason + ' · ' + matchup : preview.unitReason;
                write('.ne-unit-reason', escapeHtml(reason));
            }
            write('.ne-rule', rule);
            find('.ne-score').classList.toggle('is-qualified', qualified);
            find('[data-action="new"]').disabled = !state.root;
            find('[data-action="undo"]').disabled = !history.length;
            find('[data-action="clear"]').disabled = !state.root && !state.stored.length;
            write(
                '.ne-expression',
                state.root ? tile(state.root) : '<span class="ne-placeholder">숫자 선택</span>',
            );
            write('.ne-result', complete ? escapeHtml(resultText(result)) : '—');
            const selected = state.selected !== null && subtree(state.root, state.selected);
            const incompleteAt = nextHole(state.root);
            let prompt = '';
            if (selected) prompt = '교체할 블록을 선택하세요';
            else if (state.root && incompleteAt !== null) prompt = '숫자 블록을 선택하세요';
            write('.ne-context', prompt);
            const toolButton = (key, label) =>
                `<button type="button" data-action="${key}">${label}</button>`;
            write(
                '.ne-actions',
                selected
                    ? toolButton('remove', '제거') +
                          (selected.type === 'op' ? toolButton('split', '분해') : '') +
                          toolButton('cancelEdit', '완료')
                    : '',
            );
            const shelf = state.stored
                .map((n, i) => {
                    const r = M.evaluate(n);
                    return `<button type="button" class="ne-bank" data-stored="${i}" title="${escapeHtml(M.format(n))}">${escapeHtml(r.ok ? resultText(r) : '□')}</button>`;
                })
                .join('');
            write('.ne-shelf', shelf ? '<span class="ne-bank-label">보관한 식</span>' + shelf : '');
            find('.ne-foot').hidden = !(prompt || shelf || find('.ne-actions').childElementCount);
            function updateKeys(selector, keys, isOp) {
                const attr = isOp ? 'op' : 'number';
                write(
                    selector,
                    keys
                        .map(
                            (key) =>
                                `<button type="button" class="ne-key" data-${attr}="${key}"><b>${escapeHtml(isOp ? M.ops[key].symbol : key)}</b><small></small></button>`,
                        )
                        .join(''),
                );
                for (const keyButton of find(selector).children) {
                    const key = keyButton.dataset[attr];
                    const available = Math.max(0, (inventory[key] || 0) - (used[key] || 0));
                    const title = `${isOp ? M.ops[key].name : key} · 보유 ${inventory[key] || 0} · 예약 ${used[key] || 0}${isOp ? '\n' + M.ops[key].help + ' ' + M.ops[key].example : ''}`;
                    if (title !== keyButton.title) {
                        keyButton.title = title;
                        keyButton.disabled = available === 0;
                        keyButton.lastElementChild.textContent = available + '개';
                        keyButton.setAttribute(
                            'aria-label',
                            `${isOp ? M.ops[key].name : '숫자 ' + key}, 사용 가능 ${available}개`,
                        );
                    }
                }
            }
            updateKeys('.ne-numbers', M.numbers, false);
            updateKeys('.ne-basic-operators', Object.keys(M.ops), true);
            const waste = preview?.waste ?? 0;
            write(
                '.ne-preview',
                valid && waste > 0
                    ? `예상 ${decimalText(preview.raw)}마리 중 병력 상한 초과로 <b>${decimalText(waste)}마리 소멸</b>`
                    : '',
            );
            const launch = find('[data-action="produce"]');
            launch.disabled = !valid || !route || awaitingHost || options.active?.() === false;
            launch.dataset.destination = valid ? (route ?? '') : '';
            launch.toggleAttribute('data-awaiting-route', awaitingRoute);
            write(
                '.ne-produce-arrow',
                valid ? (route === 'supply' ? '↓' : route ? '↑' : '↗') : '=',
            );
            write(
                '.ne-produce-label',
                valid ? escapeHtml(destination || '전선 선택') : '출격 대기',
            );
            write(
                '.ne-produce-detail',
                awaitingHost
                    ? '출격 확인 중'
                    : valid
                      ? `${decimalText(actual)}마리 출격${route ? '' : ' 대기'}`
                      : '등호 ' + (inventory['='] || 0) + '개',
            );
            if (valid && route) {
                launch.setAttribute(
                    'aria-label',
                    `${destination} · ${unitName(preview)} ${decimalText(actual)}마리 출격`,
                );
            } else {
                launch.removeAttribute('aria-label');
            }
            const message =
                notice ||
                (complete && !valid
                    ? preview?.reason || preview?.error
                    : state.root && incompleteAt === null && !complete
                      ? result.error
                      : '');
            write('.ne-notice', escapeHtml(message));
        }
        function clicked(event) {
            const b = event.target.closest('button');
            if (
                awaitingHost ||
                !b ||
                b.disabled ||
                !element.contains(b) ||
                options.active?.() === false
            )
                return;
            const data = b.dataset;
            notice = '';
            const oldRoot = state.root,
                oldStored = state.stored;
            if ('number' in data) putNumber(data.number);
            else if ('op' in data) putOperator(data.op);
            else if ('stored' in data) takeStored(Number(data.stored));
            else if ('path' in data) {
                state.selected = data.path;
                render();
            } else if ('action' in data) action(data.action);
            if (oldRoot !== state.root || oldStored !== state.stored) {
                if (
                    oldRoot !== state.root &&
                    element.animate &&
                    !matchMedia('(prefers-reduced-motion: reduce)').matches
                ) {
                    const surface = find(state.root ? '.ne-result' : '.ne-sheet');
                    surface.animate(
                        [
                            { backgroundColor: '#f9d98b' },
                            { backgroundColor: getComputedStyle(surface).backgroundColor },
                        ],
                        { duration: 260 },
                    );
                }
                options.onChange?.(state.root);
            }
        }
        element.addEventListener('click', clicked);
        render();
        return {
            refresh: render,
            reset() {
                state = fresh();
                history = [];
                notice = '';
                render();
            },
            ast: () => state.root,
            otherCosts,
            reservations,
            destroy() {
                destroyed = true;
                element.removeAttribute('aria-busy');
                element.removeEventListener('click', clicked);
                element.replaceChildren();
                element.classList.remove('numori-editor');
            },
        };
    }
    globalThis.NumoriEditor = Object.freeze({ mount });
})();
