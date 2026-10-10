/**
 * Factures (§5.7) : lignes, totaux, déductions d'acomptes, avoirs, mentions.
 * Tout en centimes ENTIERS (bigint). La base recalcule et contrôle les mêmes
 * montants à l'émission (emettre_facture) : ce module doit donner EXACTEMENT
 * les mêmes valeurs (mêmes arrondis, mêmes règles R4, R5, R6, R9).
 */

import { arrondi } from './chiffrage';
import { ventiler, ventilationEcheance, type LigneDevis, type Regime, type Ventilation } from './devis';
import { formaterEuros, formaterTaux } from './formats';
import { ajouterJours, type CopieChantier, type CopieClient, type CopieEmetteur, type Manque } from './devis-document';

export type TypeFacture = 'acompte' | 'situation' | 'finale' | 'libre' | 'avoir';

export const LIBELLES_TYPE_FACTURE: Record<TypeFacture, string> = {
  acompte: 'Facture d’acompte', situation: 'Facture de situation', finale: 'Facture', libre: 'Facture', avoir: 'Avoir',
};

export const LIBELLES_STATUT_FACTURE: Record<string, string> = {
  brouillon: 'Brouillon', emise: 'Émise', envoyee: 'Envoyée', partiellement_payee: 'Partiellement payée', payee: 'Payée',
  en_retard: 'En retard', annulee: 'Annulée par avoir',
};

export type LigneFacture = LigneDevis & {
  /** Avancement (situation), en points de base ; null = 100 %. */
  avancementBp: number | null;
  /** Ligne reprise du devis accepté (traçabilité, contrôlée par la base). */
  devisLigneId?: string | null;
};

export class ErreurFacture extends Error {}

/**
 * R4 (facture) : arrondi demi-supérieur, EN UNE FOIS, de
 * quantité × PU × (1 − remise) × avancement. Identique à la contrainte en base.
 */
export function totalLigneFacture(quantiteE4: bigint, prixUnitaireCents: bigint, remiseBp: number, avancementBp: number | null): bigint {
  if (quantiteE4 < 0n || prixUnitaireCents < 0n) throw new ErreurFacture('Quantité et prix : positifs.');
  if (!Number.isInteger(remiseBp) || remiseBp < 0 || remiseBp > 10_000) throw new ErreurFacture('Remise de ligne : de 0 à 100 %.');
  const av = avancementBp ?? 10_000;
  if (!Number.isInteger(av) || av < 0 || av > 10_000) throw new ErreurFacture('Avancement : de 0 à 100 %.');
  // (q/1e4) × pu × (1e4 − r)/1e4 × av/1e4 = q × pu × (1e4 − r) × av / 1e12
  return arrondi(quantiteE4 * prixUnitaireCents * BigInt(10_000 - remiseBp) * BigInt(av), 1_000_000_000_000n);
}

export type TotauxFacture = {
  ventilation: Ventilation;
  totalHtCents: bigint;
  totalTvaCents: bigint;
  totalTtcCents: bigint;
  sommeLignesCents: bigint;
  remiseGlobaleCents: bigint;
};

/**
 * Totaux d'une facture (lignes chiffrées, remise globale R5, TVA par taux R6).
 * Autoliquidation : les lignes gardent leur taux, la TVA facturée est nulle
 * (même règle que la base). Franchise : toutes les lignes à 0 %.
 */
