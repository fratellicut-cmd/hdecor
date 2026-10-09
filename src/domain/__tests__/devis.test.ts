import { describe, expect, it } from 'vitest';
import {
  acompte, comparerVersions, controlerEcheancier, ErreurDevis, remplirModele, repriseDePoste, sousTotaux, totalLigne, totauxDevis,
  ventiler, type LigneDevis, type PosteAReprendre,
} from '../devis';

/** Ligne chiffrée : quantité et prix en décimaux lisibles (convertis exactement). */
function ligne(designation: string, quantite: string, prixEuros: string, tauxBp: number, autres: Partial<LigneDevis> = {}): LigneDevis {
  const e4 = (s: string) => { const [e, d = ''] = s.split('.'); return BigInt(e!) * 10_000n + BigInt((d + '0000').slice(0, 4)); };
  const cents = (s: string) => { const [e, d = ''] = s.split('.'); return BigInt(e!) * 100n + BigInt((d + '00').slice(0, 2)); };
  return {
    type: 'ligne', designation, quantiteE4: e4(quantite), unite: 'u', prixUnitaireCents: cents(prixEuros), remiseBp: 0, tauxTvaBp: tauxBp,
    optionnelle: false, ...autres,
  };
}
const section = (designation: string): LigneDevis => ({
  type: 'section', designation, quantiteE4: null, unite: null, prixUnitaireCents: null, remiseBp: 0, tauxTvaBp: null, optionnelle: false,
});
const sousTotal = (): LigneDevis => ({ ...section('Sous-total'), type: 'sous_total' });

describe('R4 : total d’une ligne arrondi en une fois', () => {
  it('31,93 m² × 12,50 € = 399,125 -> 399,13 €', () => expect(totalLigne(319_300n, 1_250n, 0)).toBe(39_913n));
  it('remise de ligne appliquée avant l’arrondi : 3 × 33,33 € − 10 % = 89,991 -> 89,99 €', () => {
    expect(totalLigne(30_000n, 3_333n, 1_000)).toBe(8_999n);
  });
  it('0,0001 × 0,01 € -> 0 €', () => expect(totalLigne(1n, 1n, 0)).toBe(0n));
  it('remise 100 % -> 0 €', () => expect(totalLigne(10_000n, 5_000n, 10_000)).toBe(0n));
  it('valeurs hors bornes refusées', () => {
    expect(() => totalLigne(-1n, 100n, 0)).toThrow(ErreurDevis);
    expect(() => totalLigne(1n, -100n, 0)).toThrow(ErreurDevis);
    expect(() => totalLigne(1n, 100n, 10_001)).toThrow(ErreurDevis);
    expect(() => totalLigne(1n, 100n, 1.5)).toThrow(ErreurDevis);
  });
});

describe('R6 : TVA par taux, sur le total HT du taux (cas du §6)', () => {
  it('1 000 € HT à 10 % -> 100,00 € de TVA', () => {
    const t = totauxDevis([ligne('Peinture', '1', '1000', 1_000)], 0, 'assujetti');
    expect(t.ventilation).toEqual([{ taux_bp: 1_000, base_ht_cents: 100_000n, tva_cents: 10_000n }]);
    expect(t.totalTtcCents).toBe(110_000n);
  });
  it('300 € à 20 % + 700 € à 10 % -> 60 + 70 = 130,00 €', () => {
    const t = totauxDevis([ligne('A', '1', '300', 2_000), ligne('B', '1', '700', 1_000)], 0, 'assujetti');
    expect(t.totalTvaCents).toBe(13_000n);
    expect(t.ventilation.map((v) => v.taux_bp)).toEqual([1_000, 2_000]);
  });
  it('3 lignes de 33,33 € à 20 % -> TVA sur 99,99 € = 19,998 -> 20,00 € (et non 3 × 6,67 = 20,01)', () => {
    const t = totauxDevis([ligne('A', '1', '33.33', 2_000), ligne('B', '1', '33.33', 2_000), ligne('C', '1', '33.33', 2_000)], 0, 'assujetti');
    expect(t.totalHtCents).toBe(9_999n);
    expect(t.totalTvaCents).toBe(2_000n);
  });
});

