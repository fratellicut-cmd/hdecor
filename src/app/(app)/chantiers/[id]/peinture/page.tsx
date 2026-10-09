import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { calculerChantier } from '@/lib/chantiers';
import { dixiemesDeJour, libelleType, LIBELLES_FINITION } from '@/domain/calculateur';
import { arrondi, formaterDuree } from '@/domain/chiffrage';
import { formaterEuros } from '@/domain/formats';
import { totalMatiere } from '@/domain/liste-texte';
import { AVERTISSEMENT_RENDEMENT } from '@/domain/systemes';
import { supprimerPoste } from '../../actions';
import { ResultatPosteVue } from '@/components/chantiers/ResultatPoste';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Calcul peinture' };

/** « copié dans 2 pièces ; 1 avait déjà ce poste (non modifié) ». */
function texteCopies(copies: unknown, demandees: unknown): string {
  const n = Number(copies);
  const d = Number(demandees);
  if (!Number.isInteger(n) || !Number.isInteger(d) || d <= 0 || n < 0 || n > d) return '';
  const deja = d - n;
  if (n === 0) return ' Copie déjà faite : aucune nouvelle pièce (copies existantes non modifiées).';
  return ` Copié dans ${n} pièce${n > 1 ? 's' : ''}${deja ? ` ; ${deja} avai${deja > 1 ? 'ent' : 't'} déjà ce poste (copie existante non modifiée)` : ''}.`;
}

/** Dixièmes -> « 1,5 ». */
const dixiemesTexte = (d: bigint) => `${d / 10n}${d % 10n ? `,${d % 10n}` : ''}`;

