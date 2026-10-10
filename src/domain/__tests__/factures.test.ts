import { describe, expect, it } from 'vitest';
import { lireMontantEnCentimes } from '../formats';
import { totauxDevis, type LigneDevis, type Ventilation } from '../devis';
import { arrondi } from '../chiffrage';
import { copieClient, copieEmetteur, type ParametresEmetteur } from '../devis-document';
import {
  controlesTauxFacture,
  controlerMentionsFacture, deductionsDisponibles, ErreurFacture, formaterIban, ibanValide, lignesAcompte, lignesAvoirMontant,
  finRetractation, libelleDatesPrestation, lignesAvoirTotal, lignesDepuisDevis, mentionIndemnite, mentionPenalites, netAPayer, netParTaux, totalLigneFacture, totauxFacture,
  textesAVerifierFacture, type CopieEmetteurFacture, type FactureDuDevis, type LigneFacture,
} from '../factures';
import { payloadVirementSepa, ErreurVirement } from '../virement';
import { xmlFacturX } from '../facturx';

const ld = (designation: string, qE4: bigint, pu: bigint, taux: number, autres: Partial<LigneDevis> = {}): LigneDevis => ({
  type: 'ligne', designation, quantiteE4: qE4, unite: 'm2', prixUnitaireCents: pu, remiseBp: 0, tauxTvaBp: taux, optionnelle: false, ...autres,
});
const lf = (l: LigneDevis, avancementBp: number | null = null): LigneFacture => ({ ...l, avancementBp });

describe('R4 facture : total de ligne avec avancement, arrondi en une fois', () => {
  it('31,93 m² × 12,50 € = 399,125 -> 399,13 € (100 %)', () => expect(totalLigneFacture(319_300n, 1_250n, 0, null)).toBe(39_913n));
  it('situation 50 % : 399,125 × 0,5 = 199,5625 -> 199,56 € (et non 399,13 / 2 = 199,565 -> 199,57)', () => {
    expect(totalLigneFacture(319_300n, 1_250n, 0, 5_000)).toBe(19_956n);
  });
  it('remise 10 % et avancement 33,33 % : 100 € × 0,9 × 0,3333 = 29,997 -> 30,00 €', () => {
    expect(totalLigneFacture(10_000n, 10_000n, 1_000, 3_333)).toBe(3_000n);
  });
  it('bornes', () => {
    expect(() => totalLigneFacture(1n, 1n, 0, 10_001)).toThrow(ErreurFacture);
    expect(() => totalLigneFacture(-1n, 1n, 0, null)).toThrow(ErreurFacture);
  });
});

describe('cas de référence §6 : acompte 30 % puis finale', () => {
  // Devis 5 000,00 € HT à 10 % : TTC 5 500,00 €.
  const devis = [ld('Peinture', 10_000n, 500_000n, 1_000, { id: 'l1' })];
  const accepte = totauxDevis(devis, 0, 'assujetti');
  it('acompte 30 % = 1 500,00 € HT + 150,00 € TVA = 1 650,00 € TTC', () => {
    const lignes = lignesAcompte(accepte.ventilation, 0, 3_000, 'assujetti', 'Acompte de 30 % sur le devis DEV-2026-0001');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ quantiteE4: 10_000n, unite: 'forfait', prixUnitaireCents: 150_000n, tauxTvaBp: 1_000 });
    const t = totauxFacture(lignes, 0, 'assujetti');
    expect([t.totalHtCents, t.totalTvaCents, t.totalTtcCents]).toEqual([150_000n, 15_000n, 165_000n]);
  });
  it('finale = 5 500,00 − 1 650,00 = 3 850,00 € TTC, détail HT / TVA de l’acompte déduit', () => {
    const t = totauxFacture(lignesDepuisDevis(devis, new Set(), null), 0, 'assujetti');
    expect(t.totalTtcCents).toBe(550_000n);
    const deductions = [{ facture_id: 'a1', numero: 'FAC-2026-0001', ht: 150_000n, tva: 15_000n, ttc: 165_000n }];
    expect(netAPayer(t.totalTtcCents, deductions)).toBe(385_000n);
    expect(netParTaux(t.ventilation, [[{ taux_bp: 1_000, base_ht_cents: 150_000n, tva_cents: 15_000n }]]))
      .toEqual([{ taux_bp: 1_000, base_ht_cents: 350_000n, tva_cents: 35_000n }]);
  });
  it('acomptes supérieurs au total : refusé', () => {
    expect(() => netAPayer(100n, [{ facture_id: 'a', numero: 'n', ht: 100n, tva: 1n, ttc: 101n }])).toThrow(ErreurFacture);
  });
});

