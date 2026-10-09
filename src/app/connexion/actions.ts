'use server';

import { redirect } from 'next/navigation';
import { clientServeur } from '@/lib/supabase/serveur';
import { niveauAuth } from '@/lib/niveau-auth';
import { envPublique } from '@/lib/env';
import { cheminInterneSur } from '@/lib/redirection';
import { schemaCodeTotp, schemaConnexion, schemaEmail } from '@/lib/validation/auth';
import { erreursParChamp, type EtatFormulaire } from '@/lib/etat-formulaire';

/** Message unique : ne révèle jamais si le compte existe. */
const ECHEC_CONNEXION = 'Email ou mot de passe incorrect.';

export async function seConnecter(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const lu = schemaConnexion.safeParse({
    email: formData.get('email'),
    motDePasse: formData.get('motDePasse'),
    suite: formData.get('suite') ?? undefined,
  });
  if (!lu.success) {
    return { erreurs: erreursParChamp(lu.error), valeurs: { email: String(formData.get('email') ?? '') } };
  }
  const supabase = await clientServeur();
  const { error } = await supabase.auth.signInWithPassword({
    email: lu.data.email,
    password: lu.data.motDePasse,
  });
  if (error) {
    const trop = error.status === 429;
    return {
      message: trop ? 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' : ECHEC_CONNEXION,
      valeurs: { email: lu.data.email },
    };
  }
  const suite = cheminInterneSur(lu.data.suite);
  const { data: claims } = await supabase.auth.getClaims();
  const niveau = await niveauAuth(supabase, claims?.claims?.aal);
  if (niveau.requis === 'aal2' && niveau.actuel !== 'aal2') {
    redirect(`/connexion/double-authentification?suite=${encodeURIComponent(suite)}`);
  }
  redirect(suite);
}

export async function envoyerLienDeConnexion(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const email = schemaEmail.safeParse(formData.get('email'));
  if (!email.success) return { erreurs: { email: email.error.issues[0].message } };
  const suite = cheminInterneSur(formData.get('suite'));
  const supabase = await clientServeur();
  await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${envPublique.NEXT_PUBLIC_SITE_URL}/auth/confirmer?suite=${encodeURIComponent(suite)}`,
    },
  });
  // Réponse identique que le compte existe ou non, et même si l'envoi
  // échoue : aucune information ne fuit.
  return { succes: 'Si un compte correspond à cette adresse, un lien de connexion vient de lui être envoyé.' };
}

export async function verifierCodeTotp(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const lu = schemaCodeTotp.safeParse({ code: formData.get('code'), facteurId: formData.get('facteurId') });
  if (!lu.success) return { erreurs: erreursParChamp(lu.error) };
  const supabase = await clientServeur();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: lu.data.facteurId, code: lu.data.code });
  if (error) return { erreurs: { code: 'Code incorrect ou expiré. Utilisez le code affiché en ce moment.' } };
  redirect(cheminInterneSur(formData.get('suite')));
}

export async function seDeconnecter() {
  const supabase = await clientServeur();
  await supabase.auth.signOut();
  redirect('/connexion');
}
