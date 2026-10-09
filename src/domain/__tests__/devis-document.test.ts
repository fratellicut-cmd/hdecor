import { describe, expect, it } from 'vitest';
import {
  ajouterJours, assuranceEnCours, avecRetractation, controlerMentions, copieChantier, copieClient, copieEmetteur, formaterJours, formaterQuantiteE4,
  identiteEmetteur, lignesAdresse, nomAvecForme, type DevisAControler, type ParametresEmetteur,
} from '../devis-document';

const params: ParametresEmetteur = {
  raison_sociale: "H'DECOR", forme_juridique: 'EI', nom_dirigeant: null, siret: '12345678900011', immatriculation: null,
  adresse_ligne1: '1 rue A', adresse_ligne2: '  ', code_postal: '75011', ville: 'Paris', telephone: null, email: null, numero_tva_intra: 'FR00',
  regime_tva: 'franchise', mention_franchise: 'TVA non applicable, art. 293 B du CGI', mediateur_nom: 'Médiateur', mediateur_coordonnees: null,
  mediateur_site: null, mentions_pied: '',
};
const decennale = { type: 'decennale' as const, assureur: 'A', numero_contrat: null, debut: '2026-01-01', fin: '2026-12-31', zone_couverte: null };
const rc = { ...decennale, type: 'rc_pro' as const, fin: null };
const client = copieClient({
  type: 'particulier', civilite: null, nom: 'Martin', prenom: 'Alice', raison_sociale: null, siret: null, tva_intra: null, email: null, telephone: null,
  fact_ligne1: '3 av. B', fact_ligne2: null, fact_code_postal: '93260', fact_ville: 'Les Lilas', fact_pays: null,
});
const chantier = copieChantier({ nom: 'Lilas', adresse_ligne1: '3 av. B', adresse_ligne2: null, code_postal: '93260', ville: 'Les Lilas' });
const devis: DevisAControler = { hors_etablissement: true, date_debut_travaux: '2026-11-02', delai_debut_texte: null, duree_estimee_jours: 3, conditions_paiement: 'Virement', regime_tva: 'franchise' };
const cles = (m: { cle: string; bloquant: boolean }[], bloquant = true) => m.filter((x) => x.bloquant === bloquant).map((x) => x.cle);

describe('copies figées', () => {
  it('champs vides normalisés à null, franchise gardée, TVA intracom gardée pour info', () => {
    const e = copieEmetteur(params, [decennale, rc], '2026-10-09');
    expect(e.adresse.ligne2).toBeNull();
    expect(e.mentions_pied).toBeNull();
    expect(e.mention_franchise).toBe('TVA non applicable, art. 293 B du CGI');
    expect(e.assurances).toHaveLength(2);
  });
  it('assujetti : pas de mention de franchise', () => {
    expect(copieEmetteur({ ...params, regime_tva: 'assujetti' }, [], '2026-10-09').mention_franchise).toBeNull();
  });
  it('assurances hors période exclues (bornes incluses)', () => {
    expect(assuranceEnCours(decennale, '2026-12-31')).toBe(true);
    expect(assuranceEnCours(decennale, '2027-01-01')).toBe(false);
    expect(assuranceEnCours(decennale, '2025-12-31')).toBe(false);
    expect(copieEmetteur(params, [decennale], '2027-01-01').assurances).toEqual([]);
  });
  it('client : nom affiché', () => expect(client.nom_affiche).toBe('Alice Martin'));
  it('chantier absent', () => expect(copieChantier(null)).toBeNull());
});

