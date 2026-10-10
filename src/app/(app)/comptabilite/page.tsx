import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { chargerAchats, chargerRecettes, regimeTva } from '@/lib/comptabilite';
import { schemaMois } from '@/lib/validation/comptabilite';
import { aujourdHuiParis } from '@/domain/dates';
import { achatsParCategorie, totauxAchats, totauxRecettes } from '@/domain/comptabilite';
import { formaterEuros } from '@/domain/formats';
import { ChoixMois } from '@/components/comptabilite/ChoixMois';
import { Carte } from '@/components/ui/Carte';
import { BadgeAVerifier } from '@/components/ui/Champ';

export const metadata: Metadata = { title: 'Comptabilité' };

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-center font-semibold';
const export_ = `${bouton} border-2 border-anthracite bg-white`;

export default async function PageComptabilite({ searchParams }: PageProps<'/comptabilite'>) {
  const session = await verifierSession();
  const moisCourant = aujourdHuiParis().slice(0, 7);
  const lu = schemaMois.safeParse((await searchParams).mois);
  const mois = lu.success && lu.data <= moisCourant ? lu.data : moisCourant;
  const [regime, recettes, achats] = await Promise.all([regimeTva(session.organisationId), chargerRecettes(mois), chargerAchats(mois)]);
  const r = totauxRecettes(recettes);
  const a = totauxAchats(achats);
  const categories = achatsParCategorie(achats);
  const annee = mois.slice(0, 4);
  const exp = (periode: string, format: string) => `/comptabilite/export?periode=${periode}&format=${format}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Comptabilité</h1>
        <Link href="/comptabilite/achats/nouveau" className={`${bouton} bg-anthracite text-creme`}>+ Un achat</Link>
      </div>
      <ChoixMois chemin="/comptabilite" mois={mois} moisCourant={moisCourant} />

      <Carte titre="Recettes encaissées" action={<Link href={`/comptabilite/recettes?mois=${mois}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Détail</Link>}>
        <p className="text-2xl font-bold tabular-nums">{formaterEuros(r.ttcCents)}</p>
        {regime === 'assujetti' ? <p className="tabular-nums">dont HT : {formaterEuros(r.htCents)} <BadgeAVerifier /></p> : null}
        <p className="text-sm text-encre-douce">{r.nombre} encaissement{r.nombre > 1 ? 's' : ''} (date du paiement). Livre des recettes tenu à partir des paiements notés sur les factures.</p>
      </Carte>

      <Carte titre="Achats" action={<Link href={`/comptabilite/achats?mois=${mois}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Détail</Link>}>
        <p className="text-2xl font-bold tabular-nums">{formaterEuros(a.ttcCents)} <span className="text-base font-normal">TTC</span></p>
        <p className="tabular-nums">HT {formaterEuros(a.htCents)} · TVA {formaterEuros(a.tvaCents)}</p>
        {a.sansJustificatif ? <p className="font-semibold text-danger">{a.sansJustificatif} achat{a.sansJustificatif > 1 ? 's' : ''} sans justificatif.</p> : null}
        {categories.length ? (
          <ul className="mt-2 flex flex-col divide-y divide-trait border-t border-trait">
            {categories.map((c) => <li key={c.categorie} className="flex min-h-11 items-center justify-between gap-3"><span>{c.categorie}</span><span className="tabular-nums">{formaterEuros(c.ttcCents)}</span></li>)}
          </ul>
        ) : <p className="text-encre-douce">Aucun achat noté ce mois-ci.</p>}
      </Carte>

      <Carte titre="Pour le comptable">
        <p className="mb-2 font-semibold first-letter:uppercase">Ce mois-ci</p>
        <div className="grid grid-cols-2 gap-2">
          <a href={exp(mois, 'xlsx')} className={export_}>Excel</a>
          <a href={exp(mois, 'pdf')} className={export_}>PDF</a>
          <a href={exp(mois, 'recettes.csv')} className={export_}>Recettes (CSV)</a>
          <a href={exp(mois, 'achats.csv')} className={export_}>Achats (CSV)</a>
        </div>
        <p className="mb-2 mt-4 font-semibold">Toute l’année {annee}</p>
        <div className="grid grid-cols-2 gap-2">
          <a href={exp(annee, 'xlsx')} className={export_}>Excel {annee}</a>
          <a href={exp(annee, 'pdf')} className={export_}>PDF {annee}</a>
        </div>
        <p className="mt-3 text-sm text-encre-douce">Les justificatifs restent consultables dans chaque achat.</p>
      </Carte>

      <Link href="/comptabilite/materiel" className={`${bouton} border-2 border-anthracite bg-white`}>Matériel</Link>
    </div>
  );
}
