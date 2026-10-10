'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { erreursParChamp, valeursTexte, type EtatFormulaire } from '@/lib/etat-formulaire';
import { texteObligatoire } from '@/lib/validation/champs';
import { aujourdHuiParis } from '@/domain/dates';
import { ELEMENTS_FIN_MAX, LIBELLE_FIN_MAX, lireModeleFin, listeFin, type ElementFin } from '@/domain/fin-chantier';

const ECHEC = 'L’enregistrement a échoué. Vérifiez la connexion et réessayez.';
const INCOMPLET = 'Formulaire incomplet : rechargez la page.';
const idDe = (fd: FormData, cle: string) => z.uuid().safeParse(fd.get(cle));

type Sb = Awaited<ReturnType<typeof clientServeur>>;

/** Liste actuelle du chantier (ou le modèle des Réglages s'il n'en a pas encore). */
async function lireListe(sb: Sb, organisationId: string, chantierId: string): Promise<ElementFin[] | null> {
  const [{ data: ch }, { data: liste }, { data: p }] = await Promise.all([
    sb.from('chantiers').select('id').eq('id', chantierId).maybeSingle(),
    sb.from('checklists_fin_chantier').select('items').eq('chantier_id', chantierId).maybeSingle(),
    sb.from('parametres_entreprise').select('liste_fin_chantier').eq('organisation_id', organisationId).maybeSingle(),
  ]);
  if (!ch) return null;
  return listeFin(liste ? (liste.items as ElementFin[]) : null, p?.liste_fin_chantier ?? []);
}

async function ecrireListe(sb: Sb, organisationId: string, chantierId: string, items: ElementFin[]) {
  return sb.from('checklists_fin_chantier').upsert({ organisation_id: organisationId, chantier_id: chantierId, items },
    { onConflict: 'organisation_id,chantier_id' });
}

/** Coche ou décoche un élément (date du jour). */
export async function cocherElementFin(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const chantier = idDe(fd, 'chantier_id');
  const rang = z.coerce.number().int().min(0).max(ELEMENTS_FIN_MAX - 1).safeParse(fd.get('rang'));
  if (!chantier.success || !rang.success) return { message: INCOMPLET };
  const sb = await clientServeur();
  const liste = await lireListe(sb, session.organisationId, chantier.data);
  if (!liste) return { message: 'Chantier introuvable.' };
  const element = liste[rang.data];
  if (!element) return { message: 'Élément introuvable : rechargez la page.' };
  // Le libellé envoyé doit être celui de la ligne (liste modifiée entre-temps : rien n'est coché au hasard).
  if (fd.get('libelle') !== element.libelle) return { message: 'La liste a changé : rechargez la page.' };
  const fait = fd.get('fait') === '1';
  const items = liste.map((e, i) => (i === rang.data ? { ...e, fait_le: fait ? aujourdHuiParis() : null } : e));
  const { error } = await ecrireListe(sb, session.organisationId, chantier.data, items);
  if (error) return { message: ECHEC };
  revalidatePath(`/chantiers/${chantier.data}/fin`);
  revalidatePath(`/chantiers/${chantier.data}`);
  return { succes: fait ? `« ${element.libelle} » fait.` : `« ${element.libelle} » à refaire.` };
}

export async function ajouterElementFin(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const chantier = idDe(fd, 'chantier_id');
  if (!chantier.success) return { message: INCOMPLET };
  const lu = z.object({ libelle: texteObligatoire('Élément', LIBELLE_FIN_MAX) }).safeParse({ libelle: fd.get('libelle') });
  if (!lu.success) return { erreurs: erreursParChamp(lu.error), valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const liste = await lireListe(sb, session.organisationId, chantier.data);
  if (!liste) return { message: 'Chantier introuvable.' };
  if (liste.length >= ELEMENTS_FIN_MAX) return { message: `${ELEMENTS_FIN_MAX} éléments au maximum.` };
  if (liste.some((e) => e.libelle.toLowerCase() === lu.data.libelle.toLowerCase())) return { erreurs: { libelle: 'Déjà dans la liste.' }, valeurs: valeursTexte(fd) };
  const { error } = await ecrireListe(sb, session.organisationId, chantier.data, [...liste, { libelle: lu.data.libelle, fait_le: null }]);
  if (error) return { message: ECHEC, valeurs: valeursTexte(fd) };
  revalidatePath(`/chantiers/${chantier.data}/fin`);
  return { succes: `« ${lu.data.libelle} » ajouté.` };
}

/** Modèle de liste (Réglages) : appliqué aux chantiers qui n'ont pas encore commencé la leur. */
export async function enregistrerModeleFin(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const lu = lireModeleFin(String(fd.get('liste') ?? ''));
  if ('erreur' in lu) return { erreurs: { liste: lu.erreur }, valeurs: valeursTexte(fd) };
  const sb = await clientServeur();
  const { error } = await sb.from('parametres_entreprise').update({ liste_fin_chantier: lu.elements }).eq('organisation_id', session.organisationId);
  if (error) return { message: ECHEC, valeurs: valeursTexte(fd) };
  revalidatePath('/parametres/fin-de-chantier');
  return { succes: `Modèle enregistré (${lu.elements.length} élément${lu.elements.length > 1 ? 's' : ''}).` };
}
