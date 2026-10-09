import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';

/** Marques déjà saisies (suggestions du champ « Marque »). */
export async function marquesConnues(): Promise<string[]> {
  const supabase = await clientServeur();
  const { data } = await supabase.from('produits').select('marque').order('marque').limit(2000);
  return [...new Set((data ?? []).map((p) => p.marque))];
}

/** Teintes du nuancier proposées dans les choix ; une teinte archivée déjà choisie reste affichée. */
export async function teintesAuChoix(dejaChoisie?: string | null): Promise<{ id: string; nom: string }[]> {
  const supabase = await clientServeur();
  const { data } = await supabase.from('teintes').select('id, nom, actif').order('nom').limit(500);
  return (data ?? []).filter((t) => t.actif || t.id === dejaChoisie).map((t) => ({ id: t.id, nom: t.actif ? t.nom : `${t.nom} (archivée)` }));
}
