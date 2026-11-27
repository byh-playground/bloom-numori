import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const base = process.env.BASE_SHA;
if (!base || !/^[0-9a-f]{40}$/.test(base)) {
    throw new Error('BASE_SHA must be a full commit SHA');
}

const output = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', base + '...HEAD'],
    { encoding: 'utf8' },
);
const changed = output.split('\0').filter(Boolean).filter(existsSync);
const prettier = changed.filter((file) => /\.(js|mjs|cjs|html?|css|json|md|markdown)$/i.test(file));
const eslint = changed.filter((file) => /\.(js|mjs|cjs|html?)$/i.test(file));

function check(command, flags, files) {
    if (files.length === 0) return;
    const manifest = require.resolve(command + '/package.json');
    const { bin } = require(manifest);
    const cli = resolve(dirname(manifest), typeof bin === 'string' ? bin : bin[command]);
    execFileSync(process.execPath, [cli, ...flags, '--', ...files], { stdio: 'inherit' });
}

check('prettier', ['--check', '--ignore-unknown'], prettier);
check('eslint', ['--no-warn-ignored'], eslint);
console.log(`Changed files: ${changed.length}`);
