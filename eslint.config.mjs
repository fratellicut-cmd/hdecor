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
      // Ferme le contournement « createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY) ».
      'no-restricted-syntax': ['error',
        ...['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'].flatMap((nom) => [
          {
            selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.name='${nom}']`,
            message: `${nom} : secret serveur réservé aux fichiers listés dans eslint.config.mjs.`,
          },
          {
            selector: `MemberExpression[object.object.name='process'][object.property.name='env'][property.value='${nom}']`,
            message: `${nom} : secret serveur réservé aux fichiers listés dans eslint.config.mjs.`,
          },
        ]),
      ],
    },
  },
  globalIgnores([
    '.next/**', 'out/**', 'build/**', 'next-env.d.ts',
    'src/lib/supabase/types-base.ts', '.supabase-local/**',
    'playwright-report/**', 'test-results/**',
  ]),
]);

export default eslintConfig;
