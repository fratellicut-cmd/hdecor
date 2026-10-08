/**
 * Contrôles des identifiants (format et clé), sans aucune donnée inventée :
 * on vérifie qu'un numéro est bien formé, pas qu'il existe.
 */

/** Clé de Luhn (SIREN, SIRET). */
function luhn(chiffres: string): boolean {
  let total = 0;
  for (let i = 0; i < chiffres.length; i++) {
    let d = Number(chiffres[chiffres.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return total % 10 === 0;
}

/** Retire espaces et points de saisie (« 732 829 320 00074 »). */
export function normaliserSiret(saisie: string): string {
  return saisie.replace(/[\s.  ]/g, '');
}

/**
 * SIRET : 14 chiffres et clé de Luhn. Exception connue : les établissements
 * de La Poste (SIREN 356000000) suivent une autre règle (somme des chiffres
 * multiple de 5).
 */
export function siretValide(saisie: string): boolean {
  const s = normaliserSiret(saisie);
  if (!/^\d{14}$/.test(s)) return false;
  if (s.startsWith('356000000')) {
    return s.split('').reduce((t, c) => t + Number(c), 0) % 5 === 0;
  }
  return luhn(s);
}

export function normaliserIban(saisie: string): string {
  return saisie.replace(/[\s  -]/g, '').toUpperCase();
}

/** IBAN : structure et clé (ISO 13616, reste 1 modulo 97). */
export function ibanValide(saisie: string): boolean {
  const iban = normaliserIban(saisie);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('FR') && iban.length !== 27) return false;
  const reordonne = iban.slice(4) + iban.slice(0, 4);
  let reste = 0;
  for (const c of reordonne) {
    const v = c >= 'A' ? (c.charCodeAt(0) - 55).toString() : c;
    for (const chiffre of v) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

/** IBAN affiché par groupes de 4 : « FR76 3000 6000 … ». */
export function formaterIban(iban: string): string {
  return normaliserIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/** BIC : 8 ou 11 caractères (banque, pays, lieu, agence). */
export function bicValide(saisie: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(saisie.replace(/\s/g, '').toUpperCase());
}

/** Numéro de TVA intracommunautaire français : FR + 2 caractères + SIREN. */
export function tvaIntraFrValide(saisie: string): boolean {
  const s = saisie.replace(/\s/g, '').toUpperCase();
  if (!/^FR[0-9A-Z]{2}\d{9}$/.test(s)) return false;
  const siren = s.slice(4);
  const cle = s.slice(2, 4);
  if (!/^\d{2}$/.test(cle)) return true; // clés alphanumériques (anciens formats) : format seul
  return Number(cle) === (12 + 3 * (Number(siren) % 97)) % 97;
}
