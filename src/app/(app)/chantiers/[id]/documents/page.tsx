import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate } from '@/domain/formats';
import { LIBELLES_DOCUMENT, TYPES_DOCUMENT } from '@/lib/validation/documents';
import { supprimerDocument } from '../../documents-actions';
import { FormulaireDocument } from '@/components/chantiers/Photos';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Documents du chantier' };

export default async function PageDocuments({ params }: PageProps<'/chantiers/[id]/documents'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const [{ data: ch }, { data: docs, error }] = await Promise.all([
    sb.from('chantiers').select('id, nom').eq('id', id.data).maybeSingle(),
    sb.from('documents_chantier').select('id, type, nom, created_at').eq('chantier_id', id.data).order('created_at', { ascending: false }).limit(300),
  ]);
  if (!ch) notFound();
  if (error) throw new Error('Lecture impossible : documents.');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/chantiers/${ch.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {ch.nom}</Link>
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="text-encre-douce">Fiches techniques, attestations, assurances, plans.</p>
      </div>
      <Carte titre="Ajouter un document"><FormulaireDocument chantierId={ch.id} /></Carte>
      {TYPES_DOCUMENT.map((t) => {
        const liste = docs.filter((d) => d.type === t);
        if (!liste.length) return null;
        return (
          <Carte key={t} titre={LIBELLES_DOCUMENT[t]}>
            <ul className="flex flex-col divide-y divide-trait">
              {liste.map((d) => (
                <li key={d.id} className="flex flex-col gap-1 py-2">
                  <a href={`/chantiers/${ch.id}/documents/${d.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 break-words">{d.nom}</a>
                  <span className="text-sm text-encre-douce">Ajouté le {formaterDate(new Date(d.created_at))}</span>
                  <ActionConfirmee action={supprimerDocument} champs={{ id: d.id }} libelle="Supprimer" variante="discret" confirmation="Je supprime ce document" />
                </li>
              ))}
            </ul>
          </Carte>
        );
      })}
      {!docs.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun document.</p> : null}
    </div>
  );
}
