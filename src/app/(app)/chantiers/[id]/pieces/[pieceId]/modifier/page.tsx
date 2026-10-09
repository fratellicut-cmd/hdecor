import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { FormulairePiece } from '@/components/chantiers/FormulairePiece';

export const metadata: Metadata = { title: 'Modifier la pièce' };

export default async function PageModifierPiece({ params }: PageProps<'/chantiers/[id]/pieces/[pieceId]/modifier'>) {
  await verifierSession();
  const p = await params;
  const id = z.uuid().safeParse(p.id);
  const pieceId = z.uuid().safeParse(p.pieceId);
  if (!id.success || !pieceId.success) notFound();
  const supabase = await clientServeur();
  const { data: piece, error } = await supabase.from('pieces').select('*').eq('id', pieceId.data).eq('chantier_id', id.data).maybeSingle();
  if (error) throw new Error('Lecture impossible : pièce.');
  if (!piece) notFound();
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href={`/chantiers/${id.data}/pieces/${piece.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {piece.nom}</Link>
        <h1 className="text-2xl font-bold">Modifier la pièce</h1>
      </div>
      <FormulairePiece chantierId={id.data} piece={piece} />
    </>
  );
}
