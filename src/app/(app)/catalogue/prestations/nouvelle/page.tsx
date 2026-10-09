import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { tauxProposes } from '@/lib/taux';
import { FormulairePrestation } from '@/components/catalogue/Formulaires';

export const metadata: Metadata = { title: 'Nouvelle prestation' };

export default async function PageNouvellePrestation() {
  await verifierSession();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/catalogue/prestations" className="inline-flex min-h-12 items-center underline underline-offset-4">← Prestations</Link>
      <h1 className="text-2xl font-bold">Nouvelle prestation</h1>
      <FormulairePrestation taux={await tauxProposes()} prestation={{ libelle: '', description: null, unite: 'm2', prix: '', taux_tva_bp: null }} />
    </div>
  );
}