export function totauxFacture(lignes: LigneFacture[], remiseGlobaleBp: number, regime: Regime, autoliquidation = false): TotauxFacture {
  if (autoliquidation && regime !== 'assujetti') throw new ErreurFacture('Autoliquidation : seulement pour une entreprise soumise à la TVA.');
  const chiffrees = lignes.filter((l) => l.type === 'ligne');
  if (regime === 'franchise' && chiffrees.some((l) => (l.tauxTvaBp ?? 0) !== 0)) {
    throw new ErreurFacture('Franchise en base de TVA : toutes les lignes sont à 0 %.');
  }
  const parTaux = chiffrees.map((l) => {
    if (l.quantiteE4 === null || l.prixUnitaireCents === null || l.tauxTvaBp === null) {
      throw new ErreurFacture(`Ligne « ${l.designation} » incomplète (quantité, prix ou TVA).`);
    }
    return { taux: l.tauxTvaBp, total: totalLigneFacture(l.quantiteE4, l.prixUnitaireCents, l.remiseBp, l.avancementBp) };
  });
  const ventilation = ventiler(parTaux, remiseGlobaleBp, autoliquidation ? 'franchise' : regime);
  const totalHt = ventilation.reduce((a, v) => a + v.base_ht_cents, 0n);
  const totalTva = ventilation.reduce((a, v) => a + v.tva_cents, 0n);
  const somme = parTaux.reduce((a, l) => a + l.total, 0n);
  return { ventilation, totalHtCents: totalHt, totalTvaCents: totalTva, totalTtcCents: totalHt + totalTva, sommeLignesCents: somme, remiseGlobaleCents: somme - totalHt };
}

// --------------------------------------------------------------------------
// Acomptes déduits (finale, situation)
// --------------------------------------------------------------------------

/** Forme stockée en base (deductions_bien_formees) : montants de la facture d'acompte, au centime. */
export type Deduction = { facture_id: string; numero: string; ht: bigint; tva: bigint; ttc: bigint };

/** Net à payer = TTC − acomptes déduits (jamais négatif). */
export function netAPayer(totalTtcCents: bigint, deductions: Deduction[]): bigint {
  const deduit = deductions.reduce((a, d) => a + d.ttc, 0n);
  if (deduit > totalTtcCents) throw new ErreurFacture('Les acomptes déduits dépassent le total de la facture.');
  return totalTtcCents - deduit;
}

export type FactureDuDevis = {
  id: string; numero: string | null; type: TypeFacture; statut: 'brouillon' | 'emise' | 'annulee';
  totalHtCents: bigint; totalTvaCents: bigint; totalTtcCents: bigint;
  /** Identifiants des acomptes que CETTE facture déduit (si elle est émise). */
  deduit: string[];
};

/**
 * Acomptes à déduire d'une nouvelle finale ou situation : les factures
 * d'acompte ou de situation ÉMISES (non annulées) du devis, qu'aucune autre
 * facture émise ne déduit déjà (une facture annulée libère ses acomptes).
 * Même règle que la base.
 */
export function deductionsDisponibles(factures: FactureDuDevis[], sauf?: string): Deduction[] {
  const dejaDeduits = new Set(factures.filter((f) => f.statut === 'emise' && f.id !== sauf).flatMap((f) => f.deduit));
  return factures
    .filter((f) => (f.type === 'acompte' || f.type === 'situation') && f.statut === 'emise' && f.id !== sauf && !dejaDeduits.has(f.id))
    .map((f) => ({ facture_id: f.id, numero: f.numero!, ht: f.totalHtCents, tva: f.totalTvaCents, ttc: f.totalTtcCents }));
}

// --------------------------------------------------------------------------
// Lignes depuis le devis accepté
// --------------------------------------------------------------------------

/** Cumul des acomptes ÉMIS d'un devis (hors la facture en cours d'émission), en points de base. */
export const cumulAcomptesEmis = (factures: { id: string; type: TypeFacture; statut: string; acomptePctBp: number | null }[], sauf: string) =>
  factures.filter((f) => f.type === 'acompte' && f.statut === 'emise' && f.id !== sauf).reduce((a, f) => a + (f.acomptePctBp ?? 0), 0);

/**
 * Acompte à émettre : son montant a été calculé sur un cumul d'acomptes
 * précédents (base en cumulé). Ce cumul doit être celui des acomptes émis ;
 * sinon le montant s'écarterait de l'échéancier : message, sinon null.
 */
