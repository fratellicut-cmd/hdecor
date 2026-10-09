import { describe, expect, it } from 'vitest';
import { calculerPoste, dixiemesDeJour, listeAchat, type EtapeCalc, type ParametresCalcul, type PosteCalc, type ProduitCalc } from '../calculateur';
import { formaterQuantiteCourte, quantiteDepuisFraction } from '../peinture';

const params: ParametresCalcul = {
  margePerteBp: 1000,
  coefMargeBp: 13_000,
  tauxHoraireCents: 4500n,
  formatsDefautMl: [1000, 2500, 5000, 10_000, 15_000],
  formatsDefautG: [5000, 15_000, 25_000],
  hauteurAlerteMm: 3000,
  coefSupport: { ancienne_peinture: { bp: 10_000, aVerifier: true }, platre_neuf: { bp: 8000, aVerifier: true } },
  referentiel: {
    acrylique: { rendementMinCentiemes: 1000, minutesParM2CoucheCentiemes: 15, sechageDixiemesH: null, aVerifier: true },
    impression: { rendementMinCentiemes: 800, minutesParM2CoucheCentiemes: null, sechageDixiemesH: null, aVerifier: true },
    facade: { rendementMinCentiemes: null, minutesParM2CoucheCentiemes: null, sechageDixiemesH: null, aVerifier: true },
  },
};

const acryliqueCatalogue: ProduitCalc = {
  id: 'p1', libelle: 'Acrylique mat (fictif)', reference: null, type: 'acrylique', unite: 'L', rendementCentiemes: 1000,
  couchesRecommandees: 2, sechageDixiemesH: 60, usages: ['mur', 'plafond'], aVerifier: true, archive: false,
  formats: [
    { contenanceMl: 1000, prixCents: 1500n }, { contenanceMl: 2500, prixCents: 3000n }, { contenanceMl: 5000, prixCents: 5000n },
    { contenanceMl: 10_000, prixCents: 9000n }, { contenanceMl: 15_000, prixCents: 13_000n },
  ],
};

const etape = (code: string, libelle: string, minutes: number, autres: Partial<EtapeCalc> = {}): EtapeCalc => ({
  id: code, code, libelle, minutesParM2Centiemes: minutes, produit: null, consommationE4: null, typeProduit: null, couches: 1,
  avecMatiere: false, aVerifier: true, ...autres,
});

const posteMurs: PosteCalc = {
  id: 'm', libelle: 'Chambre : murs', surface: { mm2: 31_926_800n }, cleSurface: 'chambre|murs|', hauteurMm: 2500, cible: 'murs',
  support: 'ancienne_peinture', zoneHumide: false, taches: false, exterieur: false, etapes: [etape('lessivage', 'Lessivage', 5)],
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
  it('séchage de la fiche : 6 h entre 2 couches = 6 h d’attente ; valeurs À VÉRIFIER listées ; aucun manque', () => {
    expect(r.sechage).toBe('Séchage avant recouvrement : 6 h entre couches, soit 6 h d’attente au minimum.');
    expect(r.attenteSechageDixiemesH).toBe(60);
    expect(r.aVerifier).toEqual(expect.arrayContaining(['rendement du produit', 'temps de pose', 'étape « Lessivage »', 'coefficient du support']));
    expect(r.manques).toEqual([]);
    expect(r.incomplet).toEqual({ quantite: false, temps: false, matiere: false });
    // Aspect de l'ancienne peinture non saisi : seul le rappel d'accrochage subsiste.
    expect(r.avertissements).toEqual(['Ancienne peinture brillante ou satinée : prévoir un ponçage (égrenage) ou une sous-couche d’accrochage.']);
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
  const plafond: PosteCalc = { ...posteMurs, id: 'p', libelle: 'Chambre : plafond', surface: { mm2: 12_000_000n }, cible: 'plafond', cleSurface: 'chambre|plafond|' };
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
    const p: PosteCalc = { ...posteMurs, surface: { mm2: 8_000_000n }, etapes: [etape('rebouchage', 'Rebouchage', 10, { produit: enduit, consommationE4: 5000, avecMatiere: true })] };
    const l = listeAchat([res(p)], [], params);
    const ligne = l.lignes.find((x) => x.libelle === 'Enduit (fictif)')!;
    expect(ligne.quantite.dixMilliemes).toBe(40_000n);
    expect(ligne.unite).toBe('kg');
    expect(ligne.pots?.retenue.pots).toEqual([expect.objectContaining({ contenanceMl: 5000, nombre: 1 })]);
  });
  it('durée : 630 min = 1,5 jour (journées de 7 h)', () => expect(dixiemesDeJour(630n)).toBe(15n));
});

