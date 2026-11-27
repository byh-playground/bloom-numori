/** Rebuild the offline classic bundle from immutable GameKit git objects. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceCommit = '9dd41e95f8064dc6c96f057d66f35ca9e9d690b4';
const checkout = process.argv[2];
const checkOnly = process.argv[3] === '--check';
if (!checkout || (process.argv[3] && !checkOnly) || process.argv.length > 4) {
    throw new Error('Usage: node tools/vendor-gamekit-core.mjs <GameKit checkout> [--check]');
}
function readPinned(file) {
    return execFileSync('git', ['-C', checkout, 'show', sourceCommit + ':' + file], { encoding: 'utf8' });
}
const require = createRequire(pathToFileURL(resolve(checkout, 'package.json')));
const esbuild = require('esbuild');
const lock = JSON.parse(readPinned('package-lock.json'));
if (esbuild.version !== lock.packages['node_modules/esbuild'].version) {
    throw new Error('Use the esbuild version in the pinned GameKit package-lock.json.');
}
const entry = `
import { createLoop } from './modules/simloop/index.js';
import { UniformGrid } from './modules/spatial/index.js';
import { SeededPRNG, statelessRandom } from './modules/deterministic/utilities.js';
import { CameraViewport, OrthographicProjection } from './modules/camera/index.js';
import { WebGLDevice, VectorContext, TextureAtlasArray } from './modules/rendering/index.js';

globalThis.NumoriGameKit = Object.freeze({
    createLoop, UniformGrid, SeededPRNG, statelessRandom, CameraViewport, OrthographicProjection, WebGLDevice, VectorContext, TextureAtlasArray,
});
`;
const result = await esbuild.build({
    stdin: { contents: entry, sourcefile: 'numori-gamekit-core.js', loader: 'js' },
    plugins: [{
        name: 'pinned-gamekit',
        setup(build) {
            build.onResolve({ filter: /^\.\.?\// }, ({ path, importer }) => ({
                path: posix.normalize(posix.join(posix.dirname(importer), path)),
                namespace: 'gamekit',
            }));
            build.onLoad({ filter: /.*/, namespace: 'gamekit' }, ({ path }) => ({
                contents: readPinned(path),
                loader: 'js',
            }));
        },
    }],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    treeShaking: true,
    write: false,
    banner: { js: '// Generated from byh-playground/bloom-gamekit @ ' + sourceCommit + '. See vendor/README.md.' },
});
const destination = new URL('../vendor/gamekit-core.js', import.meta.url);
const generated = result.outputFiles[0].text.replaceAll('\r\n', '\n');
if (checkOnly) {
    if ((await readFile(destination, 'utf8')).replaceAll('\r\n', '\n') !== generated) {
        throw new Error('vendor/gamekit-core.js differs from the pinned source.');
    }
} else {
    await mkdir(new URL('.', destination), { recursive: true });
    await writeFile(destination, generated);
}
console.log('Verified GameKit @ ' + sourceCommit + ', esbuild ' + esbuild.version + ', ' + generated.length + ' characters');