export function controlerCumulAcompte(cumulCalculBp: number | null, cumulEmisBp: number): string | null {
  if (cumulCalculBp === null || cumulCalculBp === cumulEmisBp) return null;
  return cumulEmisBp < cumulCalculBp
    ? `Ce brouillon d’acompte a été calculé après d’autres acomptes (${formaterTaux(cumulCalculBp)}) dont seuls ${formaterTaux(cumulEmisBp)} sont émis. `
      + 'Émettez d’abord l’acompte précédent, ou, s’il a été supprimé, supprimez ce brouillon et recréez-le : son montant sera exact.'
    : `Des acomptes ont été émis depuis la création de ce brouillon (${formaterTaux(cumulEmisBp)} au lieu de ${formaterTaux(cumulCalculBp)}) : `
      + 'supprimez ce brouillon et recréez-le pour un montant exact.';
}

/**
 * Facture d'acompte d'une échéance (ou de l'acompte du devis) : une ligne par
 * taux, base de l'échéance (en cumulé, voir ventilationEcheance), quantité 1,
 * « forfait ». La TVA est recalculée sur chaque ligne (R6) : elle vaut celle
 * imprimée sur le devis pour cette échéance.
 */
export function lignesAcompte(ventilationAcceptee: Ventilation, cumulAvantBp: number, pourcentageBp: number, regime: Regime,
  libelle: string): LigneFacture[] {
  if (pourcentageBp <= 0) throw new ErreurFacture('Pourcentage d’acompte : supérieur à 0.');
  if (cumulAvantBp + pourcentageBp >= 10_000) {
    throw new ErreurFacture('Cette échéance solde le devis : établissez la facture finale (elle déduit les acomptes).');
  }
  const v = ventilationEcheance(ventilationAcceptee, cumulAvantBp, pourcentageBp, regime);
  const plusieurs = v.length > 1;
  return v.filter((x) => x.base_ht_cents > 0n).map((x) => ({
    type: 'ligne', designation: plusieurs ? `${libelle} (TVA ${x.taux_bp / 100} %)`.replace('.', ',') : libelle, description: null,
    quantiteE4: 10_000n, unite: 'forfait', prixUnitaireCents: x.base_ht_cents, remiseBp: 0, tauxTvaBp: x.taux_bp, optionnelle: false,
    avancementBp: null, devisLigneId: null,
  }));
}

/**
 * Lignes d'une facture finale ou de situation reprises du devis accepté :
 * lignes fermes + options retenues à la signature (les autres options sont
 * écartées), sections, textes et sous-totaux conservés. Situation : avancement
 * CUMULÉ par ligne (même avancement pour toutes par défaut).
 */
export function lignesDepuisDevis(lignes: LigneDevis[], optionsRetenues: Set<string>, avancementBp: number | null,
  avancementParLigne: Map<string, number> = new Map()): LigneFacture[] {
  return lignes
    .filter((l) => !(l.type === 'ligne' && l.optionnelle && !(l.id && optionsRetenues.has(l.id))))
    .map((l) => ({
      ...l, optionnelle: false, devisLigneId: l.id ?? null, id: undefined,
      avancementBp: l.type === 'ligne' ? (l.id && avancementParLigne.has(l.id) ? avancementParLigne.get(l.id)! : avancementBp) : null,
    }));
}

// --------------------------------------------------------------------------
// Avoirs
// --------------------------------------------------------------------------

/**
 * Avoir TOTAL : copie des lignes et de la remise de la facture d'origine (et,
 * si elle déduisait des acomptes, de ses déductions : même net à payer, même
 * TVA nette par taux, au centime ; contrôlé par la base).
 */
export function lignesAvoirTotal(lignesOrigine: LigneFacture[]): LigneFacture[] {
  return lignesOrigine.map((l) => ({ ...l, id: undefined, devisLigneId: null }));
}

/**
 * Avoir d'un montant TTC donné ; si ce montant n'est pas atteignable au
 * centime (arrondi de la TVA), l'erreur propose le montant atteignable le
 * plus proche en dessous, VÉRIFIÉ (et le complément à faire ensuite).
 */
