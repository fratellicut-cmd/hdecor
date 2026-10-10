import { describe, expect, it } from 'vitest';
import { pointsAvantFacture, type EtatAvantFacture } from '../premiere-facture';

const pret: EtatAvantFacture = {
  regime: 'franchise', siret: true, adresse: true, iban: true, immatriculation: true, numeroTvaIntra: false, tauxPenalites: true,
  valeursAVerifier: 0, mentionFranchiseAVerifier: false, seuilsConfirmes: true, decennale: true, rcPro: true, mediateur: true,
  textesValides: true, tauxTvaAVerifier: 3, produitsExempleActifs: 0, produitsAVerifierActifs: 0, reglagesCalculAVerifier: 0,
  logo: true, doubleAuthentification: true,
};
const aFaire = (e: EtatAvantFacture) => pointsAvantFacture(e).filter((p) => !p.fait).map((p) => p.code);

describe('avant la première vraie facture', () => {
  it('franchise prête : tout est fait ; les taux de TVA ne comptent pas', () => expect(aFaire(pret)).toEqual([]));
  it('chaque manque est signalé, avec le lien vers son réglage', () => {
    expect(aFaire({ ...pret, tauxPenalites: false, valeursAVerifier: 2, textesValides: false, produitsExempleActifs: 6, logo: false }))
      .toEqual(['penalites', 'conditions', 'textes', 'catalogue', 'logo']);
    expect(pointsAvantFacture({ ...pret, produitsExempleActifs: 6 }).find((p) => p.code === 'catalogue')!.aide).toContain('6 produit(s) d’exemple');
  });
  it('assujetti : numéro de TVA et taux confirmés exigés en plus', () => {
    expect(aFaire({ ...pret, regime: 'assujetti' })).toEqual(['tva_intra', 'taux_tva']);
    expect(aFaire({ ...pret, regime: 'assujetti', numeroTvaIntra: true, tauxTvaAVerifier: 0 })).toEqual([]);
  });
  it('statut fiscal : mention et seuils', () => {
    expect(aFaire({ ...pret, seuilsConfirmes: false })).toEqual(['fiscal']);
    expect(aFaire({ ...pret, mentionFranchiseAVerifier: true })).toEqual(['fiscal']);
  });
});
