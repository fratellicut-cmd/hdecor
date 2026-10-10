/**
 * Procès-verbal de réception des travaux : contenu et règles de forme.
 * Les références légales citées sont À VÉRIFIER par le conseil de l'entreprise
 * (auditeur-legal, comptable) : aucune n'est présentée comme certaine.
 */

export type Reserve = { description: string; levee_le?: string | null; levee_note?: string | null };

export const RESERVES_MAX = 50;
export const LONGUEUR_RESERVE_MAX = 500;

/** Réserves saisies une par ligne (lignes vides ignorées, espaces retirés). */
export function lireReserves(saisie: string): { reserves: Reserve[] } | { erreur: string } {
  const lignes = saisie.split(/\r?\n/).map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, '').trim()).filter(Boolean);
  if (lignes.length > RESERVES_MAX) return { erreur: `${RESERVES_MAX} réserves au maximum.` };
  const longue = lignes.findIndex((l) => l.length > LONGUEUR_RESERVE_MAX);
  if (longue >= 0) return { erreur: `Réserve ${longue + 1} : ${LONGUEUR_RESERVE_MAX} caractères au maximum.` };
  return { reserves: lignes.map((description) => ({ description })) };
}

/** Phrase de décision du maître d'ouvrage. */
export function texteDecision(reserves: Reserve[]): string {
  return reserves.length
    ? `Le maître d’ouvrage déclare accepter les travaux AVEC ${reserves.length} RÉSERVE${reserves.length > 1 ? 'S' : ''}, détaillée${reserves.length > 1 ? 's' : ''} ci-dessous.`
    : 'Le maître d’ouvrage déclare accepter les travaux SANS RÉSERVE.';
}

/** Date limite de levée (AAAA-MM-JJ) : date de réception + délai en jours ; null sans délai. */
export function dateLimiteLevee(dateReception: string, delaiJours: number | null): string | null {
  if (!delaiJours) return null;
  const d = new Date(`${dateReception}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delaiJours);
  return d.toISOString().slice(0, 10);
}

/** Ce que signe le client, en langage courant (affiché au-dessus du cadre de signature). */
export function engagementClient(reserves: Reserve[], dateLimite: string | null): string {
  if (!reserves.length) return 'En signant, vous confirmez que les travaux sont terminés et que vous les acceptez sans réserve.';
  const [a, m, j] = (dateLimite ?? '').split('-');
  const quand = dateLimite ? ` au plus tard le ${j}/${m}/${a}` : '';
  return `En signant, vous acceptez les travaux, sauf ${reserves.length > 1 ? `les ${reserves.length} points listés` : 'le point listé'}, `
    + `que l’entreprise doit reprendre${quand}.`;
}

/** État des réserves : toutes levées, en partie, ou aucune. */
export function etatReserves(reserves: Reserve[]): { total: number; levees: number; libelle: string } {
  const levees = reserves.filter((r) => r.levee_le).length;
  const libelle = !reserves.length ? 'Sans réserve'
    : levees === reserves.length ? 'Toutes les réserves sont déclarées levées'
      : `${reserves.length - levees} réserve${reserves.length - levees > 1 ? 's' : ''} à lever sur ${reserves.length}`;
  return { total: reserves.length, levees, libelle };
}

/**
 * Rappel informatif imprimé sur le PV. Références légales À VÉRIFIER : elles
 * sont signalées comme telles sur le document lui-même.
 */
export const RAPPEL_RECEPTION = 'La réception est l’acte par lequel le maître de l’ouvrage déclare accepter l’ouvrage avec ou sans réserves '
  + '(article 1792-6 du Code civil). Elle marque le point de départ des garanties légales dues par l’entreprise, '
  + 'le cas échéant selon la nature des travaux (notamment la garantie de parfait achèvement). [Références À VÉRIFIER]';
