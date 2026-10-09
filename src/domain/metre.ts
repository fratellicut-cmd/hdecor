/**
 * Métré : surfaces d'une pièce, calculées EXACTEMENT en mm² (entiers BigInt).
 * Règle R1 (cadrage) : affichage à 0,01 m² arrondi au demi supérieur ; la
 * quantité reprise dans un devis est la valeur affichée.
 */

export type Ouverture = {
  type: 'porte' | 'fenetre' | 'baie' | 'autre';
  largeurMm?: number | null;
  hauteurMm?: number | null;
  surfaceDirecteMm2?: number | bigint | null;
  quantite: number;
};

export type Piece = {
  modeSaisie: 'rectangle' | 'murs';
  longueurMm?: number | null;
  largeurMm?: number | null;
  mursMm?: number[] | null;
  /** Surface au sol saisie (mode « murs ») : sans elle, pas de plafond calculable. */
  surfaceSolMm2?: number | bigint | null;
  hauteurMm: number;
  /** « x pièces identiques » */
  multiplicateur: number;
};

export type Element = {
  type: string;
  unite: 'ml' | 'm2' | 'u';
  /** Quantité × 10 000 (4 décimales exactes). */
  quantiteE4: number | bigint;
  faces: number;
  /** Largeur développée à peindre (élément en mètres linéaires). */
  developpeMm?: number | null;
  /** Surface à peindre d'une unité (élément compté à l'unité). */
  surfaceUnitaireMm2?: number | bigint | null;
};

export type LigneDetail = { libelle: string; calcul: string; resultatMm2: bigint };

export type SurfacesPiece = {
  perimetreMm: bigint;
  mursBrutsMm2: bigint;
  ouverturesMm2: bigint;
  /** Murs nets d'UNE pièce (jamais négatif). */
  mursNetsMm2: bigint;
  /** Plafond d'UNE pièce, null si non calculable (mode « murs » sans surface au sol). */
  plafondMm2: bigint | null;
  multiplicateur: bigint;
  /** Totaux, multiplicateur appliqué. */
  totalMursMm2: bigint;
  totalPlafondMm2: bigint | null;
  alertes: string[];
  detail: LigneDetail[];
};

export class ErreurMetre extends Error {}

const entierPositif = (v: unknown, libelle: string): bigint => {
  if (typeof v === 'bigint') {
    if (v <= 0n) throw new ErreurMetre(`${libelle} : valeur strictement positive attendue.`);
    return v;
  }
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
    throw new ErreurMetre(`${libelle} : valeur strictement positive attendue.`);
  }
  return BigInt(v);
};

/** 1 m² = 1 000 000 mm² ; affichage en centièmes de m², demi supérieur. */
export function mm2EnCentiemesM2(mm2: bigint): bigint {
  if (mm2 < 0n) throw new ErreurMetre('Surface négative.');
  return (mm2 + 5_000n) / 10_000n;
}