describe('acompte d’échéance : identique au devis imprimé', () => {
  it('deux taux, 2e échéance de 30 % après 20 % : base en cumulé, TVA R6', () => {
    // 1 000,01 € à 10 % et 333,33 € à 20 %. Cumul 20 % puis 50 %.
    const v = totauxDevis([ld('A', 10_000n, 100_001n, 1_000), ld('B', 10_000n, 33_333n, 2_000)], 0, 'assujetti').ventilation;
    const lignes = lignesAcompte(v, 2_000, 3_000, 'assujetti', 'Acompte début des travaux');
    // 10 % : arrondi(100 001 × 0,5) − arrondi(100 001 × 0,2) = 50 001 − 20 000 = 30 001 ; 20 % : 16 667 − 6 667 = 10 000.
    expect(lignes.map((l) => [l.tauxTvaBp, l.prixUnitaireCents])).toEqual([[1_000, 30_001n], [2_000, 10_000n]]);
    expect(lignes[0]!.designation).toBe('Acompte début des travaux (TVA 10 %)');
  });
  it('l’échéance qui solde le devis n’est pas un acompte (facture finale)', () => {
    const v = totauxDevis([ld('A', 10_000n, 100_000n, 0)], 0, 'franchise').ventilation;
    expect(() => lignesAcompte(v, 3_000, 7_000, 'franchise', 'Solde')).toThrow(/facture finale/);
  });
});

describe('finale et situation reprises du devis', () => {
  const devis: LigneDevis[] = [
    { type: 'section', designation: 'Séjour', quantiteE4: null, unite: null, prixUnitaireCents: null, remiseBp: 0, tauxTvaBp: null, optionnelle: false, id: 's' },
    ld('Murs', 319_300n, 1_250n, 0, { id: 'l1' }),
    ld('Boiseries', 50_000n, 2_000n, 0, { id: 'o1', optionnelle: true, unite: 'ml' }),
    ld('Plafond', 120_000n, 1_500n, 0, { id: 'o2', optionnelle: true }),
  ];
  it('options retenues seulement ; total = montant accepté du devis', () => {
    const lignes = lignesDepuisDevis(devis, new Set(['o1']), null);
    expect(lignes.map((l) => l.designation)).toEqual(['Séjour', 'Murs', 'Boiseries']);
    expect(lignes.every((l) => !l.optionnelle)).toBe(true);
    expect(lignes[1]!.devisLigneId).toBe('l1');
    expect(totauxFacture(lignes, 1_000, 'franchise').totalTtcCents).toBe(totauxDevis(devis, 1_000, 'franchise', new Set(['o1'])).totalTtcCents);
  });
  it('situation : avancement cumulé par ligne', () => {
    const lignes = lignesDepuisDevis(devis, new Set(), 4_000, new Map([['l1', 6_000]]));
    expect(lignes.find((l) => l.designation === 'Murs')!.avancementBp).toBe(6_000);
    expect(lignes.find((l) => l.designation === 'Séjour')!.avancementBp).toBeNull();
    // 399,125 × 0,6 = 239,475 -> 239,48 €
    expect(totauxFacture(lignes, 0, 'franchise').totalHtCents).toBe(23_948n);
  });
});

describe('déductions disponibles (même règle que la base)', () => {
  const f = (id: string, type: FactureDuDevis['type'], statut: FactureDuDevis['statut'], deduit: string[] = []): FactureDuDevis => ({
    id, numero: id.toUpperCase(), type, statut, totalHtCents: 100n, totalTvaCents: 0n, totalTtcCents: 100n, deduit,
  });
  it('acomptes et situations émis, non déduits ailleurs ; une facture annulée libère les siens', () => {
    const liste = [f('a1', 'acompte', 'emise'), f('a2', 'acompte', 'emise'), f('s1', 'situation', 'emise', ['a1']),
      f('b', 'acompte', 'brouillon'), f('x', 'acompte', 'annulee'), f('fin', 'finale', 'annulee', ['a2'])];
    expect(deductionsDisponibles(liste).map((d) => d.facture_id)).toEqual(['a2', 's1']);
  });
  it('en modifiant une facture : ses propres déductions ne la bloquent pas', () => {
    const liste = [f('a1', 'acompte', 'emise'), f('fin', 'finale', 'emise', ['a1'])];
    expect(deductionsDisponibles(liste, 'fin').map((d) => d.facture_id)).toEqual(['a1']);
  });
});