describe('R5 : remise globale répartie entre les taux', () => {
  it('remise 10 % sur 300 € à 20 % + 700 € à 10 %', () => {
    const t = totauxDevis([ligne('A', '1', '300', 2_000), ligne('B', '1', '700', 1_000)], 1_000, 'assujetti');
    expect(t.remiseGlobaleCents).toBe(10_000n);
    expect(t.ventilation).toEqual([
      { taux_bp: 1_000, base_ht_cents: 63_000n, tva_cents: 6_300n },
      { taux_bp: 2_000, base_ht_cents: 27_000n, tva_cents: 5_400n },
    ]);
  });
  it('restes égaux : le centime restant va au taux le plus élevé', () => {
    // 3 × 10 € à 5,5 %, 10 %, 20 % ; remise 3,33 % : 30 × 0,0333 = 0,999 -> 1,00 €.
    // Part de chaque taux : 1000 × 100 ÷ 3000 = 33, reste 1000 (identiques) ; 1 centime -> taux 20 %.
    const v = ventiler([{ taux: 550, total: 1_000n }, { taux: 1_000, total: 1_000n }, { taux: 2_000, total: 1_000n }], 333, 'assujetti');
    expect(v).toEqual([
      { taux_bp: 550, base_ht_cents: 967n, tva_cents: 53n }, // 53,185 -> 53
      { taux_bp: 1_000, base_ht_cents: 967n, tva_cents: 97n }, // 96,7 -> 97
      { taux_bp: 2_000, base_ht_cents: 966n, tva_cents: 193n }, // 193,2 -> 193
    ]);
  });
  it('plus fort reste servi en premier', () => {
    // 1,00 € à 20 % et 2,01 € à 10 % ; remise 5 % : 301 × 0,05 = 15,05 -> 15 cents.
    // 20 % : 100 × 15 ÷ 301 = 4 reste 296 ; 10 % : 201 × 15 ÷ 301 = 10 reste 5.
    // 1 centime à répartir -> 20 % (plus fort reste) : bases 191 (10 %) et 95 (20 %).
    const v = ventiler([{ taux: 2_000, total: 100n }, { taux: 1_000, total: 201n }], 500, 'assujetti');
    expect(v.map((x) => x.base_ht_cents)).toEqual([191n, 95n]);
  });
  it('remise 100 % : tout à zéro', () => {
    const t = totauxDevis([ligne('A', '1', '300', 2_000), ligne('B', '1', '700', 1_000)], 10_000, 'assujetti');
    expect(t.totalTtcCents).toBe(0n);
  });
  it('remise hors bornes refusée', () => {
    expect(() => ventiler([{ taux: 1_000, total: 100n }], -1, 'assujetti')).toThrow(ErreurDevis);
    expect(() => ventiler([{ taux: 1_000, total: 100n }], 10_001, 'assujetti')).toThrow(ErreurDevis);
  });
  it('taux à somme nulle omis (comme en base)', () => {
    expect(ventiler([{ taux: 1_000, total: 0n }, { taux: 2_000, total: 100n }], 0, 'assujetti').map((v) => v.taux_bp)).toEqual([2_000]);
  });
});

describe('R8 : franchise en base de TVA', () => {
  it('TVA nulle', () => {
    const t = totauxDevis([ligne('A', '2', '150', 0)], 0, 'franchise');
    expect(t).toMatchObject({ totalHtCents: 30_000n, totalTvaCents: 0n, totalTtcCents: 30_000n });
  });
  it('une ligne à un taux non nul est refusée', () => {
    expect(() => totauxDevis([ligne('A', '1', '100', 1_000)], 0, 'franchise')).toThrow(ErreurDevis);
  });
});

describe('options et lignes non chiffrées', () => {
  const lignes = [
    section('Séjour'), ligne('Murs', '1', '500', 1_000), ligne('Plafond', '1', '200', 1_000, { id: 'opt-1', optionnelle: true }),
    { ...section('Note'), type: 'texte' as const },
  ];
  it('les options ne comptent pas par défaut', () => {
    const t = totauxDevis(lignes, 0, 'assujetti');
    expect(t.totalHtCents).toBe(50_000n);
    expect(t.optionsHtCents).toBe(20_000n);
  });
  it('option retenue : comptée', () => expect(totauxDevis(lignes, 0, 'assujetti', new Set(['opt-1'])).totalHtCents).toBe(70_000n));
  it('option inconnue : ignorée', () => expect(totauxDevis(lignes, 0, 'assujetti', new Set(['autre'])).totalHtCents).toBe(50_000n));
  it('ligne incomplète : erreur explicite', () => {
    expect(() => totauxDevis([{ ...ligne('Murs', '1', '1', 1_000), prixUnitaireCents: null }], 0, 'assujetti')).toThrow(/Murs/);
  });
});

describe('sous-totaux', () => {
  it('par section, hors options', () => {
    const lignes = [
      section('Séjour'), ligne('Murs', '1', '100', 1_000), ligne('Option', '1', '50', 1_000, { optionnelle: true }), sousTotal(),
      section('Chambre'), ligne('Murs', '2', '30', 1_000), sousTotal(),
    ];
    expect([...sousTotaux(lignes).entries()]).toEqual([[3, 10_000n], [6, 6_000n]]);
  });
});

