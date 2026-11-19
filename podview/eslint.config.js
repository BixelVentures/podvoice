// Lint for the React/TypeScript code in podview/src. The pre-React modules at podview/*.js
// are not linted: they are being replaced screen by screen.
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {ignores: ['*.js', 'ui/**', 'build/**', 'public/**']},
  {
    files: ['src/**/*.{ts,tsx}'],
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