describe('avoirs', () => {
  it('avoir total d’une facture sans acompte : mêmes lignes, même total', () => {
    const lignes = [lf(ld('Murs', 319_300n, 1_250n, 1_000, { id: 'x' }))];
    const avoir = lignesAvoirTotal(lignes);
    expect(avoir[0]!.id).toBeUndefined();
    expect(totauxFacture(avoir, 0, 'assujetti').totalTtcCents).toBe(totauxFacture(lignes, 0, 'assujetti').totalTtcCents);
  });
  it('avoir d’un montant TTC exact, au prorata des taux', () => {
    const net = [{ taux_bp: 1_000, base_ht_cents: 350_000n, tva_cents: 35_000n }];
    const lignes = lignesAvoirMontant(net, 110_000n, 'assujetti', false, 'Geste commercial');
    expect(lignes[0]!.prixUnitaireCents).toBe(100_000n);
    expect(totauxFacture(lignes, 0, 'assujetti').totalTtcCents).toBe(110_000n);
  });
  it('montant inatteignable au centime près (10 % : 5 cts ne s’obtient pas) : erreur explicite', () => {
    // base 4 -> 4 + 0 = 4 ; base 5 -> 5 + 1 = 6 : 5 cts TTC impossible.
    expect(() => lignesAvoirMontant([{ taux_bp: 1_000, base_ht_cents: 1_000n, tva_cents: 100n }], 5n, 'assujetti', false, 'A'))
      .toThrow(/pas atteignable/);
  });
  it('franchise : tout montant est atteignable', () => {
    const l = lignesAvoirMontant([{ taux_bp: 0, base_ht_cents: 66_913n, tva_cents: 0n }], 12_345n, 'franchise', false, 'Avoir');
    expect(l[0]!.prixUnitaireCents).toBe(12_345n);
  });
  it('au-delà du net : refusé', () => {
    expect(() => lignesAvoirMontant([{ taux_bp: 0, base_ht_cents: 100n, tva_cents: 0n }], 101n, 'franchise', false, 'A')).toThrow(ErreurFacture);
  });
  it('avoir total d’une finale qui déduit un acompte : lignes ET déductions reprises -> net et TVA nette exacts (cas 1 000,03 € à 20 %)', () => {
    // Devis 1 000,03 HT à 20 % ; acompte 30 % : 300,01 + 60,00 = 360,01 ; finale 1 200,04 ; net 840,03.
    const lignes = [lf(ld('Murs', 10_000n, 100_003n, 2_000))];
    const t = totauxFacture(lignes, 0, 'assujetti');
    const deductions = [{ facture_id: 'a', numero: 'FAC-1', ht: 30_001n, tva: 6_000n, ttc: 36_001n }];
    expect(netAPayer(t.totalTtcCents, deductions)).toBe(84_003n);
    const avoir = totauxFacture(lignesAvoirTotal(lignes), 0, 'assujetti');
    expect(netAPayer(avoir.totalTtcCents, deductions)).toBe(84_003n);
    expect(avoir.ventilation).toEqual(t.ventilation);
  });
  it('net par taux : tous les taux (y compris celui d’un acompte seul) ; taux négatif refusé', () => {
    // Situation à 10 % seulement (1 000 + 100) qui déduit un acompte sur 10 % (300 + 30) et 5,5 % (300 + 16,50).
    expect(() => netParTaux([{ taux_bp: 1_000, base_ht_cents: 100_000n, tva_cents: 10_000n }],
      [[{ taux_bp: 1_000, base_ht_cents: 30_000n, tva_cents: 3_000n }, { taux_bp: 550, base_ht_cents: 30_000n, tva_cents: 1_650n }]]))
      .toThrow(/5,5\s%/);
  });
  it('net par taux : les avoirs déjà émis sont retirés (avoirs successifs exacts)', () => {
    expect(netParTaux([{ taux_bp: 1_000, base_ht_cents: 367_176n, tva_cents: 36_718n }, { taux_bp: 2_000, base_ht_cents: 98_568n, tva_cents: 19_714n }], [],
      [[{ taux_bp: 2_000, base_ht_cents: 70_000n, tva_cents: 14_000n }]]))
      .toEqual([{ taux_bp: 1_000, base_ht_cents: 367_176n, tva_cents: 36_718n }, { taux_bp: 2_000, base_ht_cents: 28_568n, tva_cents: 5_714n }]);
  });
  it('reste dû inatteignable en un avoir (1 200,01 € TTC à 20 % après un avoir de 100,00) : message en deux fois, et les deux avoirs passent', () => {
    // Facture 1 000,01 HT + 200,00 TVA ; avoir de 100,00 = 83,33 HT + 16,67 TVA ; reste 916,68 HT + 183,33 TVA = 1 100,01.
    const reste = netParTaux([{ taux_bp: 2_000, base_ht_cents: 100_001n, tva_cents: 20_000n }], [], [[{ taux_bp: 2_000, base_ht_cents: 8_333n, tva_cents: 1_667n }]]);
    expect(() => lignesAvoirMontant(reste, 110_001n, 'assujetti', false, 'A')).toThrow(/Montant atteignable le plus proche : 1\s100,00\s€/);
    const a1 = lignesAvoirMontant(reste, 110_000n, 'assujetti', false, 'A');
    const t1 = totauxFacture(a1, 0, 'assujetti');
    expect(t1.totalTtcCents).toBe(110_000n);
    const a2 = lignesAvoirMontant(netParTaux(reste, [], [t1.ventilation]), 1n, 'assujetti', false, 'A');
    expect(totauxFacture(a2, 0, 'assujetti').totalTtcCents).toBe(1n);
  });
  it('deux taux : le montant proposé est toujours atteignable (montants de 100,00 à 199,99 €)', () => {
    const net = [{ taux_bp: 1_000, base_ht_cents: 300_000n, tva_cents: 30_000n }, { taux_bp: 2_000, base_ht_cents: 200_000n, tva_cents: 40_000n }];
    let refuses = 0;
    for (let m = 10_000n; m < 20_000n; m++) {
      try { lignesAvoirMontant(net, m, 'assujetti', false, 'A'); } catch (e) {
        refuses++;
        const propose = /le plus proche : ([\d\s\u00a0\u202f]+,\d\d)/.exec((e as Error).message)?.[1];
        expect(propose, (e as Error).message).toBeTruthy();
        const c = BigInt(lireMontantEnCentimes(propose!)!);
        expect(c < m).toBe(true);
        expect(totauxFacture(lignesAvoirMontant(net, c, 'assujetti', false, 'A'), 0, 'assujetti').totalTtcCents).toBe(c);
      }
    }
    // Les centimes passent d'un taux à l'autre si besoin : sur deux taux, chaque montant de cette plage tombe juste
    // (le message de repli reste couvert par le cas « reste dû inatteignable »).
    expect(refuses).toBe(0);
  });
  it('avoirs successifs : la TVA créditée par taux égale exactement la TVA facturée (1 000,02 € HT à 20 %, avoir de 10,00 puis tout le reste)', () => {
    const facture = [{ taux_bp: 2_000, base_ht_cents: 100_002n, tva_cents: 20_000n }];
    // 10,00 € (8,33 + 1,67) laisserait 991,69 HT + 198,33 de TVA, incohérent d'un centime : refusé, 9,98 € proposé.
    expect(() => lignesAvoirMontant(facture, 1_000n, 'assujetti', false, 'A')).toThrow(/le plus proche : 9,98\s€/);
    const a1 = totauxFacture(lignesAvoirMontant(facture, 998n, 'assujetti', false, 'A'), 0, 'assujetti');
    const reste = netParTaux(facture, [], [a1.ventilation]);
    const du = reste.reduce((a, v) => a + v.base_ht_cents + v.tva_cents, 0n);
    const a2 = totauxFacture(lignesAvoirMontant(reste, du, 'assujetti', false, 'A'), 0, 'assujetti');
    expect(a1.ventilation[0]!.tva_cents + a2.ventilation[0]!.tva_cents).toBe(20_000n);
    expect(a1.ventilation[0]!.base_ht_cents + a2.ventilation[0]!.base_ht_cents).toBe(100_002n);
  });
  it('trois taux, deux avoirs de 174,95 € puis le reste : base et TVA de chaque taux soldées exactement', () => {
    const facture = [{ taux_bp: 550, base_ht_cents: 3_582n, tva_cents: 197n }, { taux_bp: 1_000, base_ht_cents: 6_874n, tva_cents: 687n },
      { taux_bp: 2_000, base_ht_cents: 15_755n, tva_cents: 3_151n }];
    const emis: Ventilation[] = [];
    let reste = facture;
    for (const m of [17_495n, null]) {
      const du = reste.reduce((a, v) => a + v.base_ht_cents + v.tva_cents, 0n);
      const t = totauxFacture(lignesAvoirMontant(reste, m ?? du, 'assujetti', false, 'A'), 0, 'assujetti');
      emis.push(t.ventilation);
      reste = netParTaux(facture, [], emis);
    }
    expect(reste).toEqual([]);
  });
  it('propriété : un avoir partiel puis « tout le reste » solde toujours chaque taux exactement (1 000 factures à deux taux)', () => {
    let a = 11;
    const r = (n: number) => { a = (a * 1103515245 + 12345) % 2147483648; return a % n; };
    for (let i = 0; i < 1_000; i++) {
      const b1 = BigInt(100 + r(500_000)), b2 = BigInt(100 + r(500_000));
      const facture = [{ taux_bp: 1_000, base_ht_cents: b1, tva_cents: arrondi(b1 * 1_000n, 10_000n) },
        { taux_bp: 2_000, base_ht_cents: b2, tva_cents: arrondi(b2 * 2_000n, 10_000n) }];
      const total = facture.reduce((x, v) => x + v.base_ht_cents + v.tva_cents, 0n);
      let a1: Ventilation;
      try { a1 = totauxFacture(lignesAvoirMontant(facture, BigInt(1 + r(Number(total) - 1)), 'assujetti', false, 'A'), 0, 'assujetti').ventilation; } catch { continue; }
      const reste = netParTaux(facture, [], [a1]);
      const du = reste.reduce((x, v) => x + v.base_ht_cents + v.tva_cents, 0n);
      const a2 = totauxFacture(lignesAvoirMontant(reste, du, 'assujetti', false, 'A'), 0, 'assujetti').ventilation;
      expect(netParTaux(facture, [], [a1, a2])).toEqual([]);
    }
  });
  it('propriété : tout montant atteignable reste exact sur deux taux (2 000 cas)', () => {
    let a = 3;
    const r = (n: number) => { a = (a * 1103515245 + 12345) % 2147483648; return a % n; };
    const net = [{ taux_bp: 1_000, base_ht_cents: 350_000n, tva_cents: 35_000n }, { taux_bp: 2_000, base_ht_cents: 120_000n, tva_cents: 24_000n }];
    let exacts = 0;
    for (let i = 0; i < 2_000; i++) {
      const m = BigInt(1 + r(529_000));
      try {
        const lignes = lignesAvoirMontant(net, m, 'assujetti', false, 'A');
        expect(totauxFacture(lignes, 0, 'assujetti').totalTtcCents).toBe(m);
        exacts++;
      } catch (e) { expect((e as Error).message).toMatch(/pas atteignable/); }
    }
    expect(exacts).toBeGreaterThan(1_500);
  });
});

