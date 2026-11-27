/* Application messages travel on GameKit's reliable, ordered WebRTC app channel. */
globalThis.NumoriNetwork = (() => {
    'use strict';
    const VERSION = NumoriVersion + '-1';
    const namespace = 'bloom-numori';
    const relays = [
        'wss://nos.lol',
        'wss://relay.snort.social',
        'wss://relay.primal.net',
        'wss://relay.nostr.wine',
        'wss://nostr.mom',
    ];

    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });

    function networkError(code, cause) {
        const descriptions = {
            'invalid-code': '숫자 네 자리 채널 코드를 입력하세요.',
            'insecure-context':
                '온라인 대전은 HTTPS 주소와 WebRTC를 지원하는 브라우저가 필요합니다.',
            'relay-unavailable': '채널 검색 서버에 연결할 수 없습니다.',
            'room-in-use': '이미 사용 중인 채널 코드입니다.',
            'room-full': '이미 두 사람이 대전 중인 채널입니다.',
            'version-mismatch': '두 플레이어의 게임 버전이 다릅니다.',
            timeout: '상대가 연결되지 않았습니다. 채널 코드와 네트워크를 확인하세요.',
            aborted: '연결을 취소했습니다.',
        };
        return Object.assign(new Error(descriptions[code] ?? code, { cause }), { code });
    }

    // Explicit developer/test option for separate same-origin pages. Gameplay still uses RTCPeerConnection.
    function broadcastSignaler({ namespace: scope, room, identity, signal }) {
        const bus = new BroadcastChannel(scope + '/' + room);
        const listeners = new Set();
        let closed = false;
        bus.onmessage = ({ data }) => {
            if (
                closed ||
                !data ||
                data.from === identity.id ||
                (data.to !== '*' && data.to !== identity.id)
            )
                return;
            for (const listener of listeners) listener(data);
        };
        const close = () => {
            if (closed) return;
            closed = true;
            signal.removeEventListener('abort', close);
            bus.close();
            listeners.clear();
            identity.close();
        };
        signal.addEventListener('abort', close, { once: true });
        if (signal.aborted) close();
        return {
            id: identity.id,
            subscribe(fn) {
                listeners.add(fn);
                return () => listeners.delete(fn);
            },
            async send(to, message) {
                if (closed) throw networkError('aborted');
                bus.postMessage({ from: identity.id, to, message });
            },
            close,
        };
    }

    // An established GameKit room stops broadcasting its presence. Answer an explicit host's code
    // check and a third guest's discovery without offering either the existing peer's connection.
    function discoveryAdapter(factory, role, roomRef, occupied) {
        return async (opts) => {
            const base = await factory(opts);
            let negotiatingWith = null;
            let lastProbeReply = 0;
            const unsubscribe = base.subscribe(({ from, message }) => {
                if (role === 'guest') {
                    if (message.type === 'group' && message.action === 'numori-full') occupied();
                    return;
                }
                if (message.type === 'group' && message.action === 'numori-check') {
                    void base.send(from, { type: 'presence', version: VERSION }).catch(() => {});
                }
                if (
                    message.type === 'discover' &&
                    roomRef()?.state === 'open' &&
                    from !== negotiatingWith
                ) {
                    // Suppress retries from a full joiner without creating additional offers.
                    if (Date.now() - lastProbeReply > 750) {
                        lastProbeReply = Date.now();
                        void base
                            .send(from, { type: 'group', action: 'numori-full' })
                            .catch(() => {});
                    }
                }
            });
            if (role === 'host') {
                void base.send('*', { type: 'group', action: 'numori-check' }).catch(() => {});
            }
            return {
                id: base.id,
                subscribe: (fn) => base.subscribe(fn),
                send(to, message) {
                    if (message.type === 'offer') negotiatingWith = to;
                    return base.send(to, message);
                },
                close() {
                    unsubscribe();
                    base.close();
                },
            };
        };
    }

    async function open({ role, code, signal, onStatus, onMessage, onOpen, onClose } = {}) {
        if (!['host', 'guest'].includes(role)) throw new TypeError('room role');
        if (
            (code != null && (typeof code !== 'string' || !/^\d{4}$/.test(code))) ||
            (role === 'guest' && !code)
        ) {
            throw networkError('invalid-code');
        }
        if (signal?.aborted) throw networkError('aborted');
        if (!globalThis.crypto?.subtle || typeof RTCPeerConnection !== 'function')
            throw networkError('insecure-context');
        const local = new URLSearchParams(location.search).get('signal') === 'local';
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const states = new Set(),
            packets = new Set();
        if (onMessage) packets.add(onMessage);
        const listen = (set, fn) => {
            set.add(fn);
            return () => set.delete(fn);
        };
        const emit = (set, ...args) => {
            for (const fn of [...set]) fn(...args);
        };
        let room,
            unsubscribeRoom,
            unsubscribeApp,
            terminal = false,
            forcedReason;
        function finish(state, detail) {
            if (terminal) return;
            terminal = true;
            signal?.removeEventListener('abort', abort);
            unsubscribeRoom?.();
            unsubscribeApp?.();
            room?.close();
            controller.abort();
            try {
                onStatus?.(state, detail);
                emit(states, state, detail);
                onClose?.(detail.reason);
            } finally {
                states.clear();
                packets.clear();
            }
        }
        function occupied() {
            if (room?.state === 'open') return;
            forcedReason = 'room-full';
            controller.abort();
        }
        function onEvent(event) {
            if (event.type !== 'state' || terminal) return;
            const detail = { ...event, reason: forcedReason ?? event.reason };
            if (event.state === 'failed' || event.state === 'closed') {
                finish(forcedReason ? 'failed' : event.state, detail);
            } else {
                onStatus?.(event.state, detail);
                emit(states, event.state, detail);
                if (event.state === 'open') onOpen?.({ reconnect: !!event.reconnect });
            }
        }
        try {
            for (let attempt = 0; ; attempt++) {
                try {
                    room = await NumoriGameKitTransport.createNostrRoom({
                        role: role === 'guest' ? 'join' : 'host',
                        room: code ?? undefined,
                        namespace,
                        version: VERSION,
                        relays,
                        signal: controller.signal,
                        timeoutMs: role === 'host' ? 3600000 : 22000,
                        peerTimeoutMs: 10000,
                        retryMs: 850,
                        collisionCheckMs: 1600,
                        reconnectTimeoutMs: 20000,
                        rtcConfig: {
                            iceServers: local
                                ? []
                                : [
                                      { urls: 'stun:stun.l.google.com:19302' },
                                      { urls: 'stun:stun1.l.google.com:3478' },
                                  ],
                        },
                        signalerFactory: discoveryAdapter(
                            local ? broadcastSignaler : NumoriGameKitTransport.createNostrSignaler,
                            role,
                            () => room,
                            occupied,
                        ),
                    });
                    break;
                } catch (err) {
                    if (
                        err?.code !== 'room-in-use' ||
                        code ||
                        role !== 'host' ||
                        attempt >= 3 ||
                        controller.signal.aborted
                    )
                        throw err;
                }
            }
            if (controller.signal.aborted) throw networkError(forcedReason ?? 'aborted');
            unsubscribeRoom = room.subscribe(onEvent);
            unsubscribeApp = room.app.subscribe((frame) => {
                let message;
                try {
                    message = JSON.parse(decoder.decode(frame));
                } catch {
                    finish('failed', { reason: 'invalid-packet' });
                    return;
                }
                if (!message || typeof message !== 'object' || Array.isArray(message)) {
                    finish('failed', { reason: 'invalid-packet' });
                    return;
                }
                emit(packets, message);
            });
            return {
                role,
                code: room.room,
                get state() {
                    return terminal ? 'closed' : room.state;
                },
                opened: room.opened,
                subscribe: (fn) => listen(packets, fn),
                subscribeState: (fn) => listen(states, fn),
                send(message) {
                    if (
                        terminal ||
                        room.state !== 'open' ||
                        !message ||
                        typeof message !== 'object'
                    )
                        return false;
                    try {
                        return room.app.send(encoder.encode(JSON.stringify(message)));
                    } catch {
                        return false;
                    }
                },
                close() {
                    finish('closed', { reason: 'left' });
                },
            };
        } catch (err) {
            signal?.removeEventListener('abort', abort);
            room?.close();
            const reason =
                forcedReason ??
                (controller.signal.aborted ? 'aborted' : err.code || 'relay-unavailable');
            controller.abort();
            throw networkError(reason, err);
        }
    }
    return Object.freeze({ open, version: VERSION });
})();
