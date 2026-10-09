import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { chantiersPourAchat, chargerCategories, regimeTva } from '@/lib/comptabilite';
import { aujourdHuiParis } from '@/domain/dates';
import { FormulaireDepense } from '@/components/comptabilite/Formulaires';
import { FormulaireCategorie } from '@/components/comptabilite/Formulaires';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Nouvel achat' };

export default async function PageNouvelAchat({ searchParams }: PageProps<'/comptabilite/achats/nouveau'>) {
  const session = await verifierSession();
  const chantier = z.uuid().safeParse((await searchParams).chantier);
  const [regime, categories, chantiers] = await Promise.all([regimeTva(session.organisationId), chargerCategories(), chantiersPourAchat()]);
  const chantierId = chantier.success && chantiers.some((c) => c.id === chantier.data) ? chantier.data : '';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={chantierId ? `/chantiers/${chantierId}` : '/comptabilite/achats'} className="inline-flex min-h-12 items-center underline underline-offset-4">
          ← {chantierId ? 'Chantier' : 'Achats'}
        </Link>
        <h1 className="text-2xl font-bold">Nouvel achat</h1>
      </div>
      <Carte>
        <FormulaireDepense depuisChantier={chantierId || undefined} regime={regime} categories={categories} chantiers={chantiers} depense={{
          date_depense: aujourdHuiParis(), fournisseur: '', libelle: '', categorie_id: '', chantier_id: chantierId,
          montant_ttc_cents: '', tva_cents: '', mode_paiement: '', justificatif: false,
        }} />
      </Carte>
      <details className="rounded-xl border border-trait bg-white p-4">
        <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold">Ajouter une catégorie…</summary>
        <div className="mt-2"><FormulaireCategorie /></div>
      </details>
    </div>
  );
}
