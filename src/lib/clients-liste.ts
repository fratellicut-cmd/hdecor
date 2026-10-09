import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';
import { nomAffiche } from '@/domain/clients';
import { formaterDateHeure } from '@/domain/formats';

/**
 * Clients actifs (non anonymisés) pour une liste de choix, triés par nom affiché.
 * Homonymes : ville, sinon code postal, fin du téléphone ou email ; s'ils se
 * ressemblent encore, la date de création les distingue.
 */
export async function clientsPourChoix(): Promise<{ id: string; nom: string }[]> {
  const supabase = await clientServeur();
  const { data, error } = await supabase.from('clients')
    .select('id, type, civilite, nom, prenom, raison_sociale, anonymise_le, fact_ville, fact_code_postal, telephone, email, created_at')
    .is('anonymise_le', null).order('nom').limit(1000);
  if (error) throw new Error('Lecture impossible : clients.');
  const compter = (l: string[]) => l.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>());
  const noms = data.map((c) => ({ c, nom: nomAffiche(c) }));
  const parNom = compter(noms.map((x) => x.nom));
  const premiers = noms.map(({ c, nom }) => {
    if ((parNom.get(nom) ?? 0) < 2) return { c, nom, homonyme: false };
    const detail = c.fact_ville?.trim() || c.fact_code_postal?.trim()
      || (c.telephone ? `tél. …${c.telephone.replace(/\D/g, '').slice(-4)}` : null) || c.email?.trim() || null;
    return { c, nom: detail ? `${nom} (${detail})` : nom, homonyme: true };
  });
  const parLibelle = compter(premiers.map((x) => x.nom));
  return premiers.map(({ c, nom, homonyme }) => ({
    id: c.id,
    nom: homonyme && (parLibelle.get(nom) ?? 0) > 1 ? `${nom} (créé le ${formaterDateHeure(c.created_at)})` : nom,
  })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}
