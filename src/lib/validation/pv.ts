import { z } from 'zod';
import { entier, texteFacultatif } from './champs';
import { nomSignataire, signatureImage } from './devis';
import { lireReserves, type Reserve } from '@/domain/pv';

const idFacultatif = z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null), z.uuid({ error: 'Choix invalide.' }).nullable());
const entierFacultatif = (min: number, max: number, libelle: string) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), entier(min, max, libelle).optional()).transform((n) => n ?? null);

/** Contenu d'un PV (brouillon). Réserves : une par ligne. */
export const schemaPv = z.object({
  date_reception: z.iso.date({ error: 'Date de réception : obligatoire.' }),
  travaux: texteFacultatif(2000),
  reserves: z.string().max(30_000).default('').transform((s, ctx): Reserve[] => {
    const r = lireReserves(s);
    if ('erreur' in r) { ctx.addIssue({ code: 'custom', message: r.erreur }); return z.NEVER; }
    return r.reserves;
  }),
  observations: texteFacultatif(4000),
  delai_levee_jours: entierFacultatif(1, 365, 'Délai de levée'),
  devis_id: idFacultatif,
});

/** « Lu et approuvé » : casse, accents, espaces et ponctuation finale tolérés ; conservée telle que saisie. */
const normaliser = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').replace(/\s*[.!,;]+$/, '').toLowerCase();
export const MENTION_PV = 'Lu et approuvé';
export const mentionPvValide = (s: string) => normaliser(s) === normaliser(MENTION_PV);

export const schemaSignaturePv = z.object({
  nom: nomSignataire,
  mention: z.preprocess((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v),
    z.string({ error: `Écrivez « ${MENTION_PV} ».` }).max(100).refine(mentionPvValide, { error: `Écrivez « ${MENTION_PV} ».` })),
  image: signatureImage,
  image_entreprise: signatureImage,
  document_sha256: z.string().regex(/^[0-9a-f]{64}$/, { error: 'Document inconnu : rechargez la page.' }),
  lu: z.literal('on', { error: 'Cochez la case pour confirmer avoir relu le procès-verbal.' }),
});

export const schemaLevee = z.object({
  rang: entier(0, 49, 'Réserve'),
  levee_le: z.iso.date({ error: 'Date de levée : obligatoire.' }),
  levee_note: texteFacultatif(500),
});
