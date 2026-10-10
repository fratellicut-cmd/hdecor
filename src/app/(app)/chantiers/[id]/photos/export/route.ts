import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { lire } from '@/lib/stockage';
import { archiveZip } from '@/lib/zip';
import { pdfGalerie } from '@/lib/pdf/galerie';
import { nomFichierSur, nomsUniques, pairesAvantApres } from '@/domain/galerie';
import { LIBELLES_MOMENT } from '@/lib/validation/documents';

/** Plafonds d'un export (taille de la réponse). */
const MAX_TOUTES = 200;
const MAX_GALERIE = 40;
/** Lectures du stockage menées en parallèle, par lots. */
const LOT = 8;

export const maxDuration = 60;

/** Lit les fichiers par lots de LOT (ordre conservé ; null si illisible). */
async function lireParLots<T>(elements: T[], lecture: (e: T) => Promise<Uint8Array | null>): Promise<(Uint8Array | null)[]> {
  const sortie: (Uint8Array | null)[] = [];
  for (let i = 0; i < elements.length; i += LOT) sortie.push(...(await Promise.all(elements.slice(i, i + LOT).map(lecture))));
  return sortie;
}

/** Archive ZIP aux noms uniques. */
const zip = (fichiers: { nom: string; contenu: Uint8Array }[]) => {
  const noms = nomsUniques(fichiers.map((f) => f.nom));
  return Buffer.from(archiveZip(fichiers.map((f, i) => ({ nom: noms[i]!, contenu: f.contenu }))));
};

const texte = (t: string, status: number) => new Response(t, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/**
 * Export des photos d'un chantier :
 * - quoi=tout (ZIP) : toutes les photos, rangées par moment, pour l'archive de Yorick ;
 * - quoi=galerie (ZIP ou PDF) : les photos « en galerie », avant / après, pour le
 *   portfolio ou les réseaux sociaux. Exige l'accord du client noté sur le chantier.
 * Noms de fichiers sans nom ni adresse du client (pièce et rang seulement).
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/chantiers/[id]/photos/export'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await ctx.params).id);
  const quoi = z.enum(['tout', 'galerie']).safeParse(req.nextUrl.searchParams.get('quoi'));
  const format = z.enum(['zip', 'pdf']).safeParse(req.nextUrl.searchParams.get('format'));
  if (!id.success || !quoi.success || !format.success || (quoi.data === 'tout' && format.data === 'pdf')) return texte('Export introuvable.', 404);
  const sb = await clientServeur();
  const [{ data: ch }, { data: p }] = await Promise.all([
    sb.from('chantiers').select('id, accord_diffusion_photos_le').eq('id', id.data).maybeSingle(),
    sb.from('parametres_entreprise').select('raison_sociale').eq('organisation_id', session.organisationId).maybeSingle(),
  ]);
  if (!ch) return texte('Chantier introuvable.', 404);
  if (quoi.data === 'galerie' && !ch.accord_diffusion_photos_le) {
    return texte('Galerie non exportable : notez d’abord l’accord du client pour la diffusion des photos.', 403);
  }
  let requete = sb.from('photos').select('id, moment, legende, prise_le, chemin, piece_id, pieces(nom)').eq('chantier_id', id.data)
    .order('prise_le').order('id').limit((quoi.data === 'tout' ? MAX_TOUTES : MAX_GALERIE) + 1);
  if (quoi.data === 'galerie') requete = requete.eq('en_galerie', true);
  const { data: photos, error } = await requete;
  if (error) return texte('Photos illisibles : réessayez.', 500);
  const max = quoi.data === 'tout' ? MAX_TOUTES : MAX_GALERIE;
  if (photos.length > max) return texte(`Trop de photos pour un seul export (${max} au maximum).`, 413);
  const octetsDe = async (photoId: string) => {
    const ph = photos.find((x) => x.id === photoId);
    return ph ? lire('photos', session.organisationId, ph.chemin) : null;
  };
  const entete = { 'Cache-Control': 'private, no-store' };

  if (quoi.data === 'galerie') {
    const { groupes } = pairesAvantApres(photos.map((x) => ({ id: x.id, moment: x.moment, pieceId: x.piece_id, piece: x.pieces?.nom ?? null, legende: x.legende, priseLe: x.prise_le })));
    if (format.data === 'pdf') {
      const pdf = await pdfGalerie({ entreprise: p?.raison_sociale ?? '', titre: 'Réalisation : avant / après' }, groupes, octetsDe);
      return new Response(Buffer.from(pdf), { headers: { ...entete, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="galerie-avant-apres.pdf"' } });
    }
    const prevus = groupes.flatMap((g) => g.paires.flatMap((paire, i) => ([['avant', paire.avant], ['apres', paire.apres]] as const)
      .flatMap(([cote, ph]) => (ph ? [{ id: ph.id, nom: `${nomFichierSur(g.titre)}-${i + 1}-${cote}.jpg` }] : []))));
    const octets = await lireParLots(prevus, (x) => octetsDe(x.id));
    const fichiers = prevus.flatMap((x, i) => (octets[i] ? [{ nom: x.nom, contenu: octets[i] }] : []));
    return new Response(zip(fichiers), { headers: { ...entete, 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="galerie-avant-apres.zip"' } });
  }

  const fichiers: { nom: string; contenu: Uint8Array }[] = [];
  const rangs = new Map<string, number>();
  const octets = await lireParLots(photos, (ph) => lire('photos', session.organisationId, ph.chemin));
  for (const [i, ph] of photos.entries()) {
    const o = octets[i];
    if (!o) continue;
    const dossier = nomFichierSur(LIBELLES_MOMENT[ph.moment as keyof typeof LIBELLES_MOMENT] ?? 'Autre');
    const base = nomFichierSur(ph.pieces?.nom ?? 'chantier');
    const cle = `${dossier}/${base}`;
    rangs.set(cle, (rangs.get(cle) ?? 0) + 1);
    fichiers.push({ nom: `${cle}-${rangs.get(cle)}.jpg`, contenu: o });
  }
  return new Response(zip(fichiers), { headers: { ...entete, 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="photos-chantier.zip"' } });
}
