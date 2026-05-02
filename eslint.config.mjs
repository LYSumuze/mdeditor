import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  globalIgnores([
    'dist/**',
    'dist-server/**',
    'node_modules/**',
    'scripts/**',
    'electron/**',
    'server.js',
    'download-server.js',
    'android/**',
    'release/**',
    '.coze-logs/**',
    'src-tauri/target/**',
  ]),
]);
