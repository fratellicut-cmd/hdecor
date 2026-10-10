'use server';

import { revalidatePath } from 'next/cache';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import type { EtatFormulaire } from '@/lib/etat-formulaire';

export async function toutMarquerLu(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  await verifierSession();
  if (fd.get('tout') !== 'oui') return { message: 'Formulaire incomplet : rechargez la page.' };
  const sb = await clientServeur();
  const { error } = await sb.from('notifications').update({ lu_le: new Date().toISOString() }).is('lu_le', null);
  if (error) return { message: 'L’enregistrement a échoué. Réessayez.' };
  revalidatePath('/', 'layout');
  return { succes: 'Tout est marqué comme lu.' };
}

export async function choisirNotificationsEmail(_: EtatFormulaire, fd: FormData): Promise<EtatFormulaire> {
  const session = await verifierSession();
  const actif = fd.get('actif') === 'oui';
  const sb = await clientServeur();
  const { error } = await sb.from('parametres_entreprise').update({ notifier_par_email: actif }).eq('organisation_id', session.organisationId);
  if (error) return { message: 'L’enregistrement a échoué. Réessayez.' };
  revalidatePath('/parametres/notifications');
  return { succes: actif ? 'Notifications par email activées.' : 'Notifications par email désactivées.' };
}
