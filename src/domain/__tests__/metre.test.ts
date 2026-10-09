import { describe, expect, it } from 'vitest';
import { calculerSurfacesPiece, ErreurMetre, formaterSurface, mm2EnCentiemesM2, surfaceElementMm2 } from '../metre';

// Pièce de référence (§6 du cahier des charges), calculée à la main :
// périmètre 2 × (4 + 3) = 14 m ; murs bruts 14 × 2,5 = 35 m²
// porte 0,83 × 2,04 = 1,6932 m² ; fenêtre 1,20 × 1,15 = 1,38 m² ; total 3,0732 m²
// murs nets 35 − 3,0732 = 31,9268 m² ; plafond 4 × 3 = 12 m².
const reference = { modeSaisie: 'rectangle' as const, longueurMm: 4000, largeurMm: 3000, hauteurMm: 2500, multiplicateur: 1 };
const ouverturesReference = [
  { type: 'porte' as const, largeurMm: 830, hauteurMm: 2040, quantite: 1 },
  { type: 'fenetre' as const, largeurMm: 1200, hauteurMm: 1150, quantite: 1 },
];

describe('surfaces : pièce de référence', () => {
  const s = calculerSurfacesPiece(reference, ouverturesReference);
  it('périmètre 14,00 m et murs bruts 35,00 m²', () => {
    expect(s.perimetreMm).toBe(14_000n);
    expect(s.mursBrutsMm2).toBe(35_000_000n);
  });
  it('ouvertures 3,0732 m²', () => expect(s.ouverturesMm2).toBe(3_073_200n));
  it('murs nets 31,9268 m², affichés 31,93 m²', () => {
    expect(s.mursNetsMm2).toBe(31_926_800n);
    expect(formaterSurface(s.mursNetsMm2)).toBe('31,93 m²');
  });
  it('plafond 12,00 m²', () => {
    expect(s.plafondMm2).toBe(12_000_000n);
    expect(formaterSurface(s.plafondMm2!)).toBe('12,00 m²');
  });
  it('aucune alerte, détail du calcul visible', () => {
    expect(s.alertes).toEqual([]);
    expect(s.detail.map((d) => d.libelle)).toEqual(['Périmètre', 'Plafond', 'Murs bruts', '− Porte', '− Fenêtre', 'Murs nets']);
  });
});

