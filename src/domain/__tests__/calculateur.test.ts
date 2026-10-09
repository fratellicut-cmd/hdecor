import { describe, expect, it } from 'vitest';
import { calculerPoste, dixiemesDeJour, listeAchat, type ParametresCalcul, type PosteCalc, type ProduitCalc } from '../calculateur';

const params: ParametresCalcul = {
  margePerteBp: 1000,
  coefMargeBp: 13_000,
  tauxHoraireCents: 4500n,
  formatsDefautMl: [1000, 2500, 5000, 10_000, 15_000],
  coefSupportBp: { ancienne_peinture: 10_000, platre_neuf: 8000 },
  referentiel: {
    acrylique: { rendementMinCentiemes: 1000, minutesParM2CoucheCentiemes: 15, aVerifier: true },
    impression: { rendementMinCentiemes: 800, minutesParM2CoucheCentiemes: null, aVerifier: true },
  },
};

const acryliqueCatalogue: ProduitCalc = {
  id: 'p1', libelle: 'Acrylique mat (fictif)', reference: null, type: 'acrylique', unite: 'L', rendementCentiemes: 1000,
  couchesRecommandees: 2, sechageRecouvrableH: '6.0', usages: ['mur', 'plafond'], aVerifier: true,
  formats: [
    { contenanceMl: 1000, prixCents: 1500n }, { contenanceMl: 2500, prixCents: 3000n }, { contenanceMl: 5000, prixCents: 5000n },
    { contenanceMl: 10_000, prixCents: 9000n }, { contenanceMl: 15_000, prixCents: 13_000n },
  ],
};

const posteMurs: PosteCalc = {
  id: 'm', libelle: 'Chambre : murs', surface: { mm2: 31_926_800n }, cible: 'murs', support: 'ancienne_peinture',
  zoneHumide: false, taches: false, etapes: [{ id: 'e1', code: 'lessivage', libelle: 'Lessivage', minutesParM2Centiemes: 5, produit: null, consommationE4: null, aVerifier: true }],
  produit: acryliqueCatalogue, typeProduit: null, teinte: { id: 't1', nom: 'Blanc (fictif)' }, couches: 2,
  rendementForceCentiemes: null, margePerteBp: null, majorationTempsBp: 0,
};

describe('poste : cas de référence complet', () => {
  const r = calculerPoste(posteMurs, params);
  it('7,0239 L, 5 L + 2,5 L, 80,00 €', () => {
    expect(r.quantite?.dixMilliemes).toBe(70_239n);
    expect(r.pots?.retenue.coutCents).toBe(8000n);
    expect(r.sourceRendement).toBe('produit');
  });
  it('temps 11 min (0,15 × 2 + lessivage 0,05) et main-d’œuvre 8,25 €', () => {
    expect(r.temps?.minutes).toBe(11n);
    expect(r.coutMainOeuvreCents).toBe(825n);
  });
  it('séchage repris de la fiche, valeurs À VÉRIFIER listées, aucun manque', () => {
    expect(r.sechage).toMatch(/6,0 h/);
    expect(r.aVerifier).toEqual(expect.arrayContaining(['rendement du produit', 'temps de pose', 'étape « Lessivage »', 'coefficient du support']));
    expect(r.manques).toEqual([]);
    expect(r.avertissements).toEqual([]);
  });
});

describe('poste : rendement', () => {
  it('sans produit : bas de la fourchette du référentiel (prudent), formats usuels sans prix', () => {
    const r = calculerPoste({ ...posteMurs, produit: null, typeProduit: 'acrylique' }, params);
    expect(r.sourceRendement).toBe('referentiel');
    expect(r.rendementCentiemes).toBe(1000);
    expect(r.pots?.choixAuCout).toBe(false);
    expect(r.coutMatiereCents).toBeNull();
  });
  it('rendement forcé sur le poste prioritaire : 12 m²/L -> 31,9268 ÷ 12 × 2 × 1,1 = 5,8532467 -> 5,8532 L', () => {
    // 31,9268 ÷ 12 = 2,6605667 ; × 2 = 5,3211333 ; × 1,1 = 5,8532467.
    const r = calculerPoste({ ...posteMurs, rendementForceCentiemes: 1200 }, params);
    expect(r.quantite?.dixMilliemes).toBe(58_532n);
  });
  it('coefficient de support 0,80 (plâtre neuf) : 7,023896 ÷ 0,8 = 8,77987 L', () => {
    const r = calculerPoste({ ...posteMurs, support: 'platre_neuf', etapes: [] }, params);
    expect(r.quantite?.dixMilliemes).toBe(87_799n);
    expect(r.avertissements.join(' ')).toMatch(/impression/);
  });
  it('type sans rendement connu : signalé, aucune quantité inventée', () => {
    const r = calculerPoste({ ...posteMurs, produit: null, typeProduit: 'facade' }, params);
    expect(r.quantite).toBeNull();
    expect(r.manques.join(' ')).toMatch(/Rendement inconnu/);
  });
  it('ni produit ni type : signalé', () => {
    const r = calculerPoste({ ...posteMurs, produit: null, typeProduit: null }, params);
    expect(r.manques.join(' ')).toMatch(/Choisissez un produit/);
  });
  it('surface non calculable (plinthe sans développé) : signalé, pas de calcul', () => {
    const r = calculerPoste({ ...posteMurs, surface: { manque: 'Renseignez la largeur développée.' } }, params);
    expect(r.quantite).toBeNull();
    expect(r.temps).toBeNull();
    expect(r.manques).toContain('Renseignez la largeur développée.');
  });
  it('taux horaire absent : temps calculé, coût signalé manquant', () => {
    const r = calculerPoste(posteMurs, { ...params, tauxHoraireCents: null });
    expect(r.coutMainOeuvreCents).toBeNull();
    expect(r.manques.join(' ')).toMatch(/Taux horaire/);
  });
});