export default async function PagePeinture({ params, searchParams }: PageProps<'/chantiers/[id]/peinture'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const c = await calculerChantier(id.data);
  if (!c) notFound();
  const { chantier, postes, liste } = c;
  const minutesParJour = BigInt(c.parametres.minutes_par_jour);
  const jours = dixiemesDeJour(liste.tempsMinutes, minutesParJour);
  const heuresParJour = dixiemesTexte(arrondi(minutesParJour * 10n, 60n));
  // Un même manque sur plusieurs postes (taux horaire, temps de pose…) : dit une fois, en haut.
  // Idem pour les rappels (séchage non renseigné, accrochage…) : moins de bruit sur chaque carte.
  const repetes = (listes: string[][]) => {
    const occurrences = new Map<string, number>();
    for (const l of listes) for (const m of new Set(l)) occurrences.set(m, (occurrences.get(m) ?? 0) + 1);
    return new Set([...occurrences].filter(([, n]) => n > 1).map(([m]) => m));
  };
  const communs = repetes(postes.map(({ resultat }) => resultat.manques));
  const rappelsCommuns = repetes(postes.map(({ resultat }) => [...resultat.avertissements, ...(resultat.sechage ? [resultat.sechage] : [])]));
  const tempsInconnu = liste.tempsMinutes === 0n && !liste.tempsComplet;

  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={[`poste:nouveau:${chantier.id}`, ...postes.map((p) => `poste:${p.poste.id}`)]} /> : null}
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {chantier.nom}</Link>
        <h1 className="text-2xl font-bold">Calcul peinture</h1>
      </div>
      <Message type="alerte">{AVERTISSEMENT_RENDEMENT}</Message>
      {sp.enregistre === '1' ? <Message type="succes">Poste enregistré.{texteCopies(sp.copies, sp.demandees)}</Message> : null}
      {liste.doublons.length ? (
        <div className="flex flex-col gap-1 rounded-xl bg-alerte-fond p-3 text-alerte">
          <p className="font-semibold">Comptés plusieurs fois :</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm font-semibold">{liste.doublons.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      ) : null}
      {rappelsCommuns.size ? (
        <div className="flex flex-col gap-1 rounded-xl bg-alerte-fond p-3 text-alerte">
          <p className="font-semibold">Rappels (plusieurs postes concernés) :</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm font-semibold">{[...rappelsCommuns].map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      ) : null}
      {communs.size ? (
        <div className="flex flex-col gap-1 rounded-xl bg-danger-fond p-3 text-danger">
          <p className="font-semibold">À compléter (plusieurs postes concernés) :</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm font-semibold">{[...communs].map((m) => <li key={m}>{m}</li>)}</ul>
          <Link href="/parametres/calcul" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Réglages de calcul</Link>
        </div>
      ) : null}

      {c.pieces.length === 0 ? (
        <p className="rounded-xl border border-trait bg-white p-4">Ajoutez d’abord les pièces du chantier (métré). <Link href={`/chantiers/${chantier.id}/pieces/nouvelle`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">+ Pièce</Link></p>
      ) : (
        <Link href={`/chantiers/${chantier.id}/peinture/nouveau`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">+ Poste de peinture</Link>
      )}

      {postes.map(({ poste, resultat }) => (
        <section key={poste.id} id={`poste-${poste.id}`} className="scroll-mt-4">
          <Carte titre={poste.libelle} action={<Link href={`/chantiers/${chantier.id}/peinture/${poste.id}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>}>
            <p className="mb-2 text-sm text-encre-douce">
              {[poste.produit?.libelle ?? (poste.typeProduit ? `${libelleType(poste.typeProduit)} (sans produit choisi)` : null),
                poste.finition ? LIBELLES_FINITION[poste.finition] : null, poste.teinte ? `teinte ${poste.teinte.nom}` : null,
                `${poste.couches} couche${poste.couches > 1 ? 's' : ''}`,
                poste.etapes.length ? `préparation : ${poste.etapes.map((e) => e.libelle.toLowerCase()).join(', ')}` : null].filter(Boolean).join(' · ')}
            </p>
            <ResultatPosteVue r={resultat} communs={new Set([...communs, ...rappelsCommuns])} />
            <div className="mt-2">
              <ActionConfirmee action={supprimerPoste} champs={{ id: poste.id, chantier_id: chantier.id! }} libelle="Retirer ce poste" variante="discret"
                confirmation="Je confirme le retrait de ce poste." />
            </div>
          </Carte>
        </section>
      ))}

      {postes.length ? (
        <Carte titre="Total du chantier">
          <dl className="grid grid-cols-2 gap-3 tabular-nums">
            <div><dt className="text-sm text-encre-douce">Matière HT</dt><dd className="text-lg font-bold">{totalMatiere(liste)}</dd></div>
            <div>
              <dt className="text-sm text-encre-douce">Temps{liste.tempsComplet || tempsInconnu ? '' : ' (partiel)'}</dt>
              <dd className="text-lg font-bold">{tempsInconnu ? 'non renseigné' : formaterDuree(liste.tempsMinutes)}</dd>
              {tempsInconnu ? null : <dd className="text-sm">≈ {dixiemesTexte(jours)} j de {heuresParJour} h, séchage non compris</dd>}
              {liste.attenteSechageDixiemesH !== null ? (
                <dd className="text-sm">+ au moins {dixiemesTexte(BigInt(liste.attenteSechageDixiemesH))} h de séchage entre couches</dd>
              ) : null}
            </div>
            <div>
              <dt className="text-sm text-encre-douce">Main-d’œuvre HT</dt>
              <dd className="text-lg font-bold">
                {liste.coutMainOeuvreCents === null ? 'taux horaire à renseigner' : tempsInconnu ? 'temps à renseigner' : `${formaterEuros(liste.coutMainOeuvreCents)}${liste.tempsComplet ? '' : ' (partiel)'}`}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-encre-douce">Prix de vente HT indicatif</dt>
              <dd className="text-lg font-bold">{liste.prixVenteHtCents === null ? 'incomplet' : formaterEuros(liste.prixVenteHtCents)}</dd>
              <dd className="text-sm">
                {liste.prixVenteHtCents === null
                  ? `manque : ${[!liste.coutComplet ? 'coût matière complet' : null, !liste.tempsComplet ? 'temps complet' : null,
                    liste.coutMainOeuvreCents === null ? 'taux horaire' : null].filter(Boolean).join(', ')}`
                  : 'matière × coefficient de marge + main-d’œuvre'}
              </dd>
            </div>
          </dl>
          {liste.nonChiffres.length ? (
            <div className="mt-2 text-sm font-semibold text-danger">
              <p>Non chiffré ({liste.nonChiffres.length}) : absent des totaux et de la liste d’achat.</p>
              <ul className="list-disc pl-5">{liste.nonChiffres.map((n) => <li key={n.id}>{n.libelle}</li>)}</ul>
            </div>
          ) : null}
          {!liste.coutComplet && !liste.nonChiffres.length ? <p className="mt-2 text-sm font-semibold text-danger">Des prix d’achat manquent : renseignez les produits du catalogue pour un coût complet.</p> : null}
          <Link href={`/chantiers/${chantier.id}/liste-achat`} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Voir la liste d’achat</Link>
        </Carte>
      ) : null}
    </div>
  );
}
