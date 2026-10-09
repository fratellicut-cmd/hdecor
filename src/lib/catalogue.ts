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
  const { data } = await supabase.from('teintes').select('id, nom, actif').eq('actif', true).order('nom').limit(500);
  const liste = data ?? [];
  // La teinte déjà choisie reste dans la liste, même archivée ou au-delà de la limite : sinon un nouvel enregistrement l'effacerait.
  if (dejaChoisie && !liste.some((t) => t.id === dejaChoisie)) {
    const { data: choisie } = await supabase.from('teintes').select('id, nom, actif').eq('id', dejaChoisie).maybeSingle();
    if (choisie) liste.unshift(choisie);
  }
  return liste.map((t) => ({ id: t.id, nom: t.actif ? t.nom : `${t.nom} (archivée)` }));
}