describe('liste d’achat', () => {
  const plafond: PosteCalc = { ...posteMurs, id: 'p', libelle: 'Chambre : plafond', surface: { mm2: 12_000_000n }, cible: 'plafond' };
  const res = (p: PosteCalc) => ({ poste: p, resultat: calculerPoste(p, params) });

  it('même produit et même teinte : quantités cumulées EXACTEMENT avant le choix des pots', () => {
    // murs 7,023896 L + plafond 12 ÷ 10 × 2 × 1,1 = 2,64 L -> 9,663896 L -> 9 664 ml.
    // Pots à 9,664 L : 10 L à 90 € ; 5 + 2,5 + 2,5 = 10 L à 110 € ; 5 + 5 = 100 € -> 10 L, 90,00 €.
    const l = listeAchat([res(posteMurs), res(plafond)], [], params);
    expect(l.lignes).toHaveLength(1);
    expect(l.lignes[0]!.quantite.dixMilliemes).toBe(96_639n);
    expect(l.lignes[0]!.pots?.retenue.coutCents).toBe(9000n);
    expect(l.lignes[0]!.postes).toEqual(['Chambre : murs', 'Chambre : plafond']);
  });
  it('teinte différente : ligne séparée', () => {
    const l = listeAchat([res(posteMurs), res({ ...plafond, teinte: { id: 't2', nom: 'Gris (fictif)' } })], [], params);
    expect(l.lignes.map((x) => x.teinte)).toEqual(['Blanc (fictif)', 'Gris (fictif)']);
  });
  it('totaux : matière, consommables, temps, main-d’œuvre, prix de vente (matière × 130 % + main-d’œuvre)', () => {
    // matière 80,00 € (murs) ; consommable 0,15 €/m² × 31,9268 = 4,79 € -> 84,79 €
    // temps 11 min -> 8,25 € ; vente 84,79 × 1,3 = 110,227 -> 110,23 € + 8,25 = 118,48 €.
    const l = listeAchat([res(posteMurs)], [{ id: 'k', libelle: 'Bâches et adhésif', mode: 'par_m2', prixCents: 15n, aVerifier: true }], params);
    expect(l.coutMatiereCents).toBe(8479n);
    expect(l.coutComplet).toBe(true);
    expect(l.tempsMinutes).toBe(11n);
    expect(l.coutMainOeuvreCents).toBe(825n);
    expect(l.prixVenteHtCents).toBe(11_848n);
  });
  it('un prix manquant : total partiel signalé, pas de prix de vente', () => {
    const l = listeAchat([res({ ...posteMurs, produit: null, typeProduit: 'acrylique' })], [], params);
    expect(l.coutComplet).toBe(false);
    expect(l.prixVenteHtCents).toBeNull();
    expect(l.lignes[0]!.libelle).toMatch(/produit à choisir/);
  });
  it('matière de préparation (enduit 0,5 kg/m² sur 8 m² = 4 kg) ajoutée à la liste', () => {
    const enduit: ProduitCalc = { ...acryliqueCatalogue, id: 'e', libelle: 'Enduit (fictif)', type: 'enduit', unite: 'kg', formats: [{ contenanceMl: 5000, prixCents: 1200n }] };
    const p: PosteCalc = { ...posteMurs, surface: { mm2: 8_000_000n }, etapes: [{ id: 'r', code: 'rebouchage', libelle: 'Rebouchage', minutesParM2Centiemes: 10, produit: enduit, consommationE4: 5000, aVerifier: true }] };
    const l = listeAchat([res(p)], [], params);
    const ligne = l.lignes.find((x) => x.libelle === 'Enduit (fictif)')!;
    expect(ligne.quantite.dixMilliemes).toBe(40_000n);
    expect(ligne.unite).toBe('kg');
    expect(ligne.pots?.retenue.pots).toEqual([expect.objectContaining({ contenanceMl: 5000, nombre: 1 })]);
  });
  it('durée : 630 min = 1,5 jour (journées de 7 h)', () => expect(dixiemesDeJour(630n)).toBe(15n));
});
