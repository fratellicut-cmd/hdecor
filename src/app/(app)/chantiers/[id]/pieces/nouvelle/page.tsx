import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { teintesAuChoix } from '@/lib/catalogue';
import { FormulairePiece } from '@/components/chantiers/FormulairePiece';

export const metadata: Metadata = { title: 'Nouvelle pièce' };

export default async function PageNouvellePiece({ params }: PageProps<'/chantiers/[id]/pieces/nouvelle'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await clientServeur();
  const { data: chantier, error } = await supabase.from('chantiers').select('id, nom, teinte_id').eq('id', id.data).maybeSingle();
  if (error) throw new Error('Lecture impossible : chantier.');
  if (!chantier) notFound();
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {chantier.nom}</Link>
        <h1 className="text-2xl font-bold">Nouvelle pièce</h1>
      </div>
      <FormulairePiece chantierId={chantier.id} teintes={await teintesAuChoix()} piece={{
        nom: '', etage: null, mode_saisie: 'rectangle', longueur_mm: null, largeur_mm: null, murs_mm: null,
        surface_sol_mm2: null, hauteur_mm: 2500, multiplicateur: 1, etat_support: null, notes: null, teinte_id: chantier.teinte_id,
      }} />
    </>
  );
}
