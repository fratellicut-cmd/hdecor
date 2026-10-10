'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { emailConfigure, envoyerEmail } from '@/lib/email';
import { conclureEnvoi, reserverEnvoi } from '@/lib/envois';
import type { EtatFormulaire } from '@/lib/etat-formulaire';
import { nomAffiche } from '@/domain/clients';
import { remplirModele } from '@/domain/devis';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const idDe = (fd: FormData, cle: string) => z.uuid().safeParse(fd.get(cle));

type Sb = Awaited<ReturnType<typeof clientServeur>>;

/** Factures qui marquent la fin des travaux : un avis ne se demande jamais sur un acompte ou une situation. */
const TYPES_AVIS: readonly string[] = ['finale', 'libre'];

/** Une seule demande d'avis par chantier (par facture pour une facture sans chantier). */
async function avisDejaDemande(sb: Sb, factureId: string, chantierId: string | null): Promise<boolean> {
  let ids = [factureId];
  if (chantierId) {
    const { data } = await sb.from('factures').select('id').eq('chantier_id', chantierId).limit(1_000);
    ids = (data ?? []).map((x) => x.id).concat(factureId);
  }
  const { data } = await sb.from('envois').select('id').eq('document_type', 'facture').in('document_id', ids).eq('nature', 'demande_avis').neq('statut', 'echec').limit(1);
  return !!data?.length;
}

/**
 * Demande d'avis possible : facture finale (ou libre) émise et entièrement
 * payée, lien d'avis renseigné, client ni anonymisé ni opposé aux
 * sollicitations, aucune demande déjà faite pour ce chantier.
 */
async function controler(sb: Sb, organisationId: string, factureId: string) {
  const { data: f } = await sb.from('v_factures').select('id, type, statut, reste_a_payer_cents, client_id, chantier_id').eq('id', factureId).maybeSingle();
  if (!f || f.statut !== 'emise') return { erreur: 'Facture introuvable.' } as const;
  if (!TYPES_AVIS.includes(f.type as string)) return { erreur: 'Un avis se demande sur la facture finale (ou une facture libre), une fois les travaux terminés.' } as const;
  if (f.reste_a_payer_cents === null || f.reste_a_payer_cents > 0) return { erreur: 'La facture n’est pas encore entièrement payée.' } as const;
  const [{ data: p }, { data: client }, deja, { data: modele }] = await Promise.all([
    sb.from('parametres_entreprise').select('avis_google_url, raison_sociale, email').eq('organisation_id', organisationId).single(),
    sb.from('clients').select('id, type, civilite, nom, prenom, raison_sociale, email, anonymise_le, refus_sollicitations_le').eq('id', f.client_id!).maybeSingle(),
    avisDejaDemande(sb, f.id!, f.chantier_id),
    sb.from('modeles_messages').select('sujet, corps').eq('code', 'demande_avis').maybeSingle(),
  ]);
  if (!p?.avis_google_url) return { erreur: 'Renseignez d’abord votre lien d’avis Google (Réglages > Médiateur et mentions).' } as const;
  if (!client || client.anonymise_le) return { erreur: 'Client introuvable ou anonymisé.' } as const;
  if (client.refus_sollicitations_le) return { erreur: 'Ce client a demandé à ne pas être sollicité.' } as const;
  if (deja) return { erreur: 'Un avis a déjà été demandé pour ce chantier.' } as const;
  if (!modele) return { erreur: 'Modèle « demande d’avis » introuvable (Réglages > Messages et relances).' } as const;
  const valeurs = { client: nomAffiche({ ...client, type: client.type as 'particulier' | 'professionnel' }), entreprise: p.raison_sociale ?? '', lien: p.avis_google_url };
  return { ok: true, email: client.email, repondreA: p.email, sujet: remplirModele(modele.sujet, valeurs), texte: remplirModele(modele.corps, valeurs) } as const;
}

/** Demande d'avis : envoyée par email, ou préparée pour un partage (SMS, WhatsApp), notée alors au moment du partage. */
export async function preparerDemandeAvis(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  const envoiId = idDe(fd, 'id_nouveau');
  const canal = fd.get('canal') === 'email' ? 'email' : 'lien';
  if (!id.success || !envoiId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const c = await controler(sb, session.organisationId, id.data);
  if ('erreur' in c) return { message: c.erreur };
  if (canal === 'lien') return { succes: 'Message préparé : copiez-le ou partagez-le (il sera noté à ce moment-là).', texte: c.texte, niveau: 'demande_avis' };
  if (!c.email || !emailConfigure()) return { message: 'Envoi par email impossible : partagez le message.' };
  const reservation = await reserverEnvoi(sb, {
    id: envoiId.data, organisation_id: session.organisationId, document_type: 'facture', document_id: id.data, nature: 'demande_avis', destinataire: c.email,
  });
  if (reservation === 'deja') return { message: 'Un avis a déjà été demandé pour ce chantier.' };
  if (reservation === 'echec') return { message: `${ECHEC} Aucun email n’est parti.` };
  const r = await envoyerEmail({ a: c.email, sujet: c.sujet, texte: c.texte, repondreA: c.repondreA });
  await conclureEnvoi(sb, envoiId.data, r);
  revalidatePath(`/factures/${id.data}`);
  return r.ok ? { succes: `Demande d’avis envoyée à ${c.email}.` }
    : { message: `${r.erreur} Partagez le message à la main.`, texte: c.texte, niveau: 'demande_avis' };
}

/** Message de demande d'avis copié ou partagé : noté une seule fois (canal « manuel »). */
export async function noterDemandeAvisPartagee(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const id = idDe(fd, 'id');
  const envoiId = idDe(fd, 'id_nouveau');
  if (!id.success || !envoiId.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const c = await controler(sb, session.organisationId, id.data);
  if ('erreur' in c) return { message: c.erreur };
  const { error } = await sb.from('envois').insert({
    id: envoiId.data, organisation_id: session.organisationId, document_type: 'facture', document_id: id.data, nature: 'demande_avis', canal: 'manuel',
  });
  if (error && error.code !== '23505') return { message: 'La demande n’a pas pu être notée : réessayez.' };
  revalidatePath(`/factures/${id.data}`);
  return { succes: 'Demande d’avis notée.' };
}

/** Opposition du client aux sollicitations (demande d'avis), datée ; levée sur sa demande. */
export async function opposerSollicitations(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'client_id');
  if (!id.success) return { message: INCOMPLET };
  const refus = fd.get('refus') === 'oui';
  const sb = await clientServeur();
  const { data, error } = await sb.from('clients').update({ refus_sollicitations_le: refus ? new Date().toISOString() : null }).eq('id', id.data).select('id');
  if (error) return { message: ECHEC };
  if (!data?.length) return { message: 'Client introuvable.' };
  revalidatePath(`/clients/${id.data}`);
  return { succes: refus ? 'Noté : ce client ne recevra plus de demande d’avis.' : 'Le client accepte de nouveau les demandes d’avis.' };
}
