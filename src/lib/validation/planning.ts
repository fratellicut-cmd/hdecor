import { z } from 'zod';
import { lireDecimal } from '@/domain/saisie';
import { caseACocher, texteFacultatif, texteObligatoire } from './champs';

export const TYPES_EVENEMENT = ['rendez_vous', 'chantier', 'sechage', 'rappel'] as const;
export const LIBELLES_EVENEMENT: Record<(typeof TYPES_EVENEMENT)[number], string> = {
  rendez_vous: 'Rendez-vous', chantier: 'Chantier', sechage: 'Séchage', rappel: 'Rappel',
};

const date = (libelle: string) => z.iso.date({ error: `${libelle} : date invalide.` });
const heureFacultative = z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'Heure invalide (exemple : 08:30).' }).nullable());
const idFacultatif = z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null), z.uuid({ error: 'Choix invalide.' }).nullable());

export const schemaEvenement = z.object({
  type: z.enum(TYPES_EVENEMENT, { error: 'Choisissez le type.' }),
  chantier_id: idFacultatif,
  titre: texteObligatoire('Titre', 200),
  date_debut: date('Début'),
  date_fin: z.preprocess((v) => (typeof v === 'string' && v !== '' ? v : null), date('Fin').nullable()),
  journee_entiere: caseACocher,
  heure_debut: heureFacultative,
  heure_fin: heureFacultative,
  notes: texteFacultatif(2000),
}).superRefine((e, ctx) => {
  if (e.type === 'chantier' && !e.chantier_id) ctx.addIssue({ code: 'custom', path: ['chantier_id'], message: 'Choisissez le chantier.' });
  if (!e.journee_entiere) {
    if (!e.heure_debut) ctx.addIssue({ code: 'custom', path: ['heure_debut'], message: 'Heure de début : obligatoire (ou cochez « toute la journée »).' });
    if (!e.heure_fin) ctx.addIssue({ code: 'custom', path: ['heure_fin'], message: 'Heure de fin : obligatoire.' });
  }
  const fin = e.date_fin ?? e.date_debut;
  if (fin < e.date_debut || (fin === e.date_debut && !e.journee_entiere && e.heure_debut && e.heure_fin && e.heure_fin < e.heure_debut)) {
    ctx.addIssue({ code: 'custom', path: ['date_fin'], message: 'La fin précède le début.' });
  }
});

export const schemaRappel = z.object({
  titre: texteObligatoire('Rappel', 200),
  date: date('Date'),
  heure: heureFacultative,
  chantier_id: idFacultatif,
});

/** Durée en jours (« 3 », « 2,5 ») : demi-journées, de 0,5 à 365. */
const duree = z.preprocess((v) => {
  if (typeof v !== 'string' || v.trim() === '') return Number.NaN;
  const d = lireDecimal(v, 1);
  return d === null ? Number.NaN : Number(d) / 10;
}, z.number({ error: 'Durée invalide (exemple : 3 ou 2,5).' })
  .refine((n) => !Number.isNaN(n) && n >= 0.5 && n <= 365, { error: 'Durée : de 0,5 à 365 jours.' })
  .refine((n) => Number.isInteger(n * 2), { error: 'Durée en jours ou demi-journées (exemple : 3 ou 2,5).' }));

export const schemaPlanification = z.object({
  chantier_id: z.uuid({ error: 'Chantier introuvable.' }),
  date_debut: date('Début'),
  duree_jours: duree,
});

/** Temps passé « 2 h 30 », « 2:30 », « 2,5 » (heures) ou « 150 min ». */
export function lireDuree(saisie: string): number | null {
  const t = saisie.trim().toLowerCase().replace(/\s+/g, '');
  // Minutes sur deux chiffres après « h » ou « : » (« 2h5 » serait ambigu avec 2,5 h : refusé).
  let m = /^(\d{1,2})(?:h|:)(\d{2})?(?:min)?$/.exec(t);
  if (m) { const min = Number(m[2] ?? 0); return min < 60 ? Number(m[1]) * 60 + min : null; }
  m = /^(\d{1,4})min$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d{1,2})(?:[.,](\d{1,2}))?h?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Math.round(Number(`0.${m[2] ?? '0'}`) * 60);
  return null;
}

export const schemaTemps = z.object({
  chantier_id: z.uuid({ error: 'Chantier introuvable.' }),
  jour: date('Jour'),
  minutes: z.preprocess((v) => (typeof v === 'string' ? lireDuree(v) ?? Number.NaN : Number.NaN),
    z.number({ error: 'Durée invalide (exemple : 7h30, 2,5 ou 45 min).' })
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 1440, { error: 'Durée : de 1 minute à 24 heures (exemple : 7h30).' })),
  tache: texteFacultatif(200),
});