describe('R9 : acompte', () => {
  it('5 000 € HT à 10 %, acompte 30 % -> 1 500 € HT + 150 € = 1 650,00 € TTC', () => {
    const t = totauxDevis([ligne('Peinture', '1', '5000', 1_000)], 0, 'assujetti');
    expect(acompte(t.ventilation, 3_000, 'assujetti')).toEqual({ htCents: 150_000n, tvaCents: 15_000n, ttcCents: 165_000n });
  });
  it('deux taux : base de chaque taux × %, puis TVA de chaque taux', () => {
    // 333,33 € à 10 % et 99,99 € à 20 %, 30 % : 99,999 -> 100,00 et 29,997 -> 30,00 ; TVA 10,00 + 6,00.
    const t = totauxDevis([ligne('A', '1', '333.33', 1_000), ligne('B', '1', '99.99', 2_000)], 0, 'assujetti');
    expect(acompte(t.ventilation, 3_000, 'assujetti')).toEqual({ htCents: 13_000n, tvaCents: 1_600n, ttcCents: 14_600n });
  });
  it('franchise : sans TVA', () => {
    expect(acompte([{ taux_bp: 0, base_ht_cents: 100_000n, tva_cents: 0n }], 3_000, 'franchise')).toEqual({ htCents: 30_000n, tvaCents: 0n, ttcCents: 30_000n });
  });
  it('pourcentage hors bornes refusé', () => expect(() => acompte([], 10_001, 'assujetti')).toThrow(ErreurDevis));
});

describe('échéancier', () => {
  it('acompte à la signature et contrôles', () => {
    expect(controlerEcheancier([
      { libelle: 'Acompte', pourcentageBp: 3_000, declencheur: 'signature', datePrevue: null },
      { libelle: 'Solde', pourcentageBp: 7_000, declencheur: 'fin_travaux', datePrevue: null },
    ])).toEqual({ acompteBp: 3_000, erreurs: [] });
  });
  it('plus de 100 % refusé', () => {
    const r = controlerEcheancier([
      { libelle: 'A', pourcentageBp: 6_000, declencheur: 'signature', datePrevue: null },
      { libelle: 'B', pourcentageBp: 6_000, declencheur: 'fin_travaux', datePrevue: null },
    ]);
    expect(r.erreurs).toHaveLength(1);
  });
  it('date exigée seulement pour « à date »', () => {
    expect(controlerEcheancier([{ libelle: 'A', pourcentageBp: 1_000, declencheur: 'date', datePrevue: null }]).erreurs).toHaveLength(1);
    expect(controlerEcheancier([{ libelle: 'A', pourcentageBp: 1_000, declencheur: 'signature', datePrevue: '2026-11-01' }]).erreurs).toHaveLength(1);
    expect(controlerEcheancier([{ libelle: 'A', pourcentageBp: 1_000, declencheur: 'date', datePrevue: '2026-11-01' }]).erreurs).toEqual([]);
  });
  it('échéance à 0 % refusée', () => {
    expect(controlerEcheancier([{ libelle: 'A', pourcentageBp: 0, declencheur: 'signature', datePrevue: null }]).erreurs).toHaveLength(1);
  });
});

describe('propriétés sur des devis aléatoires', () => {
  // Générateur pseudo-aléatoire déterministe (mulberry32) : tests reproductibles.
  function alea(graine: number) {
    let a = graine;
    return (n: number) => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
  }
  const TAUX = [0, 550, 1_000, 2_000];
  it('HT + TVA = TTC, bases = lignes − remise, remise globale exacte, TVA par taux', () => {
    const r = alea(42);
    for (let essai = 0; essai < 2_000; essai++) {
      const lignes: LigneDevis[] = Array.from({ length: 1 + r(12) }, (_, i) => ({
        type: 'ligne', designation: `L${i}`, quantiteE4: BigInt(r(5_000_000)), unite: 'm2', prixUnitaireCents: BigInt(r(500_000)),
        remiseBp: r(4) === 0 ? r(5_000) : 0, tauxTvaBp: TAUX[r(4)]!, optionnelle: false,
      }));
      const remiseBp = r(3) === 0 ? r(10_001) : 0;
      const t = totauxDevis(lignes, remiseBp, 'assujetti');
      const somme = lignes.reduce((a, l) => a + totalLigne(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp), 0n);
      expect(t.totalHtCents + t.totalTvaCents).toBe(t.totalTtcCents);
      expect(t.sommeLignesCents).toBe(somme);
      expect(t.remiseGlobaleCents).toBe((somme * BigInt(remiseBp) * 2n + 10_000n) / 20_000n);
      for (const v of t.ventilation) {
        expect(v.base_ht_cents >= 0n).toBe(true);
        expect(v.tva_cents).toBe((v.base_ht_cents * BigInt(v.taux_bp) * 2n + 10_000n) / 20_000n);
      }
      // Chaque taux reçoit sa part proportionnelle, à un centime près.
      for (const v of t.ventilation) {
        const sommeTaux = lignes.filter((l) => l.tauxTvaBp === v.taux_bp).reduce((a, l) => a + totalLigne(l.quantiteE4!, l.prixUnitaireCents!, l.remiseBp), 0n);
        const partExacte = (sommeTaux * t.remiseGlobaleCents) / somme;
        const remiseTaux = sommeTaux - v.base_ht_cents;
        expect(remiseTaux === partExacte || remiseTaux === partExacte + 1n).toBe(true);
      }
    }
  });
});

