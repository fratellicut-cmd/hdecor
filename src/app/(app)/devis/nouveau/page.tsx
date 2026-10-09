import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { FormulaireNouveauDevis } from '@/components/devis/Formulaires';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Nouveau devis' };

export default async function PageNouveauDevis({ searchParams }: PageProps<'/devis/nouveau'>) {
  await verifierSession();
  const sp = await searchParams;
  const chantierId = z.uuid().safeParse(sp.chantier);
  const supabase = await clientServeur();
  const { data: chantiers } = await supabase.from('v_chantiers').select('id, nom, ville, statut')
    .order('created_at', { ascending: false }).limit(300);
  const liste = (chantiers ?? []).filter((c) => c.statut !== 'termine' || c.id === (chantierId.success ? chantierId.data : null))
    .map((c) => ({ id: c.id!, libelle: [c.nom, c.ville].filter(Boolean).join(' · ') }));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/devis" className="inline-flex min-h-12 items-center underline underline-offset-4">← Devis</Link>
      <h1 className="text-2xl font-bold">Nouveau devis</h1>
      {liste.length ? (
        <FormulaireNouveauDevis chantiers={liste} chantierId={chantierId.success ? chantierId.data : null} />
      ) : (
        <Message type="info">Créez d’abord un chantier : le devis en reprend le client, l’adresse des travaux et les postes de peinture.</Message>
      )}
    </div>
  );
}
