import { z } from 'zod';

export const MOT_DE_PASSE_MIN = 12;

export const schemaEmail = z
  .string({ error: 'Saisissez votre adresse email.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Adresse email invalide.' }));

export const schemaConnexion = z.object({
  email: schemaEmail,
  motDePasse: z.string({ error: 'Saisissez votre mot de passe.' }).min(1, { error: 'Saisissez votre mot de passe.' }).max(200),
  suite: z.string().optional(),
});

export const schemaNouveauMotDePasse = z
  .object({
    motDePasse: z
      .string()
      .min(MOT_DE_PASSE_MIN, { error: `Au moins ${MOT_DE_PASSE_MIN} caractères.` })
      .max(200, { error: '200 caractères au maximum.' }),
    confirmation: z.string(),
  })
  .refine((v) => v.motDePasse === v.confirmation, {
    error: 'Les deux mots de passe ne sont pas identiques.',
    path: ['confirmation'],
  });

export const schemaCodeTotp = z.object({
  code: z.string().trim().regex(/^\d{6}$/, { error: 'Le code fait 6 chiffres.' }),
  facteurId: z.uuid(),
});
