import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';
import { nomAffiche } from '@/domain/clients';

/** Clients actifs (non anonymisés) pour une liste de choix, triés par nom affiché. */
export async function clientsPourChoix(): Promise<{ id: string; nom: string }[]> {
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('clients').select('id, type, civilite, nom, prenom, raison_sociale, anonymise_le')
    .is('anonymise_le', null).order('nom').limit(1000);
  if (error) throw new Error('Lecture impossible : clients.');
  return data.map((c) => ({ id: c.id, nom: nomAffiche(c) })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
