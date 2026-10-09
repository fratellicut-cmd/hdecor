'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { schemaEvenement, schemaPlanification, schemaRappel, schemaTemps } from '@/lib/validation/planning';
import { finDeJourParis, instantParis } from '@/domain/dates';
import { blocsOuvres, finChantier, premierJourOuvre } from '@/domain/pilotage';
import { formaterDate } from '@/domain/formats';

/** Heure d'un rappel saisi sans heure (affichée dans le formulaire). */
const HEURE_RAPPEL_PAR_DEFAUT = '08:00';
const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const idDe = (fd: FormData, cle: string) => z.uuid().safeParse(fd.get(cle));
const champs = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k]) => !k.startsWith('$')));

const revalider = (chantierId?: string | null) => {
  revalidatePath('/planning');
  revalidatePath('/');
  if (chantierId) revalidatePath(`/chantiers/${chantierId}`);
};

/** Bornes (instants UTC) d'un événement saisi en heure de Paris ; journée entière : de 0 h au soir du dernier jour. */
function bornes(e: { date_debut: string; date_fin: string | null; journee_entiere: boolean; heure_debut: string | null; heure_fin: string | null }) {
  const fin = e.date_fin ?? e.date_debut;
  return e.journee_entiere
    ? { debut: instantParis(e.date_debut, '00:00').toISOString(), fin: finDeJourParis(fin).toISOString() }
    : { debut: instantParis(e.date_debut, e.heure_debut!).toISOString(), fin: instantParis(fin, e.heure_fin!).toISOString() };
}

/** Création (identifiant fixé par le formulaire) ou modification d'un événement du planning. */
export async function enregistrerEvenement(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaEvenement.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const existant = fd.get('id') ? idDe(fd, 'id') : null;
  const nouveau = idDe(fd, 'id_nouveau');
  if (existant ? !existant.success : !nouveau.success) return { message: INCOMPLET };
  const e = lu.data;
  // Un chantier se planifie depuis sa fiche (plages de jours ouvrés, date de début du chantier).
  if (e.type === 'chantier') return { erreurs: { type: 'Un chantier se planifie depuis sa fiche : « Planning ».' }, valeurs: valeursTexte(fd) };
  const valeurs = { type: e.type, chantier_id: e.chantier_id, titre: e.titre, journee_entiere: e.journee_entiere, notes: e.notes, ...bornes(e) };
  const sb = await clientServeur();
  const { error } = existant?.success
    ? await sb.from('evenements').update(valeurs).eq('id', existant.data)
    : await sb.from('evenements').upsert({ ...valeurs, id: nouveau.data!, organisation_id: session.organisationId }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: error.code?.startsWith('23') ? 'Ces informations ont été refusées (chantier introuvable ou durée trop longue).' : ECHEC, valeurs: valeursTexte(fd) };
  revalider(e.chantier_id);
  return { succes: existant ? 'Événement modifié.' : `Ajouté au planning le ${formaterDate(e.date_debut)}.` };
}

export async function supprimerEvenement(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  if (fd.get('confirmation') !== 'on') return { message: 'Cochez la case pour confirmer.' };
  const sb = await clientServeur();
  const { data, error } = await sb.from('evenements').delete().eq('id', id.data).select('chantier_id');
  if (error) return { message: ECHEC };
  revalider(data?.[0]?.chantier_id);
  return { succes: 'Événement supprimé.' };
}

/**
 * Planifie un chantier : N jours ouvrés (week-ends exclus ; jours fériés non
 * comptés, À VÉRIFIER à la main), enregistrés en plages du lundi au vendredi
 * (rien n'apparaît le week-end), et la date de début prévue du chantier.
 * Replanifier : les nouvelles plages sont créées AVANT le retrait des anciennes
 * (un échec laisse l'ancien planning intact).
 */
export async function planifierChantier(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaPlanification.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { data: ch } = await sb.from('chantiers').select('id, nom, ville').eq('id', lu.data.chantier_id).maybeSingle();
  if (!ch) return { message: 'Chantier introuvable.' };
  const debut = premierJourOuvre(lu.data.date_debut);
  const fin = finChantier(debut, lu.data.duree_jours);
  const { data: anciens, error: e0 } = await sb.from('evenements').select('id').eq('chantier_id', ch.id).eq('type', 'chantier');
  if (e0) return { message: ECHEC, valeurs: valeursTexte(fd) };
  const titre = [ch.nom, ch.ville].filter(Boolean).join(', ');
  const { error: e1 } = await sb.from('evenements').insert(blocsOuvres(debut, fin).map((b) => ({
    organisation_id: session.organisationId, chantier_id: ch.id, type: 'chantier', titre,
    debut: instantParis(b.du, '00:00').toISOString(), fin: finDeJourParis(b.au).toISOString(), journee_entiere: true,
  })));
  if (e1) return { message: ECHEC, valeurs: valeursTexte(fd) };
  if (anciens.length) {
    const { error: e2 } = await sb.from('evenements').delete().in('id', anciens.map((a) => a.id));
    if (e2) return { message: 'Nouveau planning enregistré, mais l’ancien n’a pas été retiré : replanifiez pour le retirer.' };
  }
  const { error: e3 } = await sb.from('chantiers').update({ date_debut_prevue: debut, duree_estimee_jours: lu.data.duree_jours }).eq('id', ch.id);
  if (e3) return { message: 'Planning enregistré, mais la date de début du chantier n’a pas été mise à jour : réessayez.' };
  revalider(ch.id);
  return { succes: `Chantier planifié du ${formaterDate(debut)} au ${formaterDate(fin)} (${lu.data.duree_jours.toString().replace('.', ',')} j ouvrés).` };
}