describe('totaux facture : autoliquidation et franchise', () => {
  it('autoliquidation : lignes à 10 %, TVA facturée 0', () => {
    const t = totauxFacture([lf(ld('Murs', 10_000n, 100_000n, 1_000))], 0, 'assujetti', true);
    expect(t.ventilation).toEqual([{ taux_bp: 1_000, base_ht_cents: 100_000n, tva_cents: 0n }]);
  });
  it('autoliquidation en franchise : refusée', () => expect(() => totauxFacture([], 0, 'franchise', true)).toThrow(ErreurFacture));
  it('franchise : ligne taxée refusée', () => expect(() => totauxFacture([lf(ld('A', 1n, 1n, 1_000))], 0, 'franchise')).toThrow(ErreurFacture));
});

describe('IBAN et QR de virement', () => {
  it('IBAN : clé de contrôle', () => {
    expect(ibanValide('FR14 2004 1010 0505 0001 3M02 606')).toBe(true);
    expect(ibanValide('DE89370400440532013000')).toBe(true);
    expect(ibanValide('FR14 2004 1010 0505 0001 3M02 607')).toBe(false);
    expect(ibanValide('')).toBe(false);
    expect(formaterIban('fr1420041010050500013m02606')).toBe('FR14 2004 1010 0505 0001 3M02 606');
  });
  it('QR SEPA (EPC 002) : champs dans l’ordre, montant au point décimal', () => {
    expect(payloadVirementSepa({ beneficiaire: "H'DECOR EI", iban: 'FR14 2004 1010 0505 0001 3M02 606', bic: 'PSSTFRPPPAR', montantCents: 385_000n, reference: 'Facture FAC-2026-0002' }))
      .toBe("BCD\n002\n1\nSCT\nPSSTFRPPPAR\nH'DECOR EI\nFR1420041010050500013M02606\nEUR3850.00\n\n\nFacture FAC-2026-0002");
  });
  it('QR : accents retirés, longueurs bornées, refus des valeurs fausses', () => {
    const p = payloadVirementSepa({ beneficiaire: 'Éléonore Pèlerin', iban: 'DE89370400440532013000', montantCents: 5n, reference: 'x'.repeat(200) });
    expect(p.split('\n')[5]).toBe('Eleonore Pelerin');
    expect(p.split('\n')[7]).toBe('EUR0.05');
    expect(p.split('\n')[10]).toHaveLength(140);
    expect(() => payloadVirementSepa({ beneficiaire: 'A', iban: 'FR00', montantCents: 1n, reference: '' })).toThrow(ErreurVirement);
    expect(() => payloadVirementSepa({ beneficiaire: 'A', iban: 'DE89370400440532013000', montantCents: 0n, reference: '' })).toThrow(ErreurVirement);
  });
});

