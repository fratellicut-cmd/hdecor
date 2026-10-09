import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types-base';
import type { Insertion } from '@/lib/supabase/types';
import type { ResultatEmail } from '@/lib/email';

type Sb = SupabaseClient<Database>;

/**
 * Envoi d'un email RÉSERVÉ en base avant l'envoi (statut « en_cours ») :
 * la clé primaire (identifiant du formulaire) ou l'index unique des relances
 * refuse une seconde réservation, donc un second email. Renvoie :
 *  - 'reserve' : à nous d'envoyer ;
 *  - 'deja' : un autre envoi identique est en cours ou fait (rien à envoyer) ;
 *  - 'echec' : réservation impossible (rien n'est envoyé).
 */
export async function reserverEnvoi(sb: Sb, envoi: Omit<Insertion<'envois'>, 'canal' | 'statut'> & { id: string }): Promise<'reserve' | 'deja' | 'echec'> {
  const { error } = await sb.from('envois').insert({ ...envoi, canal: 'email', statut: 'en_cours' });
  if (!error) return 'reserve';
  if (error.code === '23505') return 'deja';
  console.error('Envoi non réservé', error.code);
  return 'echec';
}

/** Conclusion de l'envoi réservé (une seule fois) ; un échec d'écriture est signalé, l'envoi reste « en cours » (jamais renvoyé). */
export async function conclureEnvoi(sb: Sb, id: string, r: ResultatEmail): Promise<void> {
  const { error } = await sb.from('envois').update({
    statut: r.ok ? 'envoye' : 'echec', fournisseur_id: r.ok ? r.id : null, erreur: r.ok ? null : r.erreur,
  }).eq('id', id).eq('statut', 'en_cours');
  if (error) console.error('Envoi conclu mais non enregistré', id, error.code);
}
