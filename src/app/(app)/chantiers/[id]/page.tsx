import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { chargerChantier } from '@/lib/chantiers';
import { nomAffiche } from '@/domain/clients';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterSurface } from '@/domain/metre';
import { libelleStatut } from '@/domain/statuts';
import { supprimerChantier } from '../actions';
import { ChoixStatut } from '@/components/chantiers/ChoixStatut';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { CartesPilotage } from '@/components/chantiers/CartesPilotage';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Chantier' };

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-center font-semibold';

export default async function PageChantier({ params, searchParams }: PageProps<'/chantiers/[id]'>) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const donnees = await chargerChantier(id.data);
  if (!donnees) notFound();
  const { chantier, client, pieces } = donnees;
  const adresse = [chantier.adresse_ligne1, chantier.adresse_ligne2, [chantier.code_postal, chantier.ville].filter(Boolean).join(' ')].filter(Boolean);
  const totalMurs = pieces.reduce((t, p) => t + (p.surfaces?.totalMursMm2 ?? 0n), 0n);
  const totalPlafonds = pieces.reduce((t, p) => t + (p.surfaces?.totalPlafondMm2 ?? 0n), 0n);
  const incompletes = pieces.filter((p) => !p.surfaces || p.surfaces.totalPlafondMm2 === null).length;
  const { data: devis } = await (await clientServeur()).from('v_devis').select('id, numero, version, statut_affiche, total_ttc_cents')
    .eq('chantier_id', chantier.id!).order('created_at', { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={['chantier:nouveau', `chantier:${chantier.id}`]} /> : null}
      <div className="flex flex-col gap-1">
        <Link href="/chantiers" className="inline-flex min-h-12 items-center underline underline-offset-4">← Chantiers</Link>
        <h1 className="text-2xl font-bold break-words">{chantier.nom}</h1>
        <p className="text-encre-douce">
          {client ? <Link href={`/clients/${client.id}`} className="inline-flex min-h-11 items-center underline underline-offset-4">{nomAffiche(client)}</Link> : 'Client'}
          {' · '}{libelleStatut(chantier.statut_affiche)}
        </p>
      </div>
      {sp.enregistre === '1' ? <Message type="succes">Chantier enregistré.</Message> : null}
      {sp.piece === 'supprimee' ? <Message type="succes">Pièce supprimée.</Message> : null}
      {sp.achat === '1' ? <><EffacerBrouillon cles={['achat:nouveau']} /><Message type="succes">Achat enregistré pour ce chantier.</Message></> : null}

      <div className="grid grid-cols-2 gap-2">
        <Link href={`/chantiers/${chantier.id}/peinture`} className={`${bouton} bg-anthracite text-creme`}>Calcul peinture</Link>
        <Link href={`/chantiers/${chantier.id}/liste-achat`} className={`${bouton} border-2 border-anthracite bg-white`}>Liste d’achat</Link>
        <a href="#temps" className={`${bouton} border-2 border-anthracite bg-white`}>Noter mon temps</a>
        <Link href={`/comptabilite/achats/nouveau?chantier=${chantier.id}`} className={`${bouton} border-2 border-anthracite bg-white`}>Noter un achat</Link>
      </div>

      <Carte titre="Devis" action={<Link href={`/devis/nouveau?chantier=${chantier.id}`} className={`${bouton} bg-anthracite text-creme`}>+ Devis</Link>}>
        {!devis?.length ? <p className="text-encre-douce">Aucun devis. « + Devis » reprend les postes de peinture de ce chantier.</p> : (
          <ul className="flex flex-col divide-y divide-trait">
            {devis.map((d) => (
              <li key={d.id}>
                <Link href={`/devis/${d.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <span className="font-semibold">{d.numero ? `${d.numero}${d.version! > 1 ? ` v${d.version}` : ''}` : 'Brouillon'} · {libelleStatut(d.statut_affiche)}</span>
                  <span className="tabular-nums">{formaterEuros(d.total_ttc_cents!)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre="Pièces" action={<Link href={`/chantiers/${chantier.id}/pieces/nouvelle`} className={`${bouton} bg-anthracite text-creme`}>+ Pièce</Link>}>
        {pieces.length === 0 ? <p className="text-encre-douce">Aucune pièce. Commencez le métré avec « + Pièce ».</p> : (
          <ul className="flex flex-col divide-y divide-trait">
            {pieces.map((p) => (
              <li key={p.id}>
                <Link href={`/chantiers/${chantier.id}/pieces/${p.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{p.nom}{p.multiplicateur > 1 ? ` × ${p.multiplicateur}` : ''}</span>
                    <span className="text-sm text-encre-douce">{p.etage ?? ''}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {p.surfaces ? (
                      <>
                        <span className="block">Murs {formaterSurface(p.surfaces.totalMursMm2)}</span>
                        <span className="block">Plafond {p.surfaces.totalPlafondMm2 === null ? 'à compléter' : formaterSurface(p.surfaces.totalPlafondMm2)}</span>
                      </>
                    ) : <span className="font-semibold text-danger">À corriger</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {pieces.length ? (
          <p className="mt-3 border-t border-trait pt-3 font-semibold tabular-nums">
            Total : murs {formaterSurface(totalMurs)} · plafonds {formaterSurface(totalPlafonds)}
            {incompletes ? <span className="block text-sm font-normal text-danger">{incompletes} pièce(s) incomplète(s) : total partiel.</span> : null}
          </p>
        ) : null}
      </Carte>

      <CartesPilotage chantier={{ id: chantier.id!, date_debut_prevue: chantier.date_debut_prevue, duree_estimee_jours: chantier.duree_estimee_jours }} />

      <Carte titre="Statut"><ChoixStatut id={chantier.id!} statut={chantier.statut as 'a_planifier'} /></Carte>

      <Carte titre="Informations" action={<Link href={`/chantiers/${chantier.id}/modifier`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>}>
        <dl className="flex flex-col gap-2">
          <div><dt className="text-sm text-encre-douce">Adresse</dt><dd className="whitespace-pre-line">{adresse.join('\n') || 'Non renseignée'}</dd></div>
          {chantier.date_debut_prevue ? <div><dt className="text-sm text-encre-douce">Début prévu</dt><dd>{formaterDate(chantier.date_debut_prevue)}</dd></div> : null}
          {chantier.notes ? <div><dt className="text-sm text-encre-douce">Notes</dt><dd className="whitespace-pre-line break-words">{chantier.notes}</dd></div> : null}
        </dl>
      </Carte>

      <ActionConfirmee action={supprimerChantier} champs={{ id: chantier.id! }} libelle="Supprimer ce chantier" variante="danger"
        confirmation="Je confirme la suppression du chantier, de ses pièces et de son métré."
        explication="Sont aussi supprimés : postes de peinture, photos, documents, temps passés, rendez-vous, rappels et listes de contrôle. Impossible si un devis, une facture, une dépense ou un PV y est rattaché." />
    </div>
  );
}
