import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { FINITIONS, TYPES, USAGES } from '@/domain/catalogue';
import { formaterDate, formaterEuros, montantVersSaisie } from '@/domain/formats';
import { formaterContenance } from '@/domain/peinture';
import { actionFormat, actionProduit } from '../../actions';
import { BadgeStatut } from '@/components/catalogue/BadgeStatut';
import { FormulaireAjoutFormat, FormulairePrixFormat } from '@/components/catalogue/Formulaires';
import { ActionConfirmee } from '@/components/formulaire/ActionConfirmee';
import { EffacerBrouillon } from '@/components/formulaire/EffacerBrouillon';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Produit' };

export default async function PageProduit({ params, searchParams }: PageProps<'/catalogue/produits/[id]'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const supabase = await clientServeur();
  const { data: p } = await supabase.from('produits').select('*, conditionnements (id, contenance, prix_achat_ht_cents, actif)').eq('id', id.data).maybeSingle();
  if (!p) notFound();
  const ids = p.conditionnements.map((c) => c.id);
  const [historique, alertes] = await Promise.all([
    ids.length ? supabase.from('historique_prix').select('conditionnement_id, prix_achat_ht_cents, date_effet, created_at').in('conditionnement_id', ids)
      .order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    supabase.from('v_alertes_prix').select('devis_id, numero, contenance, prix_achat_retenu_cents, prix_actuel_cents').eq('produit_id', p.id),
  ]);
  const unite = p.unite_mesure === 'kg' ? 'kg' : 'L';
  const formats = [...p.conditionnements].sort((a, b) => a.contenance - b.contenance);
  const contenanceDe = new Map(formats.map((c) => [c.id, c.contenance]));
  const num = (v: number | null, u: string) => (v === null ? 'non renseigné' : `${String(v).replace('.', ',')} ${u}`);
  const details: [string, string][] = [
    ['Type', TYPES.find((t) => t.code === p.type)?.libelle ?? p.type],
    ['Usages', p.usages.map((u) => USAGES.find((x) => x.code === u)?.libelle ?? u).join(', ') || 'non renseignés'],
    ['Finition', p.finition && (FINITIONS as readonly string[]).includes(p.finition) ? p.finition : 'non précisée'],
    ['Rendement', num(p.rendement_m2_par_unite, unite === 'kg' ? 'm²/kg par passe' : 'm²/L par couche')],
    ['Couches recommandées', p.couches_recommandees === null ? 'non renseigné' : String(p.couches_recommandees)],
    ['Séchage avant recouvrement', num(p.sechage_recouvrable_h, 'h')],
    ['Fournisseur', p.fournisseur ?? 'non renseigné'],
  ];

  return (
    <div className="flex flex-col gap-4">
      {sp.enregistre === '1' ? <EffacerBrouillon cles={['produit:nouveau', `produit:${p.id}`]} /> : null}
      <Link href="/catalogue/produits" className="inline-flex min-h-12 items-center underline underline-offset-4">← Produits</Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{[p.marque, p.gamme, p.designation].filter(Boolean).join(' ')}</h1>
        <p className="flex flex-wrap items-center gap-2">
          {p.reference_fabricant ? <span>Réf. {p.reference_fabricant}</span> : <span className="text-encre-douce">Sans référence fabricant</span>}
          <BadgeStatut statut={p.statut_verification} />
          {!p.actif ? <span className="rounded-md border border-trait px-2 py-0.5 text-sm font-bold">ARCHIVÉ</span> : null}
        </p>
        {p.statut_verification === 'verifie' ? <p className="text-sm text-encre-douce">Vérifié le {formaterDate(p.verifie_le!)} ({p.source_verification}).</p> : null}
      </div>
      {sp.enregistre === '1' ? <Message type="succes">Produit enregistré.</Message> : null}
      {alertes.data?.length ? (
        <Message type="alerte">
          Prix changé depuis le chiffrage de {alertes.data.length} devis en cours :{' '}
          {alertes.data.map((a) => `${a.numero ?? 'brouillon'} (${formaterContenance(a.contenance!, unite)} : ${a.prix_achat_retenu_cents === null ? '?' : formaterEuros(a.prix_achat_retenu_cents)} → ${a.prix_actuel_cents === null ? '?' : formaterEuros(a.prix_actuel_cents)})`).join(' ; ')}.
        </Message>
      ) : null}

      <Carte titre="Caractéristiques" action={<Link href={`/catalogue/produits/${p.id}/modifier`} className="inline-flex min-h-12 items-center px-2 font-semibold underline underline-offset-4">Modifier</Link>}>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {details.map(([t, v]) => <div key={t}><dt className="text-sm text-encre-douce">{t}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
        {p.fiche_technique_url ? (
          <a href={p.fiche_technique_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-12 items-center font-semibold underline underline-offset-4">Fiche technique (lien externe)</a>
        ) : null}
      </Carte>

      <Carte titre="Formats et prix d’achat HT">
        {formats.length ? (
          <ul className="flex flex-col divide-y divide-trait">
            {formats.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {formaterContenance(c.contenance, unite)}{c.actif ? null : <span className="rounded-md border border-trait px-2 text-sm">archivé</span>}
                </p>
                {c.actif ? <FormulairePrixFormat id={c.id} libelle={`pot de ${formaterContenance(c.contenance, unite)}`} prix={montantVersSaisie(c.prix_achat_ht_cents)} /> : null}
                <ActionConfirmee action={actionFormat} champs={{ id: c.id, quoi: c.actif ? 'archiver' : 'reactiver' }}
                  libelle={c.actif ? 'Retirer ce format' : 'Remettre ce format'} variante="discret" />
              </li>
            ))}
          </ul>
        ) : <p className="text-encre-douce">Aucun format : le calcul utilisera les formats par défaut (prix inconnus).</p>}
        <details className="mt-3">
          <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold underline underline-offset-4">+ Ajouter un format</summary>
          <div className="mt-2"><FormulaireAjoutFormat produitId={p.id} unite={unite} /></div>
        </details>
      </Carte>

      <Carte titre="Historique des prix d’achat">
        {historique.data?.length ? (
          <ul className="flex flex-col gap-1 tabular-nums">
            {historique.data.map((h, i) => (
              <li key={`${h.conditionnement_id}-${h.created_at}-${i}`} className="flex flex-wrap justify-between gap-2">
                <span>{formaterDate(h.date_effet)} · {formaterContenance(contenanceDe.get(h.conditionnement_id) ?? 0, unite)}</span>
                <span className="font-semibold">{formaterEuros(h.prix_achat_ht_cents)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-encre-douce">Aucun prix enregistré.</p>}
      </Carte>

      <ActionConfirmee action={actionProduit} champs={{ id: p.id, quoi: p.actif ? 'archiver' : 'reactiver' }}
        libelle={p.actif ? 'Retirer du catalogue' : 'Remettre au catalogue'} variante={p.actif ? 'danger' : 'secondaire'}
        confirmation={p.actif ? 'Je confirme le retrait de ce produit (il reste dans les calculs et devis qui l’utilisent).' : undefined} />
    </div>
  );
}