describe('affichage', () => {
  it('adresse : pays affiché seulement hors France', () => {
    expect(lignesAdresse({ ligne1: 'a', ligne2: null, code_postal: '75011', ville: 'Paris', pays: 'France' })).toEqual(['a', '75011 Paris']);
    expect(lignesAdresse({ ligne1: 'a', ligne2: null, code_postal: '1000', ville: 'Bruxelles', pays: 'Belgique' })).toEqual(['a', '1000 Bruxelles', 'Belgique']);
  });
  it('forme juridique ajoutée une seule fois', () => {
    const e = copieEmetteur(params, [], '2026-10-09');
    expect(nomAvecForme(e)).toBe("H'DECOR EI");
    expect(nomAvecForme({ ...e, raison_sociale: "H'DECOR EI" })).toBe("H'DECOR EI");
    expect(identiteEmetteur(e)).toContain('SIRET 12345678900011');
    expect(identiteEmetteur(e).join()).not.toContain('FR00');
  });
  it('quantités sans flottant', () => {
    expect(formaterQuantiteE4(319_300n)).toBe('31,93');
    expect(formaterQuantiteE4(25_000n)).toBe('2,5');
    expect(formaterQuantiteE4(10_000n)).toBe('1');
    expect(formaterQuantiteE4(12_345_678_9n)).toBe('12 345,6789');
  });
  it('jours', () => {
    expect(formaterJours(1)).toBe('1 jour');
    expect(formaterJours(0.5)).toBe('0,5 jour');
    expect(formaterJours(3)).toBe('3 jours');
  });
  it('validité = date + jours (comme la base), passage d’année et bissextile', () => {
    expect(ajouterJours('2026-10-09', 30)).toBe('2026-11-08');
    expect(ajouterJours('2026-12-15', 30)).toBe('2027-01-14');
    expect(ajouterJours('2028-02-15', 30)).toBe('2028-03-16');
  });
});

describe('mentions obligatoires avant émission', () => {
  const e = copieEmetteur(params, [decennale, rc], '2026-10-09');
  it('devis complet : aucun manque bloquant', () => {
    expect(cles(controlerMentions(e, client, chantier, devis))).toEqual([]);
    // Immatriculation vide : signalée À VÉRIFIER, non bloquante.
    expect(cles(controlerMentions(e, client, chantier, devis), false)).toEqual(['immatriculation']);
  });
  it('entreprise incomplète : bloquant, jamais comblé', () => {
    const vide = copieEmetteur({ ...params, raison_sociale: null, siret: ' ', ville: null, mention_franchise: ' ' }, [], '2026-10-09');
    expect(cles(controlerMentions(vide, client, chantier, devis))).toEqual(['raison_sociale', 'siret', 'adresse_entreprise', 'mention_franchise', 'decennale']);
  });
  it('médiateur exigé pour un particulier seulement', () => {
    const sans = { ...e, mediateur: { nom: null, coordonnees: null, site: null } };
    expect(cles(controlerMentions(sans, client, chantier, devis))).toEqual(['mediateur']);
    expect(cles(controlerMentions(sans, { ...client, type: 'professionnel' }, chantier, devis))).toEqual([]);
  });
  it('client, chantier et conditions', () => {
    const c2 = { ...client, adresse: { ...client.adresse, ville: null } };
    expect(cles(controlerMentions(e, c2, null, { ...devis, date_debut_travaux: null, duree_estimee_jours: null, conditions_paiement: ' ' })))
      .toEqual(['client_adresse', 'chantier', 'debut', 'duree', 'conditions_paiement']);
  });
  it('délai en texte accepté à la place d’une date', () => {
    expect(cles(controlerMentions(e, client, chantier, { ...devis, date_debut_travaux: null, delai_debut_texte: 'Sous 3 semaines' }))).toEqual([]);
  });
  it('régime du devis différent des paramètres : bloquant', () => {
    expect(cles(controlerMentions(e, client, chantier, { ...devis, regime_tva: 'assujetti' }))).toEqual(['regime']);
  });
  it('assujetti sans numéro de TVA : signalé', () => {
    const a = copieEmetteur({ ...params, regime_tva: 'assujetti', numero_tva_intra: null }, [decennale, rc], '2026-10-09');
    expect(cles(controlerMentions(a, client, chantier, { ...devis, regime_tva: 'assujetti' }), false)).toContain('numero_tva_intra');
  });
  it('rétractation : particulier hors établissement seulement ; professionnel signalé À VÉRIFIER', () => {
    expect(avecRetractation(true, client)).toBe(true);
    expect(avecRetractation(false, client)).toBe(false);
    const pro = { ...client, type: 'professionnel' as const };
    expect(avecRetractation(true, pro)).toBe(false);
    expect(cles(controlerMentions(e, pro, chantier, devis), false)).toContain('retractation_pro');
  });
});
