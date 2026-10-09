import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientsPourChoix } from '@/lib/clients-liste';
import { FormulaireChantier } from '@/components/chantiers/FormulaireChantier';

export const metadata: Metadata = { title: 'Nouveau chantier' };

export default async function PageNouveauChantier({ searchParams }: PageProps<'/chantiers/nouveau'>) {
  await verifierSession();
  const client = z.uuid().safeParse((await searchParams).client);
  const clients = await clientsPourChoix();
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href="/chantiers" className="inline-flex min-h-12 items-center underline underline-offset-4">← Chantiers</Link>
        <h1 className="text-2xl font-bold">Nouveau chantier</h1>
      </div>
      {clients.length === 0 ? (
        <p className="rounded-xl border border-trait bg-white p-4">
          Créez d’abord le client. <Link href="/clients/nouveau" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">Nouveau client</Link>
        </p>
      ) : (
        <FormulaireChantier clients={clients} chantier={{
          client_id: client.success ? client.data : '', nom: '', adresse_ligne1: null, adresse_ligne2: null, code_postal: null,
          ville: null, statut: 'a_planifier', date_debut_prevue: null, notes: null,
        }} />
      )}
    </>
  );
}
