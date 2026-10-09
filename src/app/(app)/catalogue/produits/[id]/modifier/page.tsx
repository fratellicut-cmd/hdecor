import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { marquesConnues } from '@/lib/catalogue';
import { clientServeur } from '@/lib/supabase/serveur';
import { FormulaireProduit } from '@/components/catalogue/FormulaireProduit';

export const metadata: Metadata = { title: 'Modifier le produit' };

export default async function PageModifierProduit({ params }: PageProps<'/catalogue/produits/[id]/modifier'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await clientServeur();
  const { data: p } = await supabase.from('produits').select('*').eq('id', id.data).maybeSingle();
  if (!p) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/catalogue/produits/${p.id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← {p.designation}</Link>
      <h1 className="text-2xl font-bold">Modifier le produit</h1>
      <FormulaireProduit marques={await marquesConnues()} produit={p} />
    </div>
  );
}
