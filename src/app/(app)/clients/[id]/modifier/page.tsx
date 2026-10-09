import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { nomAffiche } from '@/domain/clients';
import { FormulaireClient } from '@/components/clients/FormulaireClient';

export const metadata: Metadata = { title: 'Modifier le client' };

export default async function PageModifierClient({ params }: PageProps<'/clients/[id]/modifier'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await clientServeur();
  const { data: client } = await supabase.from('clients').select('*').eq('id', id.data).maybeSingle();
  if (!client || client.anonymise_le) notFound();
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href={`/clients/${client.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {nomAffiche(client)}</Link>
        <h1 className="text-2xl font-bold">Modifier le client</h1>
      </div>
      <FormulaireClient id={client.id} client={client} />
    </>
  );
}