export function lignesAvoirMontant(netParTaux: Ventilation, montantTtcCents: bigint, regime: Regime, autoliquidation: boolean,
  libelle: string): LigneFacture[] {
  try {
    return lignesAvoirMontantExact(netParTaux, montantTtcCents, regime, autoliquidation, libelle);
  } catch (e) {
    if (!(e instanceof ErreurFacture) || !e.message.includes('pas atteignable')) throw e;
    for (let m = montantTtcCents - 1n; m > 0n && m >= montantTtcCents - 200n; m--) {
      try {
        lignesAvoirMontantExact(netParTaux, m, regime, autoliquidation, libelle);
        throw new ErreurFacture(`Avoir : ${formaterEuros(montantTtcCents)} n’est pas atteignable au centime près (arrondi de la TVA). Montant atteignable le plus proche : ${formaterEuros(m)} (le reste, ${formaterEuros(montantTtcCents - m)}, pourra être crédité par un autre avoir, lui-même ajusté si besoin).`);
      } catch (x) {
        // Montant voisin lui aussi inatteignable : on continue ; toute autre erreur remonte.
        if (!(x instanceof ErreurFacture) || x.message.includes('le plus proche')) throw x;
      }
    }
    throw e;
  }
}

/**
 * Avoir d'un montant TTC donné, EXACT : une ligne par taux, au prorata du net de chaque taux. Les
 * bases sont cherchées pour que le TTC obtenu (TVA R6 recalculée) soit
 * EXACTEMENT le montant demandé ; si un taux rend ce montant impossible au
 * centime près, une erreur l'explique (jamais d'avoir approché en silence).
 */
function lignesAvoirMontantExact(netParTaux: Ventilation, montantTtcCents: bigint, regime: Regime, autoliquidation: boolean,
  libelle: string): LigneFacture[] {
  const netTtc = netParTaux.reduce((a, v) => a + v.base_ht_cents + v.tva_cents, 0n);
  if (montantTtcCents <= 0n || montantTtcCents > netTtc) throw new ErreurFacture('Montant de l’avoir : entre 0,01 € et le net à payer.');
  const sansTva = regime === 'franchise' || autoliquidation;
  const ttcDe = (base: bigint, taux: number) => base + (sansTva ? 0n : arrondi(base * BigInt(taux), 10_000n));
  // Répartition proportionnelle du TTC demandé, le dernier taux prenant le reste.
  const parts = netParTaux.filter((v) => v.base_ht_cents + v.tva_cents > 0n);
  let reste = montantTtcCents;
  const lignes: LigneFacture[] = [];
  parts.forEach((v, i) => {
    const netT = v.base_ht_cents + v.tva_cents;
    const cible = i === parts.length - 1 ? reste : (montantTtcCents * netT) / netTtc;
    reste -= cible;
    // Base telle que base + TVA(base) = cible (recherche autour de cible / (1 + taux)).
    const t = sansTva ? 0 : v.taux_bp;
    let base = (cible * 10_000n) / BigInt(10_000 + t);
    while (ttcDe(base, t) < cible) base += 1n;
    while (base > 0n && ttcDe(base, t) > cible) base -= 1n;
    if (ttcDe(base, t) !== cible) {
      throw new ErreurFacture(`Avoir : ${formaterEuros(cible)} TTC n’est pas atteignable au centime près au taux de ${formaterTaux(t)} (arrondi de la TVA).`);
    }
    if (base > v.base_ht_cents) throw new ErreurFacture('Avoir : supérieur au net de la facture pour ce taux.');
    lignes.push({
      type: 'ligne', designation: parts.length > 1 ? `${libelle} (TVA ${v.taux_bp / 100} %)`.replace('.', ',') : libelle, description: null,
      quantiteE4: 10_000n, unite: 'forfait', prixUnitaireCents: base, remiseBp: 0, tauxTvaBp: v.taux_bp, optionnelle: false,
      avancementBp: null, devisLigneId: null,
    });
  });
  return lignes;
}

