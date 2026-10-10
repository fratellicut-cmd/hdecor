/** Côté le plus long d'une photo réduite : un ticket ou une pièce reste lisible, le fichier pèse quelques centaines de Ko. */
const COTE_MAX = 1600;
const QUALITE_JPEG = 0.75;

/**
 * Réduit une photo avant l'envoi (une photo de téléphone dépasse souvent la
 * limite d'envoi) et la convertit en JPEG ; le réencodage retire aussi les
 * métadonnées (position GPS…). `toujours` : réencoder même une petite photo
 * JPEG (photos de chantier, diffusables). Un PDF, ou une image que le
 * navigateur ne sait pas lire (HEIC hors Safari), est envoyé tel quel : le
 * serveur tranche.
 */
export async function reduirePhoto(fichier: File, toujours = false): Promise<File> {
  if (!fichier.type.startsWith('image/') || typeof createImageBitmap !== 'function') return fichier;
  try {
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
    if (!toujours && echelle === 1 && fichier.size <= 1_000_000 && fichier.type === 'image/jpeg') { image.close(); return fichier; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', QUALITE_JPEG));
    return blob ? new File([blob], fichier.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : fichier;
  } catch {
    return fichier;
  }
}