describe('mentions obligatoires de la facture', () => {
  const params: ParametresEmetteur = {
    raison_sociale: "H'DECOR", forme_juridique: 'EI', nom_dirigeant: null, siret: '12345678900011', immatriculation: null,
    adresse_ligne1: '1 rue A', adresse_ligne2: null, code_postal: '57100', ville: 'Thionville', telephone: null, email: null,
    numero_tva_intra: null, regime_tva: 'franchise', mention_franchise: 'TVA non applicable, art. 293 B du CGI',
    mediateur_nom: 'M', mediateur_coordonnees: null, mediateur_site: null, mentions_pied: null,
  };
  const dec = { type: 'decennale' as const, assureur: 'A', numero_contrat: 'D', debut: '2026-01-01', fin: null, zone_couverte: 'France' };
  const e: CopieEmetteurFacture = {
    ...copieEmetteur(params, [dec], '2026-10-09'),
    paiement: { iban: 'FR1420041010050500013M02606', bic: null, taux_penalites_bp: 1_000, indemnite_recouvrement_cents: 4_000, escompte_texte: 'Pas d’escompte.' },
  };
  const part = copieClient({ type: 'particulier', civilite: null, nom: 'Martin', prenom: 'Alice', raison_sociale: null, siret: null, tva_intra: null,
    email: null, telephone: null, fact_ligne1: '3 av. B', fact_ligne2: null, fact_code_postal: '57100', fact_ville: 'Thionville', fact_pays: null });
  const pro = { ...part, type: 'professionnel' as const, nom_affiche: 'Société X' };
  const f = { type: 'finale' as const, date_prestation_debut: '2026-10-01', date_prestation_fin: '2026-10-05', autoliquidation: false, regime_tva: 'franchise' as const,
    date_emission: '2026-10-09', date_echeance: '2026-11-08', fin_retractation: null };
  const cles = (m: { cle: string; bloquant: boolean }[], b = true) => m.filter((x) => x.bloquant === b).map((x) => x.cle);
  it('complète : aucun bloquant ; particulier : indemnité non imprimée, signalée', () => {
    expect(cles(controlerMentionsFacture(e, part, null, f))).toEqual([]);
    expect(cles(controlerMentionsFacture(e, part, null, f), false)).toEqual(['indemnite_particulier']);
    expect(mentionIndemnite(e.paiement, part)).toBeNull();
    // Montant formaté par formaterEuros (espace insécable avant « € »).
    expect(mentionIndemnite(e.paiement, pro)).toMatch(/^Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40,00\s€\.$/);
  });
  it('IBAN faux, pénalités absentes, date de prestation absente : bloquants', () => {
    const m = controlerMentionsFacture({ ...e, paiement: { ...e.paiement, iban: 'FR00 1234', taux_penalites_bp: null } }, part, null,
      { ...f, date_prestation_debut: null, date_prestation_fin: null });
    expect(cles(m)).toEqual(['iban', 'penalites', 'date_prestation']);
  });
  it('avoir : ni IBAN ni pénalités exigés', () => {
    expect(cles(controlerMentionsFacture({ ...e, paiement: { ...e.paiement, iban: null, taux_penalites_bp: null } }, part, null,
      { ...f, type: 'avoir', date_prestation_debut: null, date_prestation_fin: null }))).toEqual([]);
  });
  it('autoliquidation : client professionnel exigé', () => {
    const a = { ...e, regime_tva: 'assujetti' as const, numero_tva_intra: 'FR00123456789' };
    expect(cles(controlerMentionsFacture(a, part, null, { ...f, regime_tva: 'assujetti', autoliquidation: true }))).toEqual(['autoliquidation_client']);
    expect(cles(controlerMentionsFacture(a, pro, null, { ...f, regime_tva: 'assujetti', autoliquidation: true }), false)).toContain('autoliquidation_tva');
  });
  it('dates : acompte sans date exigée ; finale et situation : date de fin exigée', () => {
    expect(cles(controlerMentionsFacture(e, part, null, { ...f, type: 'acompte', date_prestation_debut: null, date_prestation_fin: null }))).toEqual([]);
    expect(cles(controlerMentionsFacture(e, part, null, { ...f, date_prestation_fin: null }))).toEqual(['date_prestation']);
    expect(cles(controlerMentionsFacture(e, part, null, { ...f, type: 'situation', date_prestation_fin: null }))).toEqual(['date_prestation']);
  });
  it('libellés des dates : acompte = début prévu, situation = période, finale = prestation', () => {
    const fmt = (d: string) => d.split('-').reverse().join('/');
    expect(libelleDatesPrestation('acompte', '2026-11-02', null, fmt)).toBe('Début des travaux prévu le 02/11/2026');
    expect(libelleDatesPrestation('acompte', null, null, fmt)).toBeNull();
    expect(libelleDatesPrestation('situation', '2026-10-01', '2026-10-31', fmt)).toBe('Travaux réalisés : période du 01/10/2026 au 31/10/2026');
    expect(libelleDatesPrestation('finale', '2026-10-01', '2026-10-05', fmt)).toBe('Date de la prestation : du 01/10/2026 au 05/10/2026');
    expect(libelleDatesPrestation('finale', null, '2026-10-05', fmt)).toBe('Date de la prestation : le 05/10/2026');
    expect(libelleDatesPrestation('avoir', '2026-10-01', '2026-10-05', fmt)).toBeNull();
  });
  it('rétractation : signalée pendant le délai, échéance dans le délai bloquante, rien pour un professionnel ou après le délai', () => {
    expect(finRetractation(true, 'particulier', '2026-10-01')).toBe('2026-10-15');
    expect(finRetractation(true, 'professionnel', '2026-10-01')).toBeNull();
    expect(finRetractation(false, 'particulier', '2026-10-01')).toBeNull();
    const pendant = { ...f, type: 'acompte' as const, date_emission: '2026-10-02', fin_retractation: '2026-10-15' };
    expect(cles(controlerMentionsFacture(e, part, null, { ...pendant, date_echeance: '2026-11-01' }), false)).toContain('retractation');
    expect(cles(controlerMentionsFacture(e, part, null, { ...pendant, date_echeance: '2026-10-15' }))).toEqual(['echeance_retractation']);
    expect(cles(controlerMentionsFacture(e, part, null, { ...pendant, date_emission: '2026-10-16', date_echeance: '2026-11-15' }), false))
      .not.toContain('retractation');
  });
  it('avoir d’une facture d’un ancien régime de TVA : pas de blocage « régime » ; mention selon le régime de la facture', () => {
    const assujetti = { ...e, regime_tva: 'assujetti' as const, numero_tva_intra: 'FR00123456789' };
    const avoir = { ...f, type: 'avoir' as const, date_prestation_debut: null, date_prestation_fin: null };
    expect(cles(controlerMentionsFacture(assujetti, part, null, avoir))).toEqual([]);
    expect(textesAVerifierFacture(assujetti, part, avoir)).toEqual(['Mention de franchise de TVA']);
    expect(cles(controlerMentionsFacture(assujetti, part, null, f))).toEqual(['regime']);
  });
  it('mention des pénalités et textes à vérifier', () => {
    expect(mentionPenalites(e.paiement)).toBe('En cas de retard de paiement, des pénalités au taux annuel de 10 % sont exigibles à compter du lendemain de la date d’échéance.');
    expect(textesAVerifierFacture(e, pro, f)).toEqual(['Mention des pénalités de retard (taux et point de départ)', 'Mention de l’indemnité forfaitaire pour frais de recouvrement', 'Mention de franchise de TVA']);
  });
});

