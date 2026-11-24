// Lint for PodView (podview/src, TypeScript strict) and its build tooling.
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {ignores: ['build/**', 'public/**', 'eslint.config.js']},
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts', 'vite.panel.config.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    plugins: {'react-hooks': reactHooks},
    languageOptions: {
      parserOptions: {projectService: true, tsconfigRootDir: import.meta.dirname},
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      // PodView's view models use '' for "absent" text, so `||` on strings is intended.
      '@typescript-eslint/prefer-nullish-coalescing': ['error', {ignorePrimitives: {string: true}}],
    },
  },
);
