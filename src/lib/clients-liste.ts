import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';
import { nomAffiche } from '@/domain/clients';

/**
 * Clients actifs (non anonymisés) pour une liste de choix, triés par nom affiché.
 * Homonymes : la ville, sinon la fin du téléphone, les distingue.
 */
export async function clientsPourChoix(): Promise<{ id: string; nom: string }[]> {
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('clients').select('id, type, civilite, nom, prenom, raison_sociale, anonymise_le, fact_ville, telephone')
    .is('anonymise_le', null).order('nom').limit(1000);
  if (error) throw new Error('Lecture impossible : clients.');
  const noms = data.map((c) => ({ c, nom: nomAffiche(c) }));
  const compte = new Map<string, number>();
  for (const { nom } of noms) compte.set(nom, (compte.get(nom) ?? 0) + 1);
  return noms.map(({ c, nom }) => {
    if ((compte.get(nom) ?? 0) < 2) return { id: c.id, nom };
    const detail = c.fact_ville?.trim() || (c.telephone ? `tél. …${c.telephone.replace(/\D/g, '').slice(-4)}` : 'sans ville');
    return { id: c.id, nom: `${nom} (${detail})` };
  }).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
