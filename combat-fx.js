/* Contact art is baked once per canvas renderer. Battle supplies the already-mitigated
   HP delta; projection and density limits only affect how many records are painted. */
globalThis.NumoriCombatFx = (() => {
    const cell = 64;
    const palette = [
        { edge: '#214f54', accent: '#6ee5cd', shadow: '#428f8a' },
        { edge: '#753d39', accent: '#ffad7c', shadow: '#cf705b' },
    ];
    const largeImpacts = new Set(['defenseBlast', 'giantBlast']);
    const owned = new Set(['hit', 'death', 'charge', 'brace', 'block', 'blast', ...largeImpacts]);
    const glyphs = ['cut', 'thrust', 'guard', 'stop', 'rush', 'spark', 'shard', 'leaf', 'puff', 'crack', 'defenseBurst'];
    const spriteIndex = Object.fromEntries(glyphs.map((name, i) => [name, i]));

    const ringIndex = glyphs.length;
    const digits = '0123456789.−×<e+-';
    const digitCell = 48;
    const digitFontSize = 32;
    const digitColors = ['#fff9e7', '#ffa48f', '#aaf1e4', '#ffe17b'];

    function compileAtlas() {
        const image = document.createElement('canvas');
        image.width = Math.max((ringIndex + 1) * cell, digits.length * digitCell);
        image.height = cell * 2 + digitColors.length * digitCell;
        const g = image.getContext('2d');
        g.lineJoin = g.lineCap = 'round';
        for (let side = 0; side < 2; side++) {
            const color = palette[side];
            for (const [index, name] of glyphs.entries()) {
                g.save();
                g.translate(cell * index + 32, cell * side + 32);
                const shape = (d, fill, edge, stroke = 1.5) => {
                    const p = new Path2D(d);
                    if (fill) {
                        g.fillStyle = fill;
                        g.fill(p);
                    }
                    if (edge) {
                        g.strokeStyle = edge;
                        g.lineWidth = stroke;
                        g.stroke(p);
                    }
                };
                if (name === 'cut') {
                    shape('M-26 13 Q7 14 24 -22 Q15 7 -1 17 Q-15 22 -26 13Z', '#fff0bc', '#6c4929', 2);
                    shape('M-20 15 Q4 14 19 -9 Q8 13 -6 17Z', color.accent);
                } else if (name === 'thrust') {
                    shape('M-30 1 L12 -2 7 -6 30 0 8 6 12 2Z', '#ffedac', '#634128', 1.7);
                    shape('M-22 -5 L-5 -7 M-15 6 L-1 5', null, color.accent, 2);
                } else if (name === 'guard') {
                    shape('M-11 -23 Q19 -7 6 20', null, color.edge, 6);
                    shape('M-11 -23 Q19 -7 6 20', null, color.accent, 3);
                    shape('M9 -2 L23 -12 M12 3 L28 4 M8 8 L19 19', null, '#ffda78', 2.3);
                } else if (name === 'stop') {
                    shape('M-12 -17 L4 0 -12 18 M-2 -17 L14 0 -2 18', null, color.edge, 4.2);
                    shape('M-12 -17 L4 0 -12 18 M-2 -17 L14 0 -2 18', null, color.accent, 2.1);
                    shape('M18 -4 L28 -10 M18 5 L27 12', null, '#ffe998', 2.2);
                } else if (name === 'rush') {
                    shape(
                        'M-28 -13 Q-3 -22 23 -1 Q0 -10 -17 -5Z M-23 9 Q0 5 22 0 Q4 16 -22 18Z',
                        color.accent,
                        color.edge,
                        1.8,
                    );
                    shape('M-24 -10 Q0 -16 16 -4 M-17 14 Q2 13 15 6', null, '#ffedbb', 2);
                } else if (name === 'spark') {
                    shape(
                        'M-21 4 L-5 -2 -9 -15 1 -6 7 -24 8 -6 23 -9 13 1 26 6 9 6 8 18 1 9 -11 18 -7 7Z',
                        '#ffdc76',
                        '#70452d',
                        2.3,
                    );
                    shape('M-8 2 L0 -1 6 -10 6 -2 15 -2 7 4 1 4 -4 9Z', '#fffcec');
                } else if (name === 'shard') {
                    shape('M-15 4 L-7 -14 12 -9 16 2 4 13Z', '#c49465', '#6c4b36', 2.6);
                    shape('M-7 -12 L11 -8 3 0 -12 3Z', '#fae0a5');
                } else if (name === 'leaf') {
                    shape('M-19 7 Q-13 -18 19 -10 Q14 12 -9 13Z', color.accent, color.edge, 2);
                    shape('M-11 6 L11 -6', null, color.shadow, 1.9);
                } else if (name === 'puff') {
                    shape(
                        'M-21 11 Q-29 -2 -17 -7 Q-17 -20 -3 -17 Q8 -24 15 -11 Q29 -10 24 3 Q21 16 5 15 Q-7 22 -21 11Z',
                        '#e6c795',
                        '#b39772',
                        1.7,
                    );
                    shape('M-16 -3 Q-14 -12 -6 -11 M1 -12 Q7 -16 11 -10', null, '#fff1c8', 2.4);
                } else if (name === 'defenseBurst') {
                    shape(
                        'M-28 8 L-16 -3 -20 -11 -8 -7 -3 -25 4 -10 16 -21 14 -5 26 -8 21 3 29 9 10 17 -13 16Z',
                        '#ffba5d',
                        '#885036',
                        2.6,
                    );
                    shape('M-16 8 L-7 0 -3 -15 4 -4 12 -8 10 2 18 8 6 12 -8 12Z', '#fff4c7');
                    shape('M-25 -7 L-24 -18 M21 -14 L25 -23 M26 3 L29 0', null, color.accent, 3);
                } else {
                    shape(
                        'M-25 -4 L-12 -2 -8 -7 -1 -3 6 -14 4 -5 12 -6 8 -2 23 1 6 1 12 10 2 4 -5 10 -4 3 -16 6 -11 1Z',
                        '#805d40',
                    );
                }
                g.restore();
            }
        }
        // Masks, rings and outlined number glyphs use the same atlas and sampler.
        g.strokeStyle = '#fff';
        g.lineWidth = 3.3;
        g.beginPath();
        g.arc((ringIndex + 0.5) * cell, cell / 2, cell / 2 - 4, 0, 2 * Math.PI);
        g.stroke();
        const metrics = Object.create(null);
        g.font = '900 ' + digitFontSize + 'px system-ui,sans-serif';
        g.lineWidth = 6.4;
        g.strokeStyle = '#392b20';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        for (let col = 0; col < digits.length; col++) {
            const char = digits[col];
            metrics[char] = { sx: col * digitCell, advance: g.measureText(char).width };
            for (let row = 0; row < digitColors.length; row++) {
                const x = col * digitCell + 5;
                const y = 2 * cell + (row + 0.5) * digitCell;
                g.fillStyle = digitColors[row];
                g.strokeText(char, x, y);
                g.fillText(char, x, y);
            }
        }
        return { image, metrics };
    }

    function numberText(amount) {
        if (amount > 0 && amount < 0.1) return '<0.1';
        // Display precision is one decimal; underlying records retain the full HP delta.
        return String(Math.round(amount * 10) / 10);
    }

    function create(localSide = 0) {
        const { image: atlas, metrics } = compileAtlas();
        let gpu = null;
        const marks = [],
            labels = [],
            accepted = [],
            occupied = [];

        function stamp(c, name, side, x, y, size, angle = 0, alpha = 1) {
            const sx = spriteIndex[name] * cell;
            const sy = (side === localSide ? 0 : 1) * cell;
            if (gpu) {
                const scale = size / cell;
                const a = Math.cos(angle) * scale;
                const b = Math.sin(angle) * scale;
                gpu.part(
                    atlas,
                    sx,
                    sy,
                    cell,
                    cell,
                    a,
                    b,
                    -b,
                    a,
                    x - ((a - b) * cell) / 2,
                    y - ((a + b) * cell) / 2,
                    alpha,
                );
                return;
            }
            c.save();
            c.translate(x, y);
            if (angle) c.rotate(angle);
            c.globalAlpha *= alpha;
            c.drawImage(atlas, sx, sy, cell, cell, -size / 2, -size / 2, size, size);
            c.restore();
        }

        const ringTints = new Map();
        function ring(c, x, y, radius, squash, color, weight, alpha) {
            if (gpu) {
                if (!ringTints.has(color)) {
                    const rgb = parseInt(color.slice(1), 16);
                    ringTints.set(color, [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1]);
                }
                const diameter = (radius * 2 * cell) / (cell - 8);
                gpu.image(
                    atlas,
                    ringIndex * cell,
                    0,
                    cell,
                    cell,
                    x - diameter / 2,
                    y - (diameter * squash) / 2,
                    diameter,
                    diameter * squash,
                    alpha,
                    ringTints.get(color),
                );
                return;
            }
            c.save();
            c.globalAlpha *= alpha;
            c.strokeStyle = color;
            c.lineWidth = weight;
            c.beginPath();
            c.ellipse(x, y, radius, radius * squash, 0, 0, 2 * Math.PI);
            c.stroke();
            c.restore();
        }

        // One accepted mark per small patch per family; coincident volleys do not stack
        // a dozen opaque effects on top of a single contact. The camera selects locally.
        function placed(list, x, y, spacing, family) {
            for (const p of list)
                if (p.family === family && Math.abs(x - p.x) < spacing && Math.abs(y - p.y) < spacing * 0.72)
                    return false;
            list.push({ x, y, family });
            return true;
        }
        function drawGround(c, b, v) {
            gpu = v.gpu ?? null;
            if (!b || v.zoom < 0.29) return;
            for (const p of b.projectiles ?? []) {
                if (p.kind !== 'mortar' || !v.visible(p.endX, p.endY)) continue;
                const radius = p.splashRadius;
                if (radius > 0)
                    ring(c, p.endX, p.endY * v.heightScale, radius, v.heightScale, '#a75a3b', 1.6, 0.45);
            }
            accepted.length = 0;
            for (let i = b.effects.length - 1; i >= 0 && accepted.length < 12; i--) {
                const f = b.effects[i];
                if (f.kind !== 'blast' && f.kind !== 'death' && !largeImpacts.has(f.kind)) continue;
                if (!v.visible(f.x, f.y)) continue;
                const x = f.x,
                    y = f.y * v.heightScale;
                if (!placed(accepted, x, y, 28 / v.zoom, f.kind)) continue;
                const a = f.age / f.life;
                if (largeImpacts.has(f.kind)) {
                    const radius = f.radius * (v.reducedMotion ? 1 : 0.75 + 0.25 * Math.sqrt(a));
                    const shade = f.kind === 'giantBlast' ? palette[f.side === localSide ? 0 : 1] : null;
                    ring(c, x, y, radius, v.heightScale, shade?.edge ?? '#a75a3b', 4, 0.82 * (1 - a));
                    ring(c, x, y, radius - 4, v.heightScale, shade?.accent ?? '#ffd582', 3, 0.93 * (1 - a));
                    stamp(c, 'crack', f.side, x, y, f.radius, 0, 0.52 * (1 - a));
                } else if (f.kind === 'blast') {
                    const r = v.reducedMotion ? 22 : 13 + Math.sqrt(a) * 18;
                    ring(c, x, y, r, 0.43, '#9f7450', 2.6, 0.64 * (1 - a));
                    stamp(c, 'crack', f.side, x, y, 31, 0, 0.53 * (1 - a));
                } else {
                    ring(c, x, y, 10, 0.32, palette[f.side === localSide ? 0 : 1].shadow, 1.5, 0.55 * (1 - a));
                }
            }
        }
        function drawBurst(c, f, v) {
            const x = f.x,
                y = f.y * v.heightScale,
                a = f.age / f.life;
            const t = v.reducedMotion ? 0.3 : a,
                fade = 1 - a;
            const dir = Math.atan2((f.dy || 0) * v.heightScale, f.dx ?? 1);
            const side = f.side;
            if (largeImpacts.has(f.kind)) {
                const flare = Math.max(0, 1 - a * 2.1);
                if (flare > 0) {
                    const sweep = f.giantKind === 'bulwark';
                    const size = f.kind === 'giantBlast' ? f.radius * 1.55 : 67;
                    stamp(c, sweep ? 'cut' : 'defenseBurst', side, x, y - 17, size, sweep ? dir : 0,
                        flare * (v.reducedMotion ? 0.66 : 0.92));
                }
                for (let k = 0; k < 4; k++) {
                    const theta = (f.seed || 0) * 0.63 + k * Math.PI / 2;
                    const spread = f.radius * (0.32 + t * 0.78);
                    stamp(
                        c,
                        k % 2 ? 'shard' : 'puff',
                        side,
                        x + Math.cos(theta) * spread,
                        y + Math.sin(theta) * spread * v.heightScale - 19 * Math.sin(Math.PI * t),
                        (k % 2 ? 14 : 21) + 9 * t,
                        theta * 0.24,
                        0.85 * fade,
                    );
                }
            } else if (f.kind === 'blast') {
                // A thrown stone strikes down into the ground. The opening rim sweeps
                // out towards the struck rank; the debris follows a higher, slower arc.
                const strikeDir = Math.cos(dir) < 0 ? -1 : 1;
                if (a < 0.36) {
                    const flash = Math.min(1, (0.36 - a) / 0.18);
                    stamp(
                        c,
                        'cut',
                        side,
                        x + strikeDir * (14 + 12 * t),
                        y - 11,
                        67 + 10 * t,
                        strikeDir > 0 ? 0.36 : 2.78,
                        flash,
                    );
                    stamp(c, 'spark', side, x, y - 8, 34 - 7 * t, -0.25, flash);
                }
                const seed = f.seed || 0;
                for (let k = 0; k < 6; k++) {
                    const theta = seed * 0.63 + k * 1.047;
                    const dx = Math.cos(theta),
                        dy = Math.sin(theta);
                    const dist = t * (23 + (k % 3) * 9);
                    const lift = Math.sin(Math.PI * t) * (k % 2 ? 28 : 14);
                    if (k % 2 === 0)
                        stamp(
                            c,
                            'puff',
                            side,
                            x + dx * dist,
                            y + dy * dist * 0.38 - 4 - 6 * t,
                            17 + 21 * t,
                            theta * 0.13,
                            fade * 0.83,
                        );
                    if (k % 2)
                        stamp(
                            c,
                            'shard',
                            side,
                            x + dx * dist + strikeDir * 4,
                            y + dy * dist * 0.42 - lift,
                            16 - 8 * t,
                            theta + t * 3,
                            fade,
                        );
                }
            } else if (f.kind === 'death') {
                for (let k = 0; k < 2; k++) {
                    const dx = k ? 1 : -1,
                        h = Math.sin(Math.PI * t);
                    stamp(
                        c,
                        'leaf',
                        side,
                        x + dx * (4 + 15 * t),
                        y - 8 - 13 * h + 3 * t,
                        9 - 3 * t,
                        dx * t * 2.6,
                        fade * 0.85,
                    );
                }
            } else if (f.kind === 'block') {
                stamp(c, 'guard', side, x - 6 * Math.cos(dir), y - 15, 31 + 4 * t, dir + Math.PI, fade);
                if (!v.reducedMotion)
                    stamp(
                        c,
                        'shard',
                        side,
                        x + (10 + 18 * t) * Math.cos(dir),
                        y - 18 - 18 * Math.sin(t * 2.5),
                        6,
                        dir + t * 2,
                        fade,
                    );
            } else if (f.kind === 'brace') {
                stamp(c, 'stop', side, x + 12 * Math.cos(dir), y - 15 + Math.sin(dir) * 7, 33, dir, fade);
            } else if (f.kind === 'charge') {
                const hx = Math.cos(dir),
                    hy = Math.sin(dir);
                stamp(c, 'rush', side, x - (25 + 8 * t) * hx, y - 11 - 9 * hy, 48 + 6 * t, dir, fade * 0.75);
                stamp(c, 'cut', side, x + 19 * hx, y - 18 + 5 * hy, 66, dir - 0.36 + t * 0.34, Math.min(1, fade * 1.5));
                if (a < 0.45) stamp(c, 'spark', side, x + 7 * hx, y - 16, 29, dir, Math.min(1, (0.45 - a) / 0.24));
            }
        }

        function draw(c, b, v) {
            gpu = v.gpu ?? null;
            if (!b?.damageFx || v.zoom < 0.29) return;
            const k = v.heightScale,
                z = v.zoom,
                crowd = b.units.length > 220;
            accepted.length = marks.length = labels.length = occupied.length = 0;
            const cap = crowd ? 10 : 18;
            // Keep the rare, readable artillery impact amid rapid direct fire and casualties.
            for (let i = b.effects.length - 1; i >= 0 && marks.length < 6; i--) {
                const f = b.effects[i];
                if (largeImpacts.has(f.kind) && v.visible(f.x, f.y) && placed(accepted, f.x, f.y * k, 22 / z, f.kind))
                    marks.push(f);
            }
            for (let i = b.effects.length - 1; i >= 0 && marks.length < cap; i--) {
                const f = b.effects[i];
                if (!owned.has(f.kind) || f.kind === 'hit' || largeImpacts.has(f.kind) || !v.visible(f.x, f.y)) continue;
                if (!placed(accepted, f.x, f.y * k, (crowd ? 51 : 35) / z, f.kind)) continue;
                marks.push(f);
            }
            for (const f of marks) drawBurst(c, f, v);
            accepted.length = 0;
            for (const ev of b.damageFx.values()) {
                if (!v.visible(ev.x, ev.y)) continue;
                const age = b.time - ev.born;
                if (
                    age < 0.19 &&
                    accepted.length < cap &&
                    !largeImpacts.has(ev.style) &&
                    !['blast', 'brace', 'charge', 'blocked'].includes(ev.style) &&
                    placed(accepted, ev.x, ev.y * k, (crowd ? 45 : 33) / z, 'contact')
                ) {
                    const dir = Math.atan2(ev.dy * k, ev.dx),
                        x = ev.x - (ev.base ? 32 : 5) * Math.cos(dir);
                    const y = ev.y * k - (ev.base ? 26 : 14) - Math.sin(dir) * 6;
                    const t = v.reducedMotion ? 0.3 : age / 0.19,
                        fade = 1 - age / 0.19;
                    if (ev.style === 'melee')
                        stamp(c, 'cut', ev.side, x + 10 * Math.cos(dir), y - 3, 47, dir + t * 0.35, fade);
                    if (ev.style === 'thrust') stamp(c, 'thrust', ev.side, x - 13 * Math.cos(dir), y, 43, dir, fade);
                    if (ev.style === 'arrow') {
                        stamp(c, 'shard', ev.side, x + 8 * Math.cos(dir) + t * 7, y - 5 - 6 * t, 6, dir + t, fade);
                        stamp(c, 'spark', ev.side, x, y, 14 + 5 * (1 - t), dir, fade);
                    } else stamp(c, 'spark', ev.side, x, y, ev.base ? 21 : 15, dir, fade);
                }
                const life = ev.kills ? 0.84 : ev.base ? 0.78 : 0.6;
                if (age < life) labels.push(ev);
            }
            if (z < 0.48) return;
            const priority = (f) =>
                (f.kills ? 8 : 0) +
                (f.base ? 6 : 0) +
                (f.style === 'brace' || f.style === 'blocked' ? 4 : 0) +
                (f.style === 'blast' || largeImpacts.has(f.style) ? 2 : 0);
            labels.sort((a, b) => priority(b) - priority(a) || b.born - a.born || b.amount - a.amount);
            const limit = Math.min(10, Math.max(3, Math.floor(v.width / 115)));
            for (const ev of labels) {
                if (occupied.length >= limit) break;
                const age = b.time - ev.born;
                const life = ev.kills ? 0.84 : ev.base ? 0.78 : 0.6;
                const t = v.reducedMotion ? 0.38 : age / life;
                const sign = ev.dx === 0 ? (ev.spread < 0.5 ? -1 : 1) : Math.sign(ev.dx);
                const x = ev.x + (sign * (3 + 12 * t) + (ev.spread - 0.5) * 12) / z;
                const y = ev.y * k - (ev.base ? 54 : 27) - (16 + 17 * Math.sin(Math.min(1, t) * Math.PI)) / z;
                const amount = numberText(ev.amount);
                const tier = ev.kills ? 19 : ev.base ? 16 : 14;
                const pop = crowd || v.reducedMotion ? 1 : 1 + Math.max(0, 1 - age / 0.15) * 0.28;
                const size = tier * pop;
                const text = ev.hits > 1 && ev.uniformAmount ? numberText(ev.unitAmount) + '×' + ev.hits : '−' + amount;
                let advance = 0;
                for (let i = 0; i < text.length; i++) advance += metrics[text[i]].advance;
                const width = (advance * size) / digitFontSize + 6;
                // Retain only legible screen-space labels; actual hit values never change.
                const left = x * z - width / 2,
                    top = y * z - size / 2;
                if (
                    occupied.some(
                        (box) =>
                            left < box.right + 3 &&
                            left + width > box.left - 3 &&
                            top < box.bottom + 3 &&
                            top + size > box.top - 3,
                    )
                )
                    continue;
                occupied.push({ left, right: left + width, top, bottom: top + size });
                const row = ev.kills ? 3 : ev.style === 'blocked' ? 2 : ev.targetSide === localSide ? 1 : 0;
                const alpha = Math.min(1, (1 - age / life) * 3.3);
                if (gpu) {
                    const scale = size / digitFontSize / z;
                    let pen = x - (advance * scale) / 2;
                    for (let i = 0; i < text.length; i++) {
                        const glyph = metrics[text[i]];
                        gpu.image(
                            atlas,
                            glyph.sx,
                            2 * cell + row * digitCell,
                            digitCell,
                            digitCell,
                            pen - 5 * scale,
                            y - (digitCell * scale) / 2,
                            digitCell * scale,
                            digitCell * scale,
                            alpha,
                        );
                        pen += glyph.advance * scale;
                    }
                    continue;
                }
                c.save();
                c.translate(x, y);
                c.scale(1 / z, 1 / z);
                c.globalAlpha = alpha;
                c.font = '900 ' + size.toFixed(1) + 'px system-ui,sans-serif';
                c.lineJoin = 'round';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.lineWidth = 3.1;
                c.strokeStyle = '#392b20';
                c.strokeText(text, 0, 0);
                c.fillStyle = digitColors[row];
                c.fillText(text, 0, 0);
                c.restore();
            }
        }
        return { draw, drawGround, prewarm: (backend) => backend.register(atlas), owns: (kind) => owned.has(kind) };
    }
    return { create, numberText };
})();
