/* Shared skeletal pose channels. Bind coordinates are relative to the 192px art tile.
   Each part inherits its parent's transform, then rotates around its own joint. */
globalThis.NumoriActorRig = (() => {
    'use strict';
    const rest = [0, 0, 0, 1, 1];
    const transform = (x = 0, y = 0, rotation = 0, sx = 1, sy = 1) => [x, y, rotation, sx, sy];
    const key = (t, joints = {}) => ({ t, joints });
    const neutral = [key(0), key(1)];
    const idle = [
        key(0),
        key(0.5, { body: transform(0, -1, 0, 0.995, 1.012), hand: transform(0, 0, -0.022), face: transform(0, -0.45) }),
        key(1),
    ];
    const walk = [
        key(0, {
            body: transform(-1, 1, -0.025),
            legL: transform(0, -3, 0.16),
            legR: transform(0, 0, -0.14),
            hand: transform(0, 0, -0.075),
            armL: transform(0, 0, 0.1),
        }),
        key(0.25, {
            body: transform(0, -2, 0, 0.985, 1.02),
            legL: transform(1, -2, 0.025),
            legR: transform(-1, 1, -0.025),
            face: transform(0, 1),
        }),
        key(0.5, {
            body: transform(1, 1, 0.025),
            legL: transform(0, 0, -0.14),
            legR: transform(0, -3, 0.16),
            hand: transform(0, 0, 0.075),
            armL: transform(0, 0, -0.1),
        }),
        key(0.75, {
            body: transform(0, -2, 0, 0.985, 1.02),
            legL: transform(-1, 1, -0.025),
            legR: transform(1, -2, 0.025),
            face: transform(0, 1),
        }),
    ];
    walk.push(key(1, walk[0].joints));
    const hurt = [
        key(0),
        key(0.15, {
            body: transform(-7, -3, -0.11, 0.96, 1.04),
            hand: transform(-1, -2, -0.16),
            face: transform(0, 1, 0, 1.03, 0.76),
            legR: transform(0, -3, 0.16),
        }),
        key(0.52, { body: transform(1, 2, 0.024, 1.035, 0.975), hand: transform(0, 0, 0.055) }),
        key(1),
    ];
    const attackImpact = 0.55;
    // Body, arms and gear use the same rig, with a distinct anticipation and contact for each role.
    const gestures = {
        shield: [
            { body: transform(-3, 3, -0.055), hand: transform(-4, 1, -0.12) },
            { body: transform(3, 2, 0.03, 1.045, 0.97), hand: transform(7, -2, 0.1), armL: transform(0, -1, -0.07) },
        ],
        archer: [
            {
                body: transform(-2, 0, -0.035),
                hand: transform(1, -1, -0.04),
                armL: transform(-6, 1, -0.13),
                arrow: transform(-10, 0),
                weapon: transform(0, 0, 0, 0.975, 1.01),
            },
            {
                body: transform(-1, -1, -0.015),
                hand: transform(1, 0, 0.065),
                armL: transform(4, 0, 0.15),
                weapon: transform(0, 0, -0.025, 1.04, 0.99),
            },
        ],
        spear: [
            {
                body: transform(-4, 1, -0.06),
                hand: transform(-3, 1, 0.5),
                weapon: transform(0, 0, 0.14),
                legR: transform(1, 0, -0.1),
            },
            {
                body: transform(5, 2, 0.07),
                hand: transform(12, 0, 0.89),
                weapon: transform(1, 0, 0.28),
                armL: transform(2, 1, 0.15),
            },
        ],
        charger: [
            { body: transform(-4, 5, -0.06, 1.06, 0.9), hand: transform(0, 0, -0.07), legL: transform(-2, -2, 0.16) },
            {
                body: transform(7, -3, 0.11, 1.09, 0.94),
                hand: transform(0, 0, 0.11),
                legL: transform(0, 1, -0.18),
                legR: transform(0, -3, 0.21),
            },
        ],
        thrower: [
            { body: transform(-3, 3, -0.1, 1.04, 0.95), hand: transform(-3, -5, -0.51), armL: transform(0, -1, 0.13) },
            { body: transform(4, -2, 0.1), hand: transform(4, -2, 0.62), armL: transform(-1, 1, -0.22) },
        ],
        worker: [
            { body: transform(-2, 0, -0.06), hand: transform(-2, -1, -0.22), weapon: transform(0, 0, -0.49) },
            {
                body: transform(3, 3, 0.075, 1.02, 0.96),
                hand: transform(-2, 0, 0.24),
                weapon: transform(0, 0, 0.46),
                legR: transform(0, 0, -0.1),
            },
        ],
    };
    function clipsFor(type) {
        const [prepare, contact] = gestures[type];
        const attack = [key(0), key(0.4, prepare), key(attackImpact, contact), key(0.63, contact), key(1)];
        const planted = {
            body: transform(-2, 3, -0.04, 1.03, 0.96),
            hand: transform(3, -2, 0.75),
            weapon: transform(0, 0, 0.18),
            legL: transform(-1, 0, 0.12),
            legR: transform(1, 0, -0.12),
        };
        const block = [
            key(0, { body: transform(-3, 2, -0.06), hand: transform(-1, -2, -0.17) }),
            key(0.2, {
                body: transform(-4, 3, -0.065, 1.04, 0.96),
                hand: transform(3, -3, 0.07),
                legR: transform(2, 0, -0.1),
            }),
            key(0.68, { body: transform(-1, 1, -0.02), hand: transform(2, -1, 0.04) }),
            key(1),
        ];
        const charge = walk.map((frame) => {
            const joints = frame.joints,
                b = joints.body || rest;
            return key(frame.t, {
                ...joints,
                body: transform(b[0] + 3, b[1] + 2, 0.075 + b[2], 1.05, 0.95),
                weapon: transform(0, 0, 0.05),
            });
        });
        return {
            still: neutral,
            idle,
            walk,
            charge,
            attack,
            hurt,
            block,
            brace: [key(0, planted), key(1, planted)],
            dig: attack,
        };
    }
    const identity = new Float64Array([1, 0, 0, 1, 0, 0]);
    function create(data, image) {
        if (!image || !data?.roles) return null;
        const rigs = {};
        for (const [type, definitions] of Object.entries(data.roles)) {
            const nodes = definitions.map((part) => ({
                part,
                m: new Float64Array(6),
                parent: null,
                rect: part.rect,
                projectile: (type === 'thrower' && part.id === 'weapon') || (type === 'archer' && part.id === 'arrow'),
            }));
            const byName = new Map(nodes.map((n) => [n.part.id, n]));
            for (const node of nodes) node.parent = byName.get(node.part.parent);
            // Painter order is independent of joint order: feet can be drawn behind their parent.
            const depth = (n) => (n.parent ? 1 + depth(n.parent) : 0);
            rigs[type] = { nodes, parentsFirst: [...nodes].sort((a, b) => depth(a) - depth(b)), clips: clipsFor(type) };
        }
        function evaluate(type, clip, phase) {
            const rig = rigs[type],
                frames = rig.clips[clip] || neutral;
            phase = Math.max(0, Math.min(1, phase));
            let i = 1;
            while (i + 1 < frames.length && frames[i].t < phase) i++;
            const next = frames[i],
                prev = frames[i - 1];
            const f = (1 - Math.cos((Math.PI * (phase - prev.t)) / (next.t - prev.t))) * 0.5;
            const expression =
                clip === 'hurt'
                    ? 'hurt'
                    : clip === 'attack' || clip === 'brace' || clip === 'charge' || clip === 'block'
                      ? 'attack'
                      : 'neutral';
            const released = clip === 'attack' && phase >= attackImpact && phase < 0.92;
            for (const n of rig.parentsFirst) {
                const variant = released && type === 'archer' && n.part.id === 'weapon' ? 'release' : expression;
                n.rect = released && n.projectile ? null : n.part.variants?.[variant] || n.part.rect;
                const { id, pivot } = n.part,
                    a = prev.joints[id] || rest,
                    b = next.joints[id] || rest;
                if (a === rest && b === rest) {
                    n.m.set(n.parent?.m || identity);
                    continue;
                }
                const x = a[0] + (b[0] - a[0]) * f,
                    y = a[1] + (b[1] - a[1]) * f,
                    angle = a[2] + (b[2] - a[2]) * f;
                const sx = a[3] + (b[3] - a[3]) * f,
                    sy = a[4] + (b[4] - a[4]) * f;
                const co = Math.cos(angle),
                    si = Math.sin(angle);
                const A = co * sx,
                    B = si * sx,
                    C = -si * sy,
                    D = co * sy;
                const tx = pivot[0] + x - A * pivot[0] - C * pivot[1],
                    ty = pivot[1] + y - B * pivot[0] - D * pivot[1];
                const p = n.parent?.m || identity,
                    m = n.m;
                m[0] = p[0] * A + p[2] * B;
                m[1] = p[1] * A + p[3] * B;
                m[2] = p[0] * C + p[2] * D;
                m[3] = p[1] * C + p[3] * D;
                m[4] = p[0] * tx + p[2] * ty + p[4];
                m[5] = p[1] * tx + p[3] * ty + p[5];
            }
            return rig.nodes;
        }
        function draw(ctx, type, clip, phase, material = image) {
            for (const { part, m, rect } of evaluate(type, clip, phase)) {
                if (!rect) continue;
                ctx.save();
                ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
                ctx.drawImage(material, rect[0], rect[1], rect[2], rect[3], part.at[0], part.at[1], rect[2], rect[3]);
                ctx.restore();
            }
        }
        // The GameKit batch applies the camera once to all projected-world quads.
        // Fold the part's bind rectangle into its hierarchy transform, then anchor at the feet.
        function drawGPU(batch, material, type, clip, phase, x, y, scaleX, scaleY, footX, footY) {
            let count = 0;
            for (const { part, m, rect } of evaluate(type, clip, phase)) {
                if (!rect) continue;
                const bx = part.at[0],
                    by = part.at[1];
                const tx = x + scaleX * (m[0] * bx + m[2] * by + m[4] - footX);
                const ty = y + scaleY * (m[1] * bx + m[3] * by + m[5] - footY);
                batch.part(
                    material,
                    rect[0],
                    rect[1],
                    rect[2],
                    rect[3],
                    scaleX * m[0],
                    scaleY * m[1],
                    scaleX * m[2],
                    scaleY * m[3],
                    tx,
                    ty,
                );
                count++;
            }
            return count;
        }
        return { draw, drawGPU };
    }
    return Object.freeze({ create, attackImpact });
})();
