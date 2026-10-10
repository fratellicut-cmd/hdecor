import type { Metadata } from 'next';
import { lireParametres } from '@/lib/parametres';
import { lireTextesStockes } from '@/domain/devis-document';
import { aujourdHuiParis } from '@/domain/dates';
import { FormulaireTextes } from '@/components/parametres/FormulaireTextes';
import { EnTeteSection } from '@/components/parametres/EnTeteSection';

export const metadata: Metadata = { title: 'Textes des documents' };

export default async function Page() {
  const p = await lireParametres();
  return (
    <>
      <EnTeteSection titre="Textes des documents" />
      <p className="mb-4 text-encre-douce">
        Textes légaux imprimés sur les devis, factures et procès-verbaux. Les textes proposés sont à faire valider par votre comptable :
        ils ne sont pas garantis exacts. Un document déjà émis garde les textes de sa date.
      </p>
      <FormulaireTextes textes={lireTextesStockes(p.textes_legaux)} validesLe={p.textes_legaux_valides_le} aujourdhui={aujourdHuiParis()} />
    </>
  );
}
