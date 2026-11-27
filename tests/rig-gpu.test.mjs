import { strict as assert } from 'node:assert';
import test from 'node:test';
import '../rig-data.js';
import '../actor-rig.js';

test('GPU part order, UVs and projected corners match Canvas articulation', () => {
    const material = {};
    const data = globalThis.NumoriRigData;
    const rig = globalThis.NumoriActorRig.create(data, material);
    const [footX, footY] = data.foot;
    const x = 350.5;
    const y = 817.25;
    const scaleY = 0.37;
    for (const type of Object.keys(data.roles)) {
        for (const clip of ['still', 'idle', 'walk', 'charge', 'attack', 'hurt', 'block', 'brace', 'dig']) {
            for (const phase of [0, 0.17, 0.4, 0.55, 0.83, 1]) {
                for (const facing of [-1, 1]) {
                    const scaleX = facing * scaleY;
                    const quads = [];
                    let matrix;
                    rig.draw(
                        {
                            save() {},
                            restore() {},
                            transform(...values) {
                                matrix = values;
                            },
                            drawImage(image, sx, sy, w, h, atX, atY) {
                                const [a, b, c, d, e, f] = matrix;
                                const corners = [
                                    [0, 0],
                                    [w, 0],
                                    [0, h],
                                    [w, h],
                                ].map(([u, v]) => [
                                    x + scaleX * (a * (atX + u) + c * (atY + v) + e - footX),
                                    y + scaleY * (b * (atX + u) + d * (atY + v) + f - footY),
                                ]);
                                quads.push({ image, src: [sx, sy, w, h], corners });
                            },
                        },
                        type,
                        clip,
                        phase,
                    );
                    let index = 0;
                    const count = rig.drawGPU(
                        {
                            part(image, sx, sy, w, h, a, b, c, d, e, f) {
                                const expected = quads[index++];
                                assert.equal(image, expected.image);
                                assert.deepEqual([sx, sy, w, h], expected.src);
                                for (const [vertex, [u, v]] of [
                                    [0, 0],
                                    [w, 0],
                                    [0, h],
                                    [w, h],
                                ].entries()) {
                                    const [cx, cy] = expected.corners[vertex];
                                    assert.ok(Math.abs(cx - (a * u + c * v + e)) < 1e-9);
                                    assert.ok(Math.abs(cy - (b * u + d * v + f)) < 1e-9);
                                }
                            },
                        },
                        material,
                        type,
                        clip,
                        phase,
                        x,
                        y,
                        scaleX,
                        scaleY,
                        footX,
                        footY,
                    );
                    assert.equal(count, quads.length);
                    assert.equal(index, count);
                }
            }
        }
    }
});
