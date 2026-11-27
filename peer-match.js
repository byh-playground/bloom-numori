/* Own one room connection across mutually accepted rematches. Game state lives in NumoriMatch. */
globalThis.NumoriPeerSeries = {
    create(link, { createMatch, onFailure, onVote }) {
        let round = 0,
            match,
            closed = false,
            mine = false,
            theirs = false;
        const subscriptions = [];
        function send(kind, payload) {
            return !closed && link.send({ scope: 'numori-series/1', round, kind, payload });
        }
        function next() {
            match?.close();
            round++;
            mine = theirs = false;
            match = createMatch(link.role, (packet) => send('match', packet));
        }
        function failure(reason) {
            if (closed) return;
            shutdown();
            onFailure(reason || '상대와의 연결이 종료됐습니다.');
        }
        function shutdown() {
            if (closed) return;
            closed = true;
            for (const unsub of subscriptions) unsub();
            match?.close();
            link.close();
        }
        function resumeIfAgreed() {
            if (mine && theirs) {
                next();
                match.open();
            } else onVote(mine, theirs);
        }
        next();
        subscriptions.push(
            link.subscribe((packet) => {
                if (!packet || closed || packet.scope !== 'numori-series/1' || packet.round !== round) return;
                if (packet.kind === 'match') match.receive(packet.payload);
                else if (packet.kind === 'rematch' && match.ready) {
                    theirs = true;
                    resumeIfAgreed();
                }
            }),
        );
        subscriptions.push(
            link.subscribeState((state) => {
                if (['failed', 'closed', 'interrupted'].includes(state)) failure('상대와의 연결이 종료됐습니다.');
            }),
        );
        link.opened
            .then(() => {
                if (!closed) match.open();
            })
            .catch(() => failure('상대와 연결하지 못했습니다.'));
        return {
            close: shutdown,
            get peerRequested() {
                return theirs;
            },
            get match() {
                return match;
            },
            rematch() {
                if (mine || closed || !(match.battle?.winner >= 0)) return;
                mine = true;
                if (!send('rematch', null)) return failure('재경기 요청을 보내지 못했습니다.');
                resumeIfAgreed();
            },
        };
    },
};
