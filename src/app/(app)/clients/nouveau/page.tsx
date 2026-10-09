import type { Metadata } from 'next';
import Link from 'next/link';
import { FormulaireClient } from '@/components/clients/FormulaireClient';

export const metadata: Metadata = { title: 'Nouveau client' };

export default function PageNouveauClient() {
  return (
    <>
      <div className="mb-4 flex flex-col gap-1">
        <Link href="/clients" className="inline-flex min-h-12 items-center underline underline-offset-4">← Clients</Link>
        <h1 className="text-2xl font-bold">Nouveau client</h1>
      </div>
      <FormulaireClient />
    </>
  );
}
