'use server';

import { clientServeur } from '@/lib/supabase/serveur';
import { envPublique } from '@/lib/env';
import { schemaEmail } from '@/lib/validation/auth';
import type { EtatFormulaire } from '@/lib/etat-formulaire';

export async function demanderReinitialisation(_: EtatFormulaire, formData: FormData): Promise<EtatFormulaire> {
  const email = schemaEmail.safeParse(formData.get('email'));
  if (!email.success) return { erreurs: { email: email.error.issues[0].message } };
  const supabase = await clientServeur();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${envPublique.NEXT_PUBLIC_SITE_URL}/auth/confirmer?suite=${encodeURIComponent('/compte/nouveau-mot-de-passe')}`,
  });
  return { succes: 'Si un compte correspond à cette adresse, un lien pour choisir un nouveau mot de passe vient de lui être envoyé.' };
}
