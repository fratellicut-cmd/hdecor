import type { Metadata } from 'next';
import { lireParametres } from '@/lib/parametres';
import { FormulaireConditions } from '@/components/parametres/FormulaireConditions';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Conditions et tarifs' };

export default async function Page() {
  const p = await lireParametres();
  return (
    <>
      <EnTeteSection titre="Conditions et tarifs" />
      <FormulaireConditions p={p} />
    </>
  );
}
