import 'server-only';
import { clientServeur } from '@/lib/supabase/serveur';

/** Taux de TVA proposés (Paramètres > Taux de TVA), libellé avec « À VÉRIFIER » s'il y a lieu. */
export async function tauxProposes(): Promise<{ taux_bp: number; libelle: string }[]> {
  const supabase = await clientServeur();
  const { data } = await supabase.from('taux_tva').select('taux_bp, libelle, a_verifier').eq('actif', true).order('taux_bp', { ascending: false });
  return (data ?? []).map((t) => ({ taux_bp: t.taux_bp, libelle: `${t.libelle}${t.a_verifier ? ' (À VÉRIFIER)' : ''}` }));
}
