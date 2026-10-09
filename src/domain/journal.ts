/** Présentation des entrées du journal d'audit (fonctions pures, testées). */

export const TABLES_JOURNAL: Record<string, string> = {
  clients: 'Client',
  devis: 'Devis',
  devis_lignes: 'Ligne de devis',
  factures: 'Facture',
  facture_lignes: 'Ligne de facture',
  paiements: 'Paiement',
  signatures: 'Signature',
  pv_reception: 'PV de réception',
  depenses: 'Dépense',
  parametres_entreprise: 'Paramètres de l’entreprise',
  assurances: 'Assurance',
  taux_tva: 'Taux de TVA',
};

const ACTIONS: Record<string, string> = { INSERT: 'Création', UPDATE: 'Modification', DELETE: 'Suppression' };

export function libelleAction(action: string): string {
  return ACTIONS[action] ?? action;
}

export function libelleTable(table: string): string {
  return TABLES_JOURNAL[table] ?? table;
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Objet = { [k: string]: Json } | null;

const estObjet = (v: unknown): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Numéro de document s'il figure dans l'entrée (DEV-…, FAC-…). */
export function numeroDocument(avant: unknown, apres: unknown): string | null {
  for (const o of [apres, avant]) if (estObjet(o) && typeof o.numero === 'string') return o.numero;
  return null;
}

/**
 * Champs modifiés d'une entrée UPDATE (seuls les champs non personnels sont
 * journalisés). Le statut est détaillé (« envoye → accepte »).
 */
export function resumeModification(avant: unknown, apres: unknown): string | null {
  const a: Objet = estObjet(avant) ? avant : null;
  const n: Objet = estObjet(apres) ? apres : null;
  if (!n) return null;
  const cles = Object.keys(n).filter((k) => k !== 'id' && k !== 'organisation_id');
  if (!cles.length) return 'Coordonnées ou textes (non détaillés : données personnelles)';
  return cles.map((k) => (k === 'statut' && a && typeof a.statut === 'string' && typeof n.statut === 'string'
    ? `statut : ${a.statut} → ${n.statut}` : k)).join(', ');
}
