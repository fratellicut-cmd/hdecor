import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { calculerChantier } from '@/lib/chantiers';
import { optionsPoste } from '@/lib/options-poste';
import { FormulairePoste } from '@/components/chantiers/FormulairePoste';

export const metadata: Metadata = { title: 'Nouveau poste de peinture' };

export default async function PageNouveauPoste({ params, searchParams }: PageProps<'/chantiers/[id]/peinture/nouveau'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const piece = z.uuid().safeParse((await searchParams).piece);
  const c = await calculerChantier(id.data);
  if (!c) notFound();
  const options = optionsPoste(c);
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href={`/chantiers/${id.data}/peinture`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Calcul peinture</Link>
        <h1 className="text-2xl font-bold">Nouveau poste de peinture</h1>
      </div>
      <FormulairePoste chantierId={id.data} options={options} poste={{
        piece_id: piece.success && options.pieces.some((p) => p.id === piece.data) ? piece.data : options.pieces[0]?.id ?? '',
        cible: 'murs', element_id: null, support: 'ancienne_peinture', zone_humide: false, taches: false, exterieur: false, produit_id: null,
        type_produit: 'acrylique', teinte_id: null, teinte_libre: null, finition: null, couches: 2, rendement_force: null, marge_perte_bp: null,
        majoration_temps_bp: 0, etapes: [],
      }} />
    </>
  );
}
