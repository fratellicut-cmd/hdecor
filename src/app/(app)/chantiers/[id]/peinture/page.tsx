import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { calculerChantier } from '@/lib/chantiers';
import { dixiemesDeJour, libelleType } from '@/domain/calculateur';
import { formaterDuree } from '@/domain/chiffrage';
import { formaterEuros } from '@/domain/formats';
import { AVERTISSEMENT_RENDEMENT } from '@/domain/systemes';
import { supprimerPoste } from '../../actions';
import { ResultatPosteVue } from '@/components/chantiers/ResultatPoste';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Calcul peinture' };

export default async function PagePeinture({ params, searchParams }: PageProps<'/chantiers/[id]/peinture'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const c = await calculerChantier(id.data);
  if (!c) notFound();
  const { chantier, postes, liste } = c;
  const jours = dixiemesDeJour(liste.tempsMinutes);

  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={[`poste:nouveau:${chantier.id}`, ...postes.map((p) => `poste:${p.poste.id}`)]} /> : null}
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {chantier.nom}</Link>
        <h1 className="text-2xl font-bold">Calcul peinture</h1>
      </div>
      <Message type="alerte">{AVERTISSEMENT_RENDEMENT}</Message>
      {sp.enregistre === '1' ? <Message type="succes">Poste enregistré.</Message> : null}

      {c.pieces.length === 0 ? (
        <p className="rounded-xl border border-trait bg-white p-4">Ajoutez d’abord les pièces du chantier (métré). <Link href={`/chantiers/${chantier.id}/pieces/nouvelle`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">+ Pièce</Link></p>
      ) : (
        <Link href={`/chantiers/${chantier.id}/peinture/nouveau`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">+ Poste de peinture</Link>
      )}

      {postes.map(({ poste, resultat }) => (
        <section key={poste.id} id={`poste-${poste.id}`} className="scroll-mt-4">
          <Carte titre={poste.libelle} action={<Link href={`/chantiers/${chantier.id}/peinture/${poste.id}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>}>
            <p className="mb-2 text-sm text-encre-douce">
              {[poste.produit?.libelle ?? (poste.typeProduit ? `${libelleType(poste.typeProduit)} (sans produit choisi)` : null), poste.teinte?.nom, `${poste.couches} couche${poste.couches > 1 ? 's' : ''}`,
                poste.etapes.length ? `préparation : ${poste.etapes.map((e) => e.libelle.toLowerCase()).join(', ')}` : null].filter(Boolean).join(' · ')}
            </p>
            <ResultatPosteVue r={resultat} />
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
            <div><dt className="text-sm text-encre-douce">Matière HT{liste.coutComplet ? '' : ' (partiel)'}</dt><dd className="text-lg font-bold">{formaterEuros(liste.coutMatiereCents)}</dd></div>
            <div><dt className="text-sm text-encre-douce">Temps</dt><dd className="text-lg font-bold">{formaterDuree(liste.tempsMinutes)}</dd><dd className="text-sm">≈ {(jours / 10n).toString()}{jours % 10n ? `,${jours % 10n}` : ''} j de 7 h, séchage non compris</dd></div>
            <div><dt className="text-sm text-encre-douce">Main-d’œuvre HT</dt><dd className="text-lg font-bold">{liste.coutMainOeuvreCents === null ? 'taux horaire à renseigner' : formaterEuros(liste.coutMainOeuvreCents)}</dd></div>
            <div>
              <dt className="text-sm text-encre-douce">Prix de vente HT indicatif</dt>
              <dd className="text-lg font-bold">{liste.prixVenteHtCents === null ? 'incomplet' : formaterEuros(liste.prixVenteHtCents)}</dd>
              <dd className="text-sm">matière × coefficient de marge + main-d’œuvre</dd>
            </div>
          </dl>
          {!liste.coutComplet ? <p className="mt-2 text-sm font-semibold text-danger">Des prix d’achat manquent : renseignez les produits du catalogue pour un coût complet.</p> : null}
          <Link href={`/chantiers/${chantier.id}/liste-achat`} className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Voir la liste d’achat</Link>
        </Carte>
      ) : null}
    </div>
  );
}
