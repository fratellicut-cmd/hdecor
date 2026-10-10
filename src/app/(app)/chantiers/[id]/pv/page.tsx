import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { aujourdHuiParis } from '@/domain/dates';
import { formaterDate } from '@/domain/formats';
import { etatReserves, type Reserve } from '@/domain/pv';
import { FormulairePv } from '@/components/chantiers/Pv';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Réception des travaux' };

export default async function PagePvs({ params }: PageProps<'/chantiers/[id]/pv'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const [{ data: ch }, { data: pvs, error }, { data: devis }] = await Promise.all([
    sb.from('chantiers').select('id, nom').eq('id', id.data).maybeSingle(),
    sb.from('pv_reception').select('id, statut, date_reception, reserves').eq('chantier_id', id.data).order('date_reception', { ascending: false }).limit(50),
    sb.from('devis').select('id, numero, version').eq('chantier_id', id.data).eq('statut', 'accepte').order('created_at', { ascending: false }),
  ]);
  if (!ch) notFound();
  if (error) throw new Error('Lecture impossible : PV.');
  const options = (devis ?? []).map((d) => ({ id: d.id, libelle: `${d.numero}${d.version > 1 ? ` v${d.version}` : ''}` }));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${ch.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {ch.nom}</Link>
        <h1 className="text-2xl font-bold">Réception des travaux</h1>
      </div>
      {pvs.length ? (
        <ul className="flex flex-col gap-2">
          {pvs.map((p) => (
            <li key={p.id}>
              <Link href={`/chantiers/${ch.id}/pv/${p.id}`} className="flex min-h-16 flex-col justify-center rounded-xl border border-trait bg-white px-4 py-2">
                <span className="font-semibold">PV du {formaterDate(p.date_reception)} · {p.statut === 'signe' ? 'signé' : 'brouillon'}</span>
                <span className="text-sm text-encre-douce">{etatReserves(p.reserves as Reserve[]).libelle}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <Carte titre={pvs.length ? 'Nouveau PV' : 'Préparer le PV de réception'}>
        <FormulairePv chantierId={ch.id} devis={options} pv={{
          date_reception: aujourdHuiParis(), travaux: '', reserves: '', observations: '', delai_levee_jours: '', devis_id: options.length === 1 ? options[0]!.id : '',
        }} />
      </Carte>
    </div>
  );
}