/** « 31,93 m² » (espace insécable avant l'unité, fine pour les milliers). */
export function formaterSurface(mm2: bigint): string {
  const c = mm2EnCentiemesM2(mm2);
  const entier = (c / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${entier},${(c % 100n).toString().padStart(2, '0')} m²`;
}

/** Longueur en mm -> « 4,00 m » (pour le détail des calculs). */
export function formaterLongueur(mm: bigint): string {
  const signe = mm < 0n ? '-' : '';
  const a = mm < 0n ? -mm : mm;
  const cm = (a + 5n) / 10n;
  return `${signe}${cm / 100n},${(cm % 100n).toString().padStart(2, '0')} m`;
}

const LIBELLES_OUVERTURE = { porte: 'Porte', fenetre: 'Fenêtre', baie: 'Baie', autre: 'Ouverture' } as const;

export function surfaceOuvertureMm2(o: Ouverture): bigint {
  const q = entierPositif(o.quantite, 'Quantité');
  if (o.surfaceDirecteMm2 !== null && o.surfaceDirecteMm2 !== undefined) {
    if (o.largeurMm || o.hauteurMm) throw new ErreurMetre('Ouverture : dimensions OU surface, pas les deux.');
    return entierPositif(o.surfaceDirecteMm2, 'Surface de l’ouverture') * q;
  }
  return entierPositif(o.largeurMm, 'Largeur de l’ouverture') * entierPositif(o.hauteurMm, 'Hauteur de l’ouverture') * q;
}

export function calculerSurfacesPiece(piece: Piece, ouvertures: Ouverture[] = []): SurfacesPiece {
  const hauteur = entierPositif(piece.hauteurMm, 'Hauteur sous plafond');
  const multiplicateur = entierPositif(piece.multiplicateur, 'Nombre de pièces identiques');
  const detail: LigneDetail[] = [];
  const alertes: string[] = [];

  let perimetre: bigint;
  let plafond: bigint | null;
  if (piece.modeSaisie === 'rectangle') {
    const l = entierPositif(piece.longueurMm, 'Longueur');
    const w = entierPositif(piece.largeurMm, 'Largeur');
    perimetre = 2n * (l + w);
    plafond = l * w;
    detail.push({ libelle: 'Périmètre', calcul: `2 × (${formaterLongueur(l)} + ${formaterLongueur(w)}) = ${formaterLongueur(perimetre)}`, resultatMm2: 0n });
    detail.push({ libelle: 'Plafond', calcul: `${formaterLongueur(l)} × ${formaterLongueur(w)}`, resultatMm2: plafond });
  } else {
    const murs = piece.mursMm ?? [];
    if (murs.length < 3) throw new ErreurMetre('Mur par mur : au moins 3 murs.');
    const longueurs = murs.map((m, i) => entierPositif(m, `Mur ${i + 1}`));
    perimetre = longueurs.reduce((a, b) => a + b, 0n);
    detail.push({ libelle: 'Périmètre', calcul: `${longueurs.map(formaterLongueur).join(' + ')} = ${formaterLongueur(perimetre)}`, resultatMm2: 0n });
    if (piece.surfaceSolMm2 !== null && piece.surfaceSolMm2 !== undefined) {
      plafond = entierPositif(piece.surfaceSolMm2, 'Surface au sol');
      detail.push({ libelle: 'Plafond', calcul: 'surface au sol saisie', resultatMm2: plafond });
    } else {
      plafond = null;
      alertes.push('Plafond non calculé : saisissez la surface au sol de cette pièce (mur par mur).');
    }
  }

  const mursBruts = perimetre * hauteur;
  detail.push({ libelle: 'Murs bruts', calcul: `${formaterLongueur(perimetre)} × ${formaterLongueur(hauteur)}`, resultatMm2: mursBruts });

  let totalOuvertures = 0n;
  for (const o of ouvertures) {
    const s = surfaceOuvertureMm2(o);
    totalOuvertures += s;
    const dims = o.surfaceDirecteMm2 ? 'surface saisie' : `${formaterLongueur(BigInt(o.largeurMm!))} × ${formaterLongueur(BigInt(o.hauteurMm!))}`;
    detail.push({ libelle: `− ${LIBELLES_OUVERTURE[o.type]}${o.quantite > 1 ? ` × ${o.quantite}` : ''}`, calcul: dims, resultatMm2: s });
  }

  let mursNets = mursBruts - totalOuvertures;
  if (mursNets < 0n) {
    alertes.push('Les ouvertures dépassent la surface des murs : vérifiez les dimensions saisies. Murs nets comptés à 0.');
    mursNets = 0n;
  }
  detail.push({ libelle: 'Murs nets', calcul: 'murs bruts − ouvertures', resultatMm2: mursNets });

  if (multiplicateur > 1n) {
    detail.push({ libelle: `Pièces identiques × ${multiplicateur}`, calcul: `murs ${formaterSurface(mursNets)} × ${multiplicateur}`, resultatMm2: mursNets * multiplicateur });
  }

  return {
    perimetreMm: perimetre,
    mursBrutsMm2: mursBruts,
    ouverturesMm2: totalOuvertures,
    mursNetsMm2: mursNets,
    plafondMm2: plafond,
    multiplicateur,
    totalMursMm2: mursNets * multiplicateur,
    totalPlafondMm2: plafond === null ? null : plafond * multiplicateur,
    alertes,
    detail,
  };
}

/**
 * Surface à peindre d'un élément (mm², arrondie au mm² le plus proche,
 * demi supérieur : erreur ≤ 0,5 mm², soit 0,0000005 m²).
 * Renvoie null avec la raison si la conversion en m² n'est pas possible.
 */
export function surfaceElementMm2(e: Element): { mm2: bigint } | { manque: string } {
  const q = typeof e.quantiteE4 === 'bigint' ? e.quantiteE4 : BigInt(e.quantiteE4);
  if (q <= 0n) throw new ErreurMetre('Quantité de l’élément : valeur strictement positive attendue.');
  const faces = entierPositif(e.faces, 'Faces');
  if (e.unite === 'm2') return { mm2: q * 100n * faces }; // (q / 10 000) m² × 1 000 000
  if (e.unite === 'ml') {
    if (!e.developpeMm) return { manque: 'Renseignez la largeur développée à peindre (ex. hauteur de plinthe).' };
    const d = entierPositif(e.developpeMm, 'Largeur développée');
    return { mm2: (q * d * faces + 5n) / 10n }; // (q / 10 000) m × 1 000 mm × d mm
  }
  if (!e.surfaceUnitaireMm2) return { manque: 'Renseignez la surface à peindre d’une unité.' };
  const su = entierPositif(e.surfaceUnitaireMm2, 'Surface unitaire');
  return { mm2: (q * su * faces + 5_000n) / 10_000n };
}
