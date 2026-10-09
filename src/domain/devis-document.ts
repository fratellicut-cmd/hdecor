/**
 * Contenu d'un devis émis : copies figées (émetteur, client, chantier),
 * contrôle des mentions obligatoires avant émission, textes légaux types.
 *
 * Honnêteté : les textes légaux ci-dessous sont des modèles À VÉRIFIER par le
 * comptable (questions 1, 3, 5 et 10 du cadrage). Aucun article de loi n'est
 * cité : seules les références saisies par l'entreprise (mention de franchise)
 * apparaissent. L'interface les signale tant qu'ils ne sont pas confirmés.
 */

import { nomAffiche } from './clients';
import { formaterDate } from './formats';
import type { Regime } from './devis';

// --------------------------------------------------------------------------
// Copies figées (enregistrées avec le devis à l'émission, jamais recalculées)
// --------------------------------------------------------------------------

export type Adresse = { ligne1: string | null; ligne2: string | null; code_postal: string | null; ville: string | null; pays?: string | null };

export type AssuranceCopiee = {
  type: 'decennale' | 'rc_pro';
  assureur: string;
  numero_contrat: string | null;
  debut: string | null;
  fin: string | null;
  zone_couverte: string | null;
};

export type CopieEmetteur = {
  raison_sociale: string | null;
  forme_juridique: string;
  nom_dirigeant: string | null;
  siret: string | null;
  immatriculation: string | null;
  adresse: Adresse;
  telephone: string | null;
  email: string | null;
  numero_tva_intra: string | null;
  regime_tva: Regime;
  mention_franchise: string | null;
  mediateur: { nom: string | null; coordonnees: string | null; site: string | null };
  assurances: AssuranceCopiee[];
  mentions_pied: string | null;
};

export type CopieClient = {
  type: 'particulier' | 'professionnel';
  nom_affiche: string;
  civilite: string | null;
  nom: string;
  prenom: string | null;
  raison_sociale: string | null;
  siret: string | null;
  tva_intra: string | null;
  adresse: Adresse;
};

export type CopieChantier = { nom: string; adresse: Adresse } | null;

export type ParametresEmetteur = {
  raison_sociale: string | null; forme_juridique: string; nom_dirigeant: string | null; siret: string | null; immatriculation: string | null;
  adresse_ligne1: string | null; adresse_ligne2: string | null; code_postal: string | null; ville: string | null;
  telephone: string | null; email: string | null; numero_tva_intra: string | null; regime_tva: Regime;
  mention_franchise: string; mediateur_nom: string | null; mediateur_coordonnees: string | null; mediateur_site: string | null;
  mentions_pied: string | null;
};

export type AssuranceSaisie = AssuranceCopiee & { id?: string };

const vide = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';
const net = (v: string | null | undefined) => (vide(v) ? null : v!.trim());

/** Une assurance couvre la date d'émission (bornes incluses ; fin vide = en cours). */
export function assuranceEnCours(a: AssuranceCopiee, dateIso: string): boolean {
  return (a.debut === null || a.debut <= dateIso) && (a.fin === null || a.fin >= dateIso);
}

export function copieEmetteur(p: ParametresEmetteur, assurances: AssuranceSaisie[], dateIso: string): CopieEmetteur {
  return {
    raison_sociale: net(p.raison_sociale), forme_juridique: p.forme_juridique, nom_dirigeant: net(p.nom_dirigeant),
    siret: net(p.siret), immatriculation: net(p.immatriculation),
    adresse: { ligne1: net(p.adresse_ligne1), ligne2: net(p.adresse_ligne2), code_postal: net(p.code_postal), ville: net(p.ville) },
    telephone: net(p.telephone), email: net(p.email), numero_tva_intra: net(p.numero_tva_intra), regime_tva: p.regime_tva,
    mention_franchise: p.regime_tva === 'franchise' ? net(p.mention_franchise) : null,
    mediateur: { nom: net(p.mediateur_nom), coordonnees: net(p.mediateur_coordonnees), site: net(p.mediateur_site) },
    // Seules les assurances en cours à la date d'émission figurent sur le devis.
    assurances: assurances.filter((a) => assuranceEnCours(a, dateIso))
      .map(({ type, assureur, numero_contrat, debut, fin, zone_couverte }) => ({ type, assureur, numero_contrat, debut, fin, zone_couverte })),
    mentions_pied: net(p.mentions_pied),
  };
}