describe('Factur-X (XML CII, préparé)', () => {
  const e = {
    ...copieEmetteur({
      raison_sociale: "H'DECOR & Fils <test>", forme_juridique: 'EI', nom_dirigeant: null, siret: '12345678900011', immatriculation: null,
      adresse_ligne1: '1 rue A', adresse_ligne2: null, code_postal: '57100', ville: 'Thionville', telephone: null, email: null,
      numero_tva_intra: null, regime_tva: 'franchise', mention_franchise: 'TVA non applicable, art. 293 B du CGI', mediateur_nom: null,
      mediateur_coordonnees: null, mediateur_site: null, mentions_pied: null,
    }, [], '2026-10-09'),
    paiement: { iban: 'FR1420041010050500013M02606', bic: null },
  };
  const client = copieClient({ type: 'particulier', civilite: null, nom: 'Martin', prenom: 'Alice', raison_sociale: null, siret: null, tva_intra: null,
    email: null, telephone: null, fact_ligne1: '3 av. B', fact_ligne2: null, fact_code_postal: '57100', fact_ville: 'Thionville', fact_pays: null });
  const lignes = [lf(ld('Murs', 319_300n, 1_250n, 0))];
  const t = totauxFacture(lignes, 0, 'franchise');
  const xml = xmlFacturX({
    numero: 'FAC-2026-0002', type: 'finale', dateEmission: '2026-10-09', dateEcheance: '2026-11-08', datePrestation: '2026-10-05', emetteur: e, client,
    lignes, ventilation: t.ventilation, regime: 'franchise', autoliquidation: false, remiseGlobaleCents: 0n,
    totalHtCents: t.totalHtCents, totalTvaCents: t.totalTvaCents, totalTtcCents: t.totalTtcCents,
    deductions: [{ facture_id: 'a', numero: 'FAC-2026-0001', ht: 10_000n, tva: 0n, ttc: 10_000n }], netAPayerCents: t.totalTtcCents - 10_000n, factureOrigine: null,
  });
  it('balises équilibrées (XML bien formé)', () => {
    const pile: string[] = [];
    for (const m of xml.replace(/<\?xml[^>]*\?>/, '').matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) expect(pile.pop()).toBe(m[2]); else pile.push(m[2]!);
    }
    expect(pile).toEqual([]);
  });
  it.each([
    ['profil EN 16931', '<ram:ID>urn:cen.eu:en16931:2017</ram:ID>'], ['numéro', '<ram:ID>FAC-2026-0002</ram:ID>'], ['type facture', '<ram:TypeCode>380</ram:TypeCode>'],
    ['date', '<udt:DateTimeString format="102">20261009</udt:DateTimeString>'], ['échappement', "H&apos;DECOR &amp; Fils &lt;test&gt;"],
    ['quantité m²', '<ram:BilledQuantity unitCode="MTK">31.9300</ram:BilledQuantity>'], ['total ligne', '<ram:LineTotalAmount>399.13</ram:LineTotalAmount>'],
    ['exonération (franchise)', '<ram:ExemptionReason>TVA non applicable, art. 293 B du CGI</ram:ExemptionReason>'], ['catégorie E', '<ram:CategoryCode>E</ram:CategoryCode>'],
    ['IBAN', '<ram:IBANID>FR1420041010050500013M02606</ram:IBANID>'], ['SIREN vendeur', '<ram:ID schemeID="0002">123456789</ram:ID>'],
    ['acompte déjà payé', '<ram:TotalPrepaidAmount>100.00</ram:TotalPrepaidAmount>'], ['net à payer', '<ram:DuePayableAmount>299.13</ram:DuePayableAmount>'],
    ['échéance', '<ram:DueDateDateTime><udt:DateTimeString format="102">20261108</udt:DateTimeString></ram:DueDateDateTime>'],
  ])('%s', (_, attendu) => expect(xml).toContain(attendu));
  it('vendeur avec sa forme juridique (EI)', () => expect(xml).toContain("<ram:Name>H&apos;DECOR &amp; Fils &lt;test&gt; EI</ram:Name>"));
  it('autoliquidation : motif avant la base, code d’exonération après la catégorie (ordre du schéma CII)', () => {
    const l10 = [lf(ld('Murs', 10_000n, 100_000n, 1_000))];
    const ta = totauxFacture(l10, 0, 'assujetti', true);
    const x = xmlFacturX({
      numero: 'FAC-2026-0003', type: 'libre', dateEmission: '2026-10-09', dateEcheance: '2026-11-08', datePrestation: '2026-10-05',
      emetteur: { ...e, regime_tva: 'assujetti', numero_tva_intra: 'FR00123456789' }, client, lignes: l10, ventilation: ta.ventilation,
      regime: 'assujetti', autoliquidation: true, remiseGlobaleCents: 0n, totalHtCents: ta.totalHtCents, totalTvaCents: ta.totalTvaCents,
      totalTtcCents: ta.totalTtcCents, deductions: [], netAPayerCents: ta.totalTtcCents, factureOrigine: null,
    });
    expect(x).toMatch(/<ram:TypeCode>VAT<\/ram:TypeCode><ram:ExemptionReason>Autoliquidation<\/ram:ExemptionReason><ram:BasisAmount>1000.00<\/ram:BasisAmount><ram:CategoryCode>AE<\/ram:CategoryCode><ram:ExemptionReasonCode>VATEX-EU-AE<\/ram:ExemptionReasonCode><ram:RateApplicablePercent>/);
  });
});

