import { describe, expect, it } from 'vitest';
import { choisirPots, ErreurPots } from '../pots';

const resume = (c: { pots: { contenanceMl: number; nombre: number }[] }) => c.pots.map((p) => `${p.nombre}×${p.contenanceMl}`).join(' + ');
const formats = (prix: (number | null)[]) => [1000, 2500, 5000, 10_000, 15_000]
  .map((c, i) => ({ contenanceMl: c, prixCents: prix[i] === null ? null : BigInt(prix[i]!) }));

describe('pots : cas de référence (7,0239 L, soit 7 024 ml à couvrir)', () => {
  // Prix : 1 L 15,00 € ; 2,5 L 30,00 € ; 5 L 50,00 € ; 10 L 90,00 € ; 15 L 130,00 €.
  // 5 + 2,5 = 7,5 L pour 80,00 € ; 10 L seul 90,00 € ; 3 × 2,5 L 90,00 € ; 5 + 3 × 1 L 95,00 €.
  const choix = choisirPots(7_024n, formats([1500, 3000, 5000, 9000, 13000]));
  it('5 L + 2,5 L, 80,00 €, reste 0,476 L', () => {
    expect(resume(choix.retenue)).toBe('1×5000 + 1×2500');
    expect(choix.retenue.coutCents).toBe(8000n);
    expect(choix.retenue.resteMl).toBe(476n);
    expect(choix.choixAuCout).toBe(true);
  });
  it('comparaison justifiée : 10 L seul coûte 90,00 € (reste 2,976 L)', () => {
    const dix = choix.alternatives.find((a) => resume(a) === '1×10000')!;
    expect(dix.coutCents).toBe(9000n);
    expect(dix.resteMl).toBe(2_976n);
  });
  it('si 10 L coûte 79,00 €, il devient le meilleur choix', () => {
    const c = choisirPots(7_024n, formats([1500, 3000, 5000, 7900, 13000]));
    expect(resume(c.retenue)).toBe('1×10000');
    expect(c.retenue.coutCents).toBe(7900n);
  });
});

describe('pots : départage (R3)', () => {
  it('coût égal : le moins de reste (5 + 2,5 L à 66 € plutôt que 10 L à 66 €)', () => {
    const c = choisirPots(7_024n, formats([1000, 2600, 4000, 6600, 13000]));
    expect(resume(c.retenue)).toBe('1×5000 + 1×2500');
    expect(c.retenue.resteMl).toBe(476n);
  });
  it('coût et reste égaux : le moins de pots (5 + 2,5 plutôt que 3 × 2,5 à prix proportionnels)', () => {
    const c = choisirPots(7_024n, formats([1000, 2500, 5000, 10000, 15000]));
    expect(resume(c.retenue)).toBe('1×5000 + 1×2500');
    expect(c.retenue.nombrePots).toBe(2);
  });
  it('un prix manquant : le moins de pots (R3 sans prix), coût inconnu', () => {
    // 7,024 L avec un format sans prix : 1 × 10 L (1 pot) plutôt que 5 + 2,5 L (2 pots).
    const c = choisirPots(7_024n, formats([1500, null, 5000, 9000, 13000]));
    expect(c.choixAuCout).toBe(false);
    expect(resume(c.retenue)).toBe('1×10000');
    expect(c.retenue.coutCents).toBe(9000n); // prix connu des pots retenus, mais combinaison non optimisée au coût
  });
  it('sans prix : le moins de pots parmi TOUTES les combinaisons qui couvrent, puis le moins de reste (audit métier, boucle 2)', () => {
    const sans = formats([null, null, null, null, null]);
    expect(resume(choisirPots(9_200n, sans).retenue)).toBe('1×10000');
    expect(resume(choisirPots(14_200n, sans).retenue)).toBe('1×15000');
    // 13,86 L -> 1 × 15 L (et non 10 + 2,5 + 1 + 1 L) ; 44 L -> 3 × 15 L ; 3,74 L -> 1 × 5 L.
    expect(resume(choisirPots(13_860n, sans).retenue)).toBe('1×15000');
    expect(resume(choisirPots(44_000n, sans).retenue)).toBe('3×15000');
    expect(resume(choisirPots(3_740n, sans).retenue)).toBe('1×5000');
    // À nombre de pots égal, le moins de reste : 16 L -> 15 + 1 L (reste 0) plutôt que 10 + 10 L.
    const c = choisirPots(16_000n, sans);
    expect(resume(c.retenue)).toBe('1×15000 + 1×1000');
    expect(c.retenue.resteMl).toBe(0n);
  });
  it('besoin pile sur un format : 5 000 ml -> 1 pot de 5 L, reste 0', () => {
    const c = choisirPots(5_000n, formats([null, null, null, null, null]));
    expect(resume(c.retenue)).toBe('1×5000');
    expect(c.retenue.resteMl).toBe(0n);
  });
  it('grosse quantité : 37,2 L à prix dégressifs -> 2 × 15 L + 5 L + 2,5 L (310 €)', () => {
    // 15 L 120 € ; 10 L 85 € ; 5 L 45 € ; 2,5 L 25 € ; 1 L 12 €. Combinaisons qui couvrent 37,2 L :
    // 2×15 + 5 + 2,5 (37,5 L) = 240 + 45 + 25 = 310 € ; 2×15 + 3×2,5 (37,5 L) = 240 + 75 = 315 € ;
    // 15 + 2×10 + 2,5 (37,5 L) = 120 + 170 + 25 = 315 € ; 2×15 + 10 (40 L) = 325 € ;
    // 3×10 + 5 + 2,5 (37,5 L) = 255 + 45 + 25 = 325 €. Minimum : 310 €, reste 0,3 L.
    const c = choisirPots(37_200n, formats([1200, 2500, 4500, 8500, 12000]));
    expect(c.retenue.coutCents).toBe(31_000n);
    expect(resume(c.retenue)).toBe('2×15000 + 1×5000 + 1×2500');
    expect(c.retenue.resteMl).toBe(300n);
  });
});

