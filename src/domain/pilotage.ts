/**
 * Pilotage (§5.8 à §5.10) : chiffre d'affaires par période, seuils de la
 * micro-entreprise, devis, trésorerie prévisionnelle, marge par chantier,
 * planning (jours ouvrés, fichier ICS). Montants en centimes ENTIERS (bigint),
 * dates civiles AAAA-MM-JJ (fuseau de Paris, calculé par l'appelant).
 */

import { arrondi } from './chiffrage';
import { ajouterJours } from './devis-document';
import type { Regime } from './devis';

// --------------------------------------------------------------------------
// Périodes
// --------------------------------------------------------------------------

/** Période civile, bornes INCLUSES (AAAA-MM-JJ). */
export type Periode = { du: string; au: string };

const pad = (n: number) => String(n).padStart(2, '0');
const dernierJourDuMois = (annee: number, mois: number) => new Date(Date.UTC(annee, mois, 0)).getUTCDate();

/** Même jour un an plus tôt (29 février -> 28 février). */
export function anPrecedent(date: string): string {
  const [a, m, j] = date.split('-').map(Number) as [number, number, number];
  return `${a - 1}-${pad(m)}-${pad(Math.min(j, dernierJourDuMois(a - 1, m)))}`;
}

export type PeriodesTableauDeBord = Record<'mois' | 'trimestre' | 'annee', { courante: Periode; precedente: Periode }>;

/**
 * Mois, trimestre et année EN COURS (du premier jour à aujourd'hui), et la
 * même période un an plus tôt (comparaison à date égale).
 */
export function periodesTableauDeBord(aujourdhui: string): PeriodesTableauDeBord {
  const [a, m] = aujourdhui.split('-').map(Number) as [number, number];
  const debutTrimestre = Math.floor((m - 1) / 3) * 3 + 1;
  const p = (du: string): { courante: Periode; precedente: Periode } => ({
    courante: { du, au: aujourdhui }, precedente: { du: anPrecedent(du), au: anPrecedent(aujourdhui) },
  });
  return { mois: p(`${a}-${pad(m)}-01`), trimestre: p(`${a}-${pad(debutTrimestre)}-01`), annee: p(`${a}-01-01`) };
}

const dans = (date: string, p: Periode) => date >= p.du && date <= p.au;

// --------------------------------------------------------------------------
// Chiffre d'affaires encaissé (livre des recettes)
// --------------------------------------------------------------------------

export type Encaissement = {
  date: string;
  /** Signé : un remboursement ou une annulation de paiement est négatif. */
  montantCents: bigint;
  /** Net de la facture (acomptes déduits), TTC et HT : part HT d'un encaissement. */
  factureNetTtcCents: bigint;
  factureNetHtCents: bigint;
  regime: Regime;
};

/** Arrondi demi-supérieur (en valeur absolue) d'une division, signe conservé. */
function arrondiSigne(num: bigint, den: bigint): bigint {
  return num < 0n ? -arrondi(-num, den) : arrondi(num, den);
}

/**
 * Part HT d'un encaissement : en franchise, tout l'encaissement ; sinon au
 * prorata HT / TTC de la facture (À VÉRIFIER : CA « encaissé HT » d'une
 * entreprise soumise à la TVA).
 */
export function partHt(e: Encaissement): bigint {
  if (e.regime === 'franchise' || e.factureNetTtcCents <= 0n) return e.montantCents;
  return arrondiSigne(e.montantCents * e.factureNetHtCents, e.factureNetTtcCents);
}

export type Chiffre = { ttcCents: bigint; htCents: bigint };

/** Chiffre d'affaires ENCAISSÉ sur la période (recettes moins remboursements). */
export function chiffreAffaires(encaissements: Encaissement[], p: Periode): Chiffre {
  return encaissements.filter((e) => dans(e.date, p)).reduce(
    (a, e) => ({ ttcCents: a.ttcCents + e.montantCents, htCents: a.htCents + partHt(e) }),
    { ttcCents: 0n, htCents: 0n },
  );
}

/** Évolution en points de base (+1 250 = +12,5 %) ; null sans base de comparaison. */
export function evolutionBp(courant: bigint, precedent: bigint): number | null {
  if (precedent <= 0n) return null;
  return Number(arrondiSigne((courant - precedent) * 10_000n, precedent));
}

// --------------------------------------------------------------------------
// Seuils de la micro-entreprise
// --------------------------------------------------------------------------

export type NiveauSeuil = 'non_renseigne' | 'ok' | 'alerte' | 'critique' | 'depasse';
export type Jauge = { niveau: NiveauSeuil; pourcentBp: number | null; resteCents: bigint | null };

/**
 * Jauge d'un seuil (plafond de CA, franchise de TVA) : niveau selon les deux
 * paliers paramétrés (80 % et 95 % par défaut). Seuil non saisi : aucune
 * valeur inventée.
 */
