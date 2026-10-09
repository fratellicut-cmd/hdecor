import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { marquesConnues } from '@/lib/catalogue';
import { FormulaireProduit } from '@/components/catalogue/FormulaireProduit';

export const metadata: Metadata = { title: 'Nouveau produit' };

export default async function PageNouveauProduit() {
  await verifierSession();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/catalogue/produits" className="inline-flex min-h-12 items-center underline underline-offset-4">← Produits</Link>
      <h1 className="text-2xl font-bold">Nouveau produit</h1>
      <FormulaireProduit marques={await marquesConnues()} produit={{
        marque: '', gamme: null, reference_fabricant: null, designation: '', type: '', usages: [], finition: null, unite_mesure: 'L',
        rendement_m2_par_unite: null, couches_recommandees: null, sechage_recouvrable_h: null, fournisseur: null, fiche_technique_url: null,
        statut_verification: 'a_verifier', verifie_le: null, source_verification: null,
      }} />
    </div>
  );
}
