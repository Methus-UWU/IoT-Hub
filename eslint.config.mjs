// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // src/generated is Prisma output, not authored source, and is gitignored.
    // The device catalog and the datasheets are likewise generated — by the exporters in
    // `frontend/scripts/` — and are committed only so a change shows up in review.
    // Letting Prettier reformat them would mean every regeneration produced a diff
    // against the formatter rather than against the content.
    ignores: [
      'eslint.config.mjs',
      'src/generated/**',
      'src/modules/projects/catalog/device-catalog.generated.ts',
      'src/modules/projects/catalog/device-datasheets.generated.ts',
      'dist/**',
    ],
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
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
);
