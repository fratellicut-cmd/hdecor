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

/**
 * JPEG sans métadonnées : retire les segments APP1 (EXIF : position GPS,
 * appareil, date ; XMP), APP13 (IPTC) et les commentaires, avant le début de
 * l'image, et tout ce qui suit la fin de la première image (images
 * composites des téléphones). Garde APP0 (JFIF), APP2 (profil de couleurs) et
 * APP14 (Adobe). Null si le fichier n'est pas un JPEG lisible.
 */
export function jpegSansMetadonnees(octets: Uint8Array): { octets: Uint8Array; largeur: number | null; hauteur: number | null } | null {
  if (octets.length < 4 || octets[0] !== 0xff || octets[1] !== 0xd8) return null;
  const morceaux: Uint8Array[] = [octets.subarray(0, 2)];
  let largeur: number | null = null;
  let hauteur: number | null = null;
  let i = 2;
  while (i + 4 <= octets.length) {
    if (octets[i] !== 0xff) return null;
    const marqueur = octets[i + 1]!;
    if (marqueur === 0xff) { i += 1; continue; } // octet de remplissage
    if (marqueur === 0xda) {
      // Données de l'image jusqu'à la fin d'image (FF D9) : dans les données compressées, un octet FF n'est jamais
      // suivi de D9 ; tout ce qui suit (seconde image, « photo animée », EXIF d'une vignette) est retiré.
      let fin = -1;
      for (let k = i + 2; k + 1 < octets.length; k++) if (octets[k] === 0xff && octets[k + 1] === 0xd9) { fin = k; break; }
      if (fin < 0) return null;
      morceaux.push(octets.subarray(i, fin + 2));
      break;
    }
    if (marqueur === 0xd9) { morceaux.push(octets.subarray(i, i + 2)); break; }
    const taille = (octets[i + 2]! << 8) | octets[i + 3]!;
    if (taille < 2 || i + 2 + taille > octets.length) return null;
    // Dimensions : en-tête de trame (SOF0 à SOF15, sauf DHT, JPG et DAC).
    if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur) && taille >= 7) {
      hauteur = (octets[i + 5]! << 8) | octets[i + 6]!;
      largeur = (octets[i + 7]! << 8) | octets[i + 8]!;
    }
    const retire = marqueur === 0xe1 || marqueur === 0xed || marqueur === 0xfe || (marqueur >= 0xe3 && marqueur <= 0xec) || marqueur === 0xef;
    if (!retire) morceaux.push(octets.subarray(i, i + 2 + taille));
    i += 2 + taille;
  }
  const total = morceaux.reduce((a, m) => a + m.length, 0);
  const sortie = new Uint8Array(total);
  let p = 0;
  for (const m of morceaux) { sortie.set(m, p); p += m.length; }
  return { octets: sortie, largeur: largeur || null, hauteur: hauteur || null };
}