/**
 * Reste corrigeable par taux d'une facture : sa ventilation, moins celle des
 * acomptes qu'elle déduit, moins celle des avoirs déjà émis sur elle. Tous les
 * taux sont couverts (y compris un taux présent seulement dans un acompte
 * déduit). Un taux négatif (la facture déduit plus qu'elle ne facture à ce
 * taux, par exemple un avancement en recul) rend un avoir partiel impossible
 * à ventiler exactement : erreur explicite.
 */
export function netParTaux(ventilation: Ventilation, ventilationsDeduites: Ventilation[], avoirsEmis: Ventilation[] = []): Ventilation {
  const taux = [...new Set([...ventilation, ...ventilationsDeduites.flat(), ...avoirsEmis.flat()].map((v) => v.taux_bp))].sort((a, b) => a - b);
  const somme = (vs: Ventilation, t: number, cle: 'base_ht_cents' | 'tva_cents') => vs.filter((x) => x.taux_bp === t).reduce((a, x) => a + x[cle], 0n);
  const net = taux.map((t) => ({
    taux_bp: t,
    base_ht_cents: somme(ventilation, t, 'base_ht_cents') - somme(ventilationsDeduites.flat(), t, 'base_ht_cents') - somme(avoirsEmis.flat(), t, 'base_ht_cents'),
    tva_cents: somme(ventilation, t, 'tva_cents') - somme(ventilationsDeduites.flat(), t, 'tva_cents') - somme(avoirsEmis.flat(), t, 'tva_cents'),
  }));
  const negatif = net.find((v) => v.base_ht_cents < 0n || v.tva_cents < 0n);
  if (negatif) {
    throw new ErreurFacture(`Avoir d’un montant impossible : au taux de ${formaterTaux(negatif.taux_bp)}, cette facture déduit plus qu’elle ne facture. Établissez un avoir de tout le reste dû.`);
  }
  return net.filter((v) => v.base_ht_cents > 0n || v.tva_cents > 0n);
}

// --------------------------------------------------------------------------
// Copies figées et mentions obligatoires (§5.7)
// --------------------------------------------------------------------------

export type ConditionsPaiement = {
  iban: string | null;
  bic: string | null;
  taux_penalites_bp: number | null;
  indemnite_recouvrement_cents: number;
  escompte_texte: string;
};

export type CopieEmetteurFacture = CopieEmetteur & { paiement: ConditionsPaiement };

/** IBAN : format et clé de contrôle (mod 97, norme ISO 13616). */
export function ibanValide(iban: string | null | undefined): boolean {
  if (!iban) return false;
  const t = iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(t)) return false;
  const reorganise = t.slice(4) + t.slice(0, 4);
  const chiffres = reorganise.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let reste = 0;
  for (const ch of chiffres) reste = (reste * 10 + Number(ch)) % 97;
  return reste === 1;
}

/** « FR7630006000011234567890189 » -> « FR76 3000 6000 0112 3456 7890 189 ». */
export const formaterIban = (iban: string) => iban.replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

export type FactureAControler = {
  type: TypeFacture;
  date_prestation_debut: string | null;
  date_prestation_fin: string | null;
  autoliquidation: boolean;
  regime_tva: Regime;
  date_emission: string;
  date_echeance: string;
  /** Dernier jour du délai de rétractation (devis signé hors établissement par un particulier), sinon null. */
  fin_retractation: string | null;
};

/** Délai de rétractation d'un contrat hors établissement (jours après la signature), comme sur le devis. */
export const DELAI_RETRACTATION_JOURS = 14;

/** Dernier jour du délai de rétractation, ou null si le devis n'y est pas soumis (signé à l'établissement, client professionnel). */
export function finRetractation(horsEtablissement: boolean, typeClient: string, dateSignature: string | null): string | null {
  if (!horsEtablissement || typeClient !== 'particulier' || !dateSignature) return null;
  return ajouterJours(dateSignature, DELAI_RETRACTATION_JOURS);
}