describe('totaux honnêtes (audit qa-calculs et métier)', () => {
  const res = (p: PosteCalc, prm = params) => ({ poste: p, resultat: calculerPoste(p, prm) });

  it('poste au rendement inconnu : liste partielle, poste listé « non chiffré », pas de prix de vente', () => {
    const facade = { ...posteMurs, id: 'f', libelle: 'Façade', produit: null, typeProduit: 'facade' as const, cleSurface: 'f' };
    const l = listeAchat([res(posteMurs), res(facade)], [], params);
    expect(l.coutComplet).toBe(false);
    expect(l.prixVenteHtCents).toBeNull();
    expect(l.nonChiffres).toEqual([{ libelle: 'Façade', raison: expect.stringMatching(/Rendement inconnu/) }]);
  });
  it('surface manquante : non chiffré, total partiel', () => {
    const plinthe = { ...posteMurs, id: 'x', libelle: 'Plinthes', surface: { manque: 'Renseignez la largeur développée.' }, cleSurface: 'x' };
    const l = listeAchat([res(posteMurs), res(plinthe)], [], params);
    expect(l.coutComplet).toBe(false);
    expect(l.nonChiffres.map((n) => n.libelle)).toEqual(['Plinthes']);
  });
  it('temps de pose inconnu (produit chiffré) : temps partiel, pas de prix de vente', () => {
    const p = { ...posteMurs, produit: { ...acryliqueCatalogue, type: 'facade' as const } };
    const l = listeAchat([res(p)], [], params);
    expect(l.coutComplet).toBe(true);
    expect(l.tempsComplet).toBe(false);
    expect(l.prixVenteHtCents).toBeNull();
  });
  it('étape qui consomme de la matière sans rien pour la chiffrer : signalée, total partiel', () => {
    const p = { ...posteMurs, etapes: [etape('rebouchage', 'Rebouchage', 10, { avecMatiere: true })] };
    const r = calculerPoste(p, params);
    expect(r.manques.join(' ')).toMatch(/Matière de l’étape « Rebouchage » non comptée/);
    expect(r.incomplet.matiere).toBe(true);
    expect(listeAchat([{ poste: p, resultat: r }], [], params).coutComplet).toBe(false);
  });
  it('impression cochée : sa matière est calculée par type (31,9268 ÷ 8 × 1,1 = 4,389935 L -> 4,3899 L ; 1 pot de 5 L)', () => {
    const p = { ...posteMurs, etapes: [etape('impression', 'Impression', 5, { typeProduit: 'impression', avecMatiere: true })] };
    const l = listeAchat([res(p)], [], params);
    const ligne = l.lignes.find((x) => x.libelle === 'Impression (produit à choisir)')!;
    expect(ligne.quantite.dixMilliemes).toBe(43_899n);
    expect(ligne.pots?.retenue.pots).toEqual([expect.objectContaining({ contenanceMl: 5000, nombre: 1 })]);
  });
  it('coefficient de support confirmé : plus marqué À VÉRIFIER', () => {
    const r = calculerPoste(posteMurs, { ...params, coefSupport: { ancienne_peinture: { bp: 10_000, aVerifier: false } } });
    expect(r.aVerifier).not.toContain('coefficient du support');
  });
  it('consommables au m² : une surface traitée par deux postes (impression + finition) comptée une fois', () => {
    const impression = { ...posteMurs, id: 'i', libelle: 'Chambre : murs (impression)', produit: null, typeProduit: 'impression' as const };
    const l = listeAchat([res(posteMurs), res(impression)], [{ id: 'k', libelle: 'Bâches', mode: 'par_m2', prixCents: 15n, aVerifier: true }], params);
    // 0,15 € × 31,9268 m² = 4,78902 -> 4,79 € (et non 9,58 €).
    expect(l.consommables[0]!.coutCents).toBe(479n);
  });
  it('hauteur au-delà du seuil (3,50 m > 3,00 m) : alerte échafaudage', () => {
    const r = calculerPoste({ ...posteMurs, hauteurMm: 3500 }, params);
    expect(r.avertissements.join(' ')).toMatch(/Hauteur 3,50\u00a0m : prévoir échafaudage/);
  });
  it('séchage inconnu avec 2 couches : signalé', () => {
    const r = calculerPoste({ ...posteMurs, produit: null, typeProduit: 'acrylique' }, params);
    expect(r.sechage).toBe('Séchage entre couches non renseigné : durée du chantier sous-estimée.');
    expect(r.attenteSechageDixiemesH).toBeNull();
  });
  it('affichage à 2 décimales arrondi une seule fois : 7,02495 L -> 7,02 (pas 7,03)', () => {
    expect(formaterQuantiteCourte(quantiteDepuisFraction({ num: 702_495n, den: 100_000n }))).toBe('7,02');
  });
});