export type ClientSaisi = {
  type: 'particulier' | 'professionnel'; civilite: string | null; nom: string; prenom: string | null; raison_sociale: string | null;
  siret: string | null; tva_intra: string | null; email: string | null; telephone: string | null;
  fact_ligne1: string | null; fact_ligne2: string | null; fact_code_postal: string | null; fact_ville: string | null; fact_pays: string | null;
  anonymise_le?: string | null;
};

export function copieClient(c: ClientSaisi): CopieClient {
  return {
    type: c.type, nom_affiche: nomAffiche(c), civilite: net(c.civilite), nom: c.nom, prenom: net(c.prenom), raison_sociale: net(c.raison_sociale),
    // Email et téléphone : non imprimés, donc non figés (minimisation).
    siret: net(c.siret), tva_intra: net(c.tva_intra),
    adresse: { ligne1: net(c.fact_ligne1), ligne2: net(c.fact_ligne2), code_postal: net(c.fact_code_postal), ville: net(c.fact_ville), pays: net(c.fact_pays) },
  };
}

export type ChantierSaisi = { nom: string; adresse_ligne1: string | null; adresse_ligne2: string | null; code_postal: string | null; ville: string | null };

export function copieChantier(ch: ChantierSaisi | null): CopieChantier {
  if (!ch) return null;
  return { nom: ch.nom, adresse: { ligne1: net(ch.adresse_ligne1), ligne2: net(ch.adresse_ligne2), code_postal: net(ch.code_postal), ville: net(ch.ville) } };
}

/** Lignes d'adresse affichables (vides omises, « 75011 Paris »). */
export function lignesAdresse(a: Adresse): string[] {
  const ville = [a.code_postal, a.ville].filter(Boolean).join(' ');
  return [a.ligne1, a.ligne2, ville || null, a.pays && a.pays.toLowerCase() !== 'france' ? a.pays : null].filter((x): x is string => !!x);
}

const adresseComplete = (a: Adresse) => !vide(a.ligne1) && !vide(a.code_postal) && !vide(a.ville);

// --------------------------------------------------------------------------
// Dates
// --------------------------------------------------------------------------

/** AAAA-MM-JJ + n jours (calendrier, sans fuseau). Même calcul que la base (date + entier). */
export function ajouterJours(dateIso: string, jours: number): string {
  const [a, m, j] = dateIso.split('-').map(Number);
  const d = new Date(Date.UTC(a!, m! - 1, j! + jours));
  return d.toISOString().slice(0, 10);
}

// --------------------------------------------------------------------------
// Contrôle des mentions avant émission
// --------------------------------------------------------------------------

export type DevisAControler = {
  hors_etablissement: boolean;
  date_debut_travaux: string | null;
  delai_debut_texte: string | null;
  duree_estimee_jours: number | null;
  conditions_paiement: string | null;
  regime_tva: Regime;
};

export type Manque = { cle: string; message: string; ou: 'parametres' | 'client' | 'chantier' | 'devis'; bloquant: boolean };

/**
 * Mentions du devis (§5.6) : un manque BLOQUANT empêche l'émission (jamais de
 * valeur inventée pour combler) ; un manque non bloquant est signalé.
 */
