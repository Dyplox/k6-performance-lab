// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'reports/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // Scripts de k6: corren en el runtime de k6 (Sobek), no en Node ni en el navegador.
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly' },
    },
  },
  {
    files: ['scripts/**/*.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
