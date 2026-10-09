import { z } from 'zod';
import { caseACocher, dateFacultative, entier, montantFacultatif, montantObligatoire, pourcentage, pourcentageFacultatif, texteFacultatif, texteObligatoire } from './champs';
import { schemaLigne } from './devis';

export const TYPES_NOUVELLE_FACTURE = ['libre', 'acompte', 'situation', 'finale'] as const;
export const MODES_PAIEMENT_SAISIS = ['virement', 'cheque', 'especes', 'carte'] as const;

const idFacultatif = z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null), z.uuid({ error: 'Choix invalide.' }).nullable());

export const schemaNouvelleFacture = z.object({
  type: z.enum(TYPES_NOUVELLE_FACTURE, { error: 'Choisissez le type de facture.' }),
  client_id: idFacultatif,
  chantier_id: idFacultatif,
  devis_id: idFacultatif,
  pourcentage_bp: pourcentageFacultatif(1, 10000),
}).superRefine((n, ctx) => {
  if (n.type === 'libre' && !n.client_id) ctx.addIssue({ code: 'custom', path: ['client_id'], message: 'Choisissez un client.' });
  if (n.type !== 'libre' && !n.devis_id) ctx.addIssue({ code: 'custom', path: ['devis_id'], message: 'Choisissez un devis accepté.' });
  if ((n.type === 'acompte' || n.type === 'situation') && n.pourcentage_bp === null) {
    ctx.addIssue({ code: 'custom', path: ['pourcentage_bp'], message: n.type === 'acompte' ? 'Pourcentage de l’acompte : obligatoire.' : 'Avancement : obligatoire.' });
  }
});

export const schemaAvoir = z.object({
  facture_id: z.uuid({ error: 'Facture introuvable.' }),
  nature: z.enum(['correction', 'reduction'], { error: 'Choisissez la nature de l’avoir.' }),
  mode: z.enum(['total', 'montant'], { error: 'Choisissez : tout le reste dû ou un montant.' }),
  montant_ttc_cents: montantFacultatif(),
  motif: texteObligatoire('Motif', 500),
}).superRefine((a, ctx) => {
  if (a.mode === 'montant' && !a.montant_ttc_cents) ctx.addIssue({ code: 'custom', path: ['montant_ttc_cents'], message: 'Montant de l’avoir : supérieur à 0.' });
});

export const schemaEnteteFacture = z.object({
  date_prestation_debut: dateFacultative,
  date_prestation_fin: dateFacultative,
  delai_paiement_jours: entier(0, 365, 'Délai de paiement'),
  notes_client: texteFacultatif(2000),
  remise_globale_bp: pourcentage(0, 10000),
  autoliquidation: caseACocher,
}).refine((e) => !e.date_prestation_debut || !e.date_prestation_fin || e.date_prestation_debut <= e.date_prestation_fin, {
  error: 'La fin de la prestation précède son début.', path: ['date_prestation_fin'],
});

/** Lignes d'une facture libre : mêmes règles que le devis (l'option « optionnelle » est ignorée). */
export const schemaLigneFacture = schemaLigne;

/** Avancement d'une ligne de situation (0 à 100 %). */
export const schemaAvancement = pourcentage(0, 10000);

export const schemaPaiement = z.object({
  date_paiement: z.iso.date({ error: 'Date du paiement : obligatoire.' }),
  montant_cents: montantObligatoire(10_000_000_00).refine((n) => n > 0, { error: 'Montant : supérieur à 0.' }),
  mode: z.enum(MODES_PAIEMENT_SAISIS, { error: 'Choisissez le mode de paiement.' }),
  reference: texteFacultatif(140),
});