describe('pots : cas limites', () => {
  it('besoin nul : aucun pot', () => {
    const c = choisirPots(0n, formats([1, 1, 1, 1, 1]));
    expect(c.retenue.pots).toEqual([]);
    expect(c.retenue.coutCents).toBe(0n);
  });
  it('formats aberrants ignorés (0, négatif, doublon) ; aucun format valable : refus', () => {
    expect(() => choisirPots(1_000n, [{ contenanceMl: 0, prixCents: null }, { contenanceMl: -5, prixCents: null }])).toThrow(ErreurPots);
    const c = choisirPots(1_500n, [{ contenanceMl: 1000, prixCents: 100n }, { contenanceMl: 1000, prixCents: 1n }, { contenanceMl: 2500, prixCents: 200n }]);
    expect(c.retenue.coutCents).toBe(200n);
  });
  it('prix négatif refusé', () => {
    expect(() => choisirPots(1_000n, [{ contenanceMl: 1000, prixCents: -1n }])).toThrow(ErreurPots);
  });
  it('besoin négatif ou démesuré refusé', () => {
    expect(() => choisirPots(-1n, formats([1, 1, 1, 1, 1]))).toThrow(ErreurPots);
    expect(() => choisirPots(10_000_001n, formats([1, 1, 1, 1, 1]))).toThrow(/10 000 L/);
  });
  it('jamais de quantité nulle ou négative dans la combinaison', () => {
    for (const besoin of [1n, 999n, 1_001n, 2_499n, 12_345n, 99_999n]) {
      const c = choisirPots(besoin, formats([1500, 3000, 5000, 9000, 13000]));
      expect(c.retenue.totalMl >= besoin).toBe(true);
      expect(c.retenue.pots.every((p) => p.nombre > 0)).toBe(true);
    }
  });
});

describe('pots : propriété (comparaison à une recherche exhaustive)', () => {
  it('sur 300 besoins aléatoires, coût = minimum exhaustif', () => {
    const prixListe = [1500n, 3000n, 5000n, 9000n, 13000n];
    const tailles = [1000, 2500, 5000, 10_000, 15_000];
    let graine = 42;
    const alea = () => { graine = (graine * 1103515245 + 12345) % 2 ** 31; return graine; };
    for (let k = 0; k < 300; k += 1) {
      const besoin = BigInt(1 + (alea() % 40_000));
      const c = choisirPots(besoin, tailles.map((t, i) => ({ contenanceMl: t, prixCents: prixListe[i]! })));
      let min: bigint | null = null;
      for (let a = 0; a <= 40; a += 1) for (let b = 0; b <= 17; b += 1) for (let d = 0; d <= 9; d += 1)
        for (let e = 0; e <= 5; e += 1) for (let f = 0; f <= 3; f += 1) {
          const total = a * 1000 + b * 2500 + d * 5000 + e * 10_000 + f * 15_000;
          if (BigInt(total) < besoin) continue;
          const cout = BigInt(a) * 1500n + BigInt(b) * 3000n + BigInt(d) * 5000n + BigInt(e) * 9000n + BigInt(f) * 13000n;
          if (min === null || cout < min) min = cout;
        }
      expect(c.retenue.coutCents).toBe(min);
    }
  });
});