export function jaugeSeuil(caCents: bigint, seuilCents: bigint | null, alerte1Bp: number, alerte2Bp: number): Jauge {
  if (seuilCents === null || seuilCents <= 0n) return { niveau: 'non_renseigne', pourcentBp: null, resteCents: null };
  const ca = caCents < 0n ? 0n : caCents;
  const pourcentBp = Number((ca * 10_000n) / seuilCents);   // tronqué : jamais « 80 % » avant de les avoir atteints
  const niveau: NiveauSeuil = ca > seuilCents ? 'depasse' : pourcentBp >= alerte2Bp ? 'critique' : pourcentBp >= alerte1Bp ? 'alerte' : 'ok';
  return { niveau, pourcentBp, resteCents: seuilCents - ca };
}

// --------------------------------------------------------------------------
// Devis : en attente, transformation, délai de signature
// --------------------------------------------------------------------------

export type DevisResume = {
  statut: 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'remplace';
  dateEmission: string | null;
  valideJusquAu: string | null;
  /** Date (Paris) de l'acceptation. */
  accepteLe: string | null;
  totalTtcCents: bigint;
};

export type StatistiquesDevis = {
  enAttente: { nombre: number; montantCents: bigint };
  /** Sur les devis émis dans les 12 derniers mois et tranchés (acceptés, refusés, expirés). */
  tranches: number;
  acceptes: number;
  tauxTransformationBp: number | null;
  /** Délai moyen émission -> signature, en dixièmes de jour (arrondi). */
  delaiMoyenSignatureDixiemes: number | null;
};

const joursEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function statistiquesDevis(devis: DevisResume[], aujourdhui: string): StatistiquesDevis {
  const expire = (d: DevisResume) => d.statut === 'envoye' && d.valideJusquAu !== null && d.valideJusquAu < aujourdhui;
  const attente = devis.filter((d) => d.statut === 'envoye' && !expire(d));
  const depuis = ajouterJours(anPrecedent(aujourdhui), 1);
  const recents = devis.filter((d) => d.dateEmission !== null && d.dateEmission >= depuis && d.dateEmission <= aujourdhui);
  const tranches = recents.filter((d) => d.statut === 'accepte' || d.statut === 'refuse' || expire(d));
  const acceptes = recents.filter((d) => d.statut === 'accepte' && d.accepteLe !== null);
  const delais = acceptes.map((d) => Math.max(0, joursEntre(d.dateEmission!, d.accepteLe!)));
  return {
    enAttente: { nombre: attente.length, montantCents: attente.reduce((a, d) => a + d.totalTtcCents, 0n) },
    tranches: tranches.length,
    acceptes: acceptes.length,
    tauxTransformationBp: tranches.length ? Math.floor((acceptes.length * 10_000) / tranches.length) : null,
    delaiMoyenSignatureDixiemes: delais.length ? Math.round((delais.reduce((a, x) => a + x, 0) * 10) / delais.length) : null,
  };
}

// --------------------------------------------------------------------------
// Trésorerie prévisionnelle
// --------------------------------------------------------------------------

export type Tranche = 'en_retard' | 'j30' | 'j60' | 'j90' | 'plus_tard';
export const LIBELLES_TRANCHES: Record<Tranche, string> = {
  en_retard: 'En retard', j30: 'Sous 30 jours', j60: 'De 31 à 60 jours', j90: 'De 61 à 90 jours', plus_tard: 'Au-delà de 90 jours',
};

export type Tresorerie = {
  aEncaisser: Record<Tranche, bigint>;
  totalAEncaisserCents: bigint;
  /** Reste à facturer sur les devis signés (acomptes et soldes attendus). */
  aFacturerCents: bigint;
};

/** Factures émises à encaisser, rangées par échéance ; devis signés restant à facturer. */
export function tresoreriePrevisionnelle(factures: { resteCents: bigint; echeance: string }[], resteAFacturerCents: bigint[],
  aujourdhui: string): Tresorerie {
  const t: Record<Tranche, bigint> = { en_retard: 0n, j30: 0n, j60: 0n, j90: 0n, plus_tard: 0n };
  for (const f of factures) {
    if (f.resteCents <= 0n) continue;
    const j = joursEntre(aujourdhui, f.echeance);
    const tranche: Tranche = j < 0 ? 'en_retard' : j <= 30 ? 'j30' : j <= 60 ? 'j60' : j <= 90 ? 'j90' : 'plus_tard';
    t[tranche] += f.resteCents;
  }
  return {
    aEncaisser: t,
    totalAEncaisserCents: Object.values(t).reduce((a, x) => a + x, 0n),
    aFacturerCents: resteAFacturerCents.reduce((a, x) => a + (x > 0n ? x : 0n), 0n),
  };
}

// --------------------------------------------------------------------------
// Marge par chantier
// --------------------------------------------------------------------------

export type DonneesMarge = {
  /** Facturé HT net : factures émises (acomptes déduits) moins avoirs. */
  factureHtCents: bigint;
  /** Achats rattachés au chantier : coût réel (TTC en franchise, la TVA n'étant pas récupérée ; HT sinon). */
  achatsCents: bigint;
  minutesReelles: number;
  /** Prévu au(x) devis signé(s) : coût matière et temps (lignes retenues). */
  matierePrevueCents: bigint;
  minutesPrevues: number;
  /** Taux horaire de vente (Paramètres) : valorisation indicative du temps passé. */
  tauxHoraireCents: bigint | null;
};

