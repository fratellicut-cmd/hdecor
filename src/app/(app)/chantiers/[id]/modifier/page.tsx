import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { clientsPourChoix } from '@/lib/clients-liste';
import { FormulaireChantier } from '@/components/chantiers/FormulaireChantier';

export const metadata: Metadata = { title: 'Modifier le chantier' };

export default async function PageModifierChantier({ params }: PageProps<'/chantiers/[id]/modifier'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await clientServeur();
  const { data: chantier, error } = await supabase.from('chantiers').select('*').eq('id', id.data).maybeSingle();
  if (error) throw new Error('Lecture impossible : chantier.');
  if (!chantier) notFound();
  const clients = await clientsPourChoix();
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href={`/chantiers/${chantier.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {chantier.nom}</Link>
        <h1 className="text-2xl font-bold">Modifier le chantier</h1>
      </div>
      <FormulaireChantier chantier={chantier} clients={clients} />
    </>
  );
}
