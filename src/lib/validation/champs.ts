import { z } from 'zod';
import { lireMontantEnCentimes, lirePourcentageEnPointsDeBase } from '@/domain/formats';

/** Texte facultatif : espaces retirés, vide -> null, longueur bornée. */
export const texteFacultatif = (max = 200) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
    z.string().max(max, { error: `${max} caractères au maximum.` }).nullable(),
  );

export const texteObligatoire = (libelle: string, max = 200) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string({ error: `${libelle} : champ obligatoire.` }).min(1, { error: `${libelle} : champ obligatoire.` })
      .max(max, { error: `${max} caractères au maximum.` }),
  );

/** Montant saisi en euros (« 1 234,56 ») -> centimes entiers. */
export const montantFacultatif = (max = 100_000_000_00) =>
  z.preprocess((v) => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    const c = lireMontantEnCentimes(v);
    return c === null ? Number.NaN : c;
  }, z.number({ error: 'Montant invalide (exemple : 40 ou 1 234,50).' })
    .int().min(0, { error: 'Le montant doit être positif.' }).max(max, { error: 'Montant trop élevé.' }).nullable());

const lirePb = (v: unknown, vide: null | number) => {
  if (typeof v !== 'string' || v.trim() === '') return vide;
  const pb = lirePourcentageEnPointsDeBase(v);
  return pb === null ? Number.NaN : pb;
};
const nombrePb = (min: number, max: number) =>
  z.number({ error: 'Pourcentage invalide (exemple : 10 ou 5,5).' }).int()
    .min(min, { error: `Minimum ${min / 100} %.` }).max(max, { error: `Maximum ${max / 100} %.` });

/** Pourcentage saisi (« 5,5 ») -> points de base (550). Obligatoire. */
export const pourcentage = (min = 0, max = 10000) =>
  z.preprocess((v) => lirePb(v, Number.NaN), nombrePb(min, max));

/** Pourcentage facultatif (vide -> null). */
export const pourcentageFacultatif = (min = 0, max = 10000) =>
  z.preprocess((v) => lirePb(v, null), nombrePb(min, max).nullable());

/** Montant obligatoire en euros -> centimes. */
export const montantObligatoire = (max = 100_000_000_00) =>
  z.preprocess((v) => {
    const c = typeof v === 'string' ? lireMontantEnCentimes(v) : null;
    return c === null ? Number.NaN : c;
  }, z.number({ error: 'Montant invalide (exemple : 40 ou 1 234,50).' })
    .int().min(0, { error: 'Le montant doit être positif.' }).max(max, { error: 'Montant trop élevé.' }));

/** Nombre entier saisi (« 30 »), bornes incluses. */
export const entier = (min: number, max: number, libelle: string) =>
  z.preprocess((v) => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : Number.NaN),
    z.number({ error: `${libelle} : nombre entier attendu.` }).int().min(min, { error: `${libelle} : minimum ${min}.` })
      .max(max, { error: `${libelle} : maximum ${max}.` }));

/** Case à cocher HTML -> booléen. */
export const caseACocher = z.preprocess((v) => v === 'on' || v === 'true' || v === '1', z.boolean());

/** Date AAAA-MM-JJ facultative. */
export const dateFacultative = z.preprocess(
  (v) => (typeof v === 'string' && v !== '' ? v : null),
  z.iso.date({ error: 'Date invalide.' }).nullable(),
);
