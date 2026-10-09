import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterDate, formaterEuros, montantVersSaisie } from '@/domain/formats';
import { supprimerMateriel } from '../actions';
import { FormulaireMateriel } from '@/components/comptabilite/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { Carte } from '@/components/ui/Carte';

export const metadata: Metadata = { title: 'Matériel' };

export default async function PageMateriel() {
  await verifierSession();
  const sb = await clientServeur();
  const [{ data: materiel, error }, { data: achats, error: e2 }] = await Promise.all([
    sb.from('materiel').select('id, libelle, date_achat, valeur_cents, depense_id, notes').order('libelle').limit(1_000),
    // Achats rattachables : les 300 plus récents.
    sb.from('depenses').select('id, date_depense, fournisseur, montant_ttc_cents').order('date_depense', { ascending: false }).limit(300),
  ]);
  if (error || e2) throw new Error('Lecture impossible : matériel.');
  const options = achats.map((a) => ({ id: a.id, libelle: `${formaterDate(a.date_depense)} · ${a.fournisseur} · ${formaterEuros(a.montant_ttc_cents)}` }));
  const total = materiel.reduce((s, m) => s + BigInt(m.valeur_cents ?? 0), 0n);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link href="/comptabilite" className="inline-flex min-h-12 items-center underline underline-offset-4">← Comptabilité</Link>
        <h1 className="text-2xl font-bold">Matériel</h1>
        <p className="text-encre-douce">L’inventaire de vos outils et machines (assurance, garantie, revente).</p>
      </div>
      <Carte titre="Ajouter">
        <FormulaireMateriel achats={options} materiel={{ libelle: '', date_achat: '', valeur_cents: '', depense_id: '', notes: '' }} />
      </Carte>
      {materiel.length ? <p className="font-semibold tabular-nums">{materiel.length} élément{materiel.length > 1 ? 's' : ''} · valeur déclarée {formaterEuros(total)}</p> : null}
      <ul className="flex flex-col gap-2">
        {materiel.map((m) => (
          <li key={m.id} className="rounded-xl border border-trait bg-white px-4 py-2">
            <details>
              <summary className="flex min-h-12 cursor-pointer list-none flex-col justify-center">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">{m.libelle}</span>
                  {m.valeur_cents !== null ? <span className="tabular-nums">{formaterEuros(m.valeur_cents)}</span> : null}
                </span>
                <span className="text-sm text-encre-douce">{[m.date_achat ? `acheté le ${formaterDate(m.date_achat)}` : null, m.notes].filter(Boolean).join(' · ') || 'Toucher pour modifier'}</span>
              </summary>
              <div className="mt-3 flex flex-col gap-3 border-t border-trait pt-3">
                <FormulaireMateriel achats={options} materiel={{
                  id: m.id, libelle: m.libelle, date_achat: m.date_achat ?? '', valeur_cents: m.valeur_cents === null ? '' : montantVersSaisie(m.valeur_cents),
                  depense_id: m.depense_id ?? '', notes: m.notes ?? '',
                }} />
                {m.depense_id ? <Link href={`/comptabilite/achats/${m.depense_id}`} className="inline-flex min-h-12 items-center underline underline-offset-4">Voir l’achat et son justificatif</Link> : null}
                <ActionConfirmee action={supprimerMateriel} champs={{ id: m.id }} libelle="Retirer de l’inventaire" variante="danger" confirmation="Je confirme le retrait de ce matériel." />
              </div>
            </details>
          </li>
        ))}
      </ul>
      {!materiel.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun matériel noté.</p> : null}
    </div>
  );
}
