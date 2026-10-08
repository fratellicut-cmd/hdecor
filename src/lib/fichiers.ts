/**
 * Vérification de la signature binaire d'un fichier déposé : le type déclaré
 * par le navigateur (et l'extension) ne prouvent rien. Un fichier n'est
 * accepté que si ses premiers octets correspondent au type annoncé, et si ce
 * type est autorisé pour l'espace de stockage visé. Pas de SVG (contenu actif).
 */
export type TypeFichier = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/heic' | 'application/pdf';

const commencePar = (o: Uint8Array, sig: number[], decalage = 0) =>
  o.length >= decalage + sig.length && sig.every((b, i) => o[decalage + i] === b);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Type réel d'après les premiers octets, ou null s'il n'est pas reconnu. */
export function typeReel(octets: Uint8Array): TypeFichier | null {
  if (commencePar(octets, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (commencePar(octets, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (commencePar(octets, ascii('RIFF')) && commencePar(octets, ascii('WEBP'), 8)) return 'image/webp';
  if (commencePar(octets, ascii('%PDF-'))) return 'application/pdf';
  // HEIC / HEIF : boîte « ftyp » à l'octet 4, marque principale à l'octet 8.
  if (commencePar(octets, ascii('ftyp'), 4) && ['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].some((m) => commencePar(octets, ascii(m), 8))) {
    return 'image/heic';
  }
  return null;
}

/** Vrai si le contenu est bien du type annoncé ET que ce type est autorisé. */
export function fichierConforme(octets: Uint8Array, typeAnnonce: string, autorises: readonly TypeFichier[]): boolean {
  const reel = typeReel(octets);
  return reel !== null && reel === typeAnnonce && autorises.includes(reel);
}
