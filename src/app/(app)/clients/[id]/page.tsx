import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { contactProfessionnel, formaterTelephone, lienTelephone, nomAffiche } from '@/domain/clients';
import { formaterDate, formaterEuros } from '@/domain/formats';
import { libelleStatut, libelleTypeFacture } from '@/domain/statuts';
import { effacerClient } from '../actions';
import { cleBrouillonClient } from '@/components/formulaire/cles';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Bouton } from '@/components/ui/Bouton';
import { CaseACocher } from '@/components/ui/Autres';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Fiche client' };

const MESSAGES_EFFACEMENT = {
  ok: { type: 'succes', texte: 'Client anonymisé. Ses fichiers sont supprimés en arrière-plan. Les factures émises sont conservées (obligation légale).' },
  echec: { type: 'erreur', texte: 'L’effacement a échoué. Rien n’a été modifié. Vérifiez la connexion et réessayez.' },
  deja: { type: 'info', texte: 'Ce client était déjà anonymisé.' },
  'non-confirme': { type: 'erreur', texte: 'Cochez la case de confirmation pour effacer ce client.' },
} as const;

export default async function PageClient({ params, searchParams }: PageProps<'/clients/[id]'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const supabase = await clientServeur();

  const [{ data: client, error: erreurClient }, { data: devis, error: e1 }, { data: factures, error: e2 }, { data: chantiers, error: e3 }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id.data).maybeSingle(),
    supabase.from('v_devis').select('id, numero, version, objet, statut_affiche, date_emission, total_ttc_cents, created_at')
      .eq('client_id', id.data).order('created_at', { ascending: false }),
    supabase.from('v_factures').select('id, numero, type, statut_affiche, date_emission, net_a_payer_cents, reste_a_payer_cents, created_at')
      .eq('client_id', id.data).order('created_at', { ascending: false }),
    supabase.from('v_chantiers').select('id, nom, ville, statut_affiche, date_debut_prevue, created_at')
      .eq('client_id', id.data).order('created_at', { ascending: false }),
  ]);
  // Échec technique : page d'erreur (« Réessayer »), jamais un faux « introuvable ».
  if (erreurClient) throw new Error('Lecture de la fiche client impossible.');
  if (!client) notFound();
  // Historique incomplet : on le dit, et l'effacement définitif est masqué
  // (son avertissement dépend des factures).
  const historiqueCharge = !e1 && !e2 && !e3;

  const anonymise = client.anonymise_le !== null;
  const contact = contactProfessionnel(client);
  const adresse = [client.fact_ligne1, client.fact_ligne2, [client.fact_code_postal, client.fact_ville].filter(Boolean).join(' ')]
    .filter(Boolean);
  const effacement = typeof sp.effacement === 'string' && sp.effacement in MESSAGES_EFFACEMENT
    ? MESSAGES_EFFACEMENT[sp.effacement as keyof typeof MESSAGES_EFFACEMENT] : null;
  const aDesFactures = (factures ?? []).some((f) => f.statut_affiche !== 'brouillon');

  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' || sp.effacement === 'ok'
        ? <EffacerBrouillon cles={[cleBrouillonClient(), cleBrouillonClient(client.id)]} /> : null}
      <div className="flex flex-col gap-1">
        <Link href="/clients" className="inline-flex min-h-12 items-center underline underline-offset-4">← Clients</Link>
        <h1 className="text-2xl font-bold break-words">{nomAffiche(client)}</h1>
        <p className="text-encre-douce">
          {client.type === 'professionnel' ? 'Professionnel' : 'Particulier'}
          {anonymise ? ` · anonymisé le ${formaterDate(client.anonymise_le!)}` : ''}
        </p>
      </div>

      {sp.enregistre === '1' ? <Message type="succes">Fiche enregistrée.</Message> : null}
      {effacement ? <Message type={effacement.type}>{effacement.texte}</Message> : null}
      {!historiqueCharge ? (
        <Message type="erreur">L’historique (chantiers, devis, factures) n’a pas pu être chargé. Rechargez la page.</Message>
      ) : null}

      {!anonymise ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {client.telephone ? (
              <a href={lienTelephone(client.telephone)} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">
                Appeler
              </a>
            ) : null}
            {client.email ? (
              <a href={`mailto:${client.email}`} className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">
                Email
              </a>
            ) : null}
          </div>

          <Carte titre="Coordonnées" action={
            <Link href={`/clients/${client.id}/modifier`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>
          }>
            <dl className="grid grid-cols-1 gap-2">
              {contact ? <Ligne terme="Contact" valeur={contact} /> : null}
              {client.type === 'particulier' && client.civilite ? <Ligne terme="Civilité" valeur={client.civilite} /> : null}
              {client.telephone ? <Ligne terme="Téléphone" valeur={formaterTelephone(client.telephone)} /> : null}
              {client.email ? <Ligne terme="Email" valeur={client.email} /> : null}
              {adresse.length ? <Ligne terme="Adresse de facturation" valeur={adresse.join('\n')} /> : null}
              {client.siret ? <Ligne terme="SIRET" valeur={client.siret} /> : null}
              {client.tva_intra ? <Ligne terme="TVA intracommunautaire" valeur={client.tva_intra} /> : null}
              {client.source ? <Ligne terme="Connu par" valeur={client.source} /> : null}
              {client.notes ? <Ligne terme="Notes" valeur={client.notes} /> : null}
              <Ligne terme="Créé le" valeur={formaterDate(client.created_at)} />
            </dl>
          </Carte>
        </>
      ) : null}

      <Carte titre="Chantiers">
        {chantiers?.length ? (
          <ul className="flex flex-col divide-y divide-trait">
            {chantiers.map((c) => (
              <li key={c.id} className="flex flex-col py-2">
                <span className="font-semibold">{c.nom}</span>
                <span className="text-sm text-encre-douce">
                  {[libelleStatut(c.statut_affiche), c.ville, c.date_debut_prevue ? `début ${formaterDate(c.date_debut_prevue)}` : null].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="text-encre-douce">{e3 ? 'Non chargé.' : 'Aucun chantier.'}</p>}
      </Carte>

      <Carte titre="Devis">
        {devis?.length ? (
          <ul className="flex flex-col divide-y divide-trait">
            {devis.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{d.numero ?? 'Brouillon'}{d.version && d.version > 1 ? ` (v${d.version})` : ''}</span>
                  <span className="text-sm text-encre-douce">
                    {[libelleStatut(d.statut_affiche), d.date_emission ? formaterDate(d.date_emission) : null, d.objet].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{d.total_ttc_cents !== null ? formaterEuros(d.total_ttc_cents) : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-encre-douce">{e1 ? 'Non chargé.' : 'Aucun devis.'}</p>}
      </Carte>

      <Carte titre="Factures">
        {factures?.length ? (
          <ul className="flex flex-col divide-y divide-trait">
            {factures.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{libelleTypeFacture(f.type)} {f.numero ?? '(brouillon)'}</span>
                  <span className="text-sm text-encre-douce">
                    {[libelleStatut(f.statut_affiche), f.date_emission ? formaterDate(f.date_emission) : null,
                      f.reste_a_payer_cents ? `reste ${formaterEuros(f.reste_a_payer_cents)}` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{f.net_a_payer_cents !== null ? formaterEuros(f.net_a_payer_cents) : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-encre-douce">{e2 ? 'Non chargé.' : 'Aucune facture.'}</p>}
      </Carte>

      {!anonymise ? (
        <Carte titre="Données personnelles (RGPD)">
          <div className="flex flex-col gap-4">
            <a href={`/clients/${client.id}/export`} download
              className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-5 font-semibold">
              Exporter les données de ce client
            </a>
            {historiqueCharge ? (
            <details className="rounded-xl border-2 border-danger p-3">
              <summary className="flex min-h-12 cursor-pointer items-center font-semibold text-danger">Effacer ce client (droit à l’effacement)</summary>
              <form action={effacerClient} className="mt-3 flex flex-col gap-3">
                <input type="hidden" name="id" value={client.id} />
                <p>Les coordonnées, les chantiers, les devis non acceptés, les photos et les brouillons sont effacés ou anonymisés. Cette action est définitive.</p>
                {aDesFactures ? (
                  <p className="font-semibold">Les factures émises et les devis acceptés sont conservés tels quels : leur conservation est une obligation légale.</p>
                ) : null}
                <CaseACocher nom="confirmation" libelle="Je confirme l’effacement définitif de ce client." required />
                <Bouton type="submit" variante="danger">Effacer définitivement</Bouton>
              </form>
            </details>
            ) : null}
          </div>
        </Carte>
      ) : null}
    </div>
  );
}

function Ligne({ terme, valeur }: { terme: string; valeur: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-encre-douce">{terme}</dt>
      <dd className="whitespace-pre-line break-words">{valeur}</dd>
    </div>
  );
}
