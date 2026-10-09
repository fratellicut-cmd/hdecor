/** Libellés français des statuts affichés (vues v_devis, v_factures, v_chantiers). */
const LIBELLES: Record<string, string> = {
  brouillon: 'Brouillon',
  envoye: 'Envoyé',
  consulte: 'Consulté',
  expire: 'Expiré',
  accepte: 'Accepté',
  refuse: 'Refusé',
  remplace: 'Remplacé',
  emise: 'Émise',
  envoyee: 'Envoyée',
  annulee: 'Annulée',
  en_retard: 'En retard',
  partiellement_payee: 'Partiellement payée',
  payee: 'Payée',
  a_planifier: 'À planifier',
  en_cours: 'En cours',
  termine: 'Terminé',
  facture: 'Facturé',
};

export function libelleStatut(statut: string | null | undefined): string {
  if (!statut) return '—';
  return LIBELLES[statut] ?? statut;
}

const TYPES_FACTURE: Record<string, string> = {
  acompte: 'Acompte', situation: 'Situation', finale: 'Facture', libre: 'Facture', avoir: 'Avoir',
};

export function libelleTypeFacture(type: string | null | undefined): string {
  return (type && TYPES_FACTURE[type]) || 'Facture';
}
