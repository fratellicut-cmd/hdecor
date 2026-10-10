import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { chargerRecettes, regimeTva } from '@/lib/comptabilite';
import { schemaMois } from '@/lib/validation/comptabilite';
import { aujourdHuiParis } from '@/domain/dates';
import { LIBELLES_MODE, totauxRecettes } from '@/domain/comptabilite';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { ChoixMois } from '@/components/comptabilite/ChoixMois';
import { BadgeAVerifier } from '@/components/ui/Champ';

export const metadata: Metadata = { title: 'Livre des recettes' };

export default async function PageRecettes({ searchParams }: PageProps<'/comptabilite/recettes'>) {
  const session = await verifierSession();
  const moisCourant = aujourdHuiParis().slice(0, 7);
  const lu = schemaMois.safeParse((await searchParams).mois);
  const mois = lu.success && lu.data <= moisCourant ? lu.data : moisCourant;
  const [regime, recettes] = await Promise.all([regimeTva(session.organisationId), chargerRecettes(mois)]);
  const t = totauxRecettes(recettes);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/comptabilite?mois=${mois}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Comptabilité</Link>
        <h1 className="text-2xl font-bold">Livre des recettes</h1>
      </div>
      <ChoixMois chemin="/comptabilite/recettes" mois={mois} moisCourant={moisCourant} />
      <p className="font-semibold tabular-nums">
        Total encaissé : {formaterEuros(t.ttcCents)}
        {regime === 'assujetti' ? <span className="block font-normal">dont HT : {formaterEuros(t.htCents)} <BadgeAVerifier /></span> : null}
      </p>
      {!recettes.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun encaissement ce mois-ci. Les paiements se notent sur chaque facture.</p> : (
        <ul className="flex flex-col gap-2">
          {recettes.map((r, i) => (
            <li key={`${r.date}-${r.factureNumero}-${i}`} className="flex flex-col rounded-xl border border-trait bg-white px-4 py-2">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{r.client || 'Client'}</span>
                <span className={`text-lg font-bold tabular-nums ${r.montantCents < 0n ? 'text-danger' : ''}`}>{r.montantCents < 0n ? '−' : ''}{formaterEuros(r.montantCents < 0n ? -r.montantCents : r.montantCents)}</span>
              </span>
              <span className="text-sm text-encre-douce">
                {[formaterDate(r.date), r.factureNumero, r.nature === 'remboursement' ? 'Remboursement' : null, r.mode ? LIBELLES_MODE[r.mode] ?? r.mode : null, r.reference].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
