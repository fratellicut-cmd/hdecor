'use server';

import { after } from 'next/server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { viderFileSuppression } from '@/lib/stockage-admin';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { schemaClient, type SaisieClient } from '@/lib/validation/clients';
import { nomAffiche } from '@/domain/clients';
import { texteRecherche } from '@/domain/recherche';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const REFUS = 'Ces informations ont été refusées par la base (format inattendu). Vérifiez les champs puis réessayez.';
const identifiant = z.uuid();

function lireChamps(formData: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) if (!k.startsWith('$')) o[k] = v;
  return o;
}

/** Erreur de contrainte (classe 23) : la saisie est en cause, pas le réseau. */
const messageErreur = (code: string | undefined) => (code?.startsWith('23') || code === 'P0001' ? REFUS : ECHEC);

const chiffres = (t: string | null) => (t ?? '').replace(/\D/g, '').replace(/^(00)?33/, '0');

/**
 * Fiche existante avec le même téléphone, ou le même nom : prénom + nom pour
 * un particulier, raison sociale pour un professionnel (deux entreprises
 * peuvent avoir un contact homonyme).
 */
async function chercherDoublon(saisie: SaisieClient): Promise<{ id: string; nom: string } | null> {
  const supabase = await clientServeur();
  const tel = chiffres(saisie.telephone);
  const pro = saisie.type === 'professionnel' && saisie.raison_sociale !== null;
  const nomCherche = pro ? saisie.raison_sociale! : saisie.nom;
  const memeNom = (c: { type: string; nom: string; prenom: string | null; raison_sociale: string | null }) => (pro
    ? c.type === 'professionnel' && texteRecherche(c.raison_sociale ?? '') === texteRecherche(nomCherche)
    : c.type === 'particulier' && texteRecherche(c.nom) === texteRecherche(saisie.nom)
      && texteRecherche(c.prenom ?? '') === texteRecherche(saisie.prenom ?? ''));
  const recherches = [nomCherche, ...(tel.length >= 9 ? [saisie.telephone!] : [])];
  for (const texte of recherches) {
    const { data } = await supabase.rpc('rechercher_clients', { p_texte: texte, p_limite: 20 });
    const trouve = (data ?? []).find((c) => (tel.length >= 9 && chiffres(c.telephone) === tel) || memeNom(c));
    if (trouve) return { id: trouve.id, nom: nomAffiche(trouve) };
  }
  return null;
}

/** Création (sans « id ») ou modification (avec « id ») d'une fiche client. */
export async function enregistrerClient(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = schemaClient.safeParse(lireChamps(formData));
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(formData) };

  const supabase = await clientServeur();
  const idSaisi = formData.get('id');
  let id: string;
  if (idSaisi) {
    const idLu = identifiant.safeParse(idSaisi);
    if (!idLu.success) return { message: 'Fiche introuvable.' };
    // La RLS limite la mise à jour à l'organisation ; une fiche anonymisée
    // est figée (filtre ici, trigger en base).
    const { data, error } = await supabase.from('clients').update(lu.data)
      .eq('id', idLu.data).is('anonymise_le', null).select('id').maybeSingle();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
    if (!data) return { message: 'Fiche introuvable ou anonymisée : modification impossible.' };
    id = data.id;
  } else {
    if (formData.get('creer_quand_meme') !== '1') {
      const doublon = await chercherDoublon(lu.data);
      if (doublon) return { doublon, valeurs: valeursTexte(formData) };
    }
    const { data, error } = await supabase.from('clients')
      .insert({ ...lu.data, organisation_id: session.organisationId }).select('id').single();
    if (error) return { message: messageErreur(error.code), valeurs: valeursTexte(formData) };
    id = data.id;
  }
  revalidatePath('/clients');
  redirect(`/clients/${id}?enregistre=1`);
}

/** Interblocage : PostgreSQL annule l'une des transactions, on la rejoue. */
const INTERBLOCAGE = '40P01';
const ESSAIS = 3;

/**
 * Effacement RGPD (anonymisation) d'un client. Les fichiers nominatifs sont
 * mis en file dans la même transaction ; leur suppression du stockage se fait
 * après la réponse (after), et la tâche planifiée reprend ce qui échoue.
 */
export async function effacerClient(formData: FormData) {
  const session = await verifierSession();
  const id = identifiant.safeParse(formData.get('id'));
  if (!id.success) redirect('/clients');
  if (formData.get('confirmation') !== 'on') redirect(`/clients/${id.data}?effacement=non-confirme`);

  const supabase = await clientServeur();
  let erreur: { code?: string } | null = null;
  let fichiers = 0;
  for (let essai = 1; essai <= ESSAIS; essai += 1) {
    const r = await supabase.rpc('effacer_client', { p_client_id: id.data });
    erreur = r.error;
    fichiers = r.data ?? 0;
    if (erreur?.code !== INTERBLOCAGE) break;
    await new Promise((resolve) => setTimeout(resolve, 100 * essai));
  }
  if (erreur) redirect(`/clients/${id.data}?effacement=echec`);

  if (fichiers > 0) {
    after(async () => {
      try {
        await viderFileSuppression({ organisationId: session.organisationId });
      } catch (e) {
        console.error('Effacement : suppression des fichiers reportée à la tâche planifiée', e instanceof Error ? e.message : e);
      }
    });
  }
  revalidatePath('/clients');
  redirect(`/clients/${id.data}?effacement=ok`);
}
