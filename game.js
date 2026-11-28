(() => {
    'use strict';
    const $ = (selector) => document.querySelector(selector);
    $('#productVersion').textContent = 'v' + NumoriVersion;
    const audio = NumoriAudio,
        modal = $('#modal'),
        params = new URLSearchParams(location.search);
    const mines = { mineral: '미네랄', gas: '가스' };
    const routeNames = { bridge: '중앙 다리', supply: '거인 전선' };
    const lessons = [
        () =>
            `이번 목표는 ${economy.sides[localSide].targets.summon}이에요. 숫자 광석을 하나 눌러 식을 시작하세요.`,
        () => {
            const witness = economy.sides[localSide].summonWitness;
            return witness
                ? `예를 들어 ${MathCore.format(witness)} = ${economy.sides[localSide].targets.summon}이에요. 같은 답이 나오는 다른 식도 좋아요.`
                : '목표와 수식 결과의 차이를 보고 다음 연산을 고르세요.';
        },
        () =>
            '등호로 출격하세요. 목표와 차이가 2 이내여야 출격해요. 차이가 2면 8마리, 1이면 16마리, 정확하면 24마리예요.',
        () =>
            '정확히 맞혀 소환하면 다음 목표가 열려요. 일꾼이 본진에 가져온 숫자와 기호로 새 식을 만들어 보세요.',
        () =>
            '기본 전선은 중앙 다리예요. 거인 전선으로 보내려면 수식을 만들기 전에도 그 카드를 눌러 먼저 고를 수 있어요.',
    ];
    let match,
        series,
        localSide = 0;
    let battle,
        economy,
        editor,
        world,
        loop,
        level = 'normal',
        paused = false,
        lesson = -1;
    let lastHud = -Infinity,
        lastFrame = 0,
        modalPage = '',
        lastSound = {},
        endShown = false;
    let hintGoal,
        receiptUntil = 0;
    let selectedRoute = 'bridge',
        routePreselected = false,
        routePayable = false,
        dispatched = null;
    let meterEnabled = params.get('perf') === '1';
    const frameIntervals = [];
    let meterAt = -Infinity;
    function showMeter(t, elapsed) {
        if (!meterEnabled) return;
        const panel = $('#frameMeter');
        if (panel.hidden) panel.hidden = false;
        if (elapsed > 0 && elapsed < 1000) {
            if (frameIntervals.length === 120) frameIntervals.shift();
            frameIntervals.push(elapsed);
        }
        if (t - meterAt < 300) return;
        meterAt = t;
        const stats = world.renderStats;
        const sorted = frameIntervals.slice().sort((a, b) => a - b);
        const p95 = sorted.length
            ? sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(1) + 'ms'
            : '측정 중';
        panel.textContent =
            (stats?.backend === 'webgl2'
                ? 'WebGL 2 · GPU 드로우 ' + stats.drawCalls + '회 · 쿼드 ' + stats.quads
                : 'Canvas 2D') +
            ' · 프레임 간격 p95 ' +
            p95;
    }
    const formatTime = (t) =>
        [Math.floor(t / 60), Math.floor(t % 60)].map((n) => String(n).padStart(2, '0')).join(':');
    const active = () => !!battle && battle.winner < 0 && !paused && !modal.open;
    const button = (act, label, cls = '') =>
        '<button class="' + cls + '" data-act="' + act + '">' + label + '</button>';
    function openPanel(title, body, page) {
        modalPage = page;
        $('#modalTitle').textContent = title;
        $('#modalBody').innerHTML = body;
        modal.querySelector('header button').hidden = page === 'result';
        if (!modal.open) modal.showModal();
        modal.scrollTop = 0;
    }
    function closePanel() {
        if (['result', 'disconnected'].includes(modalPage)) return;
        if (modalPage === 'pause') paused = false;
        modal.close();
        modalPage = '';
    }
    function menu() {
        openPanel(
            '경기 메뉴',
            '<div class="modal-actions">' +
                (series ? '' : button('pause', paused ? '▶ 경기 재개' : 'Ⅱ 일시정지', 'wide')) +
                button('audio', '사운드 설정') +
                button('meter', meterEnabled ? '렌더 성능 숨기기' : '렌더 성능 보기') +
                button('help', '조작법 · 연산자') +
                (series
                    ? button('askSurrender', '기권하기', 'wide')
                    : button('restart', '다시 시작') + button('leave', '메인 화면')) +
                '</div>',
            'menu',
        );
    }
    function soundPanel() {
        const s = audio.settings;
        openPanel(
            '사운드 설정',
            '<label class="sound-row">전체 음량<input data-setting="volume" type="range" min="0" max="1" step=".05" value="' +
                s.volume +
                '"></label><label>배경 음악<input data-setting="music" type="checkbox" ' +
                (s.music ? 'checked' : '') +
                '></label><label>음소거<input data-setting="mute" type="checkbox" ' +
                (s.mute ? 'checked' : '') +
                '></label>',
            'audio',
        );
    }
    function help() {
        const strategy = {
            add: '목표에 모자란 만큼 보태세요.',
            sub: '목표를 넘긴 만큼 빼거나 작은 분모를 만드세요.',
            mul: '목표가 24라면 8과 3을 곱해 보세요.',
            div: '목표가 4라면 8을 2로 나눠 보세요.',
        };
        const ops = Object.values(MathCore.ops)
            .map(
                (o) =>
                    '<details><summary>' +
                    o.symbol +
                    ' ' +
                    o.name +
                    '</summary><p>입력 ' +
                    o.arity +
                    '개 · ' +
                    o.example +
                    '<br>' +
                    o.help +
                    ' ' +
                    strategy[o.id] +
                    '</p></details>',
            )
            .join('');
        const giants = Object.values(Battle.giants)
            .map((unit) => unit.name + ' · ' + unit.role)
            .join(' / ');
        openPanel(
            '조작법 · 연산자',
            '<p>숫자 → 연산자 → 숫자를 누른 뒤 등호로 소환하세요. ‘수식 보관’을 누르면 지금 식을 두고 새 식을 시작해요. 보관한 값을 누르면 다시 사용할 수 있어요. 손패의 1~9 숫자와 +, −, ×, ÷로 목표를 만들어 보세요. 목표에서 2 이내인 양의 정수만 출격해요. 차이가 2면 8마리, 1이면 16마리, 정확히 맞추면 24마리예요. 범위 밖의 수식은 재료를 바꿔 다시 시도하세요. 병종은 수식 결과로 정해져요.</p>' +
                '<p>기본 전선은 중앙 다리예요. 수식을 만들기 전이나 도중에도 전선 카드를 눌러 이번 출격로를 고를 수 있어요. 출격하면 다음 부대의 경로가 중앙 다리로 돌아와요. 제단에서 30초 동안 병력 우세를 유지하면 거인이 아군에 합류해요. 병력이 같으면 시간이 멈추고 우세한 진영이 바뀌면 새 진영이 다시 30초를 채워야 해요. 확보한 지 28초 뒤 다른 거인이 나타나요.</p><p>' +
                giants +
                '</p>' +
                '<p>전선마다 방어 타워가 하나씩 있어요. 한 전선의 타워를 부수면 그 길로 적 본진까지 갈 수 있어요. 타워와 본진은 사거리 안의 적에게 0.2초마다 쏴요. 다섯 번째 탄은 곡사로 날아가 착탄 지점 주변의 적을 함께 때려요.</p>' +
                '<p>시작 일꾼은 미네랄 5마리, 가스 5마리입니다. 일꾼은 광산에 도착하면 2초 동안 채집한 뒤 본진으로 돌아와 자원을 반납합니다. 광산별 인원은 채집 배정에서 조절하세요.</p><ul><li>숫자 키와 + − × ÷ 로 입력 · Enter로 소환 · Backspace 또는 Ctrl+Z로 취소</li><li>전장 드래그 또는 WASD로 이동 · 휠이나 두 손가락으로 확대 · 미니맵을 눌러 이동</li></ul>' +
                ops,
            'help',
        );
    }
    function enemyLead() {
        const enemyCounts = battle?.counts[1 - localSide];
        if (!enemyCounts) return null;
        let lead = null;
        let largest = 0;
        for (const type of Object.keys(Battle.roles)) {
            if (enemyCounts[type] <= largest) continue;
            lead = type;
            largest = enemyCounts[type];
        }
        return lead;
    }
    function showEnemyForces() {
        const view = $('#enemyForces');
        const enemy = 1 - localSide;
        const giant = Object.keys(Battle.giants).find(
            (kind) => battle.giantCounts[enemy][kind] > 0,
        );
        const type = giant ?? enemyLead();
        view.hidden = type === null;
        if (type === null) return;
        if (view.dataset.unit !== type) {
            view.dataset.unit = type;
            const canvas = view.querySelector('canvas');
            const label = giant ? '적 거인' : '적 최다 병종';
            view.querySelector('small').textContent = label;
            view.setAttribute('aria-label', label);
            if (giant) NumoriWorld.giantPortrait(canvas, type, 1);
            else NumoriWorld.portrait(canvas, type, 1);
        }
        const name = giant ? Battle.giants[type].name : Battle.types[type].name;
        const count = giant ? battle.giantCounts[enemy][type] : battle.counts[enemy][type];
        view.querySelector('strong').textContent = name + ' ' + count + '마리';
    }
    function unitGuide() {
        const rules = [
            ['charger', '두 자리 이상 제곱수', '16, 25, 36'],
            ['thrower', '두 자리 이상 소수', '11, 13, 17'],
            ['spear', '10의 배수', '10, 20, 30'],
            ['shield', '3의 배수', '6, 12, 15'],
            ['archer', '나머지 양의 정수', '5, 8, 14'],
        ];
        openPanel(
            '병종이 정해지는 순서',
            '<p>수식 결과를 그대로 보고 위에서 처음 맞는 병종이 출격해요. 10은 창병, 13은 투척병이에요.</p><ul class="unit-key">' +
                rules
                    .map(
                        ([id, rule, examples]) =>
                            '<li><b>' +
                            Battle.types[id].name +
                            '</b><span>' +
                            rule +
                            '</span><small>' +
                            examples +
                            '</small><p class="role-description">' +
                            (Battle.roles?.[id]?.description ?? '') +
                            '</p></li>',
                    )
                    .join('') +
                '</ul>',
            'units',
        );
    }
    function guide(i) {
        lesson = i >= 0 && i < lessons.length ? i : -1;
        $('#guide').hidden = lesson < 0;
        if (lesson < 0) return;
        $('#guideCount').textContent = '튜토리얼 ' + (i + 1) + ' / ' + lessons.length;
        $('#guideText').textContent = lessons[i]();
        $('[data-act="guideNext"]').textContent = i === lessons.length - 1 ? '완료' : '다음';
    }
    function showFieldReceipt(detail, title, kind = 'summon') {
        const receipt = $('#launchReceipt');
        receipt.dataset.kind = kind;
        receipt.firstElementChild.textContent = detail;
        receipt.lastElementChild.textContent = title;
        receipt.hidden = false;
        receiptUntil = battle.time + (kind === 'capture' ? 1.8 : 2.4);
    }
    function showLaunchReceipt(outcome) {
        showFieldReceipt(
            routeNames[outcome.route] + ' · 이동 중',
            Battle.types[outcome.unitType].name + ' ' + outcome.actual + '마리 출격',
            outcome.route,
        );
    }
    function closeHint() {
        $('#targetHint').hidden = true;
        $('[data-act="hint"]')?.setAttribute('aria-expanded', 'false');
        hintGoal = null;
    }
    function showHint(reveal = false) {
        if (!active()) return;
        const goal = economy.sides[localSide].targets.summon;
        const solution = economy.summonHint(localSide, editor.otherCosts());
        let message = '지금 손패에서 두 연산 이내의 풀이를 찾지 못했어요.';
        if (goal == null) message = '일꾼이 자원을 가져오면 새 목표가 나와요.';
        if (solution) {
            let first = solution;
            while (first.type === 'op') first = first.args[0];
            message = reveal
                ? MathCore.format(solution) + ' = ' + goal
                : '첫 숫자 ' + first.key + '부터 시작해 보세요.';
        }
        $('#hintClue').textContent = message;
        $('[data-act="hintReveal"]').hidden = !solution || reveal;
        $('#targetHint').hidden = false;
        $('[data-act="hint"]').setAttribute('aria-expanded', 'true');
        hintGoal = goal;
    }
    function cleanView() {
        closeHint();
        receiptUntil = 0;
        frameIntervals.length = 0;
        meterAt = -Infinity;
        $('#frameMeter').hidden = true;
        $('#launchReceipt').hidden = true;
        loop?.stop();
        editor?.destroy();
        world?.destroy();
        battle = economy = editor = world = loop = null;
        if (modal.open) modal.close();
        modalPage = '';
    }
    function cleanup() {
        const previousSeries = series;
        series = null;
        previousSeries?.close();
        match?.close();
        match = null;
        cleanView();
        localSide = 0;
    }
    function returnToTitle() {
        cleanup();
        $('#gameScreen').hidden = true;
        $('#titleScreen').hidden = false;
    }
    const dockedTools = matchMedia(
        '(min-height: 365px) and (max-height: 500px) and (orientation: landscape)',
    );
    const shortField = matchMedia('(max-height: 345px) and (orientation: landscape)');
    function placeFieldTools() {
        const bar = $('.field-tools');
        const inDesk = dockedTools.matches && !$('#gameScreen').classList.contains('field-focused');
        const host = $(inDesk ? '#fieldToolsDock' : '.field');
        if (bar.parentNode !== host) host.appendChild(bar);
        const routes = $('#frontRoutes');
        const fieldRoutes =
            shortField.matches || $('#gameScreen').classList.contains('field-focused');
        if (fieldRoutes && routes.parentNode !== $('.field')) $('.field').append(routes);
        if (!fieldRoutes && routes.parentNode !== $('.desk')) $('.desk').prepend(routes);
    }
    dockedTools.addEventListener('change', placeFieldTools);
    shortField.addEventListener('change', placeFieldTools);
    function fieldFocus(expanded) {
        $('#gameScreen').classList.toggle('field-focused', expanded);
        const control = $('[data-act="fieldFocus"]');
        control.setAttribute('aria-expanded', String(expanded));
        control.setAttribute('aria-label', expanded ? '작업대 열기' : '전장 크게');
        control.innerHTML = expanded
            ? '작업대 열기'
            : '<span class="wide-label">전장 크게</span><span class="short-label" aria-hidden="true">확대</span>';
        placeFieldTools();
    }
    async function loadArt() {
        const rigImage = $('#rigImage');
        const environmentImage = $('#environmentImage');
        if (!rigImage.complete || !environmentImage.complete)
            await Promise.all([rigImage.decode(), environmentImage.decode()]);
        if (
            !rigImage.naturalWidth ||
            !globalThis.NumoriRigData ||
            environmentImage.naturalWidth !== 1024 ||
            environmentImage.naturalHeight !== 512
        )
            throw new Error('전장 그림을 불러오지 못했습니다.');
        globalThis.NumoriRigImage = rigImage;
        globalThis.NumoriEnvironmentImage = environmentImage;
    }
    function failedMatch(reason) {
        if (battle?.winner >= 0 && !endShown) result();
        const played = !!battle,
            finished = endShown;
        if (!played) {
            cleanup();
            NumoriLobby.showError(reason);
            return;
        }
        series?.close();
        match?.close();
        series = match = null;
        loop?.stop();
        paused = true;
        if (finished) {
            const again = $('[data-act="rematch"]');
            if (again) {
                again.disabled = true;
                again.textContent = '상대가 나갔습니다';
            }
        } else {
            openPanel(
                '연결 종료',
                '<p></p><div class="modal-actions">' +
                    button('leave', '메인 화면', 'wide') +
                    '</div>',
                'disconnected',
            );
            $('#modalBody p').textContent = reason;
        }
    }
    function makeMatch(role, send = () => false, tutorial = false) {
        const seed = params.has('seed')
            ? Number(params.get('seed')) >>> 0
            : crypto.getRandomValues(new Uint32Array(1))[0];
        const instance = NumoriMatch.create({
            role,
            seed,
            difficulty: level,
            send,
            reservations: (side) => (side === localSide ? (editor?.reservations() ?? {}) : {}),
            onStart: () => {
                if (match !== instance) return;
                loadArt()
                    .then(() => {
                        if (match !== instance) return;
                        cleanView();
                        if (role !== 'solo') NumoriLobby.enterGame();
                        enterMatch(instance, tutorial);
                    })
                    .catch(() => failedMatch('전장 그림을 불러오지 못했습니다.'));
            },
            onFailure: (reason) => {
                if (match === instance) failedMatch(reason);
            },
        });
        match = instance;
        return instance;
    }
    function start(tutorial = false) {
        cleanup();
        makeMatch('solo', undefined, tutorial).open();
    }
    function enterMatch(instance, tutorial) {
        battle = instance.battle;
        economy = instance.economy;
        localSide = instance.side;
        paused = false;
        endShown = false;
        lastHud = -Infinity;
        lastFrame = 0;
        lastSound = {};
        selectedRoute = 'bridge';
        routePreselected = false;
        dispatched = null;
        routePayable = false;
        $('#titleScreen').hidden = true;
        $('#gameScreen').hidden = false;
        fieldFocus(false);
        world = NumoriWorld.mount($('#world'), { localSide });
        editor = NumoriEditor.mount($('#editor'), {
            inventory: () => economy.sides[localSide].inventory,
            selectedRoute: () => selectedRoute,
            routeName: (route) => routeNames[route],
            payable(payable) {
                routePayable = payable;
            },
            targetGoal: () => economy.sides[localSide].targets.summon,
            active,
            unitMatchup: (type) => {
                const enemy = enemyLead();
                if (!enemy) return '';
                if (type === 'spear' && enemy === 'charger') return '돌격 저지';
                if (type === 'shield' && enemy === 'archer') return '화살 방어';
                if (Battle.roles?.[type]?.strongAgainst?.includes(enemy))
                    return Battle.types[enemy].name + '에 유리';
                if (Battle.roles?.[enemy]?.strongAgainst?.includes(type))
                    return Battle.types[enemy].name + ' 주의';
                return '';
            },
            preview: (ast, res) => economy.preview(localSide, 'summon', ast, res),
            produce: (ast, res, route) => {
                if (!active()) return { ok: false, reason: '경기를 재개하세요.' };
                const autoFollowOpening =
                    economy.sides[localSide].stats.firstProduction === null && !routePreselected;
                const finish = (p) => {
                    if (p?.ok && match === instance) {
                        dispatched = { route: p.route, time: battle.time };
                        selectedRoute = 'bridge';
                        routePreselected = false;
                        routePayable = false;
                        showRoutes();
                        audio.play(p.matched ? 'bonus' : 'spawn');
                        if (autoFollowOpening) world.followFirstDeployment();
                        else world.followDeployment(p.route);
                        showLaunchReceipt(p);
                        closeHint();
                        if (lesson >= 0 && lesson <= 2) guide(3);
                    }
                    return p;
                };
                const p = instance.produce(ast, res, route);
                return p && typeof p.then === 'function' ? p.then(finish) : finish(p);
            },
            onChange: (ast) => {
                if (ast) {
                    audio.play(ast.type === 'op' ? 'merge' : 'pick');
                    if (lesson === 0) guide(1);
                    if (
                        lesson === 1 &&
                        MathCore.matches(
                            MathCore.evaluate(ast),
                            economy.sides[localSide].targets.summon,
                        )
                    )
                        guide(2);
                }
                lastHud = -Infinity;
            },
        });
        $('#mines').innerHTML = Object.entries(mines)
            .map(
                ([k, n]) =>
                    '<div class="mine" data-mine="' +
                    k +
                    '"><span>' +
                    n +
                    '</span><button data-delta="-1" aria-label="' +
                    n +
                    ' 일꾼 감소">−</button><b></b><button data-delta="1" aria-label="' +
                    n +
                    ' 일꾼 증가">+</button></div>',
            )
            .join('');
        $('#laborPanel').hidden = true;
        $('[data-act="labor"]').setAttribute('aria-expanded', 'false');
        guide(tutorial ? 0 : -1);
        hud();
        const input = new Uint8Array(0);
        loop = NumoriGameKit.createLoop({
            session: {
                profile: { tickRate: 30, maxCatchupSteps: 8 },
                pace: 1,
                poll() {},
                releaseInput() {},
                advance() {
                    step();
                    return { status: 'advanced' };
                },
            },
            getInput: () => input,
            canAdvance: () => !paused && battle.winner < 0,
            render: ({ frameTimeMs: t }) => {
                world.render(
                    { battle, economy, routeCue: currentRouteCue() },
                    lastFrame ? Math.min(0.12, (t - lastFrame) / 1000) : 0,
                );
                showMeter(t, lastFrame ? t - lastFrame : 0);
                lastFrame = t;
                if (battle.winner >= 0 && !endShown) result();
                if (t - lastHud > 180) {
                    hud();
                    lastHud = t;
                }
                if (!paused && battle.winner < 0) audio.music(battle.time);
            },
        });
        loop.start();
    }
    function step() {
        if (paused || battle.winner >= 0) return;
        match.step();
        if (receiptUntil && battle.time >= receiptUntil) {
            $('#launchReceipt').hidden = true;
            receiptUntil = 0;
        }
        if (battle.winner >= 0) result();
    }
    function result() {
        if (endShown) return;
        endShown = true;
        const won = battle.winner === localSide,
            s = economy.sides[localSide],
            st = s.stats;
        audio.play('destroy');
        audio.play(won ? 'win' : 'lose');
        const rows = [
            ['경기 시간', formatTime(battle.time)],
            ['총 생산 병력', st.produced],
            ['확보한 거인', battle.station.recruits[localSide] + '마리'],
            ['파괴한 적 타워', battle.stats.towerLosses[1 - localSide] + ' / 2'],
            ['최대 동시 병력', st.maxArmy],
            [
                '병종별 생산',
                Object.keys(Battle.roles)
                    .map((k) => Battle.types[k].name + ' ' + st.byType[k])
                    .join(' · '),
            ],
            ['정확히 맞힌 목표', st.hits],
            ['가장 큰 수식값', Number(st.maxValue.toPrecision(7))],
            ['최대 한 번 생산', st.maxBatch],
            ['초과 소멸', st.waste],
            [
                '사용한 연산자',
                Object.entries(st.operators)
                    .map(([k, n]) => MathCore.ops[k].symbol + ' ×' + n)
                    .join(' · ') || '없음',
            ],
        ];
        openPanel(
            battle.bases.every((base) => base.hp > 0)
                ? won
                    ? '승리 · 상대 기권'
                    : '패배 · 기권'
                : won
                  ? '승리 · 적 본진 함락'
                  : '패배 · 아군 본진 함락',
            '<dl class="result-stats">' +
                rows.map(([a, b]) => '<dt>' + a + '</dt><dd>' + b + '</dd>').join('') +
                '</dl><div class="modal-actions">' +
                (series
                    ? button('rematch', series.peerRequested ? '재경기 수락' : '재경기 요청')
                    : button('restart', '재경기')) +
                button('leave', '메인 화면') +
                '</div>',
            'result',
        );
    }
    function currentRouteCue() {
        if (!battle) return null;
        if (routePreselected || routePayable) return { route: selectedRoute, state: 'selected' };
        if (dispatched && battle.time - dispatched.time < 5.4)
            return { route: dispatched.route, state: 'dispatched' };
        return null;
    }
    function selectRoute(route, keyboard) {
        if (
            !active() ||
            !['bridge', 'supply'].includes(route) ||
            $('#editor').hasAttribute('aria-busy')
        )
            return;
        selectedRoute = route;
        routePreselected = true;
        const receipt = $('#launchReceipt');
        if (!receipt.hidden && receipt.dataset.kind !== 'capture') {
            receipt.hidden = true;
            receiptUntil = 0;
        }
        world.route(route);
        showRoutes();
        editor.refresh();
        if (keyboard) (routePayable ? $('[data-action="produce"]') : $('#editor')).focus();
    }
    function routeDefense(route) {
        const own = battle.towers[localSide][route];
        const enemy = battle.towers[1 - localSide][route];
        const condition = (tower) =>
            tower.hp > 0 ? '체력 ' + Math.ceil(tower.hp) + '/' + tower.maxHp : '파괴';
        return '아군 타워 ' + condition(own) + ' · 적 타워 ' + condition(enemy);
    }
    function showRoutes() {
        const station = battle.station;
        const bridge = $('[data-route="bridge"]');
        const supply = $('[data-route="supply"]');
        bridge.setAttribute('aria-pressed', String(selectedRoute === 'bridge'));
        supply.setAttribute('aria-pressed', String(selectedRoute === 'supply'));
        bridge.title = routeNames.bridge + ' 선택 · ' + routeDefense('bridge');
        supply.title = routeNames.supply + ' 선택 · ' + routeDefense('supply');
        showGiantStatus(station);
    }
    function showGiantStatus(station) {
        const giant = Battle.giants[station.giantKind];
        const recruit = station.lastRecruit;
        const justRecruited = recruit && battle.time - recruit.time < 4;
        const team = (side) => (side === localSide ? '아군' : '적군');
        let name = giant?.name ?? '새 거인 대기';
        let label = '다음 거인';
        let phase =
            Math.max(0, Math.ceil((station.nextSpawn ?? battle.time) - battle.time - 1e-8)) + '초';
        if (giant) {
            label = giant.role;
            phase = '중립';
            if (station.presence[0] > 0 && station.presence[0] === station.presence[1]) {
                label = '제단';
                phase = '경합';
            } else if (station.claimant >= 0) {
                label = team(station.claimant) + ' 확보';
                phase = Math.floor(station.progress * 100) + '%';
                if (station.progress >= 1) {
                    label = team(station.claimant);
                    phase = '병력 가득';
                }
            }
        } else if (justRecruited) {
            name = Battle.giants[recruit.giantKind].name + ' 합류';
            label = team(recruit.side) + ' 확보';
        }
        for (const [selector, value] of [
            ['#giantName', name],
            ['#giantPhaseLabel', label],
            ['#giantPhase', phase],
        ]) {
            const node = $(selector);
            if (node.textContent !== value) node.textContent = value;
        }
    }
    function hud() {
        const s = economy.sides[localSide];
        $('#timer').textContent = formatTime(battle.time);
        showEnemyForces();
        showRoutes();
        if (hintGoal !== null && hintGoal !== s.targets.summon) closeHint();
        $('#baseHud').innerHTML = [localSide, 1 - localSide]
            .map(
                (index, i) =>
                    '<span class="hp ' +
                    (i ? 'enemy' : '') +
                    '" title="본진 체력 ' +
                    Math.ceil(battle.bases[index].hp) +
                    '/' +
                    battle.bases[index].maxHp +
                    '"><span>' +
                    (battle.threat[index] ? '⚠ ' : '') +
                    (i ? '적군' : '아군') +
                    '</span><b>' +
                    Math.ceil((battle.bases[index].hp / battle.bases[index].maxHp) * 100) +
                    '%</b><i><em style="width:' +
                    (battle.bases[index].hp / battle.bases[index].maxHp) * 100 +
                    '%"></em></i></span>',
            )
            .join('');
        $('#armyHud').textContent =
            '병력 ' +
            battle.count(localSide).toLocaleString('ko-KR') +
            '/' +
            Economy.config.armyLimit.toLocaleString('ko-KR');
        if (!$('#laborPanel').hidden) {
            const allocation = economy.allocation(localSide);
            $('#laborState').textContent =
                '일꾼 ' + s.workers.length + '마리 · 대기 ' + allocation.idle + '마리';
            for (const row of document.querySelectorAll('.mine')) {
                const k = row.dataset.mine;
                row.querySelector('b').textContent =
                    allocation[k] + '/' + economy.config.mineSlots[k];
                row.querySelector('[data-delta="-1"]').disabled = paused || !allocation[k];
                row.querySelector('[data-delta="1"]').disabled =
                    paused ||
                    !allocation.idle ||
                    !economy.accessible(localSide, k) ||
                    allocation[k] >= economy.config.mineSlots[k];
            }
        }
        const sounds = {
            return: s.stats.deliveries,
            attack: battle.stats.attacks,
            hit: battle.stats.hits,
            capture: battle.stats.captures[0] + battle.stats.captures[1],
            destroy: battle.stats.towerLosses[0] + battle.stats.towerLosses[1],
        };
        for (const [k, v] of Object.entries(sounds)) {
            const increase = v - (lastSound[k] ?? 0);
            if (increase > 0) audio.play(k, increase);
        }
        lastSound = sounds;
        editor.refresh();
    }
    document.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        audio.unlock();
        if (b.dataset.route) {
            selectRoute(b.dataset.route, e.detail === 0);
            return;
        }
        if (b.dataset.level) {
            level = b.dataset.level;
            document
                .querySelectorAll('[data-level]')
                .forEach((v) => v.setAttribute('aria-pressed', String(v === b)));
            return;
        }
        if (b.dataset.delta && active()) {
            Promise.resolve(
                match.assign(b.closest('[data-mine]').dataset.mine, Number(b.dataset.delta)),
            )
                .then(() => {
                    if (battle) hud();
                })
                .catch(() => {});
            return;
        }
        switch (b.dataset.act) {
            case 'labor':
                $('#laborPanel').hidden = !$('#laborPanel').hidden;
                b.setAttribute('aria-expanded', String(!$('#laborPanel').hidden));
                hud();
                break;
            case 'start':
            case 'restart':
                start();
                break;
            case 'hint':
                if ($('#targetHint').hidden) showHint();
                else closeHint();
                break;
            case 'hintReveal':
                showHint(true);
                break;
            case 'hintClose':
                closeHint();
                break;
            case 'rematch':
                series?.rematch();
                break;
            case 'askSurrender':
                openPanel(
                    '기권할까요?',
                    '<div class="modal-actions">' +
                        button('close', '계속 플레이') +
                        button('surrender', '기권하기') +
                        '</div>',
                    'forfeit',
                );
                break;
            case 'surrender':
                if (series && match) {
                    Promise.resolve(match.surrender())
                        .then(() => {
                            if (battle?.winner >= 0) result();
                        })
                        .catch(() => {});
                }
                break;
            case 'fieldFocus':
                closeHint();
                fieldFocus(!$('#gameScreen').classList.contains('field-focused'));
                break;
            case 'tutorial':
                start(true);
                break;
            case 'leave':
                returnToTitle();
                break;
            case 'menu':
                menu();
                break;
            case 'help':
                help();
                break;
            case 'units':
                unitGuide();
                break;
            case 'meter':
                meterEnabled = !meterEnabled;
                $('#frameMeter').hidden = !meterEnabled;
                meterAt = -Infinity;
                frameIntervals.length = 0;
                closePanel();
                break;
            case 'audio':
                soundPanel();
                break;
            case 'close':
                closePanel();
                break;
            case 'pause':
                paused = !paused;
                if (paused) {
                    openPanel(
                        '일시정지',
                        '<div class="modal-actions">' +
                            button('pause', '▶ 경기 재개', 'wide') +
                            '</div>',
                        'pause',
                    );
                } else closePanel();
                break;
            case 'guideNext':
                guide(lesson + 1);
                break;
            case 'guideEnd':
                guide(-1);
                break;
        }
    });
    modal.addEventListener('cancel', (e) => {
        if (['result', 'disconnected'].includes(modalPage)) e.preventDefault();
    });
    modal.addEventListener('close', () => {
        if (modalPage === 'pause') paused = false;
    });
    document.addEventListener('input', (e) => {
        const key = e.target.dataset.setting;
        if (!key) return;
        audio.settings[key] = key === 'volume' ? Number(e.target.value) : e.target.checked;
        audio.update();
    });
    document.addEventListener('keydown', (e) => {
        if (!battle || e.repeat || e.altKey || e.metaKey) return;
        if (e.key === 'Escape' && !modal.open && battle.winner < 0) {
            e.preventDefault();
            menu();
            return;
        }
        if (!active() || e.target.matches('input,textarea,select')) return;
        let node;
        if (/^[1-9]$/.test(e.key)) {
            node = document.querySelector('[data-number="' + e.key + '"]');
        } else if ({ '+': 1, '-': 1, '*': 1, '/': 1 }[e.key]) {
            node = document.querySelector(
                '[data-op="' + { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[e.key] + '"]',
            );
        } else if (e.key === 'Enter' || e.key === '=') {
            if (e.key === 'Enter' && e.target.matches('[data-route], [data-action="produce"]'))
                return;
            node = $('[data-action="produce"]');
        } else if (e.key === 'Backspace' || (e.ctrlKey && e.key.toLowerCase() === 'z'))
            node = document.querySelector('[data-action="undo"]');
        if (node) {
            e.preventDefault();
            node.click();
        }
    });
    NumoriLobby.configure({
        onRoom(link) {
            cleanup();
            series = NumoriPeerSeries.create(link, {
                createMatch: (role, send) => makeMatch(role, send),
                onFailure: failedMatch,
                onVote(mine, theirs) {
                    const control = $('[data-act="rematch"]');
                    if (control) {
                        control.disabled = mine;
                        control.textContent = mine
                            ? '상대 응답 대기 중'
                            : theirs
                              ? '재경기 수락'
                              : '재경기 요청';
                    }
                },
            });
        },
        onCancel() {
            if (!battle) cleanup();
        },
    });
    if (params.get('debug') === '1')
        window.Numori = {
            get match() {
                return match;
            },
            get battle() {
                return battle;
            },
            get economy() {
                return economy;
            },
            get editor() {
                return editor;
            },
            get world() {
                return world;
            },
            get routeCue() {
                return currentRouteCue();
            },
            advance(n) {
                for (let i = 0; i < n && battle?.winner === -1; i++) step();
                if (battle) hud();
            },
        };
})();
