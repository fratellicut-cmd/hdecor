import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { calculerChantier } from '@/lib/chantiers';
import { formaterEuros } from '@/domain/formats';
import { formaterQuantiteCourte } from '@/domain/peinture';
import { texteListeAchat, totalMatiere } from '@/domain/liste-texte';
import { AVERTISSEMENT_RENDEMENT } from '@/domain/systemes';
import { BoutonPartage } from '@/components/chantiers/BoutonPartage';
import { texteCombinaison } from '@/components/chantiers/ResultatPoste';
import { Carte } from '@/components/ui/Carte';
import { BadgeAVerifier } from '@/components/ui/Champ';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Liste d’achat' };

export default async function PageListeAchat({ params }: PageProps<'/chantiers/[id]/liste-achat'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const c = await calculerChantier(id.data);
  if (!c) notFound();
  const { chantier, liste } = c;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {chantier.nom}</Link>
        <h1 className="text-2xl font-bold">Liste d’achat</h1>
      </div>
      <Message type="alerte">{AVERTISSEMENT_RENDEMENT}</Message>

      {liste.lignes.length === 0 ? (
        <p className="rounded-xl border border-trait bg-white p-4">
          Aucun produit : ajoutez des postes dans le{' '}
          <Link href={`/chantiers/${chantier.id}/peinture`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">calcul peinture</Link>.
        </p>
      ) : null}

      {liste.nonChiffres.length ? (
        <div className="flex flex-col gap-1 rounded-xl border-2 border-danger bg-danger-fond p-3 text-danger">
          <p className="font-bold">Liste incomplète : {liste.nonChiffres.length} poste{liste.nonChiffres.length > 1 ? 's' : ''} non chiffré{liste.nonChiffres.length > 1 ? 's' : ''}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm font-semibold">
            {liste.nonChiffres.map((n) => <li key={n.id}>{n.libelle} : {n.raison}</li>)}
          </ul>
        </div>
      ) : null}

      {liste.doublons.length ? (
        <div className="flex flex-col gap-1 rounded-xl border-2 border-alerte bg-alerte-fond p-3 text-alerte">
          <p className="font-bold">Comptés plusieurs fois</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm font-semibold">{liste.doublons.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      ) : null}

      {liste.lignes.map((l) => (
        <Carte key={l.cle}>
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-lg font-bold">{l.libelle}{l.aVerifier ? <BadgeAVerifier /> : null}</p>
            {l.reference || l.teinte || l.finition ? (
              <p className="font-semibold">
                {[l.reference ? `Réf. ${l.reference}` : null, l.finition ? `Finition : ${l.finition}` : null, l.teinte ? `Teinte : ${l.teinte}` : null].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            {l.depuisPoste && !l.finition && !l.reference ? <p className="text-sm font-semibold text-alerte">Finition non précisée sur le poste.</p> : null}
            <p className="tabular-nums">Besoin : <strong>{formaterQuantiteCourte(l.quantite)} {l.unite}</strong></p>
            {l.pots ? (
              <p className="text-lg font-bold tabular-nums">{texteCombinaison(l.pots.retenue, l.unite)}</p>
            ) : <p className="font-semibold text-danger">{l.probleme}</p>}
            <p className="tabular-nums">
              {l.coutCents === null ? 'Prix à renseigner' : `Coût HT : ${formaterEuros(l.coutCents)}${l.coutIndicatif ? ' (indicatif : prix de certains formats inconnus)' : ''}`}
            </p>
            <p className="text-sm text-encre-douce">Pour : {l.postes.join(' ; ')}</p>
          </div>
        </Carte>
      ))}

      {liste.consommables.length ? (
        <Carte titre="Consommables">
          <ul className="flex flex-col gap-1">
            {liste.consommables.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <span className="flex items-center gap-2">{k.libelle}{k.aVerifier ? <BadgeAVerifier /> : null}</span>
                <span>{formaterEuros(k.coutCents)}</span>
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}

      {liste.lignes.length ? (
        <>
          <p className="rounded-xl border-2 border-anthracite bg-white p-4 text-lg font-bold tabular-nums">Total matière HT : {totalMatiere(liste)}</p>
          <a href={`/chantiers/${chantier.id}/liste-achat/pdf`} download className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">
            Télécharger le PDF
          </a>
          <BoutonPartage titre={`Liste d’achat : ${chantier.nom}`} texte={texteListeAchat(chantier.nom ?? 'chantier', liste)} />
        </>
      ) : null}
    </div>
  );
}
