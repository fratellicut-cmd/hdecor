import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate, formaterDateHeure } from '@/domain/formats';
import { LIBELLES_MOMENT, MOMENTS_PHOTO } from '@/lib/validation/documents';
import { enregistrerAccordDiffusion, supprimerPhoto } from '../../documents-actions';
import { FormulaireModifierPhoto, FormulairePhotos } from '@/components/chantiers/Photos';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Photos du chantier' };

const bouton = 'inline-flex min-h-12 items-center justify-center rounded-xl px-4 text-center font-semibold';

export default async function PagePhotos({ params }: PageProps<'/chantiers/[id]/photos'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const [{ data: ch }, { data: photos, error }, { data: pieces }] = await Promise.all([
    sb.from('chantiers').select('id, nom, accord_diffusion_photos_le').eq('id', id.data).maybeSingle(),
    sb.from('photos').select('id, moment, piece_id, legende, en_galerie, prise_le').eq('chantier_id', id.data).order('prise_le').order('id').limit(500),
    sb.from('pieces').select('id, nom').eq('chantier_id', id.data).order('ordre').order('created_at'),
  ]);
  if (!ch) notFound();
  if (error) throw new Error('Lecture impossible : photos.');
  const lesPieces = (pieces ?? []).map((p) => ({ id: p.id, libelle: p.nom }));
  const nomPiece = (pid: string | null) => lesPieces.find((p) => p.id === pid)?.libelle ?? 'Tout le chantier';
  const enGalerie = photos.filter((p) => p.en_galerie).length;
  const accord = ch.accord_diffusion_photos_le;
  const exp = (quoi: string, format: string) => `/chantiers/${ch.id}/photos/export?quoi=${quoi}&format=${format}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${ch.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {ch.nom}</Link>
        <h1 className="text-2xl font-bold">Photos</h1>
      </div>

      <Carte titre="Ajouter des photos">
        <FormulairePhotos chantierId={ch.id} pieces={lesPieces} moment={photos.some((p) => p.moment === 'avant') ? 'apres' : 'avant'} />
        <p className="mt-2 text-sm text-encre-douce">Les photos sont réduites sur le téléphone ; leur position GPS et les informations de l’appareil sont retirées.</p>
      </Carte>

      {MOMENTS_PHOTO.map((m) => {
        const liste = photos.filter((p) => p.moment === m);
        if (!liste.length) return null;
        return (
          <section key={m} aria-label={`Photos ${LIBELLES_MOMENT[m]}`} className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">{LIBELLES_MOMENT[m]} ({liste.length})</h2>
            <ul className="grid grid-cols-2 gap-2">
              {liste.map((p) => (
                <li key={p.id} className="rounded-xl border border-trait bg-white p-2">
                  <a href={`/chantiers/${ch.id}/photos/${p.id}`} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element -- photo privée servie par une route protégée */}
                    <img src={`/chantiers/${ch.id}/photos/${p.id}`} alt={p.legende ?? `Photo ${LIBELLES_MOMENT[m].toLowerCase()}, ${nomPiece(p.piece_id)}`}
                      loading="lazy" className="aspect-[4/3] w-full rounded-lg object-cover" />
                  </a>
                  <p className="mt-1 text-sm font-semibold">{nomPiece(p.piece_id)}{p.en_galerie ? ' · ★ galerie' : ''}</p>
                  {p.legende ? <p className="text-sm break-words">{p.legende}</p> : null}
                  <p className="text-xs text-encre-douce">{formaterDateHeure(p.prise_le)}</p>
                  <details>
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">Modifier</summary>
                    <div className="mt-2 flex flex-col gap-3">
                      <FormulaireModifierPhoto pieces={lesPieces}
                        photo={{ id: p.id, moment: p.moment, piece_id: p.piece_id ?? '', legende: p.legende ?? '', en_galerie: p.en_galerie }} />
                      <ActionConfirmee action={supprimerPhoto} champs={{ id: p.id }} libelle="Supprimer" variante="danger" confirmation="Je supprime cette photo" />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!photos.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucune photo. Commencez par les photos « avant ».</p> : null}

      <Carte titre="Galerie avant / après">
        <p>{enGalerie} photo{enGalerie > 1 ? 's' : ''} retenue{enGalerie > 1 ? 's' : ''} (« Modifier », puis « Dans la galerie »).</p>
        {accord ? (
          <>
            <p className="mt-2 text-sm">Accord du client pour la diffusion noté le {formaterDate(new Date(accord))}.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={exp('galerie', 'pdf')} className={`${bouton} bg-anthracite text-creme`}>Galerie (PDF)</a>
              <a href={exp('galerie', 'zip')} className={`${bouton} border-2 border-anthracite bg-white`}>Galerie (photos)</a>
            </div>
            <p className="mt-2 text-sm text-encre-douce">Sans nom ni adresse du client. Vérifiez qu’aucune photo ne montre un visage, une plaque ou un numéro de rue avant de publier.</p>
            <div className="mt-2"><ActionConfirmee action={enregistrerAccordDiffusion} champs={{ chantier_id: ch.id, accord: 'non' }} libelle="Retirer l’accord" variante="discret" /></div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm">Pour publier ces photos (portfolio, réseaux sociaux), il faut l’accord du client.</p>
            <div className="mt-2">
              <ActionConfirmee action={enregistrerAccordDiffusion} champs={{ chantier_id: ch.id, accord: 'oui' }} libelle="Noter l’accord du client"
                confirmation="Le client accepte que les photos de ses travaux soient diffusées, sans son nom ni son adresse." />
            </div>
          </>
        )}
      </Carte>

      {photos.length ? <a href={exp('tout', 'zip')} className={`${bouton} border-2 border-anthracite bg-white`}>Télécharger toutes les photos (archive)</a> : null}
    </div>
  );
}
