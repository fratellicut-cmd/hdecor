import 'server-only';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';

/** Paramètres de l'organisation de la session (RLS). */
export async function lireParametres() {
  const session = await verifierSession();
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('parametres_entreprise').select('*')
    .eq('organisation_id', session.organisationId).single();
  if (error || !data) throw new Error('Paramètres introuvables.');
  return data;
}
