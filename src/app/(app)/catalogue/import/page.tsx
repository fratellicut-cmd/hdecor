import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { COLONNES } from '@/domain/catalogue';
import { ImportCatalogue } from '@/components/catalogue/Formulaires';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Importer ou exporter le catalogue' };

export default async function PageImport() {
  await verifierSession();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/catalogue" className="inline-flex min-h-12 items-center underline underline-offset-4">← Catalogue</Link>
      <h1 className="text-2xl font-bold">Importer ou exporter</h1>
      <Carte titre="Exporter">
        <div className="flex flex-col gap-2">
          <a href="/catalogue/export" download className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Exporter les produits (CSV)</a>
          <a href="/catalogue/modele" download className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Télécharger le modèle vide</a>
          <p className="text-sm text-encre-douce">L’export a le même format que le modèle : il se modifie dans Excel et se réimporte.</p>
        </div>
      </Carte>
      <Carte titre="Importer">
        <details className="mb-3 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold underline underline-offset-4">Comment remplir le fichier</summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>Une ligne par produit. Colonnes : {COLONNES.map((c) => c.titre).join(', ')}. Obligatoires : Marque, Désignation, Type.</li>
            <li>Plusieurs formats dans une cellule, séparés par « / » : « 2,5 / 10 », et les prix dans le même ordre : « 32,50 / 115,00 ». Un prix vide garde le prix actuel.</li>
            <li>Usages séparés par des virgules : « mur, plafond ». Finition : mat, velours, satin ou brillant.</li>
            <li>Un produit déjà présent (même marque et même référence, ou même désignation sans référence) est mis à jour, sans doublon.</li>
            <li>Exemple de ligne (FICTIVE) : Marque « Exemple », Référence « EX-1 », Désignation « Acrylique mat », Type « Acrylique », Formats « 2,5 / 10 ».</li>
          </ul>
        </details>
        <ImportCatalogue />
      </Carte>
    </div>
  );
}