describe('reprise d’un poste de peinture', () => {
  const poste: PosteAReprendre = {
    designation: 'Murs séjour', description: 'Acrylique velours, 2 couches', surfaceMm2: 31_926_800n,
    coutMatiereCents: 10_000n, coutMainOeuvreCents: 26_000n, minutes: 420n, incomplet: false, origine: { poste_id: 'p1' },
  };
  it('quantité = surface affichée (31,93 m²), prix unitaire = prix de vente ÷ quantité', () => {
    // Vente : 100 € × 1,30 + 260 € = 390 € ; 390 ÷ 31,93 = 12,2142… -> 12,21 €.
    const l = repriseDePoste(poste, 13_000, 1_000);
    expect(l.quantiteE4).toBe(319_300n);
    expect(l.prixUnitaireCents).toBe(1_221n);
    expect(l).toMatchObject({ unite: 'm2', tauxTvaBp: 1_000, aCompleter: false, coutMatierePrevuCents: 10_000n, minutesPrevues: 420 });
    expect(l.origine).toEqual({ poste_id: 'p1', a_completer: false });
    // Total de la ligne : 31,93 × 12,21 = 389,8653 -> 389,87 € (écart d'arrondi du prix unitaire, visible et assumé).
    expect(totalLigne(l.quantiteE4!, l.prixUnitaireCents!, 0)).toBe(38_987n);
  });
  it('calcul incomplet : prix à compléter (0), jamais inventé', () => {
    const l = repriseDePoste({ ...poste, incomplet: true }, 13_000, 1_000);
    expect(l.prixUnitaireCents).toBe(0n);
    expect(l.aCompleter).toBe(true);
    expect(l.origine.a_completer).toBe(true);
  });
  it('surface inconnue : quantité 0, à compléter', () => {
    const l = repriseDePoste({ ...poste, surfaceMm2: null }, 13_000, 1_000);
    expect(l).toMatchObject({ quantiteE4: 0n, prixUnitaireCents: 0n, aCompleter: true });
  });
  it('main-d’œuvre inconnue : à compléter', () => {
    expect(repriseDePoste({ ...poste, coutMainOeuvreCents: null }, 13_000, 1_000).aCompleter).toBe(true);
  });
});

describe('comparaison de versions', () => {
  it('ajout, retrait, modification', () => {
    const avant = [ligne('Murs', '30', '12', 1_000), ligne('Plafond', '20', '15', 1_000)];
    const apres = [ligne('murs ', '32', '12', 1_000), ligne('Boiseries', '5', '20', 1_000)];
    expect(comparerVersions(avant, apres)).toEqual([
      { nature: 'modifiee', designation: 'murs ', champs: ['quantité'], avant: 36_000n, apres: 38_400n },
      { nature: 'ajoutee', designation: 'Boiseries', apres: 10_000n },
      { nature: 'retiree', designation: 'Plafond', avant: 30_000n },
    ]);
  });
  it('identiques : aucune différence', () => {
    const l = [section('Séjour'), ligne('Murs', '30', '12', 1_000)];
    expect(comparerVersions(l, l.map((x) => ({ ...x })))).toEqual([]);
  });
  it('lignes homonymes rapprochées dans l’ordre', () => {
    const avant = [ligne('Murs', '1', '10', 1_000), ligne('Murs', '2', '10', 1_000)];
    const apres = [ligne('Murs', '1', '10', 1_000), ligne('Murs', '3', '10', 1_000)];
    expect(comparerVersions(avant, apres)).toEqual([{ nature: 'modifiee', designation: 'Murs', champs: ['quantité'], avant: 2_000n, apres: 3_000n }]);
  });
});

describe('modèles de messages', () => {
  it('remplace les champs connus, laisse les inconnus visibles', () => {
    expect(remplirModele('Bonjour {client}, devis {numero} : {lien} {inconnu}', { client: 'M. Martin', numero: 'DEV-2026-0001', lien: 'https://x' }))
      .toBe('Bonjour M. Martin, devis DEV-2026-0001 : https://x {inconnu}');
  });
});