export function controlerMentions(e: CopieEmetteur, c: CopieClient, ch: CopieChantier, d: DevisAControler): Manque[] {
  const m: Manque[] = [];
  const bloque = (cle: string, message: string, ou: Manque['ou']) => m.push({ cle, message, ou, bloquant: true });
  const signale = (cle: string, message: string, ou: Manque['ou']) => m.push({ cle, message, ou, bloquant: false });

  if (vide(e.raison_sociale)) bloque('raison_sociale', 'Nom de l’entreprise manquant.', 'parametres');
  if (vide(e.siret)) bloque('siret', 'SIRET manquant.', 'parametres');
  if (!adresseComplete(e.adresse)) bloque('adresse_entreprise', 'Adresse de l’entreprise incomplète.', 'parametres');
  if (vide(e.immatriculation)) signale('immatriculation', 'Immatriculation (RNE / RM) non renseignée : mention À VÉRIFIER avec le comptable.', 'parametres');
  if (e.regime_tva === 'franchise' && vide(e.mention_franchise)) bloque('mention_franchise', 'Mention de franchise de TVA vide.', 'parametres');
  if (e.regime_tva === 'assujetti' && vide(e.numero_tva_intra)) signale('numero_tva_intra', 'Numéro de TVA intracommunautaire non renseigné.', 'parametres');
  if (!e.assurances.some((a) => a.type === 'decennale')) {
    bloque('decennale', 'Aucune assurance décennale en cours à la date du devis.', 'parametres');
  }
  if (!e.assurances.some((a) => a.type === 'rc_pro')) signale('rc_pro', 'Aucune RC Pro en cours à la date du devis.', 'parametres');
  if (c.type === 'particulier' && vide(e.mediateur.nom)) bloque('mediateur', 'Médiateur de la consommation manquant (client particulier).', 'parametres');

  if (vide(c.nom_affiche)) bloque('client_nom', 'Nom du client manquant.', 'client');
  if (!adresseComplete(c.adresse)) bloque('client_adresse', 'Adresse du client incomplète.', 'client');

  if (!ch) bloque('chantier', 'Aucun chantier : l’adresse des travaux est obligatoire.', 'chantier');
  else if (!adresseComplete(ch.adresse)) bloque('chantier_adresse', 'Adresse du chantier incomplète.', 'chantier');

  if (d.date_debut_travaux === null && vide(d.delai_debut_texte)) bloque('debut', 'Date ou délai de début des travaux manquant.', 'devis');
  if (d.duree_estimee_jours === null) bloque('duree', 'Durée estimée des travaux manquante.', 'devis');
  if (vide(d.conditions_paiement)) bloque('conditions_paiement', 'Conditions de paiement manquantes.', 'devis');
  if (d.regime_tva !== e.regime_tva) {
    bloque('regime', 'Le régime de TVA du devis ne correspond plus aux paramètres : dupliquez le devis.', 'devis');
  }
  if (d.hors_etablissement && c.type === 'professionnel') {
    signale('retractation_pro', 'Devis hors établissement pour un professionnel : le droit de rétractation peut s’appliquer à certaines petites entreprises (À VÉRIFIER avec le comptable). Le formulaire n’est joint que pour un particulier.', 'devis');
  }
  return m;
}

export type TauxActif = { taux_bp: number; attestation_requise: boolean };
export type LigneAControler = { designation: string; tauxTvaBp: number | null };

/**
 * Taux des lignes chiffrées : en franchise tout à 0 % ; assujetti, chaque taux
 * doit être actif dans les Paramètres, et une ligne à 0 % sans mention qui la
 * justifie (exonération, autoliquidation : À VÉRIFIER) bloque l'émission.
 * Un taux réduit avec « attestation requise » est signalé : l'attestation du
 * client n'est pas encore produite par l'application.
 */
