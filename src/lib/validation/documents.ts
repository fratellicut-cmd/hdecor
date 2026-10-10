import { z } from 'zod';
import { caseACocher, texteFacultatif, texteObligatoire } from './champs';

const idFacultatif = z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null), z.uuid({ error: 'Choix invalide.' }).nullable());

export const MOMENTS_PHOTO = ['avant', 'pendant', 'apres', 'autre'] as const;
export const LIBELLES_MOMENT: Record<(typeof MOMENTS_PHOTO)[number], string> = { avant: 'Avant', pendant: 'Pendant', apres: 'Après', autre: 'Autre' };

export const TYPES_DOCUMENT = ['fiche_technique', 'attestation', 'assurance', 'plan', 'autre'] as const;
export const LIBELLES_DOCUMENT: Record<(typeof TYPES_DOCUMENT)[number], string> = {
  fiche_technique: 'Fiche technique', attestation: 'Attestation', assurance: 'Assurance', plan: 'Plan', autre: 'Autre',
};

/**
 * Taille maximale par envoi (photos réduites à 1600 px dans le navigateur,
 * quelques centaines de Ko chacune) : sous serverActions.bodySizeLimit (6 Mo).
 */
export const PHOTOS_PAR_ENVOI = 8;
export const TAILLE_MAX_ENVOI = 5_500_000;

export const schemaPhotos = z.object({
  chantier_id: z.uuid({ error: 'Chantier introuvable.' }),
  moment: z.enum(MOMENTS_PHOTO, { error: 'Choisissez : avant, pendant, après ou autre.' }),
  piece_id: idFacultatif,
  legende: texteFacultatif(300),
});

export const schemaModifierPhoto = z.object({
  id: z.uuid({ error: 'Photo introuvable.' }),
  moment: z.enum(MOMENTS_PHOTO, { error: 'Choisissez : avant, pendant, après ou autre.' }),
  piece_id: idFacultatif,
  legende: texteFacultatif(300),
  en_galerie: caseACocher,
});

export const schemaDocument = z.object({
  chantier_id: z.uuid({ error: 'Chantier introuvable.' }),
  type: z.enum(TYPES_DOCUMENT, { error: 'Choisissez le type de document.' }),
  nom: texteObligatoire('Nom du document', 200),
});