describe('surfaces : cas limites', () => {
  it('pièce sans ouverture : murs nets = murs bruts', () => {
    expect(calculerSurfacesPiece(reference).mursNetsMm2).toBe(35_000_000n);
  });
  it('pièces dupliquées × 3 : 95,7804 m² de murs, 36 m² de plafond', () => {
    const s = calculerSurfacesPiece({ ...reference, multiplicateur: 3 }, ouverturesReference);
    expect(s.totalMursMm2).toBe(95_780_400n);
    expect(s.totalPlafondMm2).toBe(36_000_000n);
    expect(s.mursNetsMm2).toBe(31_926_800n); // une pièce
  });
  it('ouvertures × quantité : 2 portes = 3,3864 m²', () => {
    const s = calculerSurfacesPiece(reference, [{ type: 'porte', largeurMm: 830, hauteurMm: 2040, quantite: 2 }]);
    expect(s.ouverturesMm2).toBe(3_386_400n);
  });
  it('ouvertures plus grandes que les murs : 0 et alerte', () => {
    // 1 × 1 m, H 1 m : murs 4 m² ; baie saisie 5 m².
    const s = calculerSurfacesPiece({ modeSaisie: 'rectangle', longueurMm: 1000, largeurMm: 1000, hauteurMm: 1000, multiplicateur: 1 },
      [{ type: 'baie', surfaceDirecteMm2: 5_000_000, quantite: 1 }]);
    expect(s.mursNetsMm2).toBe(0n);
    expect(s.alertes[0]).toMatch(/dépassent/);
  });
  it('mur par mur, pièce en L : 5 + 3 + 2 + 1,5 + 3 + 1,5 = 16 m, × 2,5 = 40,00 m²', () => {
    const s = calculerSurfacesPiece({ modeSaisie: 'murs', mursMm: [5000, 3000, 2000, 1500, 3000, 1500], hauteurMm: 2500, multiplicateur: 1 });
    expect(s.perimetreMm).toBe(16_000n);
    expect(s.mursBrutsMm2).toBe(40_000_000n);
  });
  it('mur par mur sans surface au sol : plafond non calculé, alerte', () => {
    const s = calculerSurfacesPiece({ modeSaisie: 'murs', mursMm: [4000, 3000, 4000, 3000], hauteurMm: 2500, multiplicateur: 2 });
    expect(s.plafondMm2).toBeNull();
    expect(s.totalPlafondMm2).toBeNull();
    expect(s.alertes[0]).toMatch(/surface au sol/);
  });
  it('mur par mur avec surface au sol saisie (13,25 m²)', () => {
    const s = calculerSurfacesPiece({ modeSaisie: 'murs', mursMm: [4000, 3000, 4000, 3000], surfaceSolMm2: 13_250_000, hauteurMm: 2500, multiplicateur: 1 });
    expect(s.plafondMm2).toBe(13_250_000n);
  });
  it('décimales au millimètre : 3,215 × 2,847, H 2,503', () => {
    // périmètre 2 × 6,062 = 12,124 m ; × 2,503 = 30,346372 m² ; plafond 9,153105 m²
    const s = calculerSurfacesPiece({ modeSaisie: 'rectangle', longueurMm: 3215, largeurMm: 2847, hauteurMm: 2503, multiplicateur: 1 });
    expect(s.mursBrutsMm2).toBe(30_346_372n);
    expect(s.plafondMm2).toBe(9_153_105n);
    expect(formaterSurface(s.plafondMm2!)).toBe('9,15 m²');
  });
  it.each([
    [{ ...reference, longueurMm: 0 }, 'Longueur'],
    [{ ...reference, largeurMm: -3000 }, 'Largeur'],
    [{ ...reference, hauteurMm: 0 }, 'Hauteur'],
    [{ ...reference, multiplicateur: 0 }, 'identiques'],
    [{ ...reference, longueurMm: 1.5 }, 'Longueur'],
    [{ modeSaisie: 'murs' as const, mursMm: [4000, 3000], hauteurMm: 2500, multiplicateur: 1 }, '3 murs'],
    [{ modeSaisie: 'murs' as const, mursMm: [4000, 0, 4000], hauteurMm: 2500, multiplicateur: 1 }, 'Mur 2'],
  ])('valeur nulle, négative ou invalide refusée (%#)', (piece, message) => {
    expect(() => calculerSurfacesPiece(piece)).toThrow(ErreurMetre);
    expect(() => calculerSurfacesPiece(piece)).toThrow(message);
  });
  it('ouverture : dimensions OU surface, pas les deux ; quantité ≥ 1', () => {
    expect(() => calculerSurfacesPiece(reference, [{ type: 'porte', largeurMm: 830, hauteurMm: 2040, surfaceDirecteMm2: 1, quantite: 1 }])).toThrow(ErreurMetre);
    expect(() => calculerSurfacesPiece(reference, [{ type: 'porte', largeurMm: 830, hauteurMm: 2040, quantite: 0 }])).toThrow(ErreurMetre);
  });
});

describe('arrondi d’affichage (R1 : centième de m², demi supérieur)', () => {
  it.each([
    [0n, 0n], [4_999n, 0n], [5_000n, 1n], [31_926_800n, 3_193n], [31_925_000n, 3_193n], [31_924_999n, 3_192n],
  ])('%s mm² -> %s centièmes', (mm2, attendu) => expect(mm2EnCentiemesM2(mm2)).toBe(attendu));
  it('séparateur de milliers', () => expect(formaterSurface(1_234_560_000n)).toBe('1 234,56 m²'));
});

describe('éléments convertis en m²', () => {
  it('plinthe 14 ml × 10 cm développés = 1,40 m²', () => {
    expect(surfaceElementMm2({ type: 'plinthe', unite: 'ml', quantiteE4: 140_000, faces: 1, developpeMm: 100 })).toEqual({ mm2: 1_400_000n });
  });
  it('2 portes de 1,6932 m², 2 faces = 6,7728 m²', () => {
    expect(surfaceElementMm2({ type: 'porte', unite: 'u', quantiteE4: 20_000, faces: 2, surfaceUnitaireMm2: 1_693_200 })).toEqual({ mm2: 6_772_800n });
  });
  it('radiateur saisi en m² : 3,5 m²', () => {
    expect(surfaceElementMm2({ type: 'radiateur', unite: 'm2', quantiteE4: 35_000, faces: 1 })).toEqual({ mm2: 3_500_000n });
  });
  it('conversion impossible signalée (pas de chiffre inventé)', () => {
    expect(surfaceElementMm2({ type: 'plinthe', unite: 'ml', quantiteE4: 140_000, faces: 1 })).toHaveProperty('manque');
    expect(surfaceElementMm2({ type: 'porte', unite: 'u', quantiteE4: 10_000, faces: 1 })).toHaveProperty('manque');
  });
  it('quantité nulle refusée', () => {
    expect(() => surfaceElementMm2({ type: 'plinthe', unite: 'm2', quantiteE4: 0, faces: 1 })).toThrow(ErreurMetre);
  });
});
