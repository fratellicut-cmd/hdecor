import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { chargerAchats } from '@/lib/comptabilite';
import { schemaMois } from '@/lib/validation/comptabilite';
import { aujourdHuiParis } from '@/domain/dates';
import { totauxAchats } from '@/domain/comptabilite';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { ChoixMois } from '@/components/comptabilite/ChoixMois';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Achats' };

export default async function PageAchats({ searchParams }: PageProps<'/comptabilite/achats'>) {
  await verifierSession();
  const sp = await searchParams;
  const moisCourant = aujourdHuiParis().slice(0, 7);
  const lu = schemaMois.safeParse(sp.mois);
  const mois = lu.success && lu.data <= moisCourant ? lu.data : moisCourant;
  const achats = await chargerAchats(mois);
  const t = totauxAchats(achats);
  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={['achat:nouveau']} /> : null}
      <div className="flex flex-col gap-1">
        <Link href={`/comptabilite?mois=${mois}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Comptabilité</Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Achats</h1>
          <Link href="/comptabilite/achats/nouveau" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">+ Un achat</Link>
        </div>
      </div>
      {sp.enregistre === '1' ? <Message type="succes">Achat enregistré.</Message> : null}
      {sp.supprime === '1' ? <Message type="succes">Achat supprimé.</Message> : null}
      <ChoixMois chemin="/comptabilite/achats" mois={mois} moisCourant={moisCourant} />
      <p className="font-semibold tabular-nums">Total : {formaterEuros(t.ttcCents)} TTC <span className="font-normal">(HT {formaterEuros(t.htCents)}, TVA {formaterEuros(t.tvaCents)})</span></p>
      {!achats.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun achat ce mois-ci. Touchez « + Un achat » et photographiez le ticket.</p> : (
        <ul className="flex flex-col gap-2">
          {achats.map((a) => (
            <li key={a.id}>
              <Link href={`/comptabilite/achats/${a.id}`} className={`flex min-h-16 flex-col justify-center rounded-xl border bg-white px-4 py-2 ${a.justificatif ? 'border-trait' : 'border-danger'}`}>
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{a.fournisseur}</span>
                  <span className="text-lg font-bold tabular-nums">{formaterEuros(a.ttcCents)}</span>
                </span>
                <span className="text-sm text-encre-douce">{[formaterDate(a.date), a.categorie, a.chantier, a.libelle].filter(Boolean).join(' · ')}</span>
                {!a.justificatif ? <span className="text-sm font-semibold text-danger">Justificatif manquant</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
