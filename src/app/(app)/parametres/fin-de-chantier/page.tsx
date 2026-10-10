import type { Metadata } from 'next';
import Link from 'next/link';
import { lireParametres } from '@/lib/parametres';
import { FormulaireModeleFin } from '@/components/chantiers/Fin';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Fin de chantier' };

export default async function PageModeleFin() {
  const p = await lireParametres();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/parametres" className="inline-flex min-h-12 items-center underline underline-offset-4">← Paramètres</Link>
      <h1 className="text-2xl font-bold">Fin de chantier</h1>
      <p className="text-encre-douce">Liste proposée sur chaque chantier (« Fin de chantier »). Un chantier déjà commencé garde sa propre liste.</p>
      <Carte><FormulaireModeleFin liste={p.liste_fin_chantier} /></Carte>
    </div>
  );
}
