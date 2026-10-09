/**
 * Cohérence support / préparation / produit : AVERTISSEMENTS (jamais de
 * blocage), fondés sur les règles de l'art courantes. Ils ne remplacent pas la
 * fiche technique du fabricant, rappelée à chaque calcul.
 */

export type Support = 'platre_neuf' | 'ancienne_peinture' | 'beton' | 'enduit' | 'bois_brut'
  | 'bois_vernis' | 'metal' | 'papier_peint' | 'carrelage' | 'autre';

/** Libellés des supports (partagés : écrans serveur et client). */
export const LIBELLES_SUPPORT: Record<Support, string> = {
  platre_neuf: 'Plâtre neuf', ancienne_peinture: 'Ancienne peinture', beton: 'Béton', enduit: 'Enduit', bois_brut: 'Bois brut',
  bois_vernis: 'Bois verni', metal: 'Métal', papier_peint: 'Papier peint', carrelage: 'Carrelage', autre: 'Autre',
};

export type TypeProduit = 'sous_couche' | 'impression' | 'acrylique' | 'glycero' | 'laque' | 'facade'
  | 'lasure' | 'vernis' | 'enduit' | 'anti_humidite' | 'anti_rouille' | 'sous_couche_bloquante' | 'autre';

export type EntreeSysteme = {
  cible: 'murs' | 'plafond' | 'element';
  support: Support;
  zoneHumide: boolean;
  taches: boolean;
  exterieur: boolean;
  /** Codes des étapes de préparation cochées. */
  preparations: string[];
  typeProduit: TypeProduit | null;
  /** Usages déclarés du produit (catalogue), vide si inconnu. */
  usagesProduit: string[];
  couches: number;
  couchesRecommandees: number | null;
};

const IMPRESSIONS: TypeProduit[] = ['impression', 'sous_couche', 'sous_couche_bloquante'];
const FINITIONS_BOIS: TypeProduit[] = ['glycero', 'laque', 'lasure', 'vernis', 'acrylique'];

export const AVERTISSEMENT_RENDEMENT = 'Rendements indicatifs : se référer à la fiche technique du fabricant et au support réel.';

export function avertissementsSysteme(e: EntreeSysteme): string[] {
  const a: string[] = [];
  const prepa = new Set(e.preparations);
  const impression = prepa.has('impression') || (e.typeProduit !== null && IMPRESSIONS.includes(e.typeProduit));

  if (e.support === 'platre_neuf' && !impression) {
    a.push('Plâtre neuf : prévoir une impression (couche d’impression) avant la finition.');
  }
  if (e.support === 'ancienne_peinture') {
    if (!prepa.has('lessivage')) a.push('Ancienne peinture : prévoir un lessivage.');
    // L'aspect (brillant, satiné) n'est pas saisi : rappel tant qu'aucun accrochage n'est prévu.
    if (!prepa.has('poncage') && !impression) {
      a.push('Ancienne peinture brillante ou satinée : prévoir un ponçage (égrenage) ou une sous-couche d’accrochage.');
    }
  }
  if (e.support === 'bois_brut') {
    if (!prepa.has('poncage')) a.push('Bois brut : prévoir un ponçage.');
    if (!impression && e.typeProduit !== 'lasure' && e.typeProduit !== 'vernis') a.push('Bois brut : prévoir une impression adaptée au bois.');
  }
  if (e.support === 'bois_vernis' && !prepa.has('poncage') && !prepa.has('decapage')) {
    a.push('Bois verni : poncer (égrener) ou décaper avant de peindre, sinon risque de mauvaise adhérence.');
  }
  if (e.support === 'metal' && e.typeProduit !== 'anti_rouille' && !e.usagesProduit.includes('metal')) {
    a.push('Métal : prévoir un primaire antirouille et une finition prévue pour le métal.');
  }
  if (e.support === 'papier_peint' && !prepa.has('depose_papier_peint')) {
    a.push('Papier peint : la dépose est en général préférable ; peindre dessus risque des cloques et des décollements.');
  }
  if (e.support === 'carrelage' && !impression) {
    a.push('Carrelage : prévoir un dégraissage et une sous-couche d’accrochage spécifique.');
  }
  if (e.taches && !prepa.has('sous_couche_bloquante') && e.typeProduit !== 'sous_couche_bloquante') {
    a.push('Taches (eau, fumée, nicotine) : prévoir une sous-couche bloquante, sinon elles ressortent.');
  }
  if (e.exterieur) {
    const exterieurOk = e.usagesProduit.includes('exterieur')
      || (e.typeProduit !== null && ['facade', 'lasure', 'vernis', 'glycero', 'laque', 'anti_rouille'].includes(e.typeProduit));
    if (!exterieurOk) a.push('Extérieur : le produit doit être prévu pour l’extérieur (peinture façade, ou usage « extérieur » au catalogue).');
    a.push('Extérieur : respecter les conditions d’application de la fiche technique (température, pluie, humidité, plein soleil).');
  } else if (e.typeProduit === 'facade') {
    a.push('Peinture façade utilisée en intérieur : vérifiez que c’est voulu.');
  }
  if (e.zoneHumide && e.typeProduit !== 'anti_humidite') {
    a.push('Pièce humide : vérifiez que le produit convient aux pièces humides (fiche technique).');
  }
  if (e.typeProduit !== null && e.usagesProduit.length) {
    const usage = e.cible === 'murs' ? 'mur' : e.cible === 'plafond' ? 'plafond' : null;
    if (usage && !e.usagesProduit.includes(usage)) a.push(`Le produit n’est pas déclaré pour un usage « ${usage} » dans le catalogue.`);
  }
  if (e.cible === 'element' && !e.exterieur && e.typeProduit !== null && !FINITIONS_BOIS.includes(e.typeProduit)
      && !IMPRESSIONS.includes(e.typeProduit) && e.typeProduit !== 'anti_rouille' && e.typeProduit !== 'facade') {
    a.push('Boiseries et menuiseries : vérifiez que le produit convient (laque, glycéro, lasure, vernis ou acrylique boiserie).');
  }
  if (e.couchesRecommandees !== null && e.couches < e.couchesRecommandees) {
    a.push(`Le fabricant recommande ${e.couchesRecommandees} couches : ${e.couches} prévue${e.couches > 1 ? 's' : ''}.`);
  }
  if (e.couches === 1 && (e.typeProduit === 'acrylique' || e.typeProduit === 'glycero' || e.typeProduit === 'laque')) {
    a.push('Une seule couche de finition : couvrance souvent insuffisante, deux couches sont l’usage.');
  }
  return a;
}
