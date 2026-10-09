import { z } from 'zod';
import { dateFacultative, montantFacultatif, montantObligatoire, texteFacultatif, texteObligatoire } from './champs';
import { MODES_PAIEMENT_SAISIS } from './factures';

const idFacultatif = z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null), z.uuid({ error: 'Choix invalide.' }).nullable());

/**
 * Achat : on saisit ce qui figure sur le ticket (TTC et TVA) ; le HT s'en
 * déduit (HT = TTC − TVA, contrainte vérifiée aussi en base).
 */
export const schemaDepense = z.object({
  date_depense: z.iso.date({ error: 'Date de l’achat : obligatoire.' }),
  fournisseur: texteObligatoire('Fournisseur', 200),
  libelle: texteFacultatif(300),
  categorie_id: idFacultatif,
  chantier_id: idFacultatif,
  montant_ttc_cents: montantObligatoire(1_000_000_00).refine((n) => n > 0, { error: 'Montant TTC : supérieur à 0.' }),
  tva_cents: montantFacultatif(1_000_000_00).transform((n) => n ?? 0),
  mode_paiement: z.preprocess((v) => (v === '' ? null : v), z.enum(MODES_PAIEMENT_SAISIS, { error: 'Mode de paiement invalide.' }).nullable()),
}).superRefine((d, ctx) => {
  if (d.tva_cents > d.montant_ttc_cents) ctx.addIssue({ code: 'custom', path: ['tva_cents'], message: 'La TVA dépasse le montant TTC.' });
}).transform((d) => ({ ...d, montant_ht_cents: d.montant_ttc_cents - d.tva_cents }));

export const schemaCategorie = z.object({ libelle: texteObligatoire('Catégorie', 80) });

export const schemaMateriel = z.object({
  libelle: texteObligatoire('Désignation', 200),
  date_achat: dateFacultative,
  valeur_cents: montantFacultatif(1_000_000_00),
  depense_id: idFacultatif,
  notes: texteFacultatif(1000),
});

/** Mois « AAAA-MM » (sélecteur de la comptabilité). */
export const schemaMois = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * Taille maximale d'un justificatif, en octets : sous la limite d'envoi des
 * Server Actions (serverActions.bodySizeLimit, next.config.ts : 6 Mo, formulaire
 * compris). Les photos sont réduites dans le navigateur avant l'envoi.
 */
export const TAILLE_MAX_JUSTIFICATIF = 5_500_000;
