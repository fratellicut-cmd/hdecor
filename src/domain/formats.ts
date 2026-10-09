/**
 * Formats français (affichage) et lecture des saisies.
 *
 * Règles du projet : l'argent est manipulé en CENTIMES ENTIERS ; l'affichage
 * utilise la virgule décimale, l'espace insécable fine pour les milliers et
 * le symbole € ; les dates s'affichent en JJ/MM/AAAA (fuseau Europe/Paris).
 * Aucune de ces fonctions ne fait de calcul monétaire en virgule flottante.
 */

const ESPACE_FINE = ' ';

/** Groupe les chiffres par trois avec une espace fine insécable. */
function grouper(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_FINE);
}

/** 123456 -> « 1 234,56 € » (centimes entiers -> texte). */
export function formaterEuros(centimes: number | bigint): string {
  const n = typeof centimes === 'bigint' ? centimes : BigInt(verifierEntier(centimes, 'montant'));
  const negatif = n < 0n;
  const abs = negatif ? -n : n;
  const euros = (abs / 100n).toString();
  const cts = (abs % 100n).toString().padStart(2, '0');
  return `${negatif ? '−' : ''}${grouper(euros)},${cts}${ESPACE_FINE}€`;
}

/** 2000 -> « 20 % », 550 -> « 5,5 % » (points de base -> texte). */
export function formaterTaux(pointsDeBase: number): string {
  verifierEntier(pointsDeBase, 'taux');
  const entier = Math.trunc(pointsDeBase / 100);
  const reste = Math.abs(pointsDeBase % 100);
  const decimales = reste === 0 ? '' : ',' + String(reste).padStart(2, '0').replace(/0$/, '');
  return `${entier}${decimales}${ESPACE_FINE}%`;
}

/** Date ISO (AAAA-MM-JJ) ou instant -> « JJ/MM/AAAA » à Paris. */
export function formaterDate(valeur: string | Date): string {
  if (typeof valeur === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
    const [a, m, j] = valeur.split('-');
    return `${j}/${m}/${a}`;
  }
  const d = typeof valeur === 'string' ? new Date(valeur) : valeur;
  if (Number.isNaN(d.getTime())) throw new Error('Date invalide.');
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

/** Instant -> « JJ/MM/AAAA à HH:MM » à Paris. */
export function formaterDateHeure(valeur: string | Date): string {
  const d = typeof valeur === 'string' ? new Date(valeur) : valeur;
  if (Number.isNaN(d.getTime())) throw new Error('Date invalide.');
  const jour = formaterDate(d);
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit',
  }).format(d);
  return `${jour} à ${heure}`;
}

/**
 * Lit un montant saisi en euros (« 1 234,56 », « 1234.5 », « 12 € ») et
 * renvoie des centimes entiers, SANS passer par un nombre flottant.
 * Renvoie null si la saisie n'est pas un montant valide (plus de deux
 * décimales, lettres, plusieurs séparateurs…).
 */
export function lireMontantEnCentimes(saisie: string): number | null {
  const brut = saisie.trim().replace(/\s*€$/, '');
  // Espaces acceptés SEULEMENT entre groupes de trois chiffres (« 1 234,56 ») : « 1 0,5 » est une faute de frappe, refusée.
  if (/[\s\u00a0\u202f]/.test(brut) && !/^-?\d{1,3}(?:[\s\u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(brut)) return null;
  const texte = brut.replace(/[\s\u00a0\u202f]/g, '');
  const m = /^(-?)(\d+)(?:[.,](\d{1,2}))?$/.exec(texte);
  if (!m) return null;
  const [, signe, entier, dec = ''] = m;
  const centimes = BigInt(entier) * 100n + BigInt(dec.padEnd(2, '0') || '0');
  const resultat = signe ? -centimes : centimes;
  if (resultat > BigInt(Number.MAX_SAFE_INTEGER) || resultat < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(resultat);
}

/**
 * Lit un pourcentage saisi (« 5,5 », « 20 % ») et renvoie des points de base
 * (550, 2000). Deux décimales au plus. Null si invalide.
 */
export function lirePourcentageEnPointsDeBase(saisie: string): number | null {
  const texte = saisie.replace(/[\s  ]/g, '').replace(/%$/, '');
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(texte);
  if (!m) return null;
  const [, entier, dec = ''] = m;
  const pb = Number(entier) * 100 + Number(dec.padEnd(2, '0') || '0');
  return Number.isSafeInteger(pb) ? pb : null;
}

function verifierEntier(n: number, nom: string): number {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Valeur ${nom} invalide : un entier est attendu (reçu ${n}).`);
  }
  return n;
}

/** Centimes -> texte de saisie (« 40,00 », vide si null). */
export function montantVersSaisie(centimes: number | null | undefined): string {
  if (centimes === null || centimes === undefined) return '';
  return formaterEuros(centimes).replace(/ €$/, '').replace(/ /g, ' ');
}

/** Points de base -> texte de saisie (« 12,5 », vide si null). */
export function pourcentageVersSaisie(pb: number | null | undefined): string {
  if (pb === null || pb === undefined) return '';
  return formaterTaux(pb).replace(/ %$/, '');
}
