/**
 * Garde du jeu de démonstration : il ne se charge QUE dans la base locale
 * « hdecor_demo », jamais dans une base réelle (documents émis immuables,
 * numérotation sans trou : une démo chargée ailleurs ne s'effacerait pas).
 */
export type CibleDemo = {
  /** Base servie par la pile locale (fichier .supabase-local/base-active). */
  baseActive: string | null;
  urlSupabase: string | undefined;
  urlSite: string;
  env: Record<string, string | undefined>;
};

const locale = (u: string | undefined) => {
  try { return !!u && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(u).hostname); } catch { return false; }
};

/** Raisons de refuser le chargement ; vide si la cible est la démo locale. */
export function refusDemo(c: CibleDemo): string[] {
  const r: string[] = [];
  if (c.baseActive !== 'hdecor_demo') r.push(`La pile locale sert « ${c.baseActive ?? 'inconnue'} » : lancez d'abord npm run demo:pile (base hdecor_demo).`);
  if (!locale(c.urlSupabase)) r.push('NEXT_PUBLIC_SUPABASE_URL n’est pas une adresse locale.');
  if (!locale(c.urlSite)) r.push('Le serveur visé n’est pas local.');
  // Aucun envoi réel possible pendant la démo.
  for (const cle of ['RESEND_API_KEY', 'STRIPE_SECRET_KEY']) if (c.env[cle]) r.push(`${cle} est définie : retirez-la avant de charger la démo (aucun email ni paiement réel).`);
  return r;
}