/** Libellé de la date de prestation selon le type (acompte : début prévu ; situation : période ; sinon : prestation). */
export function libelleDatesPrestation(type: TypeFacture, debut: string | null, fin: string | null, formater: (d: string) => string): string | null {
  if (type === 'avoir') return null;
  if (type === 'acompte') return debut ? `Début des travaux prévu le ${formater(debut)}` : null;
  if (!debut && !fin) return null;
  const periode = debut && fin && debut !== fin ? `du ${formater(debut)} au ${formater(fin)}` : `le ${formater((fin ?? debut)!)}`;
  return type === 'situation' ? `Travaux réalisés : ${debut && fin && debut !== fin ? `période ${periode}` : `jusqu’au ${formater((fin ?? debut)!)}`}`
    : `Date de la prestation : ${periode}`;
}

/**
 * Mentions de la facture : un manque BLOQUANT empêche l'émission (rien n'est
 * inventé pour combler) ; les points À VÉRIFIER par le comptable sont signalés.
 */
export function controlerMentionsFacture(e: CopieEmetteurFacture, c: CopieClient, ch: CopieChantier, f: FactureAControler): Manque[] {
  const m: Manque[] = [];
  const bloque = (cle: string, message: string, ou: Manque['ou']) => m.push({ cle, message, ou, bloquant: true });
  const signale = (cle: string, message: string, ou: Manque['ou']) => m.push({ cle, message, ou, bloquant: false });
  const vide = (v: string | null | undefined) => !v || !v.trim();

  if (vide(e.raison_sociale)) bloque('raison_sociale', 'Nom de l’entreprise manquant.', 'parametres');
  if (vide(e.siret)) bloque('siret', 'SIRET manquant.', 'parametres');
  if (vide(e.adresse.ligne1) || vide(e.adresse.code_postal) || vide(e.adresse.ville)) bloque('adresse_entreprise', 'Adresse de l’entreprise incomplète.', 'parametres');
  if (e.regime_tva === 'franchise' && vide(e.mention_franchise)) bloque('mention_franchise', 'Mention de franchise de TVA vide.', 'parametres');
  if (e.regime_tva === 'assujetti' && vide(e.numero_tva_intra)) bloque('numero_tva_intra', 'Numéro de TVA intracommunautaire manquant (entreprise soumise à la TVA).', 'parametres');
  if (!e.assurances.some((a) => a.type === 'decennale')) bloque('decennale', 'Aucune assurance décennale en cours à la date de la facture.', 'parametres');
  if (f.type !== 'avoir') {
    if (!ibanValide(e.paiement.iban)) bloque('iban', 'IBAN manquant ou invalide (Paramètres > Entreprise).', 'parametres');
    if (e.paiement.taux_penalites_bp === null) bloque('penalites', 'Taux des pénalités de retard non renseigné (Paramètres > Conditions).', 'parametres');
    if (vide(e.paiement.escompte_texte)) bloque('escompte', 'Conditions d’escompte non renseignées.', 'parametres');
    if (c.type === 'particulier') {
      signale('indemnite_particulier', 'Client particulier : l’indemnité forfaitaire de recouvrement n’est pas imprimée (elle viserait les professionnels : À VÉRIFIER avec le comptable).', 'parametres');
    }
  }
  if (vide(c.nom_affiche)) bloque('client_nom', 'Nom du client manquant.', 'client');
  if (vide(c.adresse.ligne1) || vide(c.adresse.code_postal) || vide(c.adresse.ville)) bloque('client_adresse', 'Adresse du client incomplète.', 'client');
  // Acompte : versé avant les travaux, pas de date de prestation exigée ; les autres factures : date d'achèvement (ou d'arrêt de la situation).
  if (f.type !== 'avoir' && f.type !== 'acompte' && f.date_prestation_fin === null) {
    bloque('date_prestation', f.type === 'situation' ? 'Date de fin de la période facturée manquante.' : 'Date de fin des travaux (ou de la prestation) manquante.', 'devis');
  }
  if (f.date_prestation_debut && f.date_prestation_fin && f.date_prestation_fin < f.date_prestation_debut) {
    bloque('dates_prestation', 'La fin de la prestation précède son début.', 'devis');
  }
  // Un avoir garde le régime de la facture qu'il corrige (changement de régime depuis : À VÉRIFIER pour la mention).
  if (f.type !== 'avoir' && f.regime_tva !== e.regime_tva) bloque('regime', 'Le régime de TVA de la facture ne correspond plus aux Paramètres : recréez la facture.', 'devis');
  if (f.autoliquidation) {
    if (c.type !== 'professionnel') bloque('autoliquidation_client', 'Autoliquidation : seulement pour un client professionnel (donneur d’ordre).', 'devis');
    if (!c.tva_intra) signale('autoliquidation_tva', 'Autoliquidation : numéro de TVA du client non renseigné (À VÉRIFIER avec le comptable).', 'client');
  }
  if (ch && (vide(ch.adresse.ligne1) || vide(ch.adresse.ville))) signale('chantier_adresse', 'Adresse du chantier incomplète.', 'chantier');
  if (f.type === 'libre' && c.type === 'particulier') {
    signale('libre_retractation', 'Facture sans devis : si le contrat a été conclu chez le client, le délai de rétractation n’est pas contrôlé ici (aucun paiement ne peut être exigé pendant ce délai : À VÉRIFIER).', 'devis');
  }
  if (f.fin_retractation && f.type !== 'avoir') {
    if (f.date_echeance <= f.fin_retractation) {
      bloque('echeance_retractation', `Devis signé chez le client : délai de rétractation jusqu’au ${formaterDateIso(f.fin_retractation)}. L’échéance doit tomber après : allongez le délai de paiement.`, 'devis');
    } else if (f.date_emission <= f.fin_retractation) {
      signale('retractation', `Devis signé chez le client : délai de rétractation jusqu’au ${formaterDateIso(f.fin_retractation)}. La facture ne demande aucun paiement avant le ${formaterDateIso(ajouterJours(f.fin_retractation, 1))} (ni QR code ni paiement en ligne d’ici là). Durée de l’interdiction d’encaisser : À VÉRIFIER avec le comptable.`, 'devis');
    }
  }
  return m;
}