/** Rappel personnel (séchage, appel, commande…), affiché dans « À faire » à son échéance. */
export async function ajouterRappel(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaRappel.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const nouveau = idDe(fd, 'id_nouveau');
  if (!nouveau.success) return { message: INCOMPLET };
  const type = fd.get('type') === 'sechage' ? 'sechage' : 'libre';
  const sb = await clientServeur();
  const { error } = await sb.from('rappels').upsert({
    id: nouveau.data, organisation_id: session.organisationId, type, titre: lu.data.titre, chantier_id: lu.data.chantier_id,
    echeance: instantParis(lu.data.date, lu.data.heure ?? HEURE_RAPPEL_PAR_DEFAUT).toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: ECHEC, valeurs: valeursTexte(fd) };
  revalider(lu.data.chantier_id);
  return { succes: `Rappel noté pour le ${formaterDate(lu.data.date)}${lu.data.heure ? ` à ${lu.data.heure}` : ''}.` };
}

/** Rappel de séchage : « recouvrir à partir de » maintenant + N heures. */
export async function ajouterRappelSechage(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const chantierId = idDe(fd, 'chantier_id');
  const nouveau = idDe(fd, 'id_nouveau');
  const heures = z.preprocess((v) => Number(String(v ?? '').replace(',', '.')), z.number().min(0.5).max(168)).safeParse(fd.get('heures'));
  if (!chantierId.success || !nouveau.success) return { message: INCOMPLET };
  if (!heures.success) return { erreurs: { heures: 'Durée de séchage : de 0,5 à 168 heures.' }, valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { data: ch } = await sb.from('chantiers').select('nom').eq('id', chantierId.data).maybeSingle();
  if (!ch) return { message: 'Chantier introuvable.' };
  const echeance = new Date(Date.now() + Math.round(heures.data * 60) * 60_000);
  const { error } = await sb.from('rappels').upsert({
    id: nouveau.data, organisation_id: session.organisationId, type: 'sechage', chantier_id: chantierId.data,
    titre: `Séchage terminé : couche suivante possible (${ch.nom})`, echeance: echeance.toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: ECHEC };
  revalider(chantierId.data);
  return { succes: `Rappel de séchage noté : couche suivante possible vers ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(echeance)}. Il s’affichera dans « À faire » (pas d’alerte sur le téléphone).` };
}

export async function marquerRappelFait(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.from('rappels').update({ statut: 'envoye', lu_le: new Date().toISOString() })
    .eq('id', id.data).eq('statut', 'a_envoyer').select('chantier_id');
  if (error) return { message: ECHEC };
  revalider(data?.[0]?.chantier_id);
  return { succes: 'Rappel retiré de la liste.' };
}

// --------------------------------------------------------------------------
// Temps passé sur un chantier (rentabilité réelle)
// --------------------------------------------------------------------------

export async function ajouterTemps(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaTemps.safeParse(champs(fd));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const nouveau = idDe(fd, 'id_nouveau');
  if (!nouveau.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { error } = await sb.from('temps_passes').upsert({
    id: nouveau.data, organisation_id: session.organisationId, chantier_id: lu.data.chantier_id, jour: lu.data.jour,
    minutes: lu.data.minutes, tache: lu.data.tache,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) return { message: ECHEC, valeurs: valeursTexte(fd) };
  revalider(lu.data.chantier_id);
  const h = Math.floor(lu.data.minutes / 60);
  const m = lu.data.minutes % 60;
  return { succes: `${h} h${m ? ` ${String(m).padStart(2, '0')}` : ''} noté${h > 1 ? 'es' : 'e'} le ${formaterDate(lu.data.jour)}.` };
}

export async function supprimerTemps(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const id = idDe(fd, 'id');
  if (!id.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const { data, error } = await sb.from('temps_passes').delete().eq('id', id.data).select('chantier_id');
  if (error) return { message: ECHEC };
  revalider(data?.[0]?.chantier_id);
  return { succes: 'Temps retiré.' };
}
