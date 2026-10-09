import type { Metadata } from 'next';
import { verifierSession } from '@/lib/dal';
import { FormulaireMotDePasse } from '@/components/auth/FormulaireMotDePasse';

export const metadata: Metadata = { title: 'Nouveau mot de passe' };

export default async function PageNouveauMotDePasse() {
  await verifierSession();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Choisissez un nouveau mot de passe</h1>
      <FormulaireMotDePasse apresOubli />
    </div>
  );
}
