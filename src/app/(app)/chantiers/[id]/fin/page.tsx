import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { avancementFin, listeFin, type ElementFin as Element } from '@/domain/fin-chantier';
import { ElementFin, FormulaireAjoutFin } from '@/components/chantiers/Fin';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Fin de chantier' };

export default async function PageFin({ params }: PageProps<'/chantiers/[id]/fin'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const [{ data: ch }, { data: existante }, { data: p }] = await Promise.all([
    sb.from('chantiers').select('id, nom').eq('id', id.data).maybeSingle(),
    sb.from('checklists_fin_chantier').select('items').eq('chantier_id', id.data).maybeSingle(),
    sb.from('parametres_entreprise').select('liste_fin_chantier').eq('organisation_id', session.organisationId).maybeSingle(),
  ]);
  if (!ch) notFound();
  const liste = listeFin(existante ? (existante.items as Element[]) : null, p?.liste_fin_chantier ?? []);
  const a = avancementFin(liste);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${ch.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {ch.nom}</Link>
        <h1 className="text-2xl font-bold">Fin de chantier</h1>
        <p className="font-semibold">{a.termine ? 'Tout est fait.' : `${a.faits} sur ${a.total} fait${a.faits > 1 ? 's' : ''}`}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {liste.map((e, i) => <li key={`${i}-${e.libelle}`}><ElementFin chantierId={ch.id} rang={i} libelle={e.libelle} faitLe={e.fait_le} /></li>)}
      </ul>
      <Carte><FormulaireAjoutFin chantierId={ch.id} /></Carte>
      <p className="text-sm text-encre-douce">La liste de départ se règle dans Réglages, « Fin de chantier ».</p>
      <Link href={`/chantiers/${ch.id}/pv`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">Réception des travaux (PV)</Link>
    </div>
  );
}
