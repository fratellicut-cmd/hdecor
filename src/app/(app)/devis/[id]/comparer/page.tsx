import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { chargerDevis, ligneDomaine } from '@/lib/devis';
import { comparerVersions } from '@/domain/devis';
import { formaterEuros } from '@/domain/formats';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Comparer les versions' };

const montant = (v: bigint | null) => (v === null ? '—' : formaterEuros(v));

export default async function PageComparer({ params }: PageProps<'/devis/[id]/comparer'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const apres = await chargerDevis(id.data);
  if (!apres?.devis.devis_precedent_id) notFound();
  const avant = await chargerDevis(apres.devis.devis_precedent_id);
  if (!avant) notFound();
  const diffs = comparerVersions(avant.lignes.map(ligneDomaine), apres.lignes.map(ligneDomaine));
  const ttc = (c: typeof avant) => formaterEuros(c.devis.total_ttc_cents!);
  const v = (c: typeof avant) => `version ${c.devis.version}`;
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/devis/${id.data}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Retour</Link>
      <h1 className="text-2xl font-bold">{apres.devis.numero ?? 'Brouillon'} : {v(avant)} → {v(apres)}</h1>
      <Carte titre="Total">
        <p className="text-lg">{ttc(avant)} → <strong>{ttc(apres)}</strong>{apres.devis.regime_tva === 'franchise' ? '' : ' TTC'}</p>
        {apres.devis.statut === 'brouillon' ? <p className="text-sm text-encre-douce">Brouillon : total à jour de la dernière modification.</p> : null}
      </Carte>
      {!diffs.length ? <Message type="info">Aucune différence dans les lignes.</Message> : (
        <Carte titre="Lignes">
          <ul className="flex flex-col gap-2">
            {diffs.map((d, i) => (
              <li key={i} className={`rounded-xl border-l-4 bg-white p-3 ${d.nature === 'ajoutee' ? 'border-succes' : d.nature === 'retiree' ? 'border-danger' : 'border-alerte'}`}>
                <p className="font-semibold">{d.nature === 'ajoutee' ? 'Ajoutée' : d.nature === 'retiree' ? 'Retirée' : 'Modifiée'} : {d.designation}</p>
                <p className="text-sm tabular-nums">
                  {d.nature === 'ajoutee' ? `${montant(d.apres)} HT` : d.nature === 'retiree' ? `${montant(d.avant)} HT`
                    : `${d.champs.join(', ')} · ${montant(d.avant)} → ${montant(d.apres)} HT`}
                </p>
              </li>
            ))}
          </ul>
        </Carte>
      )}
    </div>
  );
}
