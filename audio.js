globalThis.NumoriAudio = (() => {
    let ctx,
        bus,
        last = {},
        impactTexture,
        lastBeat = -1;
    let settings = { volume: 0.4, music: true, mute: false };
    try {
        Object.assign(settings, JSON.parse(localStorage.getItem('numori-sound')));
    } catch {}
    function unlock() {
        try {
            if (!ctx) {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
                bus = ctx.createGain();
                bus.connect(ctx.destination);
                impactTexture = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.28), ctx.sampleRate);
                const samples = impactTexture.getChannelData(0);
                let noiseSeed = 1259;
                for (let i = 0; i < samples.length; i++) {
                    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
                    samples[i] = (noiseSeed / 2147483648 - 1) * (1 - i / samples.length);
                }
                update();
            }
            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        } catch {}
    }
    function update() {
        if (bus) bus.gain.setTargetAtTime(settings.mute ? 0 : settings.volume, ctx.currentTime, 0.04);
        try {
            localStorage.setItem('numori-sound', JSON.stringify(settings));
        } catch {}
    }
    function tone(frequency, duration, type, volume, delay = 0, bend = 1) {
        if (!ctx || settings.mute || ctx.state !== 'running') return;
        const t = ctx.currentTime + delay,
            oscillator = ctx.createOscillator(),
            envelope = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, t);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * bend, t + duration);
        envelope.gain.setValueAtTime(0.0001, t);
        envelope.gain.exponentialRampToValueAtTime(volume, t + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        oscillator.connect(envelope);
        envelope.connect(bus);
        oscillator.start(t);
        oscillator.stop(t + duration + 0.01);
        oscillator.onended = () => {
            oscillator.disconnect();
            envelope.disconnect();
        };
    }
    function impact(duration, hz, volume, ring = 0.7) {
        if (!impactTexture || ctx.state !== 'running' || settings.mute) return;
        const t = ctx.currentTime;
        const sound = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        sound.buffer = impactTexture;
        filter.type = 'bandpass';
        filter.Q.value = ring;
        filter.frequency.setValueAtTime(hz, t);
        filter.frequency.exponentialRampToValueAtTime(hz * 0.45, t + duration);
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        sound.connect(filter);
        filter.connect(gain);
        gain.connect(bus);
        sound.onended = () => {
            sound.disconnect();
            filter.disconnect();
            gain.disconnect();
        };
        sound.start(t);
        sound.stop(t + duration);
    }
    const cues = {
        pick: [530, 0.09],
        merge: [720, 0.16],
        return: [900, 0.09],
        spawn: [370, 0.24],
        bonus: [620, 0.3],
        attack: [115, 0.08],
        hit: [76, 0.1],
        capture: [480, 0.35],
        destroy: [85, 0.6],
        win: [523, 0.45],
        lose: [311, 0.5],
    };
    function play(key, count = 1) {
        const now = performance.now() / 1000;
        const limit = { hit: 0.36, attack: 0.5, return: 1, spawn: 0.16 }[key] || 0.055;
        if (now - (last[key] ?? -5) < limit || !cues[key]) return;
        last[key] = now;
        const [f, d] = cues[key],
            percussive = ['hit', 'attack', 'destroy'].includes(key);
        tone(f, d, percussive ? 'triangle' : 'sine', percussive ? 0.12 : 0.15, 0, percussive ? 0.45 : 1);
        if (['merge', 'spawn', 'bonus', 'capture', 'win', 'lose'].includes(key))
            tone(f * (key === 'lose' ? 0.84 : 1.5), d, 'triangle', 0.085, 0.09);
        if (key === 'win' || key === 'bonus') tone(f * 2, d * 1.2, 'sine', 0.09, 0.18);
        const weight = Math.min(2.2, 1 + Math.log2(Math.max(1, count)) * 0.23);
        if (key === 'hit') impact(0.13, 680, 0.18 * weight);
        if (key === 'attack') impact(0.09, 1050, 0.095 * weight, 1.5);
        if (key === 'spawn' || key === 'bonus') impact(0.23, 310, 0.22);
        if (key === 'destroy') impact(0.27, 240, 0.36);
    }
    function music(time) {
        const beat = Math.floor(time / 0.48);
        if (beat === lastBeat) return;
        lastBeat = beat;
        if (!settings.music || !ctx || settings.mute) return;
        const melody = [0, 7, 9, 12, 7, 4, 2, 4, 0, 4, 7, 14, 12, 7, 4, 2],
            i = beat % 16;
        if (i % 4 !== 3) tone(220 * 2 ** (melody[i] / 12), 0.43, 'sine', 0.036);
        if (!(i % 4)) tone(110 * 2 ** ([0, -3, -5, -7][i / 4] / 12), 1.2, 'triangle', 0.04);
    }
    return { settings, update, unlock, play, music };
})();
