/**
 * « Avant la première vraie facture » : points vérifiables dans la base, à
 * faire passer au vert (ou à trancher par écrit avec le comptable) avant de
 * facturer un vrai client. La liste complète, avec les questions posées au
 * comptable, est dans docs/CHECKLIST_PREMIERE_FACTURE.md.
 */

export type EtatAvantFacture = {
  regime: 'franchise' | 'assujetti';
  siret: boolean; adresse: boolean; iban: boolean; immatriculation: boolean; numeroTvaIntra: boolean;
  tauxPenalites: boolean; valeursAVerifier: number; mentionFranchiseAVerifier: boolean; seuilsConfirmes: boolean;
  decennale: boolean; rcPro: boolean; mediateur: boolean; textesValides: boolean; tauxTvaAVerifier: number;
  produitsExempleActifs: number; produitsAVerifierActifs: number; reglagesCalculAVerifier: number;
  logo: boolean; doubleAuthentification: boolean;
};

export type PointAvantFacture = { code: string; titre: string; fait: boolean; lien: string; aide: string };

export function pointsAvantFacture(e: EtatAvantFacture): PointAvantFacture[] {
  const p: PointAvantFacture[] = [
    { code: 'identite', titre: 'Identité de l’entreprise complète', fait: e.siret && e.adresse && e.iban, lien: '/parametres/entreprise',
      aide: 'SIRET, adresse et IBAN imprimés sur chaque devis et facture.' },
    { code: 'immatriculation', titre: 'Immatriculation (RNE / RM) renseignée ou mention tranchée', fait: e.immatriculation, lien: '/parametres/entreprise',
      aide: 'Mention à faire confirmer par le comptable.' },
    { code: 'penalites', titre: 'Taux des pénalités de retard saisi', fait: e.tauxPenalites, lien: '/parametres/conditions',
      aide: 'Obligatoire sur les factures : aucune valeur par défaut n’est inventée.' },
    { code: 'conditions', titre: 'Conditions de paiement confirmées', fait: e.valeursAVerifier === 0, lien: '/parametres/conditions',
      aide: `${e.valeursAVerifier} valeur(s) encore « À VÉRIFIER » (délais, indemnité, escompte, validité, acompte).` },
    { code: 'fiscal', titre: 'Statut fiscal confirmé', fait: !e.mentionFranchiseAVerifier && e.seuilsConfirmes, lien: '/parametres/fiscal',
      aide: e.regime === 'franchise' ? 'Mention de franchise et seuils de chiffre d’affaires à confirmer avec le comptable.' : 'Seuils et régime à confirmer avec le comptable.' },
    { code: 'assurances', titre: 'Assurances décennale et RC Pro en cours', fait: e.decennale && e.rcPro, lien: '/parametres/assurances',
      aide: 'Assureur, numéro de contrat et période, imprimés sur les devis et factures.' },
    { code: 'mediateur', titre: 'Médiateur de la consommation renseigné', fait: e.mediateur, lien: '/parametres/mentions',
      aide: 'Obligatoire pour les clients particuliers.' },
    { code: 'textes', titre: 'Textes des documents validés par le comptable', fait: e.textesValides, lien: '/parametres/textes',
      aide: 'Rétractation, médiateur, réception, autoliquidation : date de validation à saisir.' },
    { code: 'catalogue', titre: 'Produits d’exemple remplacés par vos vrais produits', fait: e.produitsExempleActifs === 0 && e.produitsAVerifierActifs === 0, lien: '/catalogue',
      aide: `${e.produitsExempleActifs} produit(s) d’exemple actif(s), ${e.produitsAVerifierActifs} à vérifier sur la fiche technique.` },
    { code: 'calcul', titre: 'Réglages de calcul vérifiés', fait: e.reglagesCalculAVerifier === 0, lien: '/parametres/calcul',
      aide: `${e.reglagesCalculAVerifier} rendement(s) ou temps encore indicatif(s).` },
    { code: 'logo', titre: 'Logo déposé', fait: e.logo, lien: '/parametres', aide: 'Imprimé en haut des documents.' },
    { code: 'double_auth', titre: 'Double authentification activée', fait: e.doubleAuthentification, lien: '/compte',
      aide: 'Protège vos factures et les données de vos clients si votre mot de passe fuit.' },
  ];
  if (e.regime === 'assujetti') {
    p.splice(5, 0,
      { code: 'tva_intra', titre: 'Numéro de TVA intracommunautaire renseigné', fait: e.numeroTvaIntra, lien: '/parametres/entreprise', aide: 'Obligatoire sur les factures d’une entreprise assujettie.' },
      { code: 'taux_tva', titre: 'Taux de TVA confirmés', fait: e.tauxTvaAVerifier === 0, lien: '/parametres/taux-tva', aide: `${e.tauxTvaAVerifier} taux encore « À VÉRIFIER ».` });
  }
  return p;
}
