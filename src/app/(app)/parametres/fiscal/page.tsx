import type { Metadata } from 'next';
import { lireParametres } from '@/lib/parametres';
import { FormulaireFiscal } from '@/components/parametres/FormulaireFiscal';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Statut fiscal' };

export default async function Page() {
  const p = await lireParametres();
  return (
    <>
      <EnTeteSection titre="Statut fiscal" />
      <FormulaireFiscal p={p} />
    </>
  );
}
