import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** Fichiers autorisés à utiliser le client « service » (contourne la RLS). */
const ADMIN_AUTORISE = [
  'src/lib/supabase/admin.ts',
  'src/lib/stockage-admin.ts',
  'src/app/api/cron/**',
  'scripts/**',
  'tests/**',
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    ignores: ADMIN_AUTORISE,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@/lib/supabase/admin', '**/supabase/admin'],
          message: 'Client « service » (contourne la RLS) : réservé aux fichiers listés dans eslint.config.mjs.',
        }],
      }],
    },
  },
  globalIgnores([
    '.next/**', 'out/**', 'build/**', 'next-env.d.ts',
    'src/lib/supabase/types-base.ts', '.supabase-local/**',
    'playwright-report/**', 'test-results/**',
  ]),
]);

export default eslintConfig;