describe('Taux de TVA à l’émission d’une facture (mêmes règles que le devis)', () => {
  const actifs = [{ taux_bp: 0, attestation_requise: false }, { taux_bp: 1000, attestation_requise: true }, { taux_bp: 2000, attestation_requise: false }];
  const cles = (m: { cle: string; bloquant: boolean }[]) => m.filter((x) => x.bloquant).map((x) => x.cle);
  it('assujetti : une ligne à 0 % sans mention est bloquante (facture libre)', () => {
    expect(cles(controlesTauxFacture('libre', 'assujetti', false, [{ designation: 'Peinture', tauxTvaBp: 0 }], actifs))).toEqual(['taux_zero']);
  });
  it('assujetti : taux réduit avec attestation requise bloquant, taux absent des Paramètres bloquant', () => {
    expect(cles(controlesTauxFacture('finale', 'assujetti', false, [{ designation: 'A', tauxTvaBp: 1000 }], actifs))).toEqual(['attestation_tva']);
    expect(cles(controlesTauxFacture('libre', 'assujetti', false, [{ designation: 'A', tauxTvaBp: 850 }], actifs))).toEqual(['taux_inactif']);
  });
  it('assujetti à 20 % : rien à signaler', () => {
    expect(controlesTauxFacture('acompte', 'assujetti', false, [{ designation: 'A', tauxTvaBp: 2000 }], actifs)).toEqual([]);
  });
  it('franchise : un taux non nul est bloquant, 0 % accepté', () => {
    expect(cles(controlesTauxFacture('libre', 'franchise', false, [{ designation: 'A', tauxTvaBp: 2000 }], actifs))).toEqual(['taux_franchise']);
    expect(controlesTauxFacture('libre', 'franchise', false, [{ designation: 'A', tauxTvaBp: 0 }], actifs)).toEqual([]);
  });
  it('avoir et autoliquidation : pas de contrôle de taux', () => {
    expect(controlesTauxFacture('avoir', 'assujetti', false, [{ designation: 'A', tauxTvaBp: 0 }], actifs)).toEqual([]);
    expect(controlesTauxFacture('libre', 'assujetti', true, [{ designation: 'A', tauxTvaBp: 0 }], actifs)).toEqual([]);
  });
});
