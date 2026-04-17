// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: {
          // spec and e2e files are excluded from tsconfig.json; allow them to be
          // linted without a dedicated tsconfig entry by falling back to the
          // default project (no type-checked rules for those files).
          allowDefaultProject: [
            'src/app.controller.spec.ts',
            'src/auth/auth.controller.spec.ts',
            'src/auth/auth.service.spec.ts',
            'src/deliveries/deliveries.controller.spec.ts',
            'src/deliveries/deliveries.service.spec.ts',
            'src/users/users.service.spec.ts',
            'test/app.e2e-spec.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      // The codebase uses `any` intentionally (noImplicitAny: false in tsconfig).
      // Keeping these as errors produces hundreds of false-positives.
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      // Variables prefixed with _ are intentionally unused (e.g. destructuring to omit fields).
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
