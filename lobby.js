/* Lobby owns discovery and cancellation until the match takes ownership of its link. */
globalThis.NumoriLobby = (() => {
    'use strict';
    const dialog = document.querySelector('#lobby');
    const entry = dialog.querySelector('#lobbyEntry');
    const waiting = dialog.querySelector('#lobbyWaiting');
    const joinCode = dialog.querySelector('#joinCode');
    const hostCode = dialog.querySelector('#hostCode');
    const lobbyCode = dialog.querySelector('#lobbyCode');
    const message = dialog.querySelector('#lobbyMessage');
    const createButton = dialog.querySelector('#createRoom');
    const cancelButton = dialog.querySelector('#cancelRoom');
    const copyButton = dialog.querySelector('#copyCode');
    const opener = document.querySelector('[data-act="multiplayer"]');
    let hooks = {};
    let current = null;

    function status(text, error = false) {
        message.classList.toggle('is-error', error);
        message.textContent = text;
    }

    function errorText(error) {
        const reason = error?.code ?? error?.reason ?? error;
        switch (reason) {
            case 'invalid-code':
                return '채널 코드는 숫자 4자리입니다.';
            case 'room-full':
                return '이미 두 사람이 대전 중입니다. 다른 채널 코드를 입력해 주세요.';
            case 'room-in-use':
                return '이미 사용 중인 코드입니다. 새 방 만들기를 다시 눌러 주세요.';
            case 'insecure-context':
                return '보안 연결(HTTPS)에서 대전을 열어 주세요.';
            case 'version-mismatch':
                return '상대와 게임 버전이 다릅니다. 두 기기에서 같은 최신 링크를 열어 주세요.';
            case 'relay-unavailable':
                return '채널 서버에 닿지 않습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
            case 'timeout':
            case 'peer-timeout':
                return '상대와 연결하지 못했습니다. 채널 코드와 상대의 대기 상태를 확인해 주세요.';
            default:
                return '연결이 끝났습니다. 방을 다시 만들거나 채널 코드로 참가해 주세요.';
        }
    }

    function showEntry() {
        entry.hidden = false;
        waiting.hidden = true;
        hostCode.hidden = true;
        lobbyCode.value = '';
        copyButton.textContent = '복사';
        joinCode.removeAttribute('aria-invalid');
    }

    function abandon() {
        const attempt = current;
        current = null;
        if (!attempt) return;
        attempt.controller.abort();
        attempt.link?.close();
        hooks.onCancel?.();
    }

    function reset() {
        abandon();
        showEntry();
        status('');
        if (dialog.open) dialog.close();
    }

    function open() {
        if (dialog.open) return;
        showEntry();
        status('');
        dialog.showModal();
    }

    function showError(error) {
        abandon();
        showEntry();
        if (!dialog.open) dialog.showModal();
        status(typeof error === 'string' && /[가-힣]/u.test(error) ? error : errorText(error), true);
        createButton.focus();
    }

    function enterGame() {
        // The match now owns shutdown, interruption and any reconnect handling.
        current = null;
        if (dialog.open) dialog.close();
    }

    async function connect(role) {
        if (current || !dialog.open) return;
        const code = joinCode.value;
        if (role === 'guest' && !/^[0-9]{4}$/.test(code)) {
            status(errorText('invalid-code'), true);
            joinCode.setAttribute('aria-invalid', 'true');
            joinCode.focus();
            return;
        }
        const attempt = { controller: new AbortController(), link: null };
        current = attempt;
        const fail = (reason) => {
            if (current === attempt) showError(reason);
        };
        entry.hidden = true;
        waiting.hidden = false;
        cancelButton.focus();
        status(role === 'host' ? '채널 코드를 발급받는 중…' : code + ' 채널을 찾는 중…');
        try {
            const link = await NumoriNetwork.open({
                role,
                ...(role === 'guest' ? { code } : {}),
                signal: attempt.controller.signal,
                onStatus(state, detail) {
                    if (current !== attempt) return;
                    if (state === 'open') status('상대와 연결했습니다. 전장을 여는 중…');
                    if (state === 'interrupted') status('연결이 끊겨 상대와 다시 연결하는 중…');
                    if (state === 'failed') fail(detail?.reason ?? detail);
                },
                onClose: fail,
            });
            if (current !== attempt) {
                link.close();
                return;
            }
            attempt.link = link;
            if (role === 'host') {
                lobbyCode.value = link.code;
                hostCode.hidden = false;
                status('상대가 이 코드를 입력하면 경기가 시작됩니다.');
            } else {
                status(code + ' 채널에 연결하는 중…');
            }
            link.opened.catch(fail);
            // Install the match packet listener before waiting for the first channel open.
            await hooks.onRoom(link);
        } catch (error) {
            fail(error);
        }
    }

    opener.addEventListener('click', open);
    createButton.addEventListener('click', () => connect('host'));
    dialog.querySelector('#joinForm').addEventListener('submit', (event) => {
        event.preventDefault();
        connect('guest');
    });
    joinCode.addEventListener('input', () => {
        joinCode.value = joinCode.value.replace(/[^0-9]/g, '');
        joinCode.removeAttribute('aria-invalid');
        status('');
    });
    cancelButton.addEventListener('click', () => {
        abandon();
        showEntry();
        status('');
        createButton.focus();
    });
    dialog.querySelector('.lobby-close').addEventListener('click', reset);
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        reset();
    });
    copyButton.addEventListener('click', async () => {
        const code = lobbyCode.value;
        if (!code) return;
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(code);
            if (code === lobbyCode.value) copyButton.textContent = '복사됨';
        } catch {
            if (code !== lobbyCode.value) return;
            lobbyCode.focus();
            lobbyCode.select();
            status('선택된 채널 코드를 복사해 상대에게 알려주세요.');
        }
    });

    return {
        configure(callbacks) {
            hooks = callbacks;
        },
        open,
        enterGame,
        reset,
        showError,
    };
})();