export function controlerTaux(lignes: LigneAControler[], regime: Regime, actifs: TauxActif[]): Manque[] {
  const m: Manque[] = [];
  const noms = (f: (l: LigneAControler) => boolean) => lignes.filter(f).map((l) => `« ${l.designation} »`).join(', ');
  if (regime === 'franchise') {
    const avecTva = noms((l) => (l.tauxTvaBp ?? 0) !== 0);
    if (avecTva) m.push({ cle: 'taux_franchise', message: `Franchise en base de TVA : lignes avec un taux de TVA à remettre à 0 % : ${avecTva}.`, ou: 'devis', bloquant: true });
    return m;
  }
  const aZero = noms((l) => l.tauxTvaBp === 0);
  if (aZero) {
    m.push({ cle: 'taux_zero', message: `Lignes à 0 % sur un devis soumis à la TVA, sans mention qui le justifie (exonération, autoliquidation : À VÉRIFIER avec le comptable) : ${aZero}. Choisissez leur taux.`, ou: 'devis', bloquant: true });
  }
  const inactifs = noms((l) => l.tauxTvaBp !== 0 && !actifs.some((t) => t.taux_bp === l.tauxTvaBp));
  if (inactifs) m.push({ cle: 'taux_inactif', message: `Taux de TVA absent des Paramètres (Taux de TVA) : ${inactifs}.`, ou: 'devis', bloquant: true });
  const attestations = [...new Set(lignes.filter((l) => actifs.some((t) => t.taux_bp === l.tauxTvaBp && t.attestation_requise)).map((l) => l.tauxTvaBp!))];
  if (attestations.length) {
    m.push({ cle: 'attestation_tva', message: `Taux réduit ${attestations.map((t) => `${t / 100} %`.replace('.', ',')).join(' et ')} : une attestation du client est requise. L’application ne la produit pas encore (phase Documents) : faites-la remplir à part (conditions À VÉRIFIER).`, ou: 'devis', bloquant: false });
  }
  return m;
}

/**
 * Contrat hors établissement avec un particulier : situations liées au délai
 * de rétractation, SIGNALÉES (non bloquantes) tant que le comptable n'a pas
 * confirmé la règle (cadrage §10, point 3) : paiement demandé à la signature,
 * début des travaux pendant les 14 jours (demande expresse du client).
 */
export function signauxRetractation(o: {
  retractation: boolean; dateEmission: string; dateDebutTravaux: string | null; acompteSignatureBp: number;
}): Manque[] {
  if (!o.retractation) return [];
  const m: Manque[] = [];
  if (o.acompteSignatureBp > 0) {
    m.push({ cle: 'acompte_retractation', ou: 'devis', bloquant: false,
      message: 'Paiement demandé à la signature d’un contrat signé chez le client : un encaissement pendant les premiers jours peut être interdit (À VÉRIFIER avec le comptable). Envisagez une échéance « début des travaux ».' });
  }
  if (o.dateDebutTravaux !== null && o.dateDebutTravaux < ajouterJours(o.dateEmission, 14)) {
    m.push({ cle: 'debut_retractation', ou: 'devis', bloquant: false,
      message: 'Début des travaux pendant le délai de rétractation de 14 jours : il faut la demande expresse et écrite du client (À VÉRIFIER avec le comptable).' });
  }
  return m;
}

/** Le formulaire de rétractation est joint : hors établissement ET client particulier. */
export const avecRetractation = (horsEtablissement: boolean, client: CopieClient) => horsEtablissement && client.type === 'particulier';

// --------------------------------------------------------------------------
// Textes types (À VÉRIFIER par le comptable : non affirmés comme exacts)
// --------------------------------------------------------------------------

export const TEXTES_A_VERIFIER = {
  mediateur: 'Phrase sur le recours au médiateur de la consommation',
  retractation: 'Information sur le droit de rétractation et formulaire type',
  devis_recu: 'Mention « Devis reçu avant l’exécution des travaux »',
  execution_anticipee: 'Demande de début des travaux pendant le délai de rétractation',
} as const;

/** Paragraphe d'information sur le devis lorsqu'il est signé hors établissement. */
export function informationRetractation(e: CopieEmetteur): string {
  const contact = [e.raison_sociale, ...lignesAdresse(e.adresse), e.email].filter(Boolean).join(', ');
  return 'Contrat conclu hors établissement : vous disposez d’un délai de quatorze (14) jours à compter de la signature du présent devis '
    + 'pour exercer votre droit de rétractation, sans avoir à justifier de motif ni à payer de pénalité. '
    + `Pour l’exercer, adressez avant l’expiration de ce délai le formulaire ci-joint, ou toute autre déclaration dénuée d’ambiguïté, à : ${contact}.`;
}

export const EXECUTION_ANTICIPEE = 'Si vous souhaitez que les travaux commencent avant la fin du délai de rétractation, vous devez en faire la demande expresse '
  + 'par écrit. Si vous vous rétractez ensuite, vous devrez payer la part des travaux réalisée jusqu’à la communication de votre décision.';

