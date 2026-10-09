import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { chantiersPourAchat, chargerCategories, regimeTva } from '@/lib/comptabilite';
import { montantVersSaisie } from '@/domain/formats';
import { supprimerDepense } from '../../actions';
import { FormulaireDepense } from '@/components/comptabilite/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Achat' };

export default async function PageAchat({ params }: PageProps<'/comptabilite/achats/[id]'>) {
  const session = await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sb = await clientServeur();
  const { data: d, error } = await sb.from('depenses')
    .select('id, date_depense, fournisseur, libelle, categorie_id, chantier_id, montant_ttc_cents, tva_cents, mode_paiement, justificatif_chemin')
    .eq('id', id.data).maybeSingle();
  if (error) throw new Error('Lecture impossible : achat.');
  if (!d) notFound();
  const [regime, categories, chantiers, { data: materiel }] = await Promise.all([
    regimeTva(session.organisationId), chargerCategories(), chantiersPourAchat(),
    sb.from('materiel').select('id, libelle').eq('depense_id', d.id).limit(20),
  ]);
  const pdf = d.justificatif_chemin?.endsWith('.pdf');
  const lien = `/comptabilite/justificatif/${d.id}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href={`/comptabilite/achats?mois=${d.date_depense.slice(0, 7)}`} className="inline-flex min-h-12 items-center underline underline-offset-4">← Achats</Link>
        <h1 className="text-2xl font-bold break-words">{d.fournisseur}</h1>
      </div>
      <Carte titre="Justificatif">
        {!d.justificatif_chemin ? <p className="font-semibold text-danger">Aucun justificatif : ajoutez la photo du ticket ci-dessous.</p>
          : pdf ? <a href={lien} target="_blank" rel="noopener" className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4">Ouvrir le PDF</a>
            : (
              <a href={lien} target="_blank" rel="noopener" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- fichier privé servi par une route protégée, pas d'optimisation d'image */}
                <img src={lien} alt={`Justificatif de l’achat chez ${d.fournisseur}`} className="max-h-96 w-full rounded-lg border border-trait object-contain" />
              </a>
            )}
      </Carte>
      <Carte titre="Détail">
        <FormulaireDepense regime={regime} categories={categories} chantiers={chantiers} depense={{
          id: d.id, date_depense: d.date_depense, fournisseur: d.fournisseur, libelle: d.libelle ?? '', categorie_id: d.categorie_id ?? '',
          chantier_id: d.chantier_id ?? '', montant_ttc_cents: montantVersSaisie(d.montant_ttc_cents), tva_cents: montantVersSaisie(d.tva_cents),
          mode_paiement: d.mode_paiement ?? '', justificatif: d.justificatif_chemin !== null,
        }} />
      </Carte>
      {materiel?.length ? (
        <p className="text-sm">Rattaché au matériel : {materiel.map((m) => m.libelle).join(', ')} (<Link href="/comptabilite/materiel" className="underline underline-offset-4">voir</Link>).</p>
      ) : null}
      <ActionConfirmee action={supprimerDepense} champs={{ id: d.id }} libelle="Supprimer cet achat" variante="danger"
        confirmation="Je confirme la suppression de cet achat et de son justificatif."
        explication="À réserver à une erreur de saisie : un achat réel doit rester dans le registre avec son justificatif." />
    </div>
  );
}
