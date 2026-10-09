'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { schemaCodeTotp, schemaNouveauMotDePasse } from '@/lib/validation/auth';
import { erreursParChamp, type EtatFormulaire } from '@/lib/etat-formulaire';

export async function changerMotDePasse(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  const lu = schemaNouveauMotDePasse.safeParse({
    motDePasse: formData.get('motDePasse'),
    confirmation: formData.get('confirmation'),
  });
  if (!lu.success) return { erreurs: erreursParChamp(lu.error) };
  const supabase = await clientServeur();
  const { error } = await supabase.auth.updateUser({ password: lu.data.motDePasse });
  if (error) {
    if (error.code === 'same_password') return { erreurs: { motDePasse: 'Choisissez un mot de passe différent de l’actuel.' } };
    if (error.code === 'weak_password') return { erreurs: { motDePasse: 'Mot de passe trop faible : allongez-le.' } };
    if (error.code === 'reauthentication_needed') return { message: 'Par sécurité, reconnectez-vous puis recommencez.' };
    return { message: 'Le mot de passe n’a pas pu être changé. Réessayez.' };
  }
  if (formData.get('apresOubli') === '1') redirect('/');
  return { succes: 'Mot de passe changé.' };
}

export type EtatTotp = EtatFormulaire & { facteurId?: string; qr?: string; secret?: string };

export async function commencerTotp(): Promise<EtatTotp> {
  await verifierSession();
  const supabase = await clientServeur();
  const { data: liste } = await supabase.auth.mfa.listFactors();
  // Un enrôlement abandonné laisse un facteur non vérifié : on le retire.
  for (const f of liste?.all ?? []) {
    if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Téléphone ${Date.now()}` });
  if (error || !data) return { message: 'Impossible de préparer la double authentification. Réessayez.' };
  return { facteurId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmerTotp(etat: EtatTotp, formData: FormData): Promise<EtatTotp> {
  await verifierSession();
  const lu = schemaCodeTotp.safeParse({ code: formData.get('code'), facteurId: formData.get('facteurId') });
  if (!lu.success) return { ...etat, erreurs: erreursParChamp(lu.error) };
  const supabase = await clientServeur();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: lu.data.facteurId, code: lu.data.code });
  if (error) return { ...etat, erreurs: { code: 'Code incorrect. Saisissez le code affiché en ce moment par l’application.' } };
  revalidatePath('/compte');
  return { succes: 'Double authentification activée. Le code sera demandé à chaque connexion.' };
}

export async function desactiverTotp(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  if (session.niveauAuth !== 'aal2') return { message: 'Reconnectez-vous avec votre code avant de désactiver la double authentification.' };
  const facteurId = z.uuid().safeParse(formData.get('facteurId'));
  if (!facteurId.success) return { message: 'Demande invalide. Rechargez la page.' };
  const supabase = await clientServeur();
  const { error } = await supabase.auth.mfa.unenroll({ factorId: facteurId.data });
  if (error) return { message: 'La double authentification n’a pas pu être désactivée.' };
  revalidatePath('/compte');
  return { succes: 'Double authentification désactivée.' };
}
