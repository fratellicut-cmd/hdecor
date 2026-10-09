import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { libelleElement, surfacesDe } from '@/lib/chantiers';
import { formaterSurface, surfaceElementMm2 } from '@/domain/metre';
import { longueurVersSaisie, quantiteVersSaisie, surfaceVersSaisie } from '@/domain/saisie';
import { retirerLigne, supprimerPiece } from '../../../actions';
import { DetailCalcul } from '@/components/chantiers/DetailCalcul';
import { FormulaireDuplication, FormulaireElement, FormulaireOuverture } from '@/components/chantiers/FormulairesPiece';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Pièce' };

const OUVERTURES: Record<string, string> = { porte: 'Porte', fenetre: 'Fenêtre', baie: 'Baie vitrée', autre: 'Ouverture' };
const UNITES: Record<string, string> = { ml: 'm', m2: 'm²', u: 'u' };

export default async function PagePiece({ params, searchParams }: PageProps<'/chantiers/[id]/pieces/[pieceId]'>) {
  const session = await verifierSession();
  const p = await params;
  const id = z.uuid().safeParse(p.id);
  const pieceId = z.uuid().safeParse(p.pieceId);
  if (!id.success || !pieceId.success) notFound();
  const sp = await searchParams;
  const supabase = await clientServeur();
  const [{ data: piece, error }, ouv, els, param, nbPostes] = await Promise.all([
    supabase.from('pieces').select('*, chantiers(nom)').eq('id', pieceId.data).eq('chantier_id', id.data).maybeSingle(),
    supabase.from('ouvertures').select('*').eq('piece_id', pieceId.data),
    supabase.from('elements').select('*').eq('piece_id', pieceId.data),
    supabase.from('parametres_entreprise').select('porte_largeur_mm, porte_hauteur_mm').eq('organisation_id', session.organisationId).single(),
    supabase.from('postes_travaux').select('id', { count: 'exact', head: true }).eq('piece_id', pieceId.data),
  ]);
  if (error || ouv.error || els.error || param.error) throw new Error('Lecture impossible : pièce.');
  if (!piece) notFound();
  const { surfaces, erreur } = surfacesDe(piece, ouv.data);
  const chantierNom = (piece.chantiers as { nom: string } | null)?.nom ?? 'Chantier';

  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={[`piece:nouvelle:${id.data}`, `piece:${piece.id}`]} /> : null}
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${id.data}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {chantierNom}</Link>
        <h1 className="text-2xl font-bold break-words">{piece.nom}{piece.multiplicateur > 1 ? ` × ${piece.multiplicateur}` : ''}</h1>
        <p className="text-encre-douce">
          {piece.mode_saisie === 'rectangle'
            ? `${longueurVersSaisie(piece.longueur_mm, 'm')} × ${longueurVersSaisie(piece.largeur_mm, 'm')} m`
            : `${piece.murs_mm?.length ?? 0} murs`}, hauteur {longueurVersSaisie(piece.hauteur_mm, 'm')} m
          {piece.etage ? ` · ${piece.etage}` : ''}
        </p>
      </div>
      {sp.enregistre === '1' ? <Message type="succes">Pièce enregistrée.</Message> : null}

      <Carte titre="Surfaces" action={<Link href={`/chantiers/${id.data}/pieces/${piece.id}/modifier`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>}>
        {erreur ? <Message type="erreur">{erreur}</Message> : surfaces ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-3 tabular-nums">
              <div><dt className="text-sm text-encre-douce">Murs nets{piece.multiplicateur > 1 ? ` (× ${piece.multiplicateur})` : ''}</dt><dd className="text-xl font-bold">{formaterSurface(surfaces.totalMursMm2)}</dd></div>
              <div><dt className="text-sm text-encre-douce">Plafond{piece.multiplicateur > 1 ? ` (× ${piece.multiplicateur})` : ''}</dt><dd className="text-xl font-bold">{surfaces.totalPlafondMm2 === null ? 'à compléter' : formaterSurface(surfaces.totalPlafondMm2)}</dd></div>
            </dl>
            {surfaces.alertes.map((a) => <Message key={a} type="alerte">{a}</Message>)}
            <DetailCalcul lignes={surfaces.detail} />
          </div>
        ) : null}
      </Carte>

      <Carte titre="Ouvertures à déduire">
        {ouv.data.length ? (
          <ul className="mb-3 flex flex-col divide-y divide-trait">
            {ouv.data.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {OUVERTURES[o.type]}{o.quantite > 1 ? ` × ${o.quantite}` : ''} :{' '}
                  {o.surface_directe_mm2 ? `${surfaceVersSaisie(o.surface_directe_mm2)} m²` : `${longueurVersSaisie(o.largeur_mm, 'cm')} × ${longueurVersSaisie(o.hauteur_mm, 'cm')} cm`}
                </span>
                <ActionConfirmee action={retirerLigne} champs={{ id: o.id, piece_id: piece.id, table: 'ouvertures' }} libelle="Retirer" variante="discret" />
              </li>
            ))}
          </ul>
        ) : <p className="mb-3 text-encre-douce">Aucune ouverture.</p>}
        <details>
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">+ Ajouter une ouverture</summary>
          <div className="mt-2">
            <FormulaireOuverture pieceId={piece.id} porte={{
              largeurCm: longueurVersSaisie(param.data.porte_largeur_mm, 'cm'), hauteurCm: longueurVersSaisie(param.data.porte_hauteur_mm, 'cm'),
            }} />
          </div>
        </details>
      </Carte>

      <Carte titre="Éléments (plinthes, portes, radiateurs…)">
        {els.data.length ? (
          <ul className="mb-3 flex flex-col divide-y divide-trait">
            {els.data.map((el) => {
              const s = surfaceElementMm2({ type: el.type, unite: el.unite as 'ml', quantiteE4: el.quantite_e4, faces: el.faces, developpeMm: el.developpe_mm, surfaceUnitaireMm2: el.surface_unitaire_mm2 });
              return (
                <li key={el.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex min-w-0 flex-col">
                    <span>{libelleElement(el.type).replace(/^./, (c) => c.toUpperCase())} : {quantiteVersSaisie(el.quantite_e4)} {UNITES[el.unite]}{el.faces > 1 ? ', 2 faces' : ''}</span>
                    <span className="text-sm text-encre-douce">{'mm2' in s ? `À peindre : ${formaterSurface(s.mm2)}` : s.manque}</span>
                  </span>
                  <ActionConfirmee action={retirerLigne} champs={{ id: el.id, piece_id: piece.id, table: 'elements' }} libelle="Retirer" variante="discret" />
                </li>
              );
            })}
          </ul>
        ) : <p className="mb-3 text-encre-douce">Aucun élément.</p>}
        <details>
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">+ Ajouter un élément</summary>
          <div className="mt-2"><FormulaireElement pieceId={piece.id} /></div>
        </details>
      </Carte>

      <Link href={`/chantiers/${id.data}/peinture/nouveau?piece=${piece.id}`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-anthracite px-4 font-semibold text-creme">
        Peinture de cette pièce{nbPostes.count ? ` (${nbPostes.count} poste${nbPostes.count > 1 ? 's' : ''})` : ''}
      </Link>

      <Carte titre="Autres actions">
        <div className="flex flex-col gap-4">
          <details>
            <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">Dupliquer la pièce…</summary>
            <div className="mt-2"><FormulaireDuplication pieceId={piece.id} chantierId={id.data} nom={piece.nom} /></div>
          </details>
          <ActionConfirmee action={supprimerPiece} champs={{ id: piece.id, chantier_id: id.data }} libelle="Supprimer la pièce" variante="danger"
            confirmation="Je confirme la suppression de la pièce, de ses ouvertures, éléments et postes de peinture." />
        </div>
      </Carte>
    </div>
  );
}
