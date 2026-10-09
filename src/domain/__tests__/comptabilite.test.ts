import { describe, expect, it } from 'vitest';
import { repartirHt } from '../pilotage';
import { achatsParCategorie, bornesMois, decalerMois, libelleMois, lignesCsv, montantCsv, tableauAchats, tableauRecettes, totauxAchats,
  type Achat, type Recette } from '../comptabilite';

// Part HT fournie par la base (répartie en cumulé : voir repartirHt) ; ici celle d'une facture 1 200 TTC / 1 000 HT.
const recette = (montant: bigint, r: Partial<Recette> = {}): Recette => ({
  date: '2026-10-05', montantCents: montant, nature: montant < 0n ? 'remboursement' : 'encaissement', mode: 'virement', reference: null,
  factureNumero: 'FAC-2026-0001', client: 'Mme Martin', partHtCents: repartirHt([montant], 100000n, 120000n, 'assujetti')[0]!, ...r,
});
const achat = (ttc: bigint, tva: bigint, categorie: string | null, justificatif = true): Achat => ({
  date: '2026-10-02', fournisseur: 'Négoce', libelle: null, categorie, chantier: null, htCents: ttc - tva, tvaCents: tva, ttcCents: ttc, mode: 'carte', justificatif,
});

describe('mois', () => {
  it('bornes, y compris février bissextile et décembre', () => {
    expect(bornesMois('2026-02')).toEqual({ du: '2026-02-01', au: '2026-02-28' });
    expect(bornesMois('2028-02')).toEqual({ du: '2028-02-01', au: '2028-02-29' });
    expect(bornesMois('2026-12')).toEqual({ du: '2026-12-01', au: '2026-12-31' });
  });
  it('décalage par-dessus l’année', () => {
    expect(decalerMois('2026-01', -1)).toBe('2025-12');
    expect(decalerMois('2026-12', 1)).toBe('2027-01');
    expect(decalerMois('2026-10', -13)).toBe('2025-09');
    expect(libelleMois('2026-08')).toBe('août 2026');
  });
});

describe('livre des recettes', () => {
  it('assujetti : part HT au prorata de la facture, arrondie au centime (remboursement négatif)', () => {
    // 1 200 € sur une facture 1 200 TTC / 1 000 HT -> 1 000 ; 100 € -> 83,333 -> 83,33 ; -50 € -> -41,666 -> -41,67.
    const t = tableauRecettes([recette(120000n), recette(10000n), recette(-5000n)], 'assujetti', 'octobre 2026');
    expect(t.entetes).toHaveLength(8);
    const csv = lignesCsv(t);
    expect(csv.map((l) => l[7])).toEqual(['1000,00', '83,33', '-41,67', '1041,66']);
    expect(csv.map((l) => l[6])).toEqual(['1200,00', '100,00', '-50,00', '1250,00']);
    expect(csv[2]![3]).toBe('Remboursement');
    expect(csv[0]![0]).toBe('05/10/2026');
  });
  it('franchise : pas de colonne HT, l’encaissement est le chiffre d’affaires', () => {
    const t = tableauRecettes([recette(30000n, { partHtCents: 30000n })], 'franchise', 'octobre 2026');
    expect(t.entetes).toHaveLength(7);
    expect(lignesCsv(t).at(-1)).toEqual(['Total', '', '', '', '', '', '300,00']);
  });
});

describe('registre des achats', () => {
  it('totaux HT / TVA / TTC exacts et justificatifs manquants', () => {
    const a = [achat(12000n, 2000n, 'Peintures et enduits'), achat(4599n, 0n, null, false), achat(1n, 0n, 'Outillage')];
    expect(totauxAchats(a)).toEqual({ htCents: 14600n, tvaCents: 2000n, ttcCents: 16600n, nombre: 3, sansJustificatif: 1 });
    expect(lignesCsv(tableauAchats(a, 'octobre 2026')).at(-1)!.slice(5, 8)).toEqual(['146,00', '20,00', '166,00']);
  });
  it('regroupement par catégorie, du plus gros au plus petit', () => {
    const a = [achat(500n, 0n, 'Outillage'), achat(12000n, 0n, 'Peintures et enduits'), achat(700n, 0n, 'Outillage'), achat(300n, 0n, null)];
    expect(achatsParCategorie(a)).toEqual([
      { categorie: 'Peintures et enduits', ttcCents: 12000n }, { categorie: 'Outillage', ttcCents: 1200n }, { categorie: 'Sans catégorie', ttcCents: 300n },
    ]);
  });
  it('montants CSV : virgule, signe, centimes sur deux chiffres', () => {
    expect(montantCsv(-5n)).toBe('-0,05');
    expect(montantCsv(123456n)).toBe('1234,56');
    expect(montantCsv(0n)).toBe('0,00');
  });
});