export const MENTION_DEVIS_RECU = 'Devis reçu avant l’exécution des travaux.';

/** Formulaire type de rétractation (page détachable). */
export function formulaireRetractation(e: CopieEmetteur, numero: string | null): { titre: string; lignes: string[] } {
  const destinataire = [e.raison_sociale, ...lignesAdresse(e.adresse), e.email].filter(Boolean).join(', ');
  return {
    titre: 'Formulaire de rétractation',
    lignes: [
      '(Veuillez compléter et renvoyer le présent formulaire uniquement si vous souhaitez vous rétracter du contrat.)',
      `À l’attention de : ${destinataire}`,
      'Je / nous (*) vous notifie / notifions (*) par la présente ma / notre (*) rétractation du contrat portant sur la prestation de services ci-dessous :',
      `Devis n° : ${numero ?? '____________________'}   Commandé le : ____ / ____ / ________`,
      'Nom du (des) consommateur(s) : ________________________________________________',
      'Adresse du (des) consommateur(s) : _____________________________________________',
      '_______________________________________________________________________________',
      'Signature du (des) consommateur(s) (uniquement en cas de notification du présent formulaire sur papier) :',
      '',
      'Date : ____ / ____ / ________',
      '(*) Rayez la mention inutile.',
    ],
  };
}

/** Lignes d'assurance imprimées : « Assurance décennale : Assureur, contrat n° X, du … au …, zone : … ». */
export function texteAssurance(a: AssuranceCopiee): string {
  const periode = a.debut && a.fin ? `du ${formaterDate(a.debut)} au ${formaterDate(a.fin)}`
    : a.debut ? `depuis le ${formaterDate(a.debut)}` : a.fin ? `jusqu’au ${formaterDate(a.fin)}` : null;
  return `${a.type === 'decennale' ? 'Assurance décennale' : 'Responsabilité civile professionnelle'} : `
    + [a.assureur, a.numero_contrat ? `contrat n° ${a.numero_contrat}` : null, periode, a.zone_couverte ? `couverture : ${a.zone_couverte}` : null]
      .filter(Boolean).join(', ');
}

/** « H'DECOR EI » : forme juridique ajoutée si le nom ne la porte pas déjà. */
export function nomAvecForme(e: CopieEmetteur): string {
  const nom = e.raison_sociale ?? '';
  const forme = e.forme_juridique.trim();
  const deja = nom.toLowerCase() === forme.toLowerCase() || nom.toLowerCase().endsWith(` ${forme.toLowerCase()}`);
  return !forme || deja ? nom : `${nom} ${forme}`;
}

/** Identité de l'émetteur en lignes (en-tête du PDF). */
export function identiteEmetteur(e: CopieEmetteur): string[] {
  return [
    nomAvecForme(e),
    e.nom_dirigeant,
    ...lignesAdresse(e.adresse),
    [e.telephone, e.email].filter(Boolean).join(' · ') || null,
    e.siret ? `SIRET ${e.siret}` : null,
    e.immatriculation,
    e.regime_tva === 'assujetti' && e.numero_tva_intra ? `TVA intracommunautaire ${e.numero_tva_intra}` : null,
  ].filter((x): x is string => !!x);
}

// --------------------------------------------------------------------------
// Affichage des lignes
// --------------------------------------------------------------------------

export const UNITES: Record<string, string> = { m2: 'm²', ml: 'ml', u: 'u', h: 'h', forfait: 'forfait', L: 'L', kg: 'kg' };

/** 319 300 -> « 31,93 » ; 25 000 -> « 2,5 » ; 10 000 -> « 1 » (zéros inutiles retirés, sans flottant). */
export function formaterQuantiteE4(q: bigint): string {
  const negatif = q < 0n;
  const abs = negatif ? -q : q;
  const entier = (abs / 10_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const dec = (abs % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${negatif ? '-' : ''}${entier}${dec ? `,${dec}` : ''}`;
}

/** Durée estimée : « 3 jours », « 0,5 jour ». */
export function formaterJours(j: number): string {
  const t = String(j).replace('.', ',');
  return `${t} jour${j >= 2 ? 's' : ''}`;
}
