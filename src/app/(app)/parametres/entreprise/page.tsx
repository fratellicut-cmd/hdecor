import type { Metadata } from 'next';
import { lireParametres } from '@/lib/parametres';
import { FormulaireEntreprise } from '@/components/parametres/FormulaireEntreprise';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Entreprise' };

export default async function Page() {
  const p = await lireParametres();
  return (
    <>
      <EnTeteSection titre="Entreprise" />
      <FormulaireEntreprise p={p} />
    </>
  );
}
