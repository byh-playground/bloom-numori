/* Ordered, host-authoritative inputs between fixed simulation ticks. The reliable
   app channel owns delivery; disconnect ends the match, with no unbounded replay log. */
globalThis.NumoriMatch = (() => {
    'use strict';
    const scope = 'numori-match/1';
    const dt = 1 / 30;
    const maxLead = 120;
    const timeoutMs = 15000;
    const mines = ['mineral', 'gas'];
    const giantKinds = Object.keys(Battle.giants);
    const blocks = new Set([...MathCore.numbers, ...Object.keys(MathCore.ops)]);
    const failed = (reason) => ({ ok: false, reason });
    const whole = (value) => Number.isSafeInteger(value) && value >= 0;
    const invalid = () => failed('경기 명령이 올바르지 않습니다.');

    function validCommand(command) {
        if (!command || typeof command !== 'object') return false;
        if (command.kind === 'surrender') return true;
        if (command.kind === 'assign') return mines.includes(command.mine) && [1, -1].includes(command.delta);
        if (
            command.kind !== 'produce' ||
            !['bridge', 'supply'].includes(command.route) ||
            !whole(command.goal) ||
            typeof command.reserved !== 'object' ||
            !command.reserved ||
            Array.isArray(command.reserved)
        )
            return false;
        if (!Object.entries(command.reserved).every(([key, n]) => blocks.has(key) && whole(n))) return false;
        return MathCore.evaluate(command.ast).ok;
    }

    // Canonical cross-engine checkpoint of gameplay, excluding effect state and camera.
    // This is a drift detector, not authentication. Commands are always revalidated.
    function checkpoint(battle, economy) {
        let hash = 2166136261;
        function add(value) {
            hash = Math.imul(hash ^ (value | 0), 16777619) >>> 0;
        }
        add(battle.tick);
        add(battle.winner);
        for (const side of [0, 1]) {
            for (const structure of [battle.bases[side], battle.towers[side].bridge, battle.towers[side].supply]) {
                add(Math.round(structure.hp * 100));
                add(Math.round(structure.cooldown * 1000));
                add(structure.shotCount);
            }
        }
        for (const mine of battle.mines) {
            add(mine.owner);
            add(mine.claimant);
            add(Math.round(mine.progress * 1000));
        }
        const station = battle.station;
        const giantId = (kind) => giantKinds.indexOf(kind) + 1;
        add(giantId(station.giantKind));
        add(station.rotation);
        add(station.nextSpawn === null ? -1 : Math.round(station.nextSpawn / dt));
        for (const recruits of station.recruits) add(recruits);
        for (const side of economy.sides) {
            for (const key of blocks) add(side.inventory[key] || 0);
            add(side.inventory['='] || 0);
            add(side.targets.summon ?? -1);
            add(side.stats.produced);
            add(side.stats.deliveries);
            for (const w of side.workers) {
                add(w.id);
                add(mines.indexOf(w.assigned));
                add(Math.round(w.x * 100));
                add(Math.round(w.y * 100));
            }
        }
        for (const unit of battle.units) {
            add(unit.id);
            add(unit.side);
            add(unit.type.charCodeAt(0));
            add(giantId(unit.giantKind));
            add(Number(unit.route === 'supply'));
            add(unit.waypoint);
            add(Math.round(unit.x * 100));
            add(Math.round(unit.y * 100));
            add(Math.round(unit.hp * 100));
        }
        return hash;
    }

    function create({
        role = 'solo',
        seed = 1,
        difficulty = 'normal',
        send,
        reservations,
        onStart = () => {},
        onFailure = () => {},
        onProduce = () => {},
    } = {}) {
        if (!['solo', 'host', 'guest'].includes(role)) throw new Error('알 수 없는 경기 방식');
        if (role !== 'solo' && typeof send !== 'function') throw new Error('멀티플레이 전송 함수가 필요합니다.');
        const side = role === 'guest' ? 1 : 0;
        let battle,
            economy,
            matchId,
            opened = false,
            closed = false,
            ready = false;
        let seq = 0,
            receivedSeq = 0,
            guestAck = 0,
            watermark = 0,
            lastPacketTick = 0;
        let guestRequest = 0,
            lastRequest = 0,
            pending = null,
            lastReply = null,
            timer;
        const queue = [];
        const paidReservations = [{}, {}];

        function initialize(value) {
            seed = value >>> 0;
            battle = Battle.create(seed);
            economy = new Economy({
                seed,
                difficulty,
                battle,
                computerOpponent: role === 'solo',
                reservations: role === 'solo' ? reservations : (actor) => paidReservations[actor],
            });
        }
        if (role !== 'guest') initialize(seed);
        if (role === 'host') matchId = crypto.getRandomValues(new Uint32Array(2)).join('-');

        function close() {
            if (closed) return;
            closed = true;
            ready = false;
            clearTimeout(timer);
            if (pending) {
                clearTimeout(pending.timer);
                pending.resolve(failed('경기가 종료됐습니다.'));
                pending = null;
            }
            queue.length = 0;
        }
        function stop(reason, tellPeer = true) {
            if (closed) return;
            close();
            if (tellPeer && role !== 'solo') {
                try {
                    send({ scope, kind: 'end', matchId });
                } catch {}
            }
            onFailure(reason);
        }
        function transmit(packet) {
            if (closed) return false;
            try {
                if (send({ scope, matchId, ...packet })) return true;
            } catch {}
            stop('상대에게 데이터를 보낼 수 없어 경기를 종료했습니다.', false);
            return false;
        }
        function markReady() {
            if (ready || closed) return;
            ready = true;
            clearTimeout(timer);
            onStart();
        }
        function open() {
            if (closed || opened) return;
            opened = true;
            if (role === 'solo') {
                markReady();
                return;
            }
            timer = setTimeout(() => stop('상대의 경기 시작 응답 시간이 지났습니다.'), timeoutMs);
            if (role === 'host') transmit({ kind: 'seed', seed });
            else transmit({ kind: 'hello' });
        }
        function execute(actor, command) {
            if (battle.winner !== -1) return failed('종료된 경기입니다.');
            if (command.kind === 'surrender') {
                battle.winner = 1 - actor;
                return { ok: true };
            }
            if (command.kind === 'assign') {
                return economy.assign(actor, command.mine, command.delta)
                    ? { ok: true }
                    : failed('일꾼을 배정할 수 없습니다.');
            }
            if (economy.sides[actor].targets.summon !== command.goal)
                return failed('소환 목표가 바뀌었습니다. 새 목표를 확인하세요.');
            const result = economy.produce(actor, 'summon', command.ast, command.reserved, command.route);
            if (result.ok && role !== 'solo') paidReservations[actor] = { ...command.reserved };
            return result;
        }
        function notifyProduced(actor, command, result) {
            if (command?.kind === 'produce' && result.ok) onProduce(actor, command.ast, result);
        }
        function authoritative(actor, command, requestId = 0) {
            const result = validCommand(command) ? execute(actor, command) : invalid();
            if (role === 'host') {
                if (result.ok) {
                    const entry = {
                        kind: 'commit',
                        actor,
                        command,
                        requestId,
                        tick: battle.tick,
                        seq: ++seq,
                        actual: result.actual ?? 0,
                        nextGoal: economy.sides[actor].targets.summon,
                    };
                    if (requestId) lastReply = entry;
                    transmit(entry);
                } else if (requestId) {
                    lastReply = { kind: 'reject', requestId, reason: result.reason };
                    transmit(lastReply);
                }
            }
            notifyProduced(actor, command, result);
            return result;
        }
        function settle(id, result) {
            if (pending?.id !== id) return;
            clearTimeout(pending.timer);
            const previous = pending;
            pending = null;
            previous.resolve(result);
        }
        function submit(command) {
            if (!ready || closed || battle.winner >= 0) return failed('경기에 입력할 수 없습니다.');
            if (role !== 'guest') return authoritative(side, command);
            if (pending) return Promise.resolve(failed('이전 명령을 처리하고 있습니다.'));
            if (!validCommand(command)) return Promise.resolve(invalid());
            return new Promise((resolve) => {
                const id = ++guestRequest;
                pending = {
                    id,
                    resolve,
                    timer: setTimeout(() => stop('경기 명령에 대한 응답 시간이 지났습니다.'), timeoutMs),
                };
                transmit({ kind: 'request', requestId: id, command });
            });
        }
        function tick() {
            economy.tick(dt);
            battle.step(dt);
        }
        function drain() {
            while (!closed && queue[0]?.tick === battle.tick) {
                const entry = queue.shift();
                if (entry.kind === 'checkpoint') {
                    if (entry.hash !== checkpoint(battle, economy)) stop('두 기기의 경기 상태가 달라져 종료했습니다.');
                    continue;
                }
                const applied = execute(entry.actor, entry.command);
                if (
                    !applied.ok ||
                    (applied.actual ?? 0) !== entry.actual ||
                    economy.sides[entry.actor].targets.summon !== entry.nextGoal
                ) {
                    stop('양측의 명령 적용 결과가 달라져 경기를 종료했습니다.');
                    return;
                }
                seq = entry.seq;
                if (entry.actor === side) settle(entry.requestId, applied);
                notifyProduced(entry.actor, entry.command, applied);
            }
        }
        function step() {
            if (!ready || closed) return;
            if (role === 'guest') {
                drain();
                for (let i = 0; i < 8 && !closed && battle.winner === -1 && battle.tick < watermark; i++) {
                    tick();
                    drain();
                }
                if (!closed && battle.tick - guestAck >= 12) {
                    guestAck = battle.tick;
                    transmit({ kind: 'seen', tick: guestAck });
                }
                return;
            }
            if (battle.winner !== -1 || (role === 'host' && battle.tick - guestAck >= maxLead)) return;
            tick();
            if (role === 'host' && (battle.tick % 3 === 0 || battle.winner !== -1)) {
                const packet = { kind: 'clock', tick: battle.tick, seq };
                if (battle.tick % 60 === 0 || battle.winner !== -1) packet.hash = checkpoint(battle, economy);
                transmit(packet);
            }
        }
        function receive(packet) {
            if (closed || role === 'solo' || packet?.scope !== scope) return;
            if (role === 'host' && packet.kind === 'hello') {
                if (opened && !ready) transmit({ kind: 'seed', seed });
                return;
            }
            if (role === 'guest' && packet.kind === 'seed') {
                if (
                    !opened ||
                    ready ||
                    typeof packet.matchId !== 'string' ||
                    packet.matchId.length > 64 ||
                    !whole(packet.seed) ||
                    packet.seed > 0xffffffff
                )
                    return;
                if (!battle) {
                    matchId = packet.matchId;
                    initialize(packet.seed);
                }
                if (matchId === packet.matchId) transmit({ kind: 'loaded' });
                return;
            }
            if (matchId == null || packet.matchId !== matchId) return;
            if (packet.kind === 'end') {
                stop('상대의 연결이 종료됐습니다.', false);
                return;
            }
            if (role === 'host' && packet.kind === 'loaded') {
                if (!ready && transmit({ kind: 'go' })) markReady();
                return;
            }
            if (role === 'guest' && packet.kind === 'go') {
                markReady();
                return;
            }
            if (!ready) return;
            const protocolError = () => stop('경기 메시지 순서를 확인할 수 없어 종료했습니다.');
            if (role === 'host') {
                if (packet.kind === 'seen') {
                    if (whole(packet.tick) && packet.tick <= battle.tick) guestAck = Math.max(guestAck, packet.tick);
                    return;
                }
                if (packet.kind !== 'request') return;
                if (!whole(packet.requestId)) return protocolError();
                if (packet.requestId === lastRequest && lastReply) {
                    transmit(lastReply);
                    return;
                }
                if (packet.requestId < lastRequest) return;
                if (packet.requestId !== lastRequest + 1) return protocolError();
                lastRequest = packet.requestId;
                authoritative(1, packet.command, lastRequest);
                return;
            }
            if (packet.kind === 'reject') {
                settle(packet.requestId, failed(packet.reason));
                return;
            }
            if (packet.kind === 'clock') {
                if (
                    !whole(packet.tick) ||
                    packet.seq !== receivedSeq ||
                    packet.tick < lastPacketTick ||
                    packet.tick > battle.tick + maxLead
                )
                    return protocolError();
                if (packet.hash !== undefined) queue.push({ kind: 'checkpoint', tick: packet.tick, hash: packet.hash });
            } else if (packet.kind === 'commit') {
                if (!whole(packet.seq) || !whole(packet.tick)) return protocolError();
                if (packet.seq <= receivedSeq) return;
                if (
                    packet.seq !== receivedSeq + 1 ||
                    packet.tick < lastPacketTick ||
                    packet.tick > battle.tick + maxLead ||
                    ![0, 1].includes(packet.actor) ||
                    !validCommand(packet.command)
                )
                    return protocolError();
                receivedSeq = packet.seq;
                queue.push(packet);
            } else return;
            if (queue.length > 256) return protocolError();
            lastPacketTick = packet.tick;
            watermark = packet.tick;
            drain();
        }

        return {
            role,
            side,
            open,
            close,
            receive,
            step,
            disconnect: () => stop('연결이 끊겨 경기를 종료했습니다.', false),
            produce: (ast, reserved = {}, route = 'bridge') =>
                submit({ kind: 'produce', ast, reserved, route, goal: economy?.sides[side].targets.summon }),
            assign: (mine, delta) => submit({ kind: 'assign', mine, delta }),
            surrender: () => submit({ kind: 'surrender' }),
            get battle() {
                return battle;
            },
            get economy() {
                return economy;
            },
            get ready() {
                return ready && !closed;
            },
            get pending() {
                return !!pending;
            },
        };
    }
    return Object.freeze({ create, tickRate: 30 });
})();
