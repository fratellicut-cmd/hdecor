import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { FormulaireTeinte } from '@/components/catalogue/Formulaires';

export const metadata: Metadata = { title: 'Modifier la teinte' };

export default async function PageTeinte({ params }: PageProps<'/catalogue/teintes/[id]'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await clientServeur();
  const { data: t } = await supabase.from('teintes').select('*').eq('id', id.data).maybeSingle();
  if (!t) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/catalogue/teintes" className="inline-flex min-h-12 items-center underline underline-offset-4">← Nuancier</Link>
      <h1 className="text-2xl font-bold">Modifier la teinte</h1>
      <FormulaireTeinte teinte={t} />
    </div>
  );
}
