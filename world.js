(() => {
    const { CameraViewport, OrthographicProjection } = globalThis.NumoriGameKit;
    const W = 3000,
        H = 1800;
    const projection = new OrthographicProjection({ degrees: 48 });
    const K = projection.K;
    const ink = '#414333';
    const teams = [
        { deep: '#154d50', mid: '#267d77', light: '#82c7a1', flag: '#59e2ca', glow: '#c2ffeb' },
        { deep: '#833e45', mid: '#bc5e58', light: '#eea080', flag: '#ffad83', glow: '#ffe8c1' },
    ];
    const routeColors = {
        bridge: ['#16554c', '#84fff0'],
        supply: ['#713814', '#ffd16b'],
    };
    const routeTints = Object.fromEntries(
        Object.entries(routeColors).map(([route, colors]) => [
            route,
            colors.map((color) => [
                Number.parseInt(color.slice(1, 3), 16) / 255,
                Number.parseInt(color.slice(3, 5), 16) / 255,
                Number.parseInt(color.slice(5, 7), 16) / 255,
                1,
            ]),
        ]),
    );
    const classes = ['archer', 'shield', 'charger', 'spear', 'thrower'];
    function surface(w, h) {
        const c = document.createElement('canvas');
        c.width = Math.ceil(w);
        c.height = Math.ceil(h);
        return c;
    }
    function path(c, d, fill, stroke = null, width = 1) {
        const p = new Path2D(d);
        if (fill) {
            c.fillStyle = fill;
            c.fill(p);
        }
        if (stroke) {
            c.lineJoin = 'round';
            c.lineCap = 'round';
            c.strokeStyle = stroke;
            c.lineWidth = width;
            c.stroke(p);
        }
    }
    function oval(c, x, y, rx, ry, fill, stroke = null, width = 1) {
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        c.fillStyle = fill;
        c.fill();
        if (stroke) {
            c.lineWidth = width;
            c.strokeStyle = stroke;
            c.stroke();
        }
    }
    function rng(seed) {
        let n = seed >>> 0;
        return () => {
            n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
            return n / 4294967296;
        };
    }
    function bake(w, h, ox, oy, fn, density = 1.5) {
        const img = surface(w * density, h * density),
            c = img.getContext('2d');
        c.scale(density, density);
        c.translate(ox, oy);
        fn(c);
        return { img, w, h, ox, oy };
    }
    function blit(c, s, x, y, scale = 1) {
        const left = x - s.ox * scale,
            top = y - s.oy * scale;
        if (s.source)
            c.drawImage(
                s.img,
                s.source.x,
                s.source.y,
                s.source.w,
                s.source.h,
                left,
                top,
                s.w * scale,
                s.h * scale,
            );
        else c.drawImage(s.img, left, top, s.w * scale, s.h * scale);
    }
    // Props and landmarks share the same illustrated atlas. The anchor is the point on
    // the ground occupied by a building, regardless of transparent padding in its cell.
    let environmentArt;
    function environment() {
        const image = globalThis.NumoriEnvironmentImage;
        if (environmentArt?.image === image && environmentArt) return environmentArt;
        const cell = 256;
        if (
            !image ||
            (image.naturalWidth || image.width) !== 4 * cell ||
            (image.naturalHeight || image.height) !== 2 * cell
        ) {
            throw new Error('전장 그림을 불러오지 못했습니다.');
        }
        const probe = surface(4 * cell, 2 * cell);
        const context = probe.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
        const bounds = Array.from({ length: 8 }, (_, i) => {
            const sx = (i % 4) * cell,
                sy = Math.floor(i / 4) * cell;
            let left = cell,
                right = -1,
                top = cell,
                bottom = -1;
            for (let y = 0; y < cell; y++) {
                for (let x = 0; x < cell; x++) {
                    if (pixels[((sy + y) * probe.width + sx + x) * 4 + 3] <= 24) continue;
                    left = Math.min(left, x);
                    right = Math.max(right, x);
                    top = Math.min(top, y);
                    bottom = Math.max(bottom, y);
                }
            }
            if (right < left) throw new Error('비어 있는 전장 그림입니다.');
            return { x: sx + left, y: sy + top, w: right - left + 1, h: bottom - top + 1 };
        });
        environmentArt = { image, bounds, cache: new Map() };
        return environmentArt;
    }

    function prop(index, width, height, floor) {
        const art = environment();
        if (art.cache.has(index)) return art.cache.get(index);
        const source = art.bounds[index];
        const scale = Math.min(width / source.w, height / source.h);
        const w = source.w * scale,
            h = source.h * scale;
        const sprite = { img: art.image, w, h, ox: w / 2, oy: h * floor, source };
        art.cache.set(index, sprite);
        return sprite;
    }
    function baseArt(team) {
        return prop(team, 183, 178, 0.89);
    }
    const turretArt = () =>
        teams.map((team) =>
            bake(116, 111, 58, 95, (g) => {
                oval(g, 0, 1, 53, 12, '#47564142');
                path(g, 'M-47 -10l12 -12h68l15 10-4 16-79 3Z', '#a39970', ink, 2.8);
                path(g, 'M-47 -10h89l-5 12-72 5Z', '#c5b58a', ink, 2.4);
                path(g, 'M-34 -17l7 -40h51l8 40-14 10h-39Z', '#e9d5a6', ink, 3.1);
                path(g, 'M14 -56h10l8 39-14 10-5 -5Z', '#c5a876', ink, 2);
                path(g, 'M-31 -34h16m-15 10h5m14 -19h5m19 19h10', null, '#cead7b', 2);
                path(
                    g,
                    'M-40 -50l3 -24 13 2 3 9h8l1 -12h15l2 11h8l2 -10h15l7 21-10 10-48 1Z',
                    team.mid,
                    team.deep,
                    3.1,
                );
                path(
                    g,
                    'M-37 -74l13 2 3 9h8l1 -12h15l2 11h8l2 -10h15l5 13-9 6-51 1-12 -6Z',
                    team.light,
                    team.deep,
                    2,
                );
                path(g, 'M-11 -41h22l3 17-14 11-14 -11Z', team.deep, ink, 1.8);
                path(g, 'M-8 -39H9l2 14L0 -17l-11 -8Z', team.flag);
                path(g, 'M-5 -30l5 -6 5 6-5 6Z', team.deep);
                path(g, 'M-22 -58v-29', null, team.deep, 2.5);
                path(g, 'M-22 -88q10 -5 26 2l-7 4 7 5q-16 -3-26 1Z', team.flag, team.deep, 1.45);
            }),
        );
    function towerRubble() {
        return bake(116, 58, 58, 43, (g) => {
            oval(g, 0, 0, 53, 12, '#4756413a');
            path(g, 'M-47 -10l12 -12h68l15 10-4 16-79 3Z', '#bca783', ink, 2.2);
            path(
                g,
                'M-32 -12-29 -22-13 -29 1 -19-4 -10-17 -6Zm24 7 12 -13 13 1 3 10-13 5Zm28 -10 6 -14 13 6 3 11-8 4Z',
                '#d2b791',
                '#79694e',
                2.3,
            );
            path(g, 'M-33 -3l13 -3m25 -8 9 3m14 -12 5 4m-44 18 8 3', null, '#aa9066', 2.1);
        });
    }
    function mineArt(gas) {
        return prop(gas ? 3 : 2, 103, 79, 0.84);
    }
    const giantColors = [
        { deep: '#594c60', mid: '#9b829d', light: '#c5aac0', flag: '#f2ce86', glow: '#fff1b7' },
        ...teams,
    ];
    let giantArt;
    function giantSprites() {
        if (giantArt) return giantArt;
        giantArt = Object.fromEntries(
            ['bulwark', 'breaker', 'lobber'].map((kind) => [
                kind,
                giantColors.map((team) =>
                    bake(188, 155, 91, 145, (c) => {
                        const edge = '#473d36';
                        // Rounded stone plates and wide-set feet echo the little geometric troops.
                        path(
                            c,
                            'M-42 -17 -33 -27 -13 -25 -7 -11 -13 1 -48 1 -51 -6Z M9 -16 21 -28 44 -23 53 -9 49 2H15Z',
                            '#827369',
                            edge,
                            4,
                        );
                        path(
                            c,
                            'M-44 -10Q-30 -17 -13 -11 M15 -8Q31 -16 46 -10',
                            null,
                            '#b5a58e',
                            3,
                        );
                        path(
                            c,
                            'M-51 -81Q-42 -102 0 -104Q34 -104 52 -84L57 -46Q51 -18 27 -14L-23 -15Q-53 -21 -58 -48Z',
                            team.mid,
                            edge,
                            4.5,
                        );
                        path(c, 'M-50 -79Q-24 -108 10 -93Q-14 -62 -47 -62Z', team.light);
                        path(
                            c,
                            'M-34 -67Q-10 -70 18 -63L26 -33Q2 -23 -27 -33Z',
                            '#ceb895',
                            edge,
                            3.3,
                        );
                        path(c, 'M-34 -37L-16 -33 -7 -43 8 -37 25 -38', null, '#b3997d', 2.3);
                        oval(c, -40, -58, 13, 16, team.deep, edge, 3);
                        oval(c, -43, -63, 5, 7, team.flag);
                        if (kind === 'bulwark') {
                            path(
                                c,
                                'M-35 -91V-113L-24 -133 -3 -128 18 -134 31 -116 27 -89Z',
                                team.light,
                                edge,
                                4,
                            );
                            path(
                                c,
                                'M-24 -131 -6 -142 12 -132 11 -119 -8 -123 -20 -118Z',
                                team.mid,
                                edge,
                                3,
                            );
                            path(c, 'M-18 -110H19L21 -99 -15 -97Z', '#433d42', edge, 2);
                            oval(c, -7, -104, 3, 3.6, team.glow);
                            oval(c, 11, -104, 3, 3.6, team.glow);
                            path(
                                c,
                                'M9 -78 61 -88 78 -73 72 -28 51 -9 21 -23 8 -40Z',
                                team.deep,
                                edge,
                                4.6,
                            );
                            path(
                                c,
                                'M18 -71 60 -78 69 -69 63 -33 50 -18 29 -30 17 -43Z',
                                team.light,
                                team.deep,
                                2.6,
                            );
                            path(
                                c,
                                'M43 -63 55 -64 55 -54 63 -55 61 -44 54 -44 51 -33 40 -34 43 -44 32 -43 34 -54 43 -54Z',
                                team.flag,
                                team.deep,
                                2,
                            );
                        } else if (kind === 'breaker') {
                            path(
                                c,
                                'M-41 -103 -33 -121 -22 -113 -12 -120 19 -114 32 -96 19 -80 -31 -83Z',
                                team.light,
                                edge,
                                4,
                            );
                            path(c, 'M-28 -100 7 -104 19 -100 18 -89 -25 -90Z', '#423b3b', edge, 2);
                            oval(c, -12, -96, 3.7, 4, team.glow);
                            oval(c, 9, -97, 3.7, 4, team.glow);
                            path(c, 'M-42 -51 46 -53 59 -38 43 -21 -38 -28Z', '#b88961', edge, 4);
                            path(c, 'M-43 -49 18 -46 36 -56 M-28 -44 9 -40', null, '#e8bf8a', 3.7);
                            path(
                                c,
                                'M38 -57 64 -62 85 -53 90 -40 78 -23 50 -19 40 -29 49 -38 41 -43Z',
                                team.deep,
                                edge,
                                4,
                            );
                            path(
                                c,
                                'M59 -54 73 -57 84 -51 87 -41 77 -35 62 -33 54 -42Z',
                                team.light,
                                team.deep,
                                3,
                            );
                            path(c, 'M60 -50 74 -52 80 -48 M59 -29 74 -29', null, team.flag, 3);
                            oval(c, -16, -33, 12, 12, team.mid, edge, 3.8);
                        } else {
                            path(
                                c,
                                'M-32 -88 -35 -105 -24 -122 12 -124 32 -108 25 -89Z',
                                team.light,
                                edge,
                                4,
                            );
                            path(c, 'M-22 -104 18 -110 24 -99 -20 -93Z', '#413e40', edge, 2);
                            oval(c, -9, -101, 4, 4, team.glow);
                            oval(c, 11, -104, 4, 4, team.glow);
                            path(
                                c,
                                'M11 -65 51 -108 59 -102 35 -64 49 -16 40 -11 19 -50Z',
                                '#a47956',
                                edge,
                                4,
                            );
                            path(
                                c,
                                'M20 -58 48 -73 78 -111 84 -107 64 -68 36 -44Z',
                                '#d9a976',
                                edge,
                                4,
                            );
                            path(
                                c,
                                'M37 -99 33 -117 46 -129 63 -129 77 -119 76 -105 64 -95Z',
                                '#9f8a80',
                                edge,
                                4,
                            );
                            path(
                                c,
                                'M41 -118 47 -123 60 -124 67 -120 57 -116 50 -106 40 -110Z',
                                '#ebd4b1',
                            );
                            path(c, 'M46 -91Q56 -84 70 -92L79 -104', null, team.deep, 6);
                            path(c, 'M47 -91Q57 -85 70 -92L79 -104', null, team.flag, 2.7);
                            oval(c, 20, -52, 12, 12, team.mid, edge, 3.8);
                        }
                    }),
                ),
            ]),
        );
        return giantArt;
    }
    function meadow() {
        const terrain = surface(W, H * K);
        const ctx = terrain.getContext('2d');
        const random = rng(87031);
        ctx.fillStyle = '#c5dfa0';
        ctx.fillRect(0, 0, terrain.width, terrain.height);
        ctx.save();
        ctx.scale(1, K);

        // Rounded strips of sod give the outer orchards a visible edge without
        // confusing the player's walking surface with solid walls.
        function terrace(shape, face, top) {
            ctx.save();
            ctx.translate(0, 18);
            path(ctx, shape, face, '#8eaa76', 3);
            ctx.restore();
            path(ctx, shape, top, '#aac68c', 3);
        }
        terrace(
            'M-90 -40H3100V405Q2920 453 2750 382T2350 389Q2160 467 2010 393T1580 407Q1380 477 1160 386T775 395Q545 475 378 392T-90 417Z',
            '#89b08d',
            '#a4cba0',
        );
        terrace(
            'M-90 1870V1290Q140 1168 343 1304T745 1295Q921 1190 1092 1272T1510 1265Q1748 1180 1930 1290T2310 1302Q2485 1183 2688 1272T3100 1250V1870Z',
            '#a5bd7b',
            '#b1ce81',
        );
        function trail(shape, tiers) {
            for (const [size, color] of tiers) path(ctx, shape, null, color, size);
        }
        // The two crossings belong to a single river. Keep their banks aligned
        // with the simulation's approach and rally points at each end.
        const river =
            'M1450 -60 C1700 210 1350 485 1480 735 Q1520 850 1500 900 C1460 1005 1428 1078 1475 1170 Q1505 1220 1500 1290 C1460 1450 1290 1680 1410 1860';
        trail(river, [
            [175, '#98ae85'],
            [162, '#ead9a4'],
            [144, '#68a99d'],
            [133, '#87c9c0'],
        ]);
        ctx.setLineDash([32, 87, 11, 58]);
        path(ctx, river, null, '#b3e2d7', 4);
        ctx.setLineDash([]);
        const mainRoad = 'M-80 918 Q150 886 360 900 H2640 Q2860 886 3080 918';
        const arenaRoad =
            'M475 900 L925 1197 Q960 1220 999 1220 H2001 Q2040 1220 2075 1197 L2525 900';
        trail(arenaRoad, [
            [102, '#a89767'],
            [96, '#cfa56f'],
            [86, '#e8bd83'],
        ]);
        for (const offset of [-18, 18]) {
            ctx.save();
            ctx.translate(0, offset);
            ctx.setLineDash([31, 16]);
            path(ctx, arenaRoad, null, '#d5a76d', 3);
            ctx.setLineDash([]);
            ctx.restore();
        }
        trail(mainRoad, [
            [150, '#a6b584'],
            [143, '#d3c698'],
            [133, '#f5e7bb'],
        ]);
        // The upper bridge is rectangular. The lower crossing opens around the altar.
        path(
            ctx,
            'M1384 827 Q1500 810 1616 827 V973 Q1500 991 1384 973 Z',
            '#8c967e',
            '#5e7569',
            4,
        );
        path(ctx, 'M1384 821 Q1500 807 1616 821 V955 Q1500 972 1384 955Z', '#eadfba', '#9aa287', 3);
        for (let row = 0; row < 3; row++) {
            const y = 837 + row * 43;
            for (let x = 1394 + (row % 2) * 28; x < 1608; x += 49)
                path(ctx, `M${x} ${y}l-2 10m0 0h17`, null, '#d3c7a4', 2.5);
        }
        for (const y of [817, 966]) {
            path(ctx, `M1378 ${y}Q1500 ${y - 11} 1622 ${y}`, null, '#768b74', 7);
            for (const x of [1382, 1441, 1559, 1618]) {
                path(ctx, `M${x - 9} ${y + 4}v-14l9 -5 9 5v14l-9 4Z`, '#dac99c', '#75816a', 3);
                path(ctx, `M${x - 9} ${y - 10}l9 -5 9 5-9 5Z`, '#fff0c3', '#87947a', 1.6);
            }
        }
        path(
            ctx,
            'M1357 1178 1407 1118 1593 1118 1643 1178V1270L1593 1333H1407L1357 1270Z',
            '#897884',
            '#695965',
            5,
        );
        path(
            ctx,
            'M1357 1164 1407 1104 1593 1104 1643 1164V1255L1593 1318H1407L1357 1255Z',
            '#e4c6b4',
            '#937b85',
            4,
        );
        path(
            ctx,
            'M1375 1173 1418 1124 1582 1124 1625 1173V1251L1582 1299H1418L1375 1251Z',
            '#d6c2b3',
            '#ad9397',
            3,
        );
        oval(ctx, 1500, 1220, 102, 87, '#dfcdbd', '#bea2a1', 3);
        oval(ctx, 1500, 1220, 77, 69, '#d7c4b5', '#b9a1a0', 2.5);
        path(ctx, 'M1500 1153 1563 1220 1500 1287 1437 1220Z', null, '#bba2a1', 2.8);
        for (const [x, y] of [
            [1410, 1133],
            [1590, 1133],
            [1410, 1288],
            [1590, 1288],
        ]) {
            oval(ctx, x, y + 5, 16, 12, '#ac9498');
            path(ctx, `M${x - 11} ${y + 1}v-26l11 -7 11 7v26l-11 8Z`, '#bda5a1', '#8f777e', 2.7);
            path(ctx, `M${x - 11} ${y - 25}l11 -7 11 7-11 8Z`, '#f2d7b9', '#8f777e', 2.2);
            oval(ctx, x, y - 25, 4, 3, '#ba926e');
        }
        // River-bank reeds, floating leaves and the bridge flags break up the
        // large quiet areas without competing with moving troop silhouettes.
        for (const [x, y] of [
            [1442, 790],
            [1419, 1034],
            [1519, 1075],
            [1393, 1130],
            [1550, 1388],
        ]) {
            path(ctx, `M${x - 8} ${y}q2 -13 7 -20l-1 15 6 -21 0 20 8 -12 -4 16Z`, '#779961');
            oval(ctx, x + 17, y + 6, 7, 3.2, '#a3cfa4');
            oval(ctx, x + 9, y + 13, 4.4, 2.5, '#a8d3a7');
        }
        for (const x of [1382, 1618]) {
            path(ctx, `M${x} 817v-36`, null, '#776c4f', 3);
            path(ctx, `M${x} 780l23 4-5 7-18 -3Z`, '#60a59a', '#626f57', 1.8);
            oval(ctx, x, 778, 3, 3, '#ead193');
        }
        for (const [base, sign] of [
            [360, 1],
            [2640, -1],
        ]) {
            for (const [dx, dy] of [
                [-148, -110],
                [150, 110],
            ]) {
                const x = base + dx * sign,
                    y = 900 + dy;
                trail(`M${base} 900 Q${base + dx * 0.55 * sign} ${900 + dy * 0.18} ${x} ${y}`, [
                    [50, '#c9be92'],
                    [44, '#f3dfb4'],
                ]);
            }
            oval(ctx, base, 900, 111, 72, '#c7b48d');
            oval(ctx, base, 897, 108, 69, '#f4dfb5');
        }

        // Only a few soft cut-grass shapes/pebbles per patch; never a texture layer
        // over units. These low-contrast accents establish scale while panning.
        for (let i = 0; i < 340; i++) {
            const x = random() * W,
                y = random() * H;
            if (y < 510 || (y > 706 && y < 1342) || Math.abs(x - 1500) < 210) continue;
            ctx.save();
            ctx.translate(x, y);
            path(ctx, 'M-9 0q5 -2 7 -7q4 5 2 8q4 -4 8 -4q-1 5 -7 7Z', '#b4d18d');
            ctx.restore();
        }
        for (let i = 0; i < 160; i++) {
            const x = random() * W,
                y = 900 + (random() - 0.5) * 65;
            if (Math.abs(x - 1500) < 130) continue;
            const w = 1.3 + random() * 4.2;
            oval(ctx, x, y, w, 1.8, '#ddc59b');
        }
        ctx.restore();

        const trees = [prop(4, 82, 92, 0.94), prop(5, 62, 96, 0.94)];
        const boulder = prop(6, 46, 34, 0.88),
            flower = prop(7, 44, 33, 0.9);
        const objects = [];
        const put = (x, y, s, sprite) => objects.push({ x, y, s, sprite });
        function grove(x, y, type, size = 1) {
            const plan = [
                [-41, -6, 0.79],
                [7, -20, 0.94],
                [49, -2, 0.65],
                [-11, 15, 1.07],
                [27, 27, 0.51],
            ];
            const direction = random() < 0.5 ? -1 : 1;
            for (const [dx, dy, s] of plan) {
                if (s < 0.8 && random() < 0.36) continue;
                put(
                    x + direction * dx + (random() - 0.5) * 15,
                    y + dy + (random() - 0.5) * 14,
                    size * s,
                    s < 0.57 ? flower : trees[type],
                );
            }
            if (random() < 0.55) put(x - direction * 57, y + 22, 0.62, boulder);
        }
        const rimClear = (x, y) =>
            (y < 666 || y > 1390) &&
            Math.abs(x - 1500) > 240 &&
            ![360, 2640].some((h) => Math.abs(h - x) < 238 && Math.abs(y - 900) < 325) &&
            !(Math.abs(x - 1500) < 240 && Math.abs(y - 900) < 345);
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 14; col++) {
                const x = ((col + 0.48) * W) / 14 + (random() - 0.5) * 96,
                    y = ((row + 0.5) * H) / 8 + (random() - 0.5) * 78;
                if ((y > 218 && y < 526) || !rimClear(x, y) || random() < 0.22) continue;
                grove(x, y, (row + col) % 2, 0.65 + random() * 0.45);
            }
        }
        // Landmarks at the approach to each camp, away from the return tracks.
        for (const [base, dir] of [
            [360, 1],
            [2640, -1],
        ]) {
            grove(base - 191 * dir, 680, 0, 0.85);
            grove(base + 152 * dir, 685, 1, 0.73);
            grove(base - 218 * dir, 1099, 1, 0.64);
            grove(base + 200 * dir, 1137, 0, 0.8);
            for (const [dx, dy, sc] of [
                [-83, -147, 0.52],
                [-109, 119, 0.58],
                [65, -118, 0.52],
                [96, 149, 0.54],
            ])
                put(base + dx * dir, 900 + dy, sc, flower);
        }
        for (const [x, y, type] of [
            [1070, 604, 0],
            [1360, 572, 1],
            [1750, 1470, 0],
            [2150, 1448, 1],
        ])
            grove(x, y, type, 0.76);
        for (const [x, y] of [
            [1050, 765],
            [1135, 1064],
            [1333, 676],
            [1650, 685],
            [1690, 1152],
            [1958, 1028],
            [594, 806],
            [2415, 1007],
        ]) {
            put(x, y, 0.53, boulder);
            put(x + 16, y + 9, 0.48, flower);
        }
        for (const [x, y, type] of [
            [1230, 1057, 0],
            [1773, 1080, 1],
            [1305, 745, 1],
            [1720, 722, 0],
        ])
            grove(x, y, type, 0.58);
        for (const o of objects.sort((a, b) => a.y - b.y)) {
            ctx.globalAlpha = trees.includes(o.sprite) ? 0.81 : 0.87;
            blit(ctx, o.sprite, o.x, o.y * K, o.s);
        }
        ctx.globalAlpha = 1;
        return terrain;
    }

    const sheetRoles = ['shield', 'archer', 'spear', 'charger', 'thrower', 'worker'];
    const actorHeight = { shield: 48, archer: 41, spear: 54, charger: 38, thrower: 46, worker: 38 };
    const lodSamples = [
        ['still', 0],
        ['walk', 0],
        ['walk', 0.5],
        ['attack', 0.4],
        ['attack', 0.55],
        ['hurt', 0.15],
        ['brace', 0.5],
        ['dig', 0.55],
    ];
    // Uniform trim is painted into the part textures once. Its pixels inherit the
    // same pivots, protection from occlusion and shading as the underlying gear.
    const uniformBand = {
        shield: [44, -0.1],
        archer: [56, -0.14],
        spear: [43, -0.13],
        charger: [94, -0.12],
        thrower: [59, -0.16],
        worker: [68, -0.08],
    };
    const trimPalette = [
        { shadow: [14, 66, 80], light: [59, 181, 184] },
        { shadow: [127, 38, 30], light: [254, 152, 111] },
    ];
    function factionMaterials(source, data) {
        const materials = trimPalette.map(() => surface(source.width, source.height));
        for (let side = 0; side < materials.length; side++) {
            const c = materials[side].getContext('2d');
            c.drawImage(source, 0, 0);
            const pixels = c.getImageData(0, 0, source.width, source.height);
            const colors = pixels.data;
            for (const [type, parts] of Object.entries(data.roles)) {
                const [bandY, slope] = uniformBand[type];
                for (const part of parts) {
                    if (part.id !== 'body' && part.id !== 'weapon') continue;
                    // The bow release artwork has a clean underlying bowstring.
                    for (const rect of [part.rect, ...Object.values(part.variants ?? {})]) {
                        const [left, top, w, h] = rect;
                        for (let row = 0; row < h; row++)
                            for (let col = 0; col < w; col++) {
                                const i = ((top + row) * pixels.width + left + col) * 4;
                                if (colors[i + 3] < 24) continue;
                                const r = colors[i],
                                    g = colors[i + 1],
                                    b = colors[i + 2];
                                const tone = 0.25 * r + 0.58 * g + 0.17 * b;
                                if (tone < 51 || Math.min(r, g, b) > 206) continue;
                                const x = part.at[0] + col,
                                    y = part.at[1] + row;
                                let distance = Infinity;
                                if (part.id === 'body')
                                    distance = Math.abs(y - bandY - slope * (x - 96)) / 6.8;
                                else if (type === 'shield')
                                    distance = Math.abs(y - 125 + 0.15 * (x - 120)) / 18;
                                else if (type === 'archer') distance = Math.abs(y - 78) / 21;
                                else if (type === 'spear') distance = Math.abs(y - 25) / 21;
                                else if (type === 'charger') distance = Math.abs(y - 78) / 14;
                                if (distance >= 1) continue;
                                const gradient = clamp01((tone - 46) / 198);
                                const coverage = Math.min(1, (1 - distance) * 7);
                                const { shadow, light } = trimPalette[side];
                                for (let channel = 0; channel < 3; channel++) {
                                    const shaded =
                                        shadow[channel] +
                                        (light[channel] - shadow[channel]) * gradient;
                                    colors[i + channel] +=
                                        coverage * (shaded - colors[i + channel]);
                                }
                            }
                    }
                }
            }
            c.putImageData(pixels, 0, 0);
        }
        return materials;
    }
    const clamp01 = (value) => Math.max(0, Math.min(1, value));
    let cachedActorSheet = null;
    function actorSheets() {
        const source = globalThis.NumoriRigImage,
            data = globalThis.NumoriRigData;
        if (
            !source ||
            !data ||
            !globalThis.NumoriActorRig ||
            !(source.naturalWidth || source.width)
        )
            return null;
        if (cachedActorSheet?.source === source && cachedActorSheet.data === data)
            return cachedActorSheet;
        const scale = {};
        for (const type of sheetRoles) {
            const parts = data.roles[type];
            const x0 = Math.min(...parts.map((p) => p.at[0])),
                y0 = Math.min(...parts.map((p) => p.at[1]));
            const x1 = Math.max(...parts.map((p) => p.at[0] + p.rect[2]));
            scale[type] = Math.min(
                63 / Math.max(1, x1 - x0),
                actorHeight[type] / Math.max(1, data.foot[1] - y0),
            );
        }
        cachedActorSheet = {
            source,
            data,
            scale,
            materials: factionMaterials(source, data),
            rig: NumoriActorRig.create(data, source),
        };
        return cachedActorSheet;
    }
    // Near actors evaluate the rig directly. Only distant silhouettes use these shared LOD samples.
    function drawArt(c, art, type, side, clip, phase, facing, x, y, scale) {
        c.save();
        c.translate(x, y);
        c.scale(facing * scale, scale);
        oval(c, 1, 0.5, type === 'shield' || type === 'thrower' ? 18 : 13, 3.9, '#18382e36');
        c.scale(art.scale[type], art.scale[type]);
        c.translate(-art.data.foot[0], -art.data.foot[1]);
        art.rig.draw(c, type, clip, phase, art.materials[side]);
        c.restore();
    }
    function posedLibrary(art) {
        const width = 94,
            height = 76,
            ox = 46,
            oy = 63,
            density = 1.5;
        const tileW = width * density,
            tileH = height * density,
            // Keep all six roles' tinted LODs on one 2048px GameKit atlas page.
            columns = 12;
        const atlas = surface(
            columns * tileW,
            Math.ceil((sheetRoles.length * lodSamples.length * 2) / columns) * tileH,
        );
        const context = atlas.getContext('2d');
        const chars = {};
        let slot = 0;
        for (const type of sheetRoles) {
            chars[type] = [0, 1].map((side) =>
                lodSamples.map(([clip, phase]) => {
                    const x = (slot % columns) * tileW,
                        y = Math.floor(slot++ / columns) * tileH;
                    context.save();
                    context.beginPath();
                    context.rect(x, y, tileW, tileH);
                    context.clip();
                    context.translate(x + ox * density, y + oy * density);
                    context.scale(density, density);
                    drawArt(context, art, type, side, clip, phase, 1, 0, 0, 1);
                    context.restore();
                    const sprite = {
                        img: atlas,
                        w: width,
                        h: height,
                        ox,
                        oy,
                        source: { x, y, w: tileW, h: tileH },
                    };
                    return [sprite, sprite];
                }),
            );
        }
        return {
            chars,
            art,
            bases: [baseArt(0), baseArt(1)],
            mine: [mineArt(false), mineArt(true)],
        };
    }
    function creature(type, side, pose, face) {
        const t = teams[side];
        return bake(
            72,
            64,
            36,
            54,
            (c) => {
                c.scale(face, 1);
                const heavy = type === 'shield' || type === 'thrower';
                oval(c, 2, 0, heavy ? 16 : 11, heavy ? 4.1 : 3, '#304e4262');
                const walk = pose === 1 ? 1 : pose === 2 ? -1 : 0,
                    attack = pose === 3;
                oval(c, -5 - walk, 0, 4.6, 2.8, '#745941', ink, 1.35);
                oval(c, 5 + walk, -0.5, 4.7, 2.8, '#80674a', ink, 1.35);
                c.translate(attack ? (type === 'charger' ? 4 : 2) : 0, walk ? -1.9 : 0);
                if (type === 'shield') c.scale(1.04, 1.12);
                if (type === 'spear') c.scale(0.92, 1.13);
                if (type === 'charger') {
                    c.rotate(attack ? -0.21 : -0.12);
                    c.scale(1.04, 0.88);
                }
                if (type === 'archer') c.scale(0.9, 0.96);
                if (type === 'thrower') {
                    c.scale(1.08, 0.94);
                    path(c, 'M-9 -27 Q-26 -29 -25 -9 Q-20 -1 -11 -5Z', '#986651', ink, 2);
                    path(c, 'M-20 -23 -14 -15 -19 -6 M-24 -16 -14 -17', null, '#e3ac70', 1.7);
                }
                if (type === 'worker') {
                    path(c, 'M-8 -20 Q-22 -22 -17 -7 Q-13 -4 -8 -7Z', '#c1a265', ink, 1.5);
                    path(c, 'M-17 -17 -10 -15 M-18 -14 -10 -12', null, '#837651', 1.3);
                }
                if (type !== 'worker') {
                    path(
                        c,
                        'M-11 -16 Q-17 -17 -17 -9 L-21 -5 -13 -6 -16 0 -7 -4 -2 -12Z',
                        t.mid,
                        ink,
                        1.5,
                    );
                }
                const body = type === 'worker' ? '#f8e0a4' : side ? '#f9bd98' : '#f4e6b1';
                path(
                    c,
                    'M-13 -10 Q-14 -23 -5 -29 Q-2 -32 2 -31 Q14 -26 15 -15 Q18 -6 9 -3 Q-3 1 -11 -4 Q-14 -6 -13 -10Z',
                    body,
                    '#554a37',
                    2.15,
                );
                path(c, 'M-11 -14 Q-11 -22 -5 -25', null, '#fff4c9', 2.5);
                path(c, 'M-12 -10 Q0 -6 13 -11 L12 -5 Q4 1 -10 -3Z', t.mid, ink, 1.25);
                if (type === 'archer') {
                    // Draw the feathered hunting cap apart from the longbow.
                    path(
                        c,
                        'M-17 -24 Q-10 -31 -21 -39 Q-6 -39 0 -33 Q6 -31 12 -25 L16 -22 Q3 -24 -10 -19Z',
                        t.deep,
                        ink,
                        1.8,
                    );
                    path(c, 'M-8 -30 Q-14 -41 -19 -41 Q-21 -33 -11 -29Z', t.flag, ink, 1.2);
                    path(c, 'M-17 -24 Q-5 -30 12 -25', null, '#d9bd82', 1.8);
                    path(c, 'M-13 -8 -21 -23 -16 -26 -8 -11Z', '#ac8057', ink, 1.3);
                    path(c, 'M-19 -22 -22 -33 M-16 -23 -17 -33', null, '#e2d5a3', 1.8);
                } else if (type === 'thrower') {
                    path(
                        c,
                        'M-16 -23 Q-18 -31 -11 -34 Q-12 -38 -6 -40 Q1 -38 3 -34 Q11 -37 16 -30 L16 -24 Q-1 -19 -16 -23Z',
                        t.deep,
                        ink,
                        1.7,
                    );
                    path(c, 'M-14 -26 Q-2 -31 13 -26 M-8 -33 Q-3 -37 1 -34', null, t.light, 2.4);
                    oval(c, -11, -24, 2.1, 1.8, '#ffe2a2', ink, 1);
                } else if (type === 'worker') {
                    path(
                        c,
                        'M-13 -22 Q-10 -30 -3 -31 Q-8 -35 -6 -40 Q1 -39 3 -32 Q6 -41 16 -40 Q13 -32 5 -30 Q11 -28 13 -23 Q7 -25 3 -23 L-1 -26 -6 -23 -8 -25Z',
                        t.light,
                        ink,
                        1.6,
                    );
                    path(c, 'M3 -32 Q8 -36 13 -38', null, t.deep, 1.1);
                } else {
                    path(
                        c,
                        'M-14 -20 Q-15 -32 -4 -34 Q8 -36 13 -24 L16 -21 Q11 -17 3 -20 Q-8 -20 -14 -17Z',
                        t.mid,
                        ink,
                        1.8,
                    );
                    path(c, 'M-11 -24 Q-9 -31 -2 -32 L1 -31 Q-5 -28 -5 -22Z', t.light);
                    path(c, 'M-14 -21 Q-1 -26 13 -23', null, '#ebcc88', 1.9);
                    if (type === 'charger') {
                        path(c, 'M-10 -27 Q-19 -29 -18 -37 Q-14 -31 -8 -32Z', '#f3dfaf', ink, 1.4);
                        path(c, 'M7 -31 Q14 -34 15 -40 Q19 -30 11 -26Z', '#f9eac1', ink, 1.4);
                    } else if (type === 'spear') {
                        path(
                            c,
                            'M-1 -33 Q-10 -39 -3 -43 Q7 -44 10 -40 Q4 -41 3 -32Z',
                            '#edbb6a',
                            ink,
                            1.1,
                        );
                    }
                }
                oval(c, 2, -16, 1.6, 2.4, '#453d31');
                oval(c, 10, -16.6, 1.55, 2.25, '#453d31');
                oval(c, 0.5, -12, 1.8, 0.9, '#d9977f');
                path(c, 'M4 -12 Q6.5 -10 8 -12', null, '#77513c', 1);
                c.save();

                if (type === 'charger') {
                    path(c, 'M10 -12 28 -13 32 -10 26 -7 11 -5Z', '#ffedbc', ink, 1.8);
                    path(c, 'M4 -10 11 -11 13 -5 5 -4Z', t.deep, ink, 1.3);
                } else if (type === 'archer') {
                    const bowX = attack ? 0 : -4;
                    c.save();
                    c.translate(bowX, 0);
                    if (!attack) {
                        c.translate(12, -8);
                        c.rotate(-0.45);
                        c.scale(0.73, 0.78);
                        c.translate(-16, 10);
                    }
                    path(c, 'M18 -35 Q34 -17 18 -2', null, '#553e2c', 3.3);
                    path(c, 'M18 -35 Q29 -23 26 -17', null, '#f3cf87', 1.3);
                    const pull = attack ? 7 : 16;
                    path(c, `M18 -35 L${pull} -17 18 -2`, null, '#fff3ca', 1.6);
                    if (attack) {
                        path(c, 'M5 -17 29 -17', null, '#805d37', 1.8);
                        path(c, 'M23 -20 30 -17 23 -14Z', '#fff1b4', ink, 1);
                        oval(c, 9, -15, 3.6, 2.4, '#f6da9e', ink, 1.1);
                        oval(c, 23, -15, 3.4, 2.2, '#f6da9e', ink, 1.1);
                    }
                    c.restore();
                } else if (type === 'spear') {
                    if (attack) {
                        path(c, 'M-10 -10 29 -20', null, '#896347', 2.6);
                        path(c, 'M24 -22 37 -23 29 -17 25 -18Z', '#ebf6df', ink, 1.2);
                    } else {
                        path(c, 'M6 0 20 -40', null, '#896347', 2.6);
                        path(c, 'M17 -36 24 -49 24 -39 20 -33Z', '#e5f5df', ink, 1.4);
                        path(c, 'M17 -35 Q11 -32 9 -36 L12 -29Z', t.flag, ink, 0.8);
                    }
                } else if (type === 'shield') {
                    path(
                        c,
                        'M2 -23 16 -27 25 -21 24 -9 Q22 -2 13 2 L3 -5 -2 -13Z',
                        '#edc673',
                        ink,
                        2.1,
                    );
                    path(c, 'M3 -21 16 -24 23 -19 21 -9 Q20 -4 13 -1 L6 -6 2 -13Z', t.deep);
                    path(c, 'M4 -22 15 -23 20 -20 16 -14 14 -3 7 -7Z', t.mid);
                    path(c, 'M11 -17 15 -20 19 -17 15 -12Z', '#fff0a9', ink, 0.7);
                } else if (type === 'thrower') {
                    const ballY = attack ? -23 : -9;
                    path(c, `M4 -9 Q16 -13 17 ${ballY}`, null, '#714e37', 4);
                    oval(c, 19, ballY, 7, 6.7, '#747f78', ink, 1.8);
                    path(c, `M14 ${ballY - 2} l4 -3 4 2 -3 4Z`, '#bdc1a2');
                } else {
                    path(c, 'M9 -3 20 -19', null, '#866a45', 2.4);
                    path(c, 'M14 -21 Q22 -24 26 -14 L20 -18Z', '#c5d0ae', ink, 1.3);
                }
                if (type !== 'shield') oval(c, 10, -7, 3.1, 2.6, '#f6da9e', ink, 1.1);
                c.restore();
            },
            2,
        );
    }
    // Projectiles share small weapon-specific sprites. The projected arc tangent
    // aims both the tip and the wake on the ascent and the descent.
    let projectileSprites;
    function getProjectileArt() {
        return (projectileSprites ??= teams.map((team) => ({
            arrow: bake(36, 10, 29, 5, (c) => {
                path(c, 'M-28 0 -10 -1 -7 0 -10 1Z', team.flag + '90');
                path(c, 'M-14 -2 -8 0 -14 2 -12 0Z', team.flag, '#5a5243', 0.65);
                path(c, 'M-11 0 1 0', null, '#6a4830', 1.7);
                path(c, 'M-1 -2.2 5 0 -1 2.2Z', '#fff1be', '#725b47', 0.8);
            }),
            stone: bake(22, 14, 15, 7, (c) => {
                path(c, 'M-14 0 -4 -2 -1 0 -5 1Z', team.flag + '72');
                path(c, 'M-5 -1 -3 -4 1 -4.5 5 -2 5 1 2 4 -2 4 -5 2Z', '#8f8274', '#514a41', 1.15);
                path(c, 'M-3 -1 -2 -3 1 -3 2 -2Z', '#eadcc3');
            }),
            bolt: bake(53, 20, 43, 10, (c) => {
                path(c, 'M-40 0 -18 -5 -5 -4 -9 4 -21 4Z', team.flag + '80');
                path(c, 'M-26 0 -8 -6 1 -4 8 0 1 4 -8 6Z', team.flag, team.deep, 1.7);
                path(c, 'M-15 0 -5 -2 4 0 -5 2Z', '#fff8cd');
            }),
            mortar: bake(58, 34, 44, 17, (c) => {
                path(c, 'M-41 0 Q-20 -11 -9 -6 L-10 7 Q-23 9 -41 0Z', team.flag + '9e');
                path(c, 'M-28 0 -11 -6 -8 0 -12 5Z', '#ffde87');
                path(
                    c,
                    'M-9 -7 Q-2 -12 5 -9 Q12 -7 12 0 Q12 7 5 9 Q-3 12 -9 7Z',
                    '#ffbb59',
                    '#59362b',
                    2.3,
                );
                path(c, 'M-6 -5 Q-2 -9 5 -6 M-11 -4 L-12 2', null, '#fff6c9', 2.8);
                path(c, 'M0 -10 Q5 -4 5 7 L1 10 Q3 1 -3 -9Z', team.deep);
            }),
        })));
    }
    let library = null;
    let librarySource = null;
    function sprites() {
        const art = actorSheets();
        if (library && librarySource === art) return library;
        librarySource = art;
        if (art) {
            library = posedLibrary(art);
            return library;
        }
        const actors = [...classes, 'worker'];
        const atlas = surface(2304, actors.length * 128),
            painter = atlas.getContext('2d'),
            chars = {};
        let i = 0;
        for (const type of actors) {
            chars[type] = [];
            for (const side of [0, 1]) {
                chars[type][side] = [];
                for (let pose = 0; pose < 4; pose++) {
                    const row = (chars[type][side][pose] = []);
                    for (const face of [-1, 1]) {
                        const sprite = creature(type, side, pose, face),
                            w = sprite.img.width,
                            h = sprite.img.height;
                        const x = (i % 16) * w,
                            y = Math.floor(i++ / 16) * h;
                        painter.drawImage(sprite.img, x, y);
                        row[face > 0 ? 1 : 0] = { ...sprite, img: atlas, source: { x, y, w, h } };
                    }
                }
            }
        }
        // Crowd tiles are composed once. A single atlas submission can show a rank
        // of soldiers when most of their individual silhouettes overlap.
        const groups = surface(1920, 15 * 78),
            gc = groups.getContext('2d');
        const offsets = [
            [-12, -11],
            [9, -13],
            [-19, -4],
            [14, -5],
            [-5, 0],
            [6, 5],
        ];
        let slot = 0;
        for (const type of classes)
            for (const side of [0, 1])
                for (let pose = 0; pose < 4; pose++)
                    for (let facing = 0; facing < 2; facing++) {
                        const sp = chars[type][side][pose][facing];
                        sp.formations = [];
                        for (const count of [2, 4, 6]) {
                            const w = 96,
                                h = 78,
                                x = (slot % 20) * w,
                                y = Math.floor(slot++ / 20) * h;
                            for (let i = 0; i < count; i++) {
                                const [dx, dy] = count === 2 ? [i ? 8 : -8, i * 4 - 2] : offsets[i];
                                const actor =
                                    chars[type][side][pose === 3 && i % 2 === 0 ? 1 : pose][facing];
                                blit(gc, actor, x + 48 + dx, y + 58 + dy, 0.76);
                            }
                            sp.formations.push({
                                img: groups,
                                w,
                                h,
                                ox: 48,
                                oy: 58,
                                source: { x, y, w, h },
                            });
                        }
                    }
        library = { chars, bases: [baseArt(0), baseArt(1)], mine: [mineArt(false), mineArt(true)] };
        return library;
    }
    function portrait(canvas, type, side = 0) {
        const size = 72;
        canvas.width = size;
        canvas.height = size;
        const c = canvas.getContext('2d'),
            a = sprites();
        c.clearRect(0, 0, size, size);
        const sprite = a.chars[type]?.[side]?.[0]?.[1];
        if (sprite) blit(c, sprite, size * 0.5, size * 0.86, 1.04);
    }
    function giantPortrait(canvas, kind, side = -1) {
        canvas.width = canvas.height = 72;
        const sprite = giantSprites()[kind]?.[side + 1];
        if (sprite) blit(canvas.getContext('2d'), sprite, 36, 66, 0.4);
    }
    const labels = {
        home: '본진 보기',
        battle: '교전 지역 보기',
        overview: '전체 전장 보기',
        minus: '축소',
        plus: '확대',
    };
    const icons = {
        home: 'M3 10 12 3 21 10 M5 9v11h5v-6h4v6h5V9',
        battle: 'M4 3 19 18 M3 3l4 1-3 3z M14 18l4-4 M17 20l3-3 M20 3 14 9 M5 18l4-4 M20 3l-4 1 3 3z M6 20l-3-3',
        overview: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
        minus: 'M5 12h14',
        plus: 'M5 12h14 M12 5v14',
    };
    function mount(container, options = {}) {
        const localSide = options.localSide ?? 0;
        if (localSide !== 0 && localSide !== 1) throw new RangeError('localSide must be 0 or 1');
        const enemySide = 1 - localSide;
        const attackDirection = localSide === 0 ? 1 : -1;
        const relativeSide = (side) => (side === localSide ? 0 : 1);
        const teamColors = localSide === 0 ? teams : [teams[1], teams[0]];
        container.classList.add('nr-world');
        const field = document.createElement('canvas');
        field.className = 'nr-field';
        field.setAttribute('aria-label', '전장. 드래그로 이동, 휠 또는 핀치로 확대');
        field.tabIndex = 0;
        const mini = document.createElement('canvas');
        mini.className = 'nr-map';
        mini.setAttribute(
            'aria-label',
            '미니맵. 눌러서 이동하고 거인 제단을 눌러 제단을 확대합니다.',
        );
        mini.width = 240;
        mini.height = 144;
        const controls = document.createElement('div');
        controls.className = 'nr-camera';
        const terrainLayer = document.createElement('canvas');
        terrainLayer.className = 'nr-ground';
        terrainLayer.setAttribute('aria-hidden', 'true');
        const gpuLayer = document.createElement('canvas');
        gpuLayer.className = 'nr-gpu';
        gpuLayer.setAttribute('aria-hidden', 'true');
        const captureCard = document.createElement('div');
        captureCard.className = 'nr-capture-status';
        captureCard.hidden = true;
        captureCard.innerHTML =
            '<div class="nr-capture-heading"><strong class="nr-capture-label"></strong>' +
            '<b class="nr-capture-remaining"></b></div>' +
            '<div class="nr-capture-track" aria-hidden="true"><i></i></div>' +
            '<small class="nr-capture-count"></small>';
        const captureLabel = captureCard.querySelector('.nr-capture-label');
        const captureRemaining = captureCard.querySelector('.nr-capture-remaining');
        const captureCount = captureCard.querySelector('.nr-capture-count');
        container.append(terrainLayer, gpuLayer, field, mini, controls, captureCard);
        let device = null;
        let gpu = null;
        let fallbackReason = '';
        let renderStats = { backend: 'canvas2d', drawCalls: 0 };
        const preferCanvas =
            options.renderer === 'canvas2d' ||
            new URLSearchParams(location.search).get('renderer') === 'canvas2d';
        if (!preferCanvas) {
            try {
                device = NumoriGPU.create(gpuLayer);
            } catch (error) {
                fallbackReason = String(error?.message || error);
            }
        } else fallbackReason = 'canvas2d-requested';
        // World geometry and effects share the GPU surface. The upper 2D layer owns
        // camera input and small readable HUD elements (flags, cargo and captions).
        function selectRenderer() {
            const backend = gpu ? 'webgl2' : 'canvas2d';
            if (container.dataset.renderer !== backend) {
                container.dataset.renderer = backend;
                terrainDirty = true;
            }
        }
        const ground = terrainLayer.getContext('2d', { alpha: false });
        let terrainDirty = true;
        const formationCells = new Map();
        const combatFx = globalThis.NumoriCombatFx?.create(localSide);
        const projectileArt = getProjectileArt();
        const towersArt = turretArt(),
            ruinsArt = towerRubble(),
            towerFlash = bake(50, 50, 25, 25, (g) => {
                path(
                    g,
                    'M-22 0-8 -4-9 -13-3 -9 0 -21 4 -8 13 -13 9 -3 22 1 8 5 13 12 4 9 0 21-5 9-14 13-11 4Z',
                    '#fff3bc',
                    '#d48349',
                    2,
                );
                oval(g, 0, 0, 5, 4, '#fffcef');
            }),
            mortarFlash = bake(62, 60, 31, 47, (g) => {
                path(
                    g,
                    'M-26 3 -15 -7 -16 -18 -5 -14 0 -42 8 -19 18 -29 17 -13 27 -7 18 7 -11 8Z',
                    '#ffcd6b',
                    '#9c583b',
                    2.5,
                );
                path(g, 'M-12 4 -5 -12 2 -26 5 -9 13 -5 8 4Z', '#fff6c9');
            });
        const c = field.getContext('2d'),
            m = mini.getContext('2d'),
            camera = new CameraViewport({ projection }),
            terrain = meadow();
        let a = sprites();
        function gpuSprite(sprite, x, y, scale = 1, facing = 1, angle = 0, alpha = 1) {
            const image = sprite.img;
            const rect = sprite.source;
            const sourceW = rect?.w ?? (image.naturalWidth || image.width);
            const sourceH = rect?.h ?? (image.naturalHeight || image.height);
            const sin = Math.sin(angle),
                cos = Math.cos(angle);
            const sx = scale * facing,
                sy = scale;
            gpu.part(
                image,
                rect?.x ?? 0,
                rect?.y ?? 0,
                sourceW,
                sourceH,
                (cos * sx * sprite.w) / sourceW,
                (sin * sx * sprite.w) / sourceW,
                (-sin * sy * sprite.h) / sourceH,
                (cos * sy * sprite.h) / sourceH,
                x - sprite.ox * cos * sx + sprite.oy * sin * sy,
                y - sprite.ox * sin * sx - sprite.oy * cos * sy,
                alpha,
            );
        }
        const actorShadow = bake(48, 12, 24, 6, (context) => {
            oval(context, 1, 0.5, 17, 3.9, '#18382e36');
        });
        const softDot = bake(20, 20, 10, 10, (context) => oval(context, 0, 0, 9, 9, '#fff'));
        const linePixel = surface(4, 4);
        const fillPixel = linePixel.getContext('2d');
        fillPixel.fillStyle = '#fff';
        fillPixel.fillRect(0, 0, 4, 4);
        const aimTint = [
            [0.4, 0.66, 0.57, 0.66],
            [0.91, 0.61, 0.45, 0.5],
        ];
        const healthTint = [
            [0.35, 0.88, 0.79, 1],
            [1, 0.68, 0.51, 1],
        ];
        const healthTrack = [0.22, 0.29, 0.23, 1],
            dustTint = [0.99, 0.87, 0.62, 1];
        const hitTint = [1, 0.97, 0.74, 1];
        function gpuDot(x, y, rx, ry, color, alpha = 1) {
            gpu.image(
                softDot.img,
                0,
                0,
                softDot.img.width,
                softDot.img.height,
                x - rx,
                y - ry,
                rx * 2,
                ry * 2,
                alpha,
                color,
            );
        }
        function gpuLine(x, y, dx, dy, thickness, color) {
            const length = Math.hypot(dx, dy);
            if (length < 0.001) return;
            const nx = (-dy / length) * thickness,
                ny = (dx / length) * thickness;
            gpu.part(linePixel, 1, 1, 1, 1, dx, dy, nx, ny, x - nx / 2, y - ny / 2, 1, color);
        }
        function drawRouteCue(left, right, top, bottom) {
            const cue = scene.routeCue;
            const points = cue && Battle.routes[cue.route];
            if (!points) return;
            const colors = routeColors[cue.route];
            const tints = routeTints[cue.route];
            const dashed = cue.state === 'selected';
            const scale = 1 / zoom;
            const dash = 13 * scale;
            const interval = 22 * scale;
            const arrowInterval = 86 * scale;

            function stroke(x, y, dx, dy, band, width) {
                if (gpu) {
                    gpuLine(x, y, dx, dy, width * scale, tints[band]);
                    return;
                }
                c.beginPath();
                c.moveTo(x, y);
                c.lineTo(x + dx, y + dy);
                c.lineWidth = width * scale;
                c.strokeStyle = colors[band];
                c.stroke();
            }

            if (!gpu) {
                c.save();
                c.lineCap = 'butt';
            }
            for (let i = 1; i < points.length; i++) {
                const from = points[i - 1];
                const to = points[i];
                const y = from.y * K;
                const endY = to.y * K;
                if (
                    from.x > right ||
                    to.x < left ||
                    Math.min(y, endY) > bottom ||
                    Math.max(y, endY) < top
                )
                    continue;
                const dx = to.x - from.x;
                const dy = endY - y;
                const length = Math.hypot(dx, dy);
                const ux = dx / length;
                const uy = dy / length;
                const start = Math.max(0, (left - from.x) / ux);
                const end = Math.min(length, (right - from.x) / ux);
                for (let band = 0; band <= 1; band++) {
                    const width = band === 0 ? 6 : 3;
                    const stride = dashed ? interval : length;
                    const mark = dashed ? dash : length;
                    for (let d = Math.floor(start / stride) * stride; d < end; d += stride) {
                        const size = Math.min(mark, length - d);
                        stroke(from.x + ux * d, y + uy * d, ux * size, uy * size, band, width);
                    }
                    for (
                        let d = (Math.floor(start / arrowInterval) + 0.5) * arrowInterval;
                        d < Math.min(end, length - 12 * scale);
                        d += arrowInterval
                    ) {
                        const tipX = from.x + ux * d;
                        const tipY = y + uy * d;
                        const backX = ux * attackDirection * 11 * scale;
                        const backY = uy * attackDirection * 11 * scale;
                        const crossX = -uy * 7 * scale;
                        const crossY = ux * 7 * scale;
                        stroke(tipX, tipY, -backX + crossX, -backY + crossY, band, width);
                        stroke(tipX, tipY, -backX - crossX, -backY - crossY, band, width);
                    }
                }
            }
            if (!gpu) c.restore();
        }
        const giantRadius = Battle.settings.captureRadius;
        const captureZone = bake(
            giantRadius * 2 + 10,
            giantRadius * K * 2 + 10,
            giantRadius + 5,
            giantRadius * K + 5,
            (g) => {
                g.setLineDash([7, 9]);
                oval(g, 0, 0, giantRadius, giantRadius * K, '#fff7cd28', '#8f7083', 2.8);
            },
        );
        const launchCircles = [0, 1].map((side) =>
            [false, true].map((bonus) =>
                bake(200, 110, 100, 55, (context) => {
                    oval(
                        context,
                        0,
                        0,
                        96,
                        51,
                        bonus ? '#fff4b52a' : teams[side].flag + '2a',
                        teams[side].deep,
                        3,
                    );
                    oval(
                        context,
                        0,
                        0,
                        96,
                        51,
                        'transparent',
                        bonus ? '#ffdf78' : teams[side].glow,
                        1.8,
                    );
                    if (bonus) oval(context, 0, 0, 76, 40, 'transparent', teams[side].glow, 1.6);
                }),
            ),
        );
        const terrainTileSize = 1000;
        function drawTerrainTiles() {
            // The static map is larger than a mobile atlas page. Fixed source tiles
            // are reused across camera pans/zooms; no scrolling viewport is uploaded.
            const tile = terrainTileSize;
            const left = Math.max(0, cx - viewW / (2 * zoom));
            const top = Math.max(0, cy * K - viewH / (2 * zoom));
            const right = Math.min(terrain.width, cx + viewW / (2 * zoom));
            const bottom = Math.min(terrain.height, cy * K + viewH / (2 * zoom));
            for (let y = Math.floor(top / tile) * tile; y < bottom; y += tile) {
                for (let x = Math.floor(left / tile) * tile; x < right; x += tile) {
                    const w = Math.min(tile, terrain.width - x),
                        h = Math.min(tile, terrain.height - y);
                    gpu.image(terrain, x, y, w, h, x, y, w, h);
                }
            }
        }
        function prewarmTextures(backend) {
            // Largest immutable regions first to avoid fragmenting mobile atlas banks.
            for (let y = 0; y < terrain.height; y += terrainTileSize) {
                for (let x = 0; x < terrain.width; x += terrainTileSize) {
                    backend.register(
                        terrain,
                        x,
                        y,
                        Math.min(terrain.width - x, terrainTileSize),
                        Math.min(terrain.height - y, terrainTileSize),
                    );
                }
            }
            if (a.art) {
                a.art.materials.forEach((material) => backend.register(material));
                backend.register(a.chars.archer[0][0][0].img);
            }
            backend.register(a.bases[0].img);
            combatFx?.prewarm(backend);
            backend.register(linePixel);
            for (const sprite of [
                actorShadow,
                softDot,
                ...Object.values(giantSprites()).flat(),
                ...towersArt,
                ruinsArt,
                towerFlash,
                mortarFlash,
                captureZone,
                ...launchCircles.flat(),
                ...projectileArt.flatMap((side) => Object.values(side)),
            ])
                backend.register(sprite.img);
        }
        if (device) {
            try {
                prewarmTextures(device);
            } catch (error) {
                fallbackReason = String(error?.message || error);
                console.warn('Numori WebGL atlas:', fallbackReason);
                device.dispose();
                device = null;
            }
        }
        const miniTerrain = surface(mini.width, mini.height);
        miniTerrain.getContext('2d').drawImage(terrain, 0, 0, mini.width, mini.height);
        const pointers = new Map(),
            keys = new Set(),
            reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'),
            signals = new AbortController(),
            on = { signal: signals.signal };
        let scene = {},
            miniAt = -1,
            seenSize = '',
            mode = 'routes',
            clock = 0;
        let cx = localSide === 0 ? 410 : W - 410,
            cy = 900,
            zoom = 1,
            viewW = 1,
            viewH = 1,
            dpr = 1;
        const clamp = (x, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, x)));
        function fit() {
            return Math.min(viewW / W, viewH / (H * K));
        }
        const framing = { x: cx, y: cy, zoom, width: 1, height: 1 };
        const siegeState = [
            { hp: null, last: -10 },
            { hp: null, last: -10 },
        ];
        let tracked = null,
            trackedUnit = null,
            nextScan = -1;
        function homeZoom() {
            return Math.min(1.45, viewW / 430, Math.max(0.43, (viewH - 48) / 282));
        }
        function fightZoom(siege = false) {
            return Math.min(
                siege ? 1.45 : 1.72,
                viewW / (siege ? 310 : 270),
                Math.max(0.72, (viewH - 33) / (siege ? 224 : 147)),
            );
        }
        function setMode(next) {
            mode = next;
            for (const btn of controls.children) {
                if (['home', 'overview', 'battle'].includes(btn.dataset.camera))
                    btn.setAttribute('aria-pressed', String(btn.dataset.camera === mode));
            }
        }
        function constrain(resizing = false) {
            const minimum = mode === 'overview' ? fit() : Math.max(viewW / W, viewH / (H * K));
            zoom = clamp(zoom, minimum, 2.8);
            cx = clamp(cx, viewW / (zoom * 2), W - viewW / (zoom * 2));
            cy = clamp(cy, viewH / (zoom * 2 * K), H - viewH / (zoom * 2 * K));
            if (!resizing)
                Object.assign(framing, { x: cx, y: cy, zoom, width: viewW, height: viewH });
            camera.setCamera({ x: cx, y: cy * K, zoom });
            miniAt = -1;
            terrainDirty = true;
        }
        function frameHome() {
            const base = scene.battle?.bases?.[localSide] ?? {
                x: localSide === 0 ? 360 : W - 360,
                y: 900,
            };
            zoom = homeZoom();
            cx = base.x + attackDirection * 16;
            // Fit the pennant and both supply mines above the mobile control rail.
            cy = base.y + (-43 + Math.min(21, viewH * 0.08) / zoom) / K;
        }
        function battleSubject() {
            const b = scene.battle;
            if (!b) return { x: 1500, y: 900 };
            const collapse = b.effects.findLast(
                (effect) =>
                    effect.kind === 'towerDestroy' &&
                    effect.age < 0.78 &&
                    Math.abs(effect.x - cx) * zoom < viewW * 0.44 &&
                    Math.abs(effect.y - cy) * K * zoom < viewH * 0.42,
            );
            if (collapse) return { x: collapse.x, y: collapse.y, siege: true };
            let clash = null,
                siege = null,
                advance = null,
                enemy = null,
                clashScore = Infinity,
                siegeScore = Infinity;
            for (const u of b.units) {
                if (u.hp <= 0) continue;
                if (u.side === localSide && (!advance || (u.x - advance.x) * attackDirection > 0))
                    advance = u;
                if (u.side === enemySide && (!enemy || (u.x - enemy.x) * attackDirection < 0))
                    enemy = u;
                const target = u.target,
                    structure = u.structureTarget;
                if (!target && structure?.hp > 0 && !u.moving) {
                    const dist = Math.hypot(u.x - structure.x, u.y - structure.y);
                    if (dist < (u.spec?.range ?? 0) + 110) {
                        const rank =
                            (u.side === enemySide ? 0 : 1000) +
                            dist -
                            (trackedUnit === u ? 240 : 0);
                        if (rank < siegeScore) {
                            siege = { u, structure };
                            siegeScore = rank;
                        }
                    }
                }
                if (!target || target.hp <= 0 || target.isBase) continue;
                const dist = Math.hypot(u.x - target.x, u.y - target.y);
                if (dist > (u.spec?.range ?? 0) + 75) continue;
                const rank =
                    (u.moving ? 220 : 0) +
                    (u.side === enemySide ? 35 : 0) +
                    Math.hypot(u.x - (tracked?.x ?? 1500), u.y - (tracked?.y ?? 900)) * 0.28 -
                    (trackedUnit === u ? 440 : 0);
                if (rank < clashScore) {
                    clash = { u, target };
                    clashScore = rank;
                }
            }
            if (siege) {
                trackedUnit = siege.u;
                return {
                    x: siege.structure.x * 0.56 + siege.u.x * 0.44,
                    y: siege.structure.y * 0.64 + siege.u.y * 0.36,
                    siege: true,
                };
            }
            if (clash) {
                trackedUnit = clash.u;
                return { x: (clash.u.x + clash.target.x) / 2, y: (clash.u.y + clash.target.y) / 2 };
            }
            // Keep the same marching animal while it stays close to its army's front.
            const front = advance ?? enemy;
            if (front) {
                const u =
                    trackedUnit?.hp > 0 &&
                    trackedUnit.side === front.side &&
                    Math.abs(trackedUnit.x - front.x) < 105
                        ? trackedUnit
                        : front;
                trackedUnit = u;
                return { x: u.x + (u.side ? -1 : 1) * 28, y: u.y };
            }
            trackedUnit = null;
            const mine = b.mines?.find((m) => m.claimant >= 0) ?? b.mines?.[0];
            return mine ? { x: mine.x, y: mine.y } : { x: 1500, y: 900 };
        }
        function frameBattle(snap = false, dt = 0) {
            if (snap || !tracked || clock >= nextScan) {
                tracked = battleSubject();
                nextScan = clock + 0.24;
            }
            const desiredZoom = fightZoom(tracked.siege);
            const desiredY =
                tracked.y +
                ((tracked.siege ? -50 : -17) + Math.min(18, viewH * 0.07) / desiredZoom) / K;
            if (snap) {
                cx = tracked.x;
                cy = desiredY;
                zoom = desiredZoom;
                return;
            }
            const deltaX = tracked.x - cx,
                deltaY = desiredY - cy;
            const outside =
                Math.abs(deltaX) * zoom > Math.min(32, viewW * 0.1) ||
                Math.abs(deltaY) * K * zoom > Math.min(24, viewH * 0.11);
            if (!outside && Math.abs(zoom - desiredZoom) < 0.015) return;
            const alpha = 1 - Math.exp(-Math.max(0, dt) * 4.8);
            cx += deltaX * alpha;
            cy += deltaY * alpha;
            zoom += (desiredZoom - zoom) * alpha;
            constrain();
        }
        let openingViewAvailable = true;
        let convoyUnit = null;
        let captureRailClearance = 46;
        function frameConvoy(snap, dt) {
            const battle = scene.battle;
            if (!convoyUnit || !battle) return;
            const { route, born } = convoyUnit;
            const destination = route === 'supply' ? battle.station : Battle.routes.bridge[1];
            if (convoyUnit.hp <= 0) {
                convoyUnit = battle.units.findLast(
                    (u) =>
                        u.side === localSide &&
                        u.route === route &&
                        u.born === born &&
                        !u.giantKind &&
                        u.hp > 0,
                );
            }
            if (
                !convoyUnit ||
                Math.hypot(convoyUnit.x - destination.x, convoyUnit.y - destination.y) < 140
            ) {
                navigate(route === 'supply' ? 'supply' : 'battle');
                return;
            }
            const destinationX = convoyUnit.x + attackDirection * 52;
            const destinationY = convoyUnit.y + 10;
            const nextZoom = Math.min(1.38, viewW / 330, Math.max(0.54, (viewH - 53) / (216 * K)));
            const alpha = snap ? 1 : 1 - Math.exp(-Math.max(0, dt) * 5);
            cx += (destinationX - cx) * alpha;
            cy += (destinationY - cy) * alpha;
            zoom += (nextZoom - zoom) * alpha;
            constrain();
        }
        function frameRoutes(name) {
            cx = W / 2;
            if (name === 'routes') {
                cx -= attackDirection * 273;
                cy = 1074;
                zoom = Math.min(1.22, viewW / 860, Math.max(0.26, (viewH - 86) / (565 * K)));
            } else if (name === 'route-cue') {
                cy = 1040;
                zoom = Math.min(0.98, viewW / 590, Math.max(0.28, (viewH - 92) / (470 * K)));
            } else if (name === 'supply') {
                if (viewH > 295) {
                    cy = 1080;
                    zoom = Math.min(1.24, viewW / 330, (viewH - 95) / (525 * K));
                } else {
                    // Keep the touch controls, capture card, and giant in three separate rows.
                    const groundY = Math.min(viewH * 0.76, viewH - 66);
                    zoom = Math.min(1.22, viewW / 325, Math.max(0.27, (groundY - 118) / 151));
                    cy = 1220 - (groundY - viewH / 2) / (zoom * K);
                }
            } else {
                cy = 1040;
                zoom = Math.min(viewW / 2630, (viewH - 60) / (910 * K));
            }
        }
        function navigate(name) {
            openingViewAvailable = false;
            if (name === 'home') {
                setMode(name);
                frameHome();
            }
            if (name === 'battle') {
                setMode(name);
                frameBattle(true);
            }
            if (name === 'overview' || name === 'supply' || name === 'route-cue') {
                setMode(name);
                frameRoutes(name);
            }
            if (name === 'plus' || name === 'minus') setZoom(name === 'plus' ? 1.28 : 1 / 1.28);
            constrain();
            options.onNavigate?.(name);
        }
        for (const name of ['home', 'battle', 'overview', 'minus', 'plus']) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.title = labels[name];
            btn.setAttribute('aria-label', labels[name]);
            btn.dataset.camera = name;
            btn.innerHTML =
                '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="' + icons[name] + '"/></svg>';
            controls.append(btn);
            btn.addEventListener('click', () => navigate(name), on);
        }
        function size() {
            const w = Math.max(1, field.clientWidth),
                h = Math.max(1, field.clientHeight),
                d = Math.min(devicePixelRatio || 1, 2);
            if (seenSize === [w, h, d].join('/')) return;
            const initial = viewW === 1 && viewH === 1;
            viewW = w;
            viewH = h;
            dpr = d;
            seenSize = [w, h, d].join('/');
            camera.setViewport({ width: w, height: h, dpr: d }).resizeCanvas(field);
            container.dataset.shortField = String(h <= 235);
            container.dataset.miniField = String(h < 170);
            captureRailClearance = Math.max(46, h - mini.offsetTop + 4, h - controls.offsetTop + 4);
            if (mode === 'home') frameHome();
            else if (mode === 'battle') frameBattle(true);
            else if (
                mode === 'overview' ||
                mode === 'supply' ||
                mode === 'routes' ||
                mode === 'route-cue'
            )
                frameRoutes(mode);
            else {
                cx = framing.x;
                cy = framing.y;
                zoom = framing.zoom * Math.sqrt((w * h) / (framing.width * framing.height));
            }
            constrain(!initial);
        }
        function setZoom(mult, x = viewW * 0.5, y = viewH * 0.5) {
            const prev = zoom;
            zoom = clamp(zoom * mult, fit(), 2.8);
            cx += (x - viewW * 0.5) * (1 / prev - 1 / zoom);
            cy += ((y - viewH * 0.5) * (1 / prev - 1 / zoom)) / K;
            setMode('manual');
            constrain();
        }
        function fieldPoint(e) {
            const r = field.getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }
        const pair = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        let stationTap = null;
        field.addEventListener(
            'pointerdown',
            (e) => {
                if (e.button !== 0) return;
                field.focus({ preventScroll: true });
                const point = fieldPoint(e);
                stationTap = pointers.size === 0 ? point : null;
                pointers.set(e.pointerId, point);
                field.setPointerCapture(e.pointerId);
            },
            on,
        );
        field.addEventListener(
            'pointermove',
            (e) => {
                const old = pointers.get(e.pointerId);
                if (!old) return;
                const next = fieldPoint(e),
                    other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
                if (stationTap && pair(stationTap, next) > 5) stationTap = null;
                if (other) {
                    const d = pair(old, other);
                    if (d > 4)
                        setZoom(
                            pair(next, other) / d,
                            (next.x + other.x) * 0.5,
                            (next.y + other.y) * 0.5,
                        );
                }
                cx -= ((next.x - old.x) / zoom) * (other ? 0.5 : 1);
                cy -= ((next.y - old.y) / (zoom * K)) * (other ? 0.5 : 1);
                setMode('manual');
                pointers.set(e.pointerId, next);
                constrain();
            },
            on,
        );
        field.addEventListener(
            'pointerup',
            (e) => {
                const pt = fieldPoint(e),
                    st = scene.battle?.station;
                if (stationTap && pair(stationTap, pt) <= 5 && st) {
                    const x = cx + (pt.x - viewW / 2) / zoom;
                    const y = cy * K + (pt.y - viewH / 2) / zoom;
                    const nearAltar = Math.abs(x - st.x) < 87 && Math.abs(y - st.y * K) < 54;
                    const onGiant =
                        st.giantKind &&
                        Math.abs(x - st.x) < 65 &&
                        y > st.y * K - 144 &&
                        y < st.y * K;
                    if (nearAltar || onGiant) navigate('supply');
                }
                stationTap = null;
            },
            on,
        );
        field.addEventListener('lostpointercapture', (e) => pointers.delete(e.pointerId), on);
        field.addEventListener(
            'wheel',
            (e) => {
                e.preventDefault();
                const p = fieldPoint(e);
                setZoom(Math.exp(-clamp(e.deltaY, -180, 180) * 0.0025), p.x, p.y);
            },
            { ...on, passive: false },
        );
        const panKeys = new Set([
            'a',
            'd',
            'w',
            's',
            'arrowleft',
            'arrowright',
            'arrowup',
            'arrowdown',
        ]);
        window.addEventListener(
            'keydown',
            (e) => {
                if (
                    e.altKey ||
                    e.metaKey ||
                    e.ctrlKey ||
                    e.target.closest?.(
                        'input,textarea,select,[contenteditable="true"],dialog[open]',
                    ) ||
                    !field.getClientRects().length
                )
                    return;
                const k = e.key.toLowerCase();
                if (!panKeys.has(k)) return;
                if (k.startsWith('arrow') && e.target !== field && e.target !== document.body)
                    return;
                keys.add(k);
                e.preventDefault();
            },
            on,
        );
        window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()), on);
        window.addEventListener('blur', () => keys.clear(), on);
        function moveMini(e) {
            const r = mini.getBoundingClientRect();
            cx = ((e.clientX - r.left) / r.width) * W;
            cy = ((e.clientY - r.top) / r.height) * H;
            if (mode === 'overview') zoom = fightZoom();
            setMode('manual');
            constrain();
        }
        let miniTap = null;
        mini.addEventListener(
            'pointerdown',
            (e) => {
                miniTap = { x: e.clientX, y: e.clientY };
                mini.setPointerCapture(e.pointerId);
                moveMini(e);
            },
            on,
        );
        mini.addEventListener(
            'pointermove',
            (e) => {
                if (!mini.hasPointerCapture(e.pointerId)) return;
                if (miniTap && Math.hypot(e.clientX - miniTap.x, e.clientY - miniTap.y) > 5)
                    miniTap = null;
                moveMini(e);
            },
            on,
        );
        mini.addEventListener(
            'pointerup',
            (e) => {
                const st = scene.battle?.station;
                if (st && miniTap) {
                    const r = mini.getBoundingClientRect();
                    const dx = e.clientX - r.left - (st.x / W) * r.width;
                    const dy = e.clientY - r.top - (st.y / H) * r.height;
                    if (Math.abs(dx) < 8 && Math.abs(dy) < Math.min(9, r.height * 0.085)) {
                        navigate('supply');
                    }
                }
                miniTap = null;
            },
            on,
        );
        function structures() {
            const b = scene.battle,
                e = scene.economy,
                base = b?.bases ?? [
                    { x: 360, y: 900 },
                    { x: 2640, y: 900 },
                ];
            const mines = [];
            for (let side = 0; side < 2; side++) {
                const dir = side === 0 ? 1 : -1,
                    home = base[side],
                    resources = e?.mines?.[side];
                mines.push({
                    ...resources?.mineral,
                    x: resources?.mineral?.x ?? home.x - dir * 148,
                    y: resources?.mineral?.y ?? 790,
                    kind: 'mineral',
                    owner: side,
                });
                mines.push({
                    ...resources?.gas,
                    x: resources?.gas?.x ?? home.x + dir * 150,
                    y: resources?.gas?.y ?? 1010,
                    kind: 'gas',
                    owner: side,
                });
            }
            const towers = b?.towers?.flatMap((lanes) => [lanes.bridge, lanes.supply]) ?? [];
            return { base, mines, towers, station: b?.station };
        }
        function drawMini(b, s) {
            const mx = mini.width / W,
                my = mini.height / H;
            m.drawImage(miniTerrain, 0, 0);
            m.fillStyle = '#193a2824';
            m.fillRect(0, 0, mini.width, mini.height);
            const routes = globalThis.Battle.routes;
            if (routes) {
                m.save();
                m.scale(mx, my);
                for (const [key, tint] of [
                    ['supply', '#b87a30'],
                    ['bridge', '#f9f0ce'],
                ]) {
                    const points = routes[key];
                    const line = new Path2D();
                    points.forEach(({ x, y }, i) => (i ? line.lineTo(x, y) : line.moveTo(x, y)));
                    m.lineCap = 'round';
                    m.lineJoin = 'round';
                    m.lineWidth = 61;
                    m.strokeStyle = '#596747';
                    m.stroke(line);
                    m.lineWidth = 37;
                    m.strokeStyle = tint;
                    m.stroke(line);
                }
                m.restore();
            }
            const cue = scene.routeCue;
            if (cue && routes?.[cue.route]) {
                const points = routes[cue.route];
                const colors = routeColors[cue.route];
                m.save();
                m.beginPath();
                points.forEach(({ x, y }, i) =>
                    i ? m.lineTo(x * mx, y * my) : m.moveTo(x * mx, y * my),
                );
                m.lineJoin = 'round';
                m.lineCap = 'round';
                if (cue.state === 'selected') m.setLineDash([10, 7]);
                m.lineWidth = 13;
                m.strokeStyle = colors[0];
                m.stroke();
                m.lineWidth = 8;
                m.strokeStyle = colors[1];
                m.stroke();
                m.restore();
            }
            for (let side = 0; side < 2; side++) {
                m.fillStyle = teamColors[side].deep;
                const occupied = new Set();
                m.beginPath();
                for (const u of b?.units ?? []) {
                    if (u.side !== side) continue;
                    const px = Math.floor(u.x * mx * 0.5),
                        py = Math.floor(u.y * my * 0.5),
                        key = py * mini.width + px;
                    if (occupied.has(key)) continue;
                    occupied.add(key);
                    m.rect(px * 2 - 1, py * 2 - 1, 2.5, 2.5);
                }
                m.fill();
                const x = s.base[side].x * mx,
                    y = s.base[side].y * my;
                m.fillStyle = teamColors[side].flag;
                m.fillRect(x - 4, y - 4, 8, 8);
                m.strokeStyle = '#384e3d';
                m.lineWidth = 1.3;
                m.strokeRect(x - 4, y - 4, 8, 8);
                if (b?.threat?.[side]) {
                    m.strokeStyle = '#c24c46';
                    m.lineWidth = 2;
                    m.beginPath();
                    m.arc(x, y, 7 + Math.sin(clock * 8), 0, Math.PI * 2);
                    m.stroke();
                }
            }
            for (const tower of s.towers) {
                m.save();
                m.translate(tower.x * mx, tower.y * my);
                if (tower.hp > 0) {
                    path(
                        m,
                        'M0 -6 5 0 0 6 -5 0Z',
                        teamColors[tower.side].flag,
                        teamColors[tower.side].deep,
                        1.6,
                    );
                } else {
                    path(m, 'M-3 -3 3 3 M3 -3 -3 3', null, '#615548', 1.7);
                }
                m.restore();
            }
            if (s.station) {
                const x = s.station.x * mx,
                    y = s.station.y * my;
                // The wide bridge and round altar remain distinguishable on a phone.
                m.save();
                m.translate(x, 900 * my);
                path(m, 'M-10 -4 H10 V4 H-10Z', '#fff4ce', '#516654', 2);
                path(m, 'M-7 -5v10m14 -10v10', null, '#55664f', 2.4);
                m.restore();
                m.save();
                m.translate(x, y);
                path(
                    m,
                    'M-9 -4 -5 -8 5 -8 9 -4 9 4 5 8 -5 8 -9 4Z',
                    s.station.giantKind ? '#ffddb5' : '#d0aeac',
                    '#654d62',
                    1.8,
                );
                if (s.station.giantKind)
                    path(m, 'M-4 3v-6l2 -2 2 1 2 -1 2 2v6Z', '#876e87', '#59465b', 1.2);
                m.restore();
            }
            for (const unit of b?.units ?? []) {
                if (!unit.giantKind) continue;
                m.save();
                m.translate(unit.x * mx, unit.y * my);
                path(
                    m,
                    'M-7 3 -7 -4 -3 -8 3 -8 7 -4 7 3 0 7Z',
                    teamColors[unit.side].flag,
                    teamColors[unit.side].deep,
                    2,
                );
                path(m, 'M-3 -2h1m4 0h1', null, teamColors[unit.side].deep, 2);
                m.restore();
            }
            if (
                (b?.effects ?? []).some((f) => f.kind === 'hit' || f.kind === 'blast') &&
                b?.focus
            ) {
                const f = b.focus;
                m.fillStyle = '#fff5b0';
                m.beginPath();
                m.arc(f.x * mx, f.y * my, 4, 0, Math.PI * 2);
                m.fill();
            }
            const w = Math.min((viewW / zoom) * mx, mini.width - 2),
                h = Math.min((viewH / (zoom * K)) * my, mini.height - 2);
            const left = clamp(cx * mx - w / 2, 1, mini.width - w - 1),
                top = clamp(cy * my - h / 2, 1, mini.height - h - 1);
            m.strokeStyle = '#223f34';
            m.lineWidth = 3.4;
            m.strokeRect(left, top, w, h);
            m.strokeStyle = '#fff4c9';
            m.lineWidth = 1.6;
            m.strokeRect(left, top, w, h);
        }
        function updateCaptureCard(station, time) {
            const [allies, enemies] = station
                ? [station.presence[localSide], station.presence[enemySide]]
                : [0, 0];
            const fresh =
                station &&
                !station.giantKind &&
                station.lastRecruit &&
                time - station.lastRecruit.time < 2.4;
            const active = station?.giantKind && allies + enemies > 0;
            const x = station ? (station.x - cx) * zoom + viewW / 2 : -1;
            const y = station ? (station.y - cy) * K * zoom + viewH / 2 : -1;
            const visible = x >= 0 && x <= viewW && y >= 0 && y <= viewH;
            const show = visible && Boolean(active || fresh);
            if (captureCard.hidden !== !show) captureCard.hidden = !show;
            if (!show) return false;

            const relation = (side) =>
                side < 0 ? 'neutral' : side === localSide ? 'ally' : 'enemy';
            const side = fresh ? station.lastRecruit.side : station.claimant;
            const team = side === localSide ? '아군' : '적군';
            const progress = fresh ? 1 : clamp(station.progress, 0, 1);
            let state, heading, remaining;
            if (fresh) {
                state = 'secured';
                heading = team + ' 확보';
                remaining = '';
            } else if (allies === enemies) {
                state = 'contested';
                heading = '경합 · 일시정지';
                remaining = side >= 0 ? team + ' ' + Math.floor(progress * 100) + '%' : '';
            } else if (progress === 1) {
                state = 'full';
                heading = team + ' 점령 완료';
                remaining = '병력 가득';
            } else {
                state = 'capturing';
                heading = team + ' 점령 중';
                const seconds = Battle.settings.captureSeconds * (1 - progress);
                remaining = (Math.max(1, Math.ceil(seconds * 10 - 1e-8)) / 10).toFixed(1) + '초';
            }
            const count = fresh
                ? Battle.giants[station.lastRecruit.giantKind].name + ' 합류'
                : '아군 ' + allies + ' · 적군 ' + enemies;
            for (const [node, value] of [
                [captureLabel, heading],
                [captureRemaining, remaining],
                [captureCount, count],
            ]) {
                if (node.textContent !== value) node.textContent = value;
            }
            const progressSide = relation(side);
            const cardSide = state === 'contested' ? 'neutral' : progressSide;
            if (captureCard.dataset.state !== state) captureCard.dataset.state = state;
            if (captureCard.dataset.side !== cardSide) captureCard.dataset.side = cardSide;
            if (captureCard.dataset.progressSide !== progressSide)
                captureCard.dataset.progressSide = progressSide;
            captureCard.style.setProperty('--capture-progress', progress);

            const width = 158;
            const height = 53;
            const topLimit = viewH < 220 ? 47 : 54;
            const bottomLimit = Math.max(topLimit, viewH - height - captureRailClearance);
            // Keep the card near the altar and outside the camera rail and tool row.
            const above = y - (active ? 150 : 35) * zoom - height - 7;
            const below = y + 24 * zoom + 7;
            let left = x - width / 2;
            let top = above >= topLimit ? above : below;
            if (top > bottomLimit && above < topLimit) {
                const sideGap = 77 * zoom + 8;
                if (x - sideGap - width >= 4) left = x - sideGap - width;
                else if (x + sideGap + width <= viewW - 4) left = x + sideGap;
                else left = x - width / 2;
            }
            left = clamp(left, 4, Math.max(4, viewW - width - 4));
            top = clamp(top, topLimit, bottomLimit);
            captureCard.style.transform =
                'translate(' + Math.round(left) + 'px, ' + Math.round(top) + 'px)';
            return true;
        }
        function drawCaptureProgress(n) {
            if (n.progress <= 0 || n.claimant < 0) return;
            const x = n.x,
                y = n.y * K,
                radius = giantRadius,
                angle = Math.min(1, n.progress) * Math.PI * 2;
            if (gpu) {
                const segments = Math.ceil(angle * 8);
                let previousX = x,
                    previousY = y - radius * K;
                for (let i = 1; i <= segments; i++) {
                    const radians = (angle * i) / segments - Math.PI / 2;
                    const nextX = x + radius * Math.cos(radians),
                        nextY = y + radius * K * Math.sin(radians);
                    gpuLine(
                        previousX,
                        previousY,
                        nextX - previousX,
                        nextY - previousY,
                        5,
                        healthTint[relativeSide(n.claimant)],
                    );
                    previousX = nextX;
                    previousY = nextY;
                }
                return;
            }
            c.beginPath();
            c.ellipse(x, y, radius, radius * K, 0, -Math.PI / 2, -Math.PI / 2 + angle);
            c.strokeStyle = teamColors[n.claimant].flag;
            c.lineWidth = 5;
            c.stroke();
        }
        function siegeDamage(base, side, time) {
            const state = siegeState[side];
            if (state.hp !== null && base.hp < state.hp) state.last = time;
            state.hp = base.hp;
            const age = time - state.last;
            if (!(age >= 0 && age < 0.45)) return;
            const pulse = 1 - age / 0.45,
                dir = side ? -1 : 1;
            c.save();
            c.translate(base.x + dir * 10, base.y * K - 31);
            c.globalAlpha = pulse * 0.8;
            path(
                c,
                'M-10 1 -4 -2 -8 -9 -1 -5 3 -14 5 -6 14 -8 8 -2 15 2 7 4 6 11 0 6 -9 7 -5 3Z',
                '#ffcd71',
                '#b76a45',
                1.3,
            );
            for (let i = 0; i < 5; i++) {
                const dx = Math.cos(i * 2.14 + side),
                    dy = Math.sin(i * 2.14 + side);
                oval(c, dx * (12 + age * 48), dy * (9 + age * 35), 2, 2, '#ffe0a4');
            }
            c.restore();
        }
        function tag(x, y, text, team, ratio) {
            if (zoom < 0.42 && !['overview', 'routes', 'route-cue', 'supply'].includes(mode))
                return;
            c.save();
            c.font = '700 10px system-ui,sans-serif';
            const w = Math.ceil(c.measureText(text).width) + 20;
            const inset = (viewW / 2 - w / 2 - 4) / zoom;
            c.translate(clamp(x, cx - inset, cx + inset), y);
            c.scale(1 / zoom, 1 / zoom);
            c.beginPath();
            c.roundRect(-w / 2, -9, w, 18, 8);
            c.fillStyle = '#253e33dc';
            c.fill();
            c.fillStyle = team >= 0 ? teamColors[team].flag : '#e5cf8a';
            oval(c, -w / 2 + 7, -0.5, 2.2, 2.2, c.fillStyle);
            c.textBaseline = 'middle';
            c.textAlign = 'center';
            c.fillStyle = '#fff3cf';
            c.fillText(text, 3, 0);
            if (Number.isFinite(ratio)) {
                c.fillStyle = '#304638';
                c.fillRect(-w * 0.43, 10, w * 0.86, 3);
                c.fillStyle = team >= 0 ? teamColors[team].flag : '#f1ce74';
                c.fillRect(-w * 0.43, 10, w * 0.86 * clamp(ratio, 0, 1), 3);
            }
            c.restore();
        }
        function drawLaunchRings(f) {
            const progress = clamp(f.age / f.life, 0, 1);
            const strength = 1 - progress;
            const matched = f.kind === 'bonus';
            const team = teamColors[f.side];
            const radius = 27 + (reducedMotion.matches ? 34 : Math.sqrt(progress) * 73);
            if (gpu) {
                gpuSprite(
                    launchCircles[relativeSide(f.side)][Number(matched)],
                    f.x,
                    f.y * K,
                    radius / 96,
                    1,
                    0,
                    strength,
                );
                return;
            }
            c.save();
            c.translate(f.x, f.y * K);
            c.globalAlpha = strength * 0.2;
            oval(c, 0, 0, radius, radius * 0.56, matched ? '#fff4b5' : team.flag);
            c.globalAlpha = strength * 0.9;
            oval(c, 0, 0, radius, radius * 0.56, null, team.deep, 4);
            oval(c, 0, 0, radius, radius * 0.56, null, matched ? '#ffdf78' : team.glow, 2);
            if (matched && !reducedMotion.matches) {
                c.globalAlpha = strength * 0.65;
                oval(c, 0, 0, radius * 0.77, radius * 0.43, null, team.glow, 2);
                for (let index = 0; index < 8; index++) {
                    const angle = (index * Math.PI) / 4;
                    const x = Math.cos(angle) * radius;
                    const y = Math.sin(angle) * radius * 0.56 - progress * 28;
                    oval(c, x, y, 2.5, 2.5, index % 2 ? '#ffe992' : team.glow);
                }
            }
            c.restore();
        }
        function canShowLaunch(f) {
            return (
                !!f &&
                zoom >= 0.42 &&
                Math.abs(f.x - cx) * zoom <= viewW / 2 - 8 &&
                Math.abs(f.y - cy) * K * zoom <= viewH / 2 - 8
            );
        }
        function drawLaunchCaption(f) {
            if (!Number.isSafeInteger(f.count) || f.count < 1 || !canShowLaunch(f)) return;
            const team = teamColors[f.side];
            const matched = f.kind === 'bonus';
            const unit = globalThis.Battle?.types[f.type]?.name;
            const count = unit ? `${unit} ${f.count}마리 출격` : `${f.count}마리 출격`;
            const heading = f.equation || '목표 달성';
            const rise = reducedMotion.matches ? 0 : 14 * (f.age / f.life);
            const height = matched ? 41 : 26;
            c.save();
            c.font = '750 10px system-ui, sans-serif';
            const headingWidth = matched ? c.measureText(heading).width : 0;
            c.font = '800 14px system-ui, sans-serif';
            const width = Math.min(
                viewW - 8,
                Math.ceil(Math.max(c.measureText(count).width, headingWidth)) + 24,
            );
            // Keep the label inside the map viewport without moving the camera or covering its controls.
            const half = width / (2 * zoom);
            const viewLeft = cx - viewW / (2 * zoom);
            const viewTop = cy * K - viewH / (2 * zoom);
            const spawnX = (f.x - viewLeft) * zoom;
            const spawnY = (f.y * K - viewTop) * zoom;
            if (width > viewW - 8 || spawnX < 0 || spawnX > viewW || spawnY < 0 || spawnY > viewH) {
                c.restore();
                return;
            }
            const x = clamp(
                f.x,
                viewLeft + half + 4 / zoom,
                viewLeft + viewW / zoom - half - 4 / zoom,
            );
            const screenY = spawnY - 64 - rise;
            const safeTop = viewH < 180 ? 38 : 25;
            const y =
                viewTop + clamp(screenY, safeTop + height / 2, viewH - 46 - height / 2) / zoom;
            c.translate(x, y);
            c.scale(1 / zoom, 1 / zoom);
            c.globalAlpha = Math.min(1, (1 - f.age / f.life) * 3);
            c.beginPath();
            c.roundRect(-width / 2, -height / 2, width, height, 7);
            c.fillStyle = team.deep;
            c.fill();
            c.strokeStyle = matched ? '#ffdb79' : team.glow;
            c.lineWidth = 1.5;
            c.stroke();
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = '#fff8e6';
            if (matched) {
                c.font = '750 10px system-ui, sans-serif';
                c.fillStyle = '#ffe393';
                c.fillText(heading, 0, -10, width - 12);
            }
            c.font = '800 14px system-ui, sans-serif';
            c.fillStyle = '#fff8e6';
            c.fillText(count, 0, matched ? 7 : 0, width - 12);
            c.restore();
        }
        function hitDirection(effect) {
            return Math.atan2((effect.dy || 0) * K, effect.dx ?? 1);
        }
        function drawRoleImpact(effect, progress, team) {
            const t = reducedMotion.matches ? 0 : progress;
            c.translate(effect.x, effect.y * K - 12);
            c.rotate(hitDirection(effect));
            c.scale(0.84 + t * 0.24, 0.84 + t * 0.18);
            if (effect.kind === 'charge') {
                path(
                    c,
                    'M-34 -17 Q-12 -26 19 -1 Q-11 17 -34 16 Q-13 7 1 -1 Q-12 -9 -34 -17Z',
                    team.flag,
                    team.deep,
                    1.6,
                );
                path(c, 'M-24 -9 Q-8 -14 16 -1 Q-6 8 -25 8 Q-8 4 1 -1 Q-9 -5 -24 -9Z', '#fff3b7');
            } else if (effect.kind === 'brace') {
                path(c, 'M-8 -20 9 0 -8 20 M1 -20 18 0 1 20', null, team.deep, 4.5);
                path(c, 'M-8 -20 9 0 -8 20 M1 -20 18 0 1 20', null, team.flag, 2.4);
                path(c, 'M17 -9 27 -13 M19 0 32 0 M17 9 27 13', null, '#fff1ad', 2);
            } else {
                path(c, 'M-4 -18 Q20 -6 8 18', null, team.deep, 5);
                path(c, 'M-4 -18 Q20 -6 8 18', null, team.flag, 2.6);
                path(c, 'M2 -2 22 -12 M4 1 26 4 M0 4 16 17', null, '#fff5b8', 2);
            }
        }
        function drawEffect(f) {
            const life = clamp(f.age / Math.max(0.01, f.life), 0, 1),
                u = 1 - life,
                team = teamColors[f.side] ?? teams[0],
                x = f.x,
                y = f.y * K;
            c.save();
            c.globalAlpha = u;
            c.lineWidth = 2.4;
            if (['charge', 'brace', 'block'].includes(f.kind)) {
                drawRoleImpact(f, life, team);
            } else if (['capture', 'destroy', 'blast'].includes(f.kind)) {
                const large = ['capture', 'destroy'].includes(f.kind),
                    r = (large ? 18 : 5) + life * (large ? 82 : 30);
                c.strokeStyle = f.kind === 'blast' || f.kind === 'destroy' ? '#ffd57a' : team.glow;
                c.beginPath();
                c.ellipse(x, y, r, r * 0.48, 0, 0, Math.PI * 2);
                c.stroke();
                if (f.kind === 'blast') {
                    c.globalAlpha = u * 0.49;
                    oval(c, x, y, r * 0.92, r * 0.43, '#8b7256');
                    c.globalAlpha = u;
                    oval(c, x, y, r * 0.68, r * 0.33, null, '#fff0b9', 1.6);
                }
                for (let i = 0; i < (large ? 12 : 6); i++) {
                    const angle = i * 2.4 + f.x;
                    c.fillStyle = i % 2 ? '#fff7cd' : team.flag;
                    c.fillRect(
                        x + Math.cos(angle) * r,
                        y + Math.sin(angle) * r * 0.42 - Math.sin(life * Math.PI) * 18,
                        3,
                        4,
                    );
                }
            } else if (f.kind === 'hit') {
                c.translate(x, y - 13);
                const scale = reducedMotion.matches ? 1 : 0.8 + life * 0.8;
                c.scale(scale, scale);
                path(c, 'M-8 0 -2 -2 0 -10 2 -2 8 -1 2 1 1 7 -2 2Z', '#fff3b3', team.deep, 1.2);
            } else if (f.kind === 'death') {
                const radius = 7 + life * 12;
                oval(c, x, y, radius, radius * 0.4, '#b39c7770');
                if (!reducedMotion.matches) {
                    c.translate(x, y - life * 25);
                    c.rotate(life * 2 + f.x);
                    path(c, 'M-8 2 -2 -5 3 0 0 5Z', team.flag, team.deep, 1);
                    path(c, 'M5 -1 8 -5 12 -3 9 2Z', '#fff0ad');
                }
            }
            c.restore();
        }
        function drawTowerCollapse(effect) {
            const progress = clamp(effect.age / effect.life, 0, 1);
            const alpha = 1 - progress;
            const burst = reducedMotion.matches ? 0.65 : Math.sqrt(progress);
            const y = effect.y * K;
            for (let i = 0; i < 7; i++) {
                const angle = i * 2.4;
                const x = effect.x + Math.cos(angle) * (16 + 73 * burst);
                const dy = Math.sin(angle) * (9 + 30 * burst) - Math.sin(burst * Math.PI) * 40;
                const radius = ((i % 3) + 1) * 2.4 + 4 * progress;
                if (gpu) gpuDot(x, y + dy, radius, radius * 0.65, dustTint, alpha);
                else
                    oval(
                        c,
                        x,
                        y + dy,
                        radius,
                        radius * 0.65,
                        '#ffdf9e' +
                            Math.round(alpha * 255)
                                .toString(16)
                                .padStart(2, '0'),
                    );
            }
        }
        function drawMuzzle(building, y, time) {
            if (!Number.isFinite(building.lastShot)) return;
            if (reducedMotion.matches) return;
            const mortar = building.lastShotKind === 'mortar';
            const elapsed = time - building.lastShot;
            const duration = mortar ? 0.18 : 0.09;
            if (!(elapsed >= 0 && elapsed < duration)) return;
            const sprite = mortar ? mortarFlash : towerFlash;
            const alpha = (mortar ? 0.94 : 0.62) * (1 - elapsed / duration);
            const scale = mortar ? 0.77 + elapsed * 1.1 : 0.38 + elapsed * 1.7;
            const height = building.isBase ? 46 : 49;
            if (gpu) gpuSprite(sprite, building.x, y - height, scale, 1, 0, alpha);
            else {
                c.save();
                c.globalAlpha = alpha;
                blit(c, sprite, building.x, y - height, scale);
                c.restore();
            }
        }
        function drawGiant(unit, time) {
            const neutral = unit.side < 0;
            const team = neutral ? 0 : 1 + relativeSide(unit.side);
            const sprite = giantSprites()[unit.giantKind]?.[team];
            if (!sprite) return;
            const animate = !reducedMotion.matches;
            const walk = animate && unit.moving ? Math.sin(unit.walkDistance / 9) : 0;
            const idle = animate && neutral ? Math.sin(time * 2.3) * 1.8 : 0;
            const lunge = animate ? (unit.attack || 0) * 9 : 0;
            const facing = unit.facing === -1 ? -1 : 1;
            const x = unit.x,
                y = unit.y * K;
            if (gpu) {
                gpuSprite(actorShadow, x, y + 1, 2.8);
                gpuSprite(
                    sprite,
                    x + lunge * facing,
                    y - Math.abs(walk) * 6 + idle,
                    1,
                    facing,
                    walk * 0.045,
                );
            } else {
                blit(c, actorShadow, x, y + 1, 2.8);
                c.save();
                c.translate(x + lunge * facing, y - Math.abs(walk) * 6 + idle);
                c.rotate(walk * 0.045);
                c.scale(facing, 1);
                blit(c, sprite, 0, 0);
                c.restore();
            }
        }
        const stride = { charger: 42, worker: 35, shield: 26, spear: 33, archer: 35, thrower: 29 };
        const rigStats = { direct: 0, lod: 0 };
        function drawAnimated(u, type, facing, x, y, scale, time, near) {
            const worker = type === 'worker',
                moving = worker ? u.phase === 'out' || u.phase === 'back' : u.moving;
            let clip = 'idle',
                phase = (time / 1.2 + u.id * 0.123) % 1,
                bin = 0;
            if (worker && u.phase === 'dig') {
                const elapsed = Math.max(0, scene.economy.config.digSeconds - u.wait);
                clip = 'dig';
                phase = (elapsed / 0.58) % 1;
                bin = phase < 0.5 ? 3 : 7;
            } else if (
                type === 'shield' &&
                Number.isFinite(u.lastBlockTime) &&
                time - u.lastBlockTime < 0.24
            ) {
                clip = 'block';
                phase = (time - u.lastBlockTime) / 0.24;
                bin = 4;
            } else if (u.recoil > 0.06 || u.hit > 0.05) {
                clip = 'hurt';
                phase = Math.max(0.15, 1 - Math.max(u.hit || 0, (u.recoil || 0) / 0.54));
                bin = 5;
            } else if (u.windup > 0 || u.attack > 0) {
                clip = 'attack';
                const impact = globalThis.NumoriActorRig?.attackImpact ?? 0.55;
                phase =
                    u.windup > 0
                        ? impact * (1 - Math.min(1, u.windup / 0.12))
                        : impact + (1 - impact) * (1 - Math.min(1, u.attack / 0.5));
                bin = phase < impact ? 3 : 4;
            } else if (u.braced) {
                clip = 'brace';
                phase = 0.5;
                bin = 6;
            } else if (moving) {
                clip = u.chargeReady ? 'charge' : 'walk';
                phase = ((u.walkDistance || 0) / stride[type] + u.id * 0.127) % 1;
                bin = phase < 0.5 ? 1 : 2;
            }
            if (reducedMotion.matches) {
                if (clip === 'walk' || clip === 'charge' || clip === 'idle' || clip === 'hurt') {
                    clip = 'still';
                    phase = 0;
                    bin = 0;
                } else if (clip === 'attack' || clip === 'dig') {
                    phase = 0.55;
                    bin = clip === 'dig' ? 7 : 4;
                }
            }
            const side = relativeSide(worker ? u.team : u.side);
            if (a.art && near) {
                if (gpu) {
                    gpuSprite(
                        actorShadow,
                        x,
                        y,
                        scale * (type === 'shield' || type === 'thrower' ? 1.05 : 0.8),
                    );
                    const factor = a.art.scale[type] * scale;
                    a.art.rig.drawGPU(
                        gpu,
                        a.art.materials[side],
                        type,
                        clip,
                        phase,
                        x,
                        y,
                        facing * factor,
                        factor,
                        a.art.data.foot[0],
                        a.art.data.foot[1],
                    );
                } else drawArt(c, a.art, type, side, clip, phase, facing, x, y, scale);
                rigStats.direct++;
            } else {
                const frame = a.art
                    ? bin
                    : clip === 'walk'
                      ? bin
                      : ['attack', 'dig', 'brace'].includes(clip)
                        ? 3
                        : 0;
                const sp = a.chars[type]?.[side]?.[frame]?.[facing < 0 ? 0 : 1];
                if (sp && gpu) {
                    gpuSprite(sp, x, y, scale, a.art ? facing : 1);
                } else if (sp && a.art && facing < 0) {
                    c.save();
                    c.translate(x, y);
                    c.scale(-1, 1);
                    blit(c, sp, 0, 0, scale);
                    c.restore();
                } else if (sp) blit(c, sp, x, y, scale);
                rigStats.lod++;
            }
        }
        function drawWorker(w, base, time) {
            const returning = w.phase === 'back';
            const mine = scene.economy.mines[w.team][w.trip ?? w.assigned];
            const target = returning ? base : (mine ?? base);
            const facing = target.x >= w.x ? 1 : 0;
            const y = w.y * K;
            drawAnimated(w, 'worker', facing ? 1 : -1, w.x, y, 0.78, time, zoom >= 0.5);
            if (w.cargo == null || zoom < 0.4) return;
            const symbol = globalThis.MathCore?.ops?.[w.cargo]?.symbol ?? String(w.cargo);
            const bundle = (w.cargoCount ?? 1) > 1;
            const text = bundle ? symbol + ' 외 ' + (w.cargoCount - 1) : symbol;
            c.save();
            c.translate(w.x, y - 36);
            c.scale(1 / zoom, 1 / zoom);
            c.font = 'bold 10px system-ui';
            const width = Math.ceil(c.measureText(text).width) + 8;
            c.beginPath();
            c.roundRect(-width / 2, -7, width, 14, 4);
            c.fillStyle = '#fff2ce';
            c.fill();
            c.lineWidth = 1;
            c.strokeStyle = '#706a4e';
            c.stroke();
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = '#3b5143';
            c.fillText(text, 0, 0);
            c.restore();
        }
        const roleScale = { archer: 0.65, shield: 0.85, charger: 0.74, spear: 0.78, thrower: 0.82 };
        function groupScale(type) {
            return roleScale[type] ?? 0.72;
        }
        function render(next = scene, dt = 1 / 60) {
            if (
                next?.routeCue?.route !== scene.routeCue?.route ||
                next?.routeCue?.state !== scene.routeCue?.state
            )
                miniAt = -1;
            scene = next ?? {};
            if (!a.art && globalThis.NumoriRigImage) a = sprites();
            clock += Math.min(0.15, Math.max(0, dt || 0));
            size();
            if (viewW < 3 || viewH < 3) return;
            if (mode === 'battle') frameBattle(false, dt);
            if (mode === 'convoy') frameConvoy(false, dt);
            if (keys.size) {
                setMode('manual');
                const speed = (Math.min(0.08, dt || 0) * 550) / zoom;
                cx +=
                    (Number(keys.has('d') || keys.has('arrowright')) -
                        Number(keys.has('a') || keys.has('arrowleft'))) *
                    speed;
                cy +=
                    ((Number(keys.has('s') || keys.has('arrowdown')) -
                        Number(keys.has('w') || keys.has('arrowup'))) *
                        speed) /
                    K;
                constrain();
            }
            if (device) {
                try {
                    gpu = device.begin({
                        width: viewW,
                        height: viewH,
                        cx,
                        cy: cy * K,
                        zoom,
                        dpr,
                        clearColor: [129 / 255, 151 / 255, 122 / 255, 1],
                    })
                        ? device
                        : null;
                    selectRenderer();
                    paintFrame();
                    if (gpu) {
                        const stats = gpu.end();
                        renderStats = { ...stats, pipeline: stats.backend, backend: 'webgl2' };
                    } else
                        renderStats = {
                            backend: 'canvas2d',
                            drawCalls: 0,
                            reason: 'webgl-context-unavailable',
                        };
                    return;
                } catch (error) {
                    // A lost/restoring context can be used on a later frame. A persistent
                    // device/allocation error should leave the match playable on Canvas.
                    fallbackReason = String(error?.message || error);
                    console.warn('Numori WebGL renderer:', fallbackReason);
                    device.dispose();
                    device = null;
                }
            }
            gpu = null;
            selectRenderer();
            paintFrame();
            renderStats = { backend: 'canvas2d', drawCalls: 0, reason: fallbackReason };
        }
        function paintFrame() {
            const b = scene.battle,
                e = scene.economy,
                s = structures(),
                t = b?.time ?? 0;
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.clearRect(0, 0, field.width, field.height);
            if (gpu) drawTerrainTiles();
            else if (terrainDirty) {
                camera.resizeCanvas(terrainLayer);
                ground.setTransform(1, 0, 0, 1, 0, 0);
                ground.fillStyle = '#81977a';
                ground.fillRect(0, 0, terrainLayer.width, terrainLayer.height);
                camera.applyToContext(ground);
                const x = Math.max(0, cx - viewW / (2 * zoom)),
                    y = Math.max(0, cy * K - viewH / (2 * zoom));
                const w = Math.min(terrain.width - x, viewW / zoom),
                    h = Math.min(terrain.height - y, viewH / zoom);
                ground.drawImage(terrain, x, y, w, h, x, y, w, h);
                terrainDirty = false;
            }
            camera.applyToContext(c);
            const left = cx - viewW / (zoom * 2) - 125,
                right = cx + viewW / (zoom * 2) + 125,
                top = cy * K - viewH / (zoom * 2) - 45,
                bottom = cy * K + viewH / (zoom * 2) + 175;
            const visible = (x, y) => x >= left && x <= right && y * K >= top && y * K <= bottom;
            drawRouteCue(left, right, top, bottom);
            combatFx?.drawGround(c, b, {
                gpu,
                zoom,
                heightScale: K,
                visible,
                reducedMotion: reducedMotion.matches,
            });
            const launches = [null, null];
            for (const f of b?.effects ?? []) {
                if ((f.kind === 'summon' || f.kind === 'bonus') && visible(f.x, f.y))
                    launches[f.side] = f;
            }
            const drawables = [];
            s.base.forEach((obj, side) => {
                if (visible(obj.x, obj.y)) drawables.push({ kind: 'base', obj, side });
            });
            for (const obj of s.towers)
                if (visible(obj.x, obj.y)) drawables.push({ kind: 'tower', obj });
            for (const obj of s.mines)
                if (visible(obj.x, obj.y)) drawables.push({ kind: 'mine', obj });
            const station = s.station;
            if (station?.giantKind && visible(station.x, station.y)) {
                if (gpu) gpuSprite(captureZone, station.x, station.y * K);
                else blit(c, captureZone, station.x, station.y * K);
                drawCaptureProgress(station);
                drawables.push({
                    kind: 'neutralGiant',
                    obj: { x: station.x, y: station.y, side: -1, giantKind: station.giantKind },
                });
            }
            for (const team of e?.sides ?? [])
                for (const obj of team.workers ?? []) {
                    if (visible(obj.x, obj.y)) drawables.push({ kind: 'worker', obj });
                }
            const soldiers = b?.units ?? [];
            const dense = soldiers.length > 450;
            if (dense) {
                // Preserve every simulated agent. A screen-space cell draws its frontmost
                // soldier for each faction where individual silhouettes overlap.
                const spacing =
                    Math.max(18, Math.min(46, Math.sqrt(soldiers.length) * 0.68)) /
                    Math.min(1.6, zoom);
                formationCells.clear();
                for (const obj of soldiers) {
                    if (!visible(obj.x, obj.y)) continue;
                    if (obj.giantKind) {
                        drawables.push({ kind: 'unit', obj });
                        continue;
                    }
                    const key =
                        (Math.floor(obj.x / spacing) * 4096 + Math.floor((obj.y * K) / spacing)) *
                            2 +
                        obj.side;
                    const cell = formationCells.get(key);
                    if (!cell) formationCells.set(key, { kind: 'unit', obj, count: 1 });
                    else {
                        cell.count++;
                        if (cell.obj.y < obj.y) cell.obj = obj;
                    }
                }
                for (const cell of formationCells.values()) drawables.push(cell);
            } else
                for (const obj of soldiers)
                    if (visible(obj.x, obj.y)) drawables.push({ kind: 'unit', obj });
            const articulateAll = !dense && drawables.length <= 105;
            rigStats.direct = rigStats.lod = 0;
            for (const launch of launches) if (launch) drawLaunchRings(launch);
            drawables.sort((i, j) => i.obj.y - j.obj.y);
            for (const d of drawables) {
                const u = d.obj,
                    x = u.x,
                    y = u.y * K;
                if (d.kind === 'base' || d.kind === 'tower') {
                    const side = u.side ?? d.side;
                    const sprite =
                        d.kind === 'base'
                            ? a.bases[relativeSide(side)]
                            : u.hp > 0
                              ? towersArt[relativeSide(side)]
                              : ruinsArt;
                    if (gpu) gpuSprite(sprite, x, y);
                    else blit(c, sprite, x, y);
                    if (d.kind === 'base') siegeDamage(u, side, t);
                    if (u.hp > 0) drawMuzzle(u, y, t);
                    continue;
                }
                if (d.kind === 'mine') {
                    const sprite = a.mine[Number(u.kind === 'gas')];
                    if (gpu) gpuSprite(sprite, x, y);
                    else blit(c, sprite, x, y);

                    continue;
                }
                if (u.giantKind) {
                    drawGiant(u, t);
                    continue;
                }
                if (d.kind === 'worker') {
                    drawWorker(u, s.base[u.team], t);
                    continue;
                }
                const { side, type } = u;
                const facing = u.facing === -1 ? -1 : 1;
                const scale = groupScale(type);
                if (
                    !dense &&
                    type === 'charger' &&
                    u.chargeReady &&
                    u.moving &&
                    !reducedMotion.matches
                ) {
                    const dust = Math.sin(t * 12 + u.id) * 4;
                    if (gpu) {
                        gpuDot(x - facing * (13 + dust), y + 2, 8, 2.3, dustTint, 0.44);
                        gpuDot(x - facing * (24 + dust), y + 1, 4, 1.5, dustTint, 0.29);
                    } else {
                        oval(c, x - facing * (13 + dust), y + 2, 8, 2.3, '#fbdf9e6f');
                        oval(c, x - facing * (24 + dust), y + 1, 4, 1.5, '#fae6a34b');
                    }
                }
                if (!dense && type === 'archer' && u.windup > 0 && u.target) {
                    const dx = u.target.x - x,
                        dy = (u.target.y - u.y) * K,
                        dist = Math.hypot(dx, dy) || 1;
                    const startX = x + (dx / dist) * 22,
                        startY = y - 16 + (dy / dist) * 22;
                    const reach = Math.min(dist, 58) - 22;
                    if (gpu)
                        gpuLine(
                            startX,
                            startY,
                            (dx / dist) * reach,
                            (dy / dist) * reach,
                            1.4,
                            aimTint[relativeSide(side)],
                        );
                    else {
                        c.beginPath();
                        c.moveTo(startX, startY);
                        c.lineTo(startX + (dx / dist) * reach, startY + (dy / dist) * reach);
                        c.strokeStyle = side === enemySide ? '#e89c7280' : '#65a890a8';
                        c.lineWidth = 1.4;
                        c.stroke();
                    }
                }
                const focusActor =
                    !articulateAll &&
                    (u.windup > 0 || u.hit > 0.45 || u.braced) &&
                    rigStats.direct < 12;
                drawAnimated(
                    u,
                    type,
                    facing,
                    x,
                    y,
                    scale,
                    t,
                    zoom >= 0.5 && (articulateAll || focusActor),
                );
                if (!dense && u.hit > 0.1) {
                    if (gpu) gpuDot(x + 3, y - 13, 5, 3, hitTint, 0.53);
                    else oval(c, x + 3, y - 13, 5, 3, '#fff5bd87');
                }
                if (!dense && (u.hit > 0.38 || u.hp < u.maxHp * 0.25) && zoom > 0.65) {
                    const lx = x - 6,
                        ly = y - 39 * scale,
                        health = 12 * clamp(u.hp / u.maxHp, 0, 1);
                    if (gpu) {
                        gpu.image(linePixel, 1, 1, 1, 1, lx, ly, 12, 1.8, 1, healthTrack);
                        if (health > 0)
                            gpu.image(
                                linePixel,
                                1,
                                1,
                                1,
                                1,
                                lx,
                                ly,
                                health,
                                1.8,
                                1,
                                healthTint[relativeSide(side)],
                            );
                    } else {
                        c.fillStyle = '#38493a';
                        c.fillRect(lx, ly, 12, 1.8);
                        c.fillStyle = teamColors[side].flag;
                        c.fillRect(lx, ly, health, 1.8);
                    }
                }
            }
            e?.sides?.forEach((team, side) => {
                for (const event of Object.values(team.stats.lastSupply ?? {})) {
                    if (!event) continue;
                    const base = s.base[side],
                        age = e.time - event.time;
                    if (age < 0 || age > 0.62 || !visible(base.x, base.y) || zoom < 0.4) continue;
                    const token = globalThis.MathCore?.ops?.[event.token]?.symbol ?? event.token;
                    const label =
                        token +
                        (event.count > 1 ? ' 외 ' + (event.count - 1) + '개' : '') +
                        ' 획득';
                    const gas = event.mine === 'gas' || event.mine === 'centerGas';
                    c.save();
                    c.translate(base.x + (gas ? 23 : -23) / zoom, base.y * K - 20 - age * 25);
                    c.scale(1 / zoom, 1 / zoom);
                    c.globalAlpha = 1 - age / 0.62;
                    c.font = 'bold 11px system-ui';
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    c.strokeStyle = '#395846';
                    c.lineWidth = 3;
                    c.strokeText(label, 0, 0);
                    c.fillStyle = '#fff0af';
                    c.fillText(label, 0, 0);
                    c.restore();
                }
            });
            for (const p of b?.projectiles ?? [])
                if (visible(p.x, p.y)) {
                    const x = p.x,
                        y = p.y * K - (p.z ?? 0) - 8;
                    const progress = clamp(p.age / p.duration, 0, 1);
                    const defenseShot = p.kind === 'bolt' || p.kind === 'mortar';
                    const height = p.arcHeight ?? (p.kind === 'stone' ? 48 : defenseShot ? 0 : 12);
                    const dx = p.endX - p.startX;
                    const dy = (p.endY - p.startY) * K - height * (4 - 8 * progress);
                    const sprite = projectileArt[relativeSide(p.side)][p.kind];
                    if (!sprite) continue;
                    const angle = Math.atan2(dy + (defenseShot ? p.spec.muzzle - 4 : 0), dx);
                    const scale = p.giantKind ? 1.65 : 1;
                    if (gpu) gpuSprite(sprite, x, y, scale, 1, angle);
                    else {
                        c.save();
                        c.translate(x, y);
                        c.rotate(angle);
                        blit(c, sprite, 0, 0, scale);
                        c.restore();
                    }
                }
            let smallFx = 0,
                roleFx = 0;
            for (const f of b?.effects ?? [])
                if (visible(f.x, f.y)) {
                    if (f.kind === 'summon' || f.kind === 'bonus' || combatFx?.owns(f.kind))
                        continue;
                    if (f.kind === 'towerDestroy') {
                        drawTowerCollapse(f);
                        continue;
                    }
                    if (dense && (f.kind === 'hit' || f.kind === 'death') && ++smallFx > 28)
                        continue;
                    if (
                        (f.kind === 'charge' || f.kind === 'brace' || f.kind === 'block') &&
                        ++roleFx > 15
                    )
                        continue;
                    drawEffect(f);
                }
            combatFx?.draw(c, b, {
                gpu,
                zoom,
                heightScale: K,
                visible,
                reducedMotion: reducedMotion.matches,
                width: viewW,
                height: viewH,
            });
            const screenTop = cy * K - viewH / (2 * zoom),
                screenBottom = cy * K + viewH / (2 * zoom);
            for (const n of drawables) {
                const obj = n.obj;
                if (n.kind === 'base') {
                    const hp = obj.hp / obj.maxHp,
                        damaged = hp < 0.999;
                    const label =
                        (n.side === localSide ? '아군 본진' : '적군 본진') +
                        (damaged ? ' · ' + Math.ceil(hp * 100) + '%' : '');
                    const safeTop = viewW < 670 ? 52 : 14;
                    const y = Math.max(screenTop + safeTop / zoom, obj.y * K - 174);
                    if (y < obj.y * K - 43 && y < screenBottom - 22 / zoom)
                        tag(obj.x + (viewH < 176 && !damaged ? 90 : 0), y, label, n.side, hp);
                }
                if (n.kind === 'tower' && obj.hp > 0 && mode !== 'overview') {
                    const y = obj.y * K - 108;
                    const near = Math.abs(obj.x - cx) * zoom < viewW / 2 - 12;
                    if (near && y > screenTop + 19 / zoom && y < screenBottom - 16 / zoom)
                        tag(obj.x, y, '1차 타워', obj.side, obj.hp / obj.maxHp);
                }
                if (n.kind === 'unit' && obj.giantKind && mode !== 'overview') {
                    const y = obj.y * K - 151;
                    if (
                        Math.abs(obj.x - cx) * zoom < viewW / 2 &&
                        y > screenTop + 16 / zoom &&
                        y < screenBottom - 22 / zoom
                    )
                        tag(
                            obj.x,
                            y,
                            Battle.giants[obj.giantKind].name,
                            obj.side,
                            obj.hp / obj.maxHp,
                        );
                }
            }
            const captureShown = updateCaptureCard(s.station, t);
            if (s.station) {
                const place = s.station;
                const showTags =
                    ['overview', 'routes', 'route-cue', 'supply'].includes(mode) || zoom >= 0.42;
                const bridgeY = 801 * K;
                const altarY = place.y * K + (place.giantKind ? 31 : -8);
                if (
                    !captureShown &&
                    showTags &&
                    visible(place.x, place.y) &&
                    altarY > screenTop + 16 / zoom &&
                    altarY < screenBottom - 40 / zoom
                ) {
                    const name = Battle.giants?.[place.giantKind]?.name;
                    const label = name
                        ? name + (place.claimant >= 0 ? ' · 합류 중' : ' · 중립')
                        : '거인 제단';
                    tag(
                        place.x,
                        altarY,
                        label,
                        place.claimant,
                        place.claimant >= 0 ? place.progress : undefined,
                    );
                }
                const tightCapture = captureShown && mode === 'supply' && viewH <= 295;
                if (
                    !tightCapture &&
                    showTags &&
                    visible(1500, 900) &&
                    bridgeY > screenTop + 10 / zoom &&
                    bridgeY < screenBottom - 50 / zoom
                ) {
                    const labelClearance = mode === 'route-cue' ? 54 : mode === 'supply' ? 67 : 0;
                    const y =
                        labelClearance && viewW < 650
                            ? Math.max(bridgeY, screenTop + labelClearance / zoom)
                            : bridgeY;
                    tag(1500, y, '중앙 다리', -1);
                }
            }
            for (const launch of launches) {
                if (launch && (launch.side !== localSide || scene.routeCue?.state !== 'dispatched'))
                    drawLaunchCaption(launch);
            }
            if (miniAt < 0 || clock - miniAt > 0.12) {
                drawMini(b, s);
                miniAt = clock;
            }
        }
        setMode('routes');
        size();
        render();
        return {
            render,
            portrait,
            home: () => navigate('home'),
            battle: () => navigate('battle'),
            overview: () => navigate('overview'),
            supply: () => navigate('supply'),
            route(route) {
                if (Object.hasOwn(Battle.routes, route)) navigate('route-cue');
            },
            followDeployment(route) {
                if (mode === 'manual' || mode === 'overview' || mode === 'home') return;
                convoyUnit = scene.battle?.units.findLast(
                    (u) => u.side === localSide && u.route === route && !u.giantKind && u.hp > 0,
                );
                if (convoyUnit) {
                    setMode('convoy');
                    frameConvoy(true, 0);
                }
            },
            followFirstDeployment() {
                if (openingViewAvailable && mode === 'routes') navigate('battle');
                openingViewAvailable = false;
            },
            zoom: setZoom,
            get renderStats() {
                return renderStats;
            },
            get rigRendering() {
                return { ...rigStats };
            },
            get camera() {
                return { x: cx, y: cy, zoom, width: viewW, height: viewH };
            },
            destroy() {
                signals.abort();
                device?.dispose();
                gpuLayer.remove();
                terrainLayer.remove();
                field.remove();
                captureCard.remove();
                mini.remove();
                controls.remove();
                delete container.dataset.renderer;
                delete container.dataset.shortField;
                delete container.dataset.miniField;
                container.classList.remove('nr-world');
            },
        };
    }
    globalThis.NumoriWorld = {
        mount,
        portrait,
        giantPortrait,
        usesActorSheet: () => !!actorSheets(),
    };
})();
