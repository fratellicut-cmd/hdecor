/**
 * QR code de virement SEPA (« EPC QR », format du Conseil européen des
 * paiements, version 002) : le client le scanne avec l'application de sa
 * banque, qui pré-remplit bénéficiaire, IBAN, montant et référence.
 * Ce module ne produit que le TEXTE encodé ; le dessin du QR est fait ailleurs.
 */

import { ibanValide } from './factures';

export class ErreurVirement extends Error {}

/** Caractères acceptés sans risque par les banques (jeu SEPA de base). */
function nettoyer(t: string, max: number): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9 /?:().,'+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function payloadVirementSepa(o: { beneficiaire: string; iban: string; bic?: string | null; montantCents: bigint; reference: string }): string {
  if (!ibanValide(o.iban)) throw new ErreurVirement('IBAN invalide.');
  if (o.montantCents < 1n || o.montantCents > 99_999_999_999n) throw new ErreurVirement('Montant du virement hors limites.');
  const nom = nettoyer(o.beneficiaire, 70);
  if (!nom) throw new ErreurVirement('Nom du bénéficiaire manquant.');
  const bic = (o.bic ?? '').replace(/\s+/g, '').toUpperCase();
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) throw new ErreurVirement('BIC invalide.');
  const montant = `EUR${o.montantCents / 100n}.${(o.montantCents % 100n).toString().padStart(2, '0')}`;
  return ['BCD', '002', '1', 'SCT', bic, nom, o.iban.replace(/\s+/g, '').toUpperCase(), montant, '', '', nettoyer(o.reference, 140)].join('\n');
}
