/* A painter-ordered GameKit quad stream. One instance carries the composed two
 * axes, translation, atlas layer, UV rectangle, and premultiplied tint. */
globalThis.NumoriGPU = (() => {
    'use strict';
    const atlasWidth = 2048;
    const atlasHeight = 1024;
    const maxBanks = 8;
    const samplerNames = Array.from({ length: maxBanks }, (_, i) => 'u_page' + i);
    const stride = 15;
    const white = [1, 1, 1, 1];
    const clear = [0.5, 0.59, 0.47, 1];
    const corners = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    const indices = new Uint16Array([0, 1, 2, 2, 1, 3]);
    const vertex = `#version 300 es
precision highp float;
in vec2 a_corner;
in vec4 i_axes;
in vec3 i_position;
in vec4 i_uv;
in vec4 i_tint;
uniform vec4 u_camera;
out vec3 uvLayer;
flat out vec4 uvBox;
flat out vec4 tint;
void main(){
    vec2 point = i_position.xy + i_axes.xy*a_corner.x + i_axes.zw*a_corner.y;
    gl_Position = vec4((point-u_camera.zw)*u_camera.xy, 0., 1.);
    uvLayer=vec3(i_uv.xy+a_corner*i_uv.zw,i_position.z);
    uvBox=i_uv; tint=i_tint;
}`;
    const fragment = `#version 300 es
precision highp float;
precision highp sampler2DArray;
${samplerNames.map((name) => 'uniform sampler2DArray ' + name + ';').join('\n')}
in vec3 uvLayer;
flat in vec4 uvBox;
flat in vec4 tint;
out vec4 result;
void main(){
    vec2 halfTexel=0.5 / vec2(${atlasWidth}.0, ${atlasHeight}.0);
    vec2 uv=clamp(uvLayer.xy,uvBox.xy+halfTexel,uvBox.xy+uvBox.zw-halfTexel);
    vec4 pixel;
    int bank=int(uvLayer.z+0.5);
    ${samplerNames
        .map(
            (name, i) =>
                (i === 0 ? '' : 'else ') +
                (i === maxBanks - 1 ? '' : 'if (bank == ' + i + ') ') +
                'pixel=texture(' +
                name +
                ',vec3(uv,0.));',
        )
        .join('\n    ')}
    result=pixel*tint;
}`;
    function create(canvas) {
        const { WebGLDevice, VectorContext, TextureAtlasArray } = NumoriGameKit;
        const query = new URLSearchParams(location.search);
        const variant = query.get('debug') === '1' ? query.get('gpuBatch') : null;
        const vector = variant === 'vector';
        const single = variant === 'single';
        const device = new WebGLDevice(canvas, {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            textureAtlas: { width: atlasWidth, height: atlasHeight, layers: vector ? 8 : 1, gutter: 1 },
        });
        let context;
        try {
            context = new VectorContext(device, { initialVertices: 1024, maxVertices: 196608 });
        } catch (error) {
            device.dispose();
            throw error;
        }
        const atlas = device.textureAtlas;
        const banks = [atlas];
        const rect = new Float32Array(4);
        const uv = new Float32Array(4);
        const matrix = new Float32Array(6);
        const commonQuad = { localRects: rect, uvRects: uv, matrix, color: white };
        const projection = new Float32Array(4);
        const stream = { used: 0, data: new Float32Array(1024 * stride) };
        let frameQuads = 0,
            frameReasons = {},
            frameOpen = false,
            disposed = false;
        let latest = null;
        const sources = new WeakMap();
        let pipeline, vertexBuffer, indexBuffer, instanceBuffer;
        let parameters;
        function uploadStatic() {
            device.uploadVertices(vertexBuffer, corners);
            device.uploadIndices(indexBuffer, indices);
        }
        // GameKit recreates pipeline/atlas and buffer capacity on context restore.
        // Static quad geometry is re-uploaded; dynamic instances are written each frame.
        try {
            if (!vector) {
                pipeline = device.createPipeline({
                    vertex,
                    fragment,
                    stride: 8,
                    instanceStride: stride * 4,
                    attributes: [
                        { name: 'a_corner', size: 2, offset: 0 },
                        { name: 'i_axes', size: 4, offset: 0, source: 'instance' },
                        { name: 'i_position', size: 3, offset: 16, source: 'instance' },
                        { name: 'i_uv', size: 4, offset: 28, source: 'instance' },
                        { name: 'i_tint', size: 4, offset: 44, source: 'instance' },
                    ],
                    uniforms: { u_camera: '4fv', ...Object.fromEntries(samplerNames.map((key) => [key, '1i'])) },
                });
                vertexBuffer = device.createVertexBuffer();
                indexBuffer = device.createIndexBuffer();
                instanceBuffer = device.createVertexBuffer({ capacityBytes: stream.data.byteLength });
                uploadStatic();
                parameters = {
                    pipeline,
                    buffer: vertexBuffer,
                    indexBuffer,
                    instanceBuffer,
                    count: 6,
                    instances: 0,
                    uniforms: { u_camera: projection, ...Object.fromEntries(samplerNames.map((key) => [key, 0])) },
                    textures: [atlas.texture],
                    blend: 'source-over',
                    depth: false,
                };
                canvas.addEventListener('webglcontextrestored', uploadStatic);
            }
        } catch (error) {
            context.dispose();
            device.dispose();
            throw error;
        }
        function upload(source, sx, sy, width, height, whole) {
            if (width > atlasWidth - 2 || height > atlasHeight - 2) {
                throw new RangeError('Sprite exceeds atlas page; split it into stable tiles.');
            }
            let pixels = source;
            if (!whole) {
                pixels = document.createElement('canvas');
                pixels.width = width;
                pixels.height = height;
                pixels.getContext('2d').drawImage(source, sx, sy, width, height, 0, 0, width, height);
            }
            // Keep a single hardware draw across banks; a spare layer is allocated
            // only if every earlier bank is full. The device retains their pixels for recovery.
            for (let bank = 0; bank < maxBanks; bank++) {
                if (bank === banks.length) {
                    const spare = new TextureAtlasArray(device, { width: atlasWidth, height: atlasHeight, layers: 1 });
                    banks.push(spare);
                    parameters.textures.push(spare.texture);
                    parameters.uniforms[samplerNames[bank]] = bank;
                }
                const storage = banks[bank];
                let region;
                try {
                    region = storage.allocate(width, height);
                } catch (error) {
                    if (vector || !(error instanceof RangeError)) throw error;
                    continue;
                }
                storage.upload(region, pixels);
                return { x: region.x - sx, y: region.y - sy, sw: width, sh: height, layer: vector ? region.layer : bank };
            }
            throw new RangeError('Battlefield sprite budget exceeded.');
        }
        function getRegion(source, sx, sy, sw, sh) {
            let entry = sources.get(source);
            if (!entry) {
                const width = source.naturalWidth || source.width,
                    height = source.naturalHeight || source.height;
                if (width <= atlasWidth - 2 && height <= atlasHeight - 2) {
                    entry = { whole: upload(source, 0, 0, width, height, true) };
                } else {
                    entry = { width, crops: new Map() };
                }
                sources.set(source, entry);
            }
            if (entry.whole) return entry.whole;
            // Oversized sheets have fixed terrain chunks or sprite slots. Retain only
            // needed cells, never a newly cropped viewport on each camera movement.
            let key = sy * entry.width + sx;
            let region = entry.crops.get(key);
            if (region && (region.sw !== sw || region.sh !== sh)) {
                // Rare alternate crop from the same origin. The normal hot path uses integer keys.
                key = key + '/' + sw + '/' + sh;
                region = entry.crops.get(key);
            }
            if (!region) {
                region = upload(source, sx, sy, sw, sh, false);
                entry.crops.set(key, region);
            }
            return region;
        }
        function register(source, sx = 0, sy = 0, sw, sh) {
            const w = source.naturalWidth || source.width,
                h = source.naturalHeight || source.height;
            if (w <= atlasWidth - 2 && h <= atlasHeight - 2) getRegion(source, 0, 0, w, h);
            else if (sw && sh) getRegion(source, sx, sy, sw, sh);
        }
        function flush(reason) {
            if (!frameOpen || stream.used === 0) return;
            device.uploadVertices(instanceBuffer, stream.data.subarray(0, stream.used * stride));
            parameters.instances = stream.used;
            device.draw(parameters);
            frameReasons[reason] = (frameReasons[reason] || 0) + 1;
            stream.used = 0;
        }
        const unsubscribe = device.registerBatcher(flush);
        function begin({ width, height, cx, cy, zoom, dpr = 1, clearColor = clear }) {
            if (disposed) throw new Error('Disposed battlefield renderer');
            stream.used = 0;
            frameQuads = 0;
            frameReasons = {};
            frameOpen = context.beginFrame({
                width: Math.max(1, Math.round(width * dpr)),
                height: Math.max(1, Math.round(height * dpr)),
                clearColor,
            });
            if (!frameOpen) return false;
            projection[0] = (zoom * 2) / width;
            projection[1] = (-zoom * 2) / height;
            projection[2] = cx;
            projection[3] = cy;
            if (vector)
                context.setTransform(
                    zoom * dpr,
                    0,
                    0,
                    zoom * dpr,
                    (width / 2 - cx * zoom) * dpr,
                    (height / 2 - cy * zoom) * dpr,
                );
            return true;
        }
        function part(source, sx, sy, sw, sh, a, b, c, d, tx, ty, alpha = 1, tint = white) {
            if (!frameOpen || alpha <= 0 || !sw || !sh) return;
            const region = getRegion(source, sx, sy, sw, sh);
            const u = (region.x + sx) / atlasWidth,
                v = (region.y + sy) / atlasHeight;
            tint = tint || white;
            frameQuads++;
            if (vector) {
                rect[2] = sw;
                rect[3] = sh;
                uv[0] = u;
                uv[1] = v;
                uv[2] = sw / atlasWidth;
                uv[3] = sh / atlasHeight;
                matrix[0] = a;
                matrix[1] = b;
                matrix[2] = c;
                matrix[3] = d;
                matrix[4] = tx;
                matrix[5] = ty;
                commonQuad.layer = region.layer;
                commonQuad.color = tint;
                commonQuad.alpha = alpha;
                context.drawQuads(commonQuad);
                return;
            }
            if (stream.used * stride >= stream.data.length) {
                const grown = new Float32Array(stream.data.length * 2);
                grown.set(stream.data);
                stream.data = grown;
            }
            const offset = stream.used++ * stride,
                out = stream.data;
            out[offset] = a * sw;
            out[offset + 1] = b * sw;
            out[offset + 2] = c * sh;
            out[offset + 3] = d * sh;
            out[offset + 4] = tx;
            out[offset + 5] = ty;
            out[offset + 6] = region.layer;
            out[offset + 7] = u;
            out[offset + 8] = v;
            out[offset + 9] = sw / atlasWidth;
            out[offset + 10] = sh / atlasHeight;
            const opacity = alpha * (tint[3] ?? 1);
            out[offset + 11] = tint[0] * opacity;
            out[offset + 12] = tint[1] * opacity;
            out[offset + 13] = tint[2] * opacity;
            out[offset + 14] = opacity;
            if (single) flush('unbatched');
        }
        function image(source, sx, sy, sw, sh, x, y, w, h, alpha = 1, tint = white) {
            part(source, sx, sy, sw, sh, w / sw, 0, 0, h / sh, x, y, alpha, tint);
        }
        function end() {
            if (!frameOpen) return latest;
            flush('frameEnd');
            context.endFrame();
            frameOpen = false;
            const stat = device.stats;
            if (vector && stat.drawCalls) frameReasons.vector = stat.drawCalls;
            latest = {
                backend: vector ? 'gamekit-vector' : single ? 'gamekit-unbatched' : 'gamekit-instanced',
                drawCalls: stat.drawCalls,
                instancedDrawCalls: stat.instancedDrawCalls,
                quads: frameQuads,
                textureUploads: stat.textureUploads,
                uploadedBytes: stat.bufferBytes,
                gpuTextureBytes: stat.gpuTextureBytes,
                gpuBufferBytes: stat.gpuBufferBytes,
                atlasRegions: banks.reduce((sum, bank) => sum + bank.regions.size, 0),
                atlasBanks: banks.length,
                restores: stat.restores,
                flushReasons: frameReasons,
            };
            return latest;
        }
        function dispose() {
            if (disposed) return;
            disposed = true;
            canvas.removeEventListener('webglcontextrestored', uploadStatic);
            unsubscribe();
            for (let i = 1; i < banks.length; i++) banks[i].dispose();
            context.dispose();
            device.dispose();
        }
        return {
            begin,
            register,
            part,
            image,
            end,
            dispose,
            get stats() {
                return latest;
            },
        };
    }
    return Object.freeze({ create });
})();
