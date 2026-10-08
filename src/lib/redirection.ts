/**
 * Ne garde qu'un chemin INTERNE pour les redirections « ?suite=… » : refuse
 * les URL absolues, « //domaine », « /\domaine » et tout caractère de
 * contrôle (redirection ouverte).
 */
export function cheminInterneSur(suite: unknown, defaut = '/'): string {
  if (typeof suite !== 'string' || suite.length === 0 || suite.length > 512) return defaut;
  if (!suite.startsWith('/') || suite.startsWith('//') || suite.startsWith('/\\')) return defaut;
  if (/[\u0000-\u001f\u007f\\]/.test(suite)) return defaut;
  return suite;
}