export type Marge = {
  margeBruteCents: bigint;
  tauxMargeBp: number | null;
  ecartMatiereCents: bigint;
  ecartMinutes: number;
  valeurTempsCents: bigint | null;
  resultatApresTempsCents: bigint | null;
};

/**
 * Marge d'un chantier : facturé HT − achats réels ; écarts réel / prévu sur la
 * matière et le temps ; résultat après valorisation du temps passé au taux
 * horaire (indicatif : le temps n'est pas une dépense pour un entrepreneur seul).
 */
export function margeChantier(d: DonneesMarge): Marge {
  const margeBruteCents = d.factureHtCents - d.achatsCents;
  const valeurTempsCents = d.tauxHoraireCents === null ? null : arrondi(BigInt(d.minutesReelles) * d.tauxHoraireCents, 60n);
  return {
    margeBruteCents,
    tauxMargeBp: d.factureHtCents > 0n ? Number(arrondiSigne(margeBruteCents * 10_000n, d.factureHtCents)) : null,
    ecartMatiereCents: d.achatsCents - d.matierePrevueCents,
    ecartMinutes: d.minutesReelles - d.minutesPrevues,
    valeurTempsCents,
    resultatApresTempsCents: valeurTempsCents === null ? null : margeBruteCents - valeurTempsCents,
  };
}

/** Coût réel d'un achat selon le régime : TTC en franchise (TVA non récupérable), HT sinon. */
export const coutAchat = (a: { htCents: bigint; ttcCents: bigint }, regime: Regime) => (regime === 'franchise' ? a.ttcCents : a.htCents);

// --------------------------------------------------------------------------
// Planning
// --------------------------------------------------------------------------

const estWeekEnd = (date: string) => { const j = new Date(`${date}T12:00:00Z`).getUTCDay(); return j === 0 || j === 6; };

/** Premier jour ouvré (lundi à vendredi) à partir de cette date. */
export function premierJourOuvre(date: string): string {
  let d = date;
  while (estWeekEnd(d)) d = ajouterJours(d, 1);
  return d;
}

/**
 * Dernier jour d'un chantier de N jours ouvrés commencé tel jour (week-ends
 * exclus, jours fériés NON pris en compte). Durée arrondie au jour supérieur.
 */
export function finChantier(debut: string, dureeJours: number): string {
  const n = Math.max(1, Math.ceil(dureeJours));
  let d = premierJourOuvre(debut);
  for (let i = 1; i < n; i++) d = premierJourOuvre(ajouterJours(d, 1));
  return d;
}

// --------------------------------------------------------------------------
// Fichier ICS (export vers Google Agenda, RFC 5545)
// --------------------------------------------------------------------------

export type EvenementIcs = {
  id: string;
  titre: string;
  /** Journée entière : dates AAAA-MM-JJ (fin incluse) ; sinon instants ISO. */
  debut: string;
  fin: string;
  journeeEntiere: boolean;
  description?: string | null;
  lieu?: string | null;
};

const echapperIcs = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Plie une ligne à 75 octets (UTF-8), sans couper un caractère. */
function plier(ligne: string): string {
  const octets = (c: string) => new TextEncoder().encode(c).length;
  const parts: string[] = [];
  let courant = '';
  let taille = 0;
  for (const c of ligne) {
    const t = octets(c);
    if (taille + t > (parts.length ? 74 : 75)) { parts.push(courant); courant = ''; taille = 0; }
    courant += c;
    taille += t;
  }
  parts.push(courant);
  return parts.join('\r\n ');
}

const horodatage = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const dateIcs = (d: string) => d.replace(/-/g, '');

export function fichierIcs(evenements: EvenementIcs[], maintenant: Date, domaine = 'hdecor'): string {
  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//H\'DECOR//Planning//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:H\'DECOR : planning'];
  for (const e of evenements) {
    lignes.push('BEGIN:VEVENT', `UID:${e.id}@${domaine}`, `DTSTAMP:${horodatage(maintenant.toISOString())}`);
    if (e.journeeEntiere) {
      lignes.push(`DTSTART;VALUE=DATE:${dateIcs(e.debut.slice(0, 10))}`, `DTEND;VALUE=DATE:${dateIcs(ajouterJours(e.fin.slice(0, 10), 1))}`);
    } else {
      lignes.push(`DTSTART:${horodatage(e.debut)}`, `DTEND:${horodatage(e.fin)}`);
    }
    lignes.push(`SUMMARY:${echapperIcs(e.titre)}`);
    if (e.lieu) lignes.push(`LOCATION:${echapperIcs(e.lieu)}`);
    if (e.description) lignes.push(`DESCRIPTION:${echapperIcs(e.description)}`);
    lignes.push('END:VEVENT');
  }
  lignes.push('END:VCALENDAR');
  return lignes.map(plier).join('\r\n') + '\r\n';
}