/** Textes types À VÉRIFIER par le comptable imprimés sur la facture (confirmés à l'émission). */
export function textesAVerifierFacture(e: CopieEmetteurFacture, c: CopieClient, f: FactureAControler): string[] {
  const t: string[] = [];
  if (f.type !== 'avoir') {
    t.push('Mention des pénalités de retard (taux et point de départ)');
    if (c.type === 'professionnel') t.push('Mention de l’indemnité forfaitaire pour frais de recouvrement');
  }
  if (f.autoliquidation) t.push('Mention d’autoliquidation (sous-traitance du bâtiment)');
  if (f.regime_tva === 'franchise') t.push('Mention de franchise de TVA');
  return t;
}

export function mentionPenalites(p: ConditionsPaiement): string | null {
  if (p.taux_penalites_bp === null) return null;
  return `En cas de retard de paiement, des pénalités au taux annuel de ${(p.taux_penalites_bp / 100).toString().replace('.', ',')} % sont exigibles à compter du lendemain de la date d’échéance.`;
}

export function mentionIndemnite(p: ConditionsPaiement, client: CopieClient): string | null {
  if (client.type !== 'professionnel') return null;
  return `Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : ${formaterEuros(p.indemnite_recouvrement_cents)}.`;
}

/** AAAA-MM-JJ -> JJ/MM/AAAA (sans fuseau : date civile). */
const formaterDateIso = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Date d'échéance = émission + délai (même calcul que la base). */
export const dateEcheance = (dateEmission: string, delaiJours: number) => ajouterJours(dateEmission, delaiJours);

