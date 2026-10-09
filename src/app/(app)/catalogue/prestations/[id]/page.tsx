import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { tauxProposes } from '@/lib/taux';
import { montantVersSaisie } from '@/domain/formats';
import { FormulairePrestation } from '@/components/catalogue/Formulaires';

export const metadata: Metadata = { title: 'Modifier la prestation' };

export default async function PagePrestation({ params }: PageProps<'/catalogue/prestations/[id]'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const supabase = await clientServeur();
  const { data: p } = await supabase.from('prestations').select('*').eq('id', id.data).maybeSingle();
  if (!p) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/catalogue/prestations" className="inline-flex min-h-12 items-center underline underline-offset-4">← Prestations</Link>
      <h1 className="text-2xl font-bold">Modifier la prestation</h1>
      <FormulairePrestation taux={await tauxProposes()} prestation={{ ...p, prix: montantVersSaisie(p.prix_unitaire_ht_cents) }} />
    </div>
  );
}
