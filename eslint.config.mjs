import js from '@eslint/js';
import html from 'eslint-plugin-html';
import globals from 'globals';

// The browser entry loads classic scripts in order. Only names shared between
// those scripts or provided by the pinned GameKit bundle belong here.
const gameGlobals = {
    Battle: 'readonly',
    Economy: 'readonly',
    MathCore: 'readonly',
    NumoriActorRig: 'readonly',
    NumoriAISolver: 'readonly',
    NumoriAudio: 'readonly',
    NumoriCombatFx: 'readonly',
    NumoriEditor: 'readonly',
    NumoriGPU: 'readonly',
    NumoriGameKit: 'readonly',
    NumoriGameKitTransport: 'readonly',
    NumoriLobby: 'readonly',
    NumoriMatch: 'readonly',
    NumoriNetwork: 'readonly',
    NumoriPeerSeries: 'readonly',
    NumoriRigData: 'readonly',
    NumoriVersion: 'readonly',
    NumoriWorld: 'readonly',
};

export default [
    {
        ignores: [
            'vendor/**',
            'rig-data.js',
            'numori-beta.html',
            'qa/**/*.{html,htm}',
            '**/*.min.js',
            '**/*.generated.js',
            '**/*.gen.js',
        ],
    },
    {
        files: ['**/*.{js,mjs,cjs,html,htm}'],
        rules: js.configs.recommended.rules,
        languageOptions: { ecmaVersion: 'latest' },
    },
    {
        files: ['**/*.{js,mjs,html,htm}'],
        ignores: ['eslint.config.mjs', '{qa,tests,tools}/**'],
        languageOptions: { globals: { ...globals.browser, ...gameGlobals } },
    },
    {
        files: ['*.js', '**/*.{html,htm}'],
        languageOptions: { sourceType: 'script' },
    },
    {
        files: ['**/*.{html,htm}'],
        plugins: { html },
    },
    {
        files: ['eslint.config.mjs', 'tools/**/*.{js,mjs,cjs}'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['{qa,tests}/**/*.{js,mjs,cjs}'],
        languageOptions: { globals: { ...globals.node, ...gameGlobals } },
    },
];
