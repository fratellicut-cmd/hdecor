import type { Metadata } from 'next';
import { lireParametres } from '@/lib/parametres';
import { FormulaireMentions } from '@/components/parametres/FormulaireMentions';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Médiateur et mentions' };

export default async function Page() {
  const p = await lireParametres();
  return (
    <>
      <EnTeteSection titre="Médiateur et mentions" />
      <FormulaireMentions p={p} />
    </>
  );
}
