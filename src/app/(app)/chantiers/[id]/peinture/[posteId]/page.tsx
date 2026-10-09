import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { calculerChantier } from '@/lib/chantiers';
import { optionsPoste } from '@/lib/options-poste';
import { FormulairePoste } from '@/components/chantiers/FormulairePoste';

export const metadata: Metadata = { title: 'Poste de peinture' };

export default async function PagePoste({ params }: PageProps<'/chantiers/[id]/peinture/[posteId]'>) {
  const p = await params;
  const id = z.uuid().safeParse(p.id);
  const posteId = z.uuid().safeParse(p.posteId);
  if (!id.success || !posteId.success) notFound();
  const c = await calculerChantier(id.data);
  if (!c) notFound();
  const trouve = c.postes.find((x) => x.poste.id === posteId.data);
  if (!trouve) notFound();
  const l = trouve.ligne;
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href={`/chantiers/${id.data}/peinture#poste-${l.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Calcul peinture</Link>
        <h1 className="text-2xl font-bold">{trouve.poste.libelle}</h1>
      </div>
      <FormulairePoste chantierId={id.data} options={optionsPoste(c)} poste={{
        id: l.id, updated_at: l.updated_at, piece_id: l.piece_id, cible: l.cible, element_id: l.element_id, support: l.support, zone_humide: l.zone_humide, exterieur: l.exterieur,
        taches: l.taches, produit_id: l.produit_id, type_produit: l.type_produit, teinte_id: l.teinte_id, finition: l.finition,
        couches: l.couches, rendement_force: l.rendement_force, marge_perte_bp: l.marge_perte_bp, majoration_temps_bp: l.majoration_temps_bp,
        etapes: trouve.poste.etapes.map((e) => e.id),
      }} />
    </>
  );
}
