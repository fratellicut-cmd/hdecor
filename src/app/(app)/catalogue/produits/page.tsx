import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { TYPES } from '@/domain/catalogue';
import { formaterEuros } from '@/domain/formats';
import { formaterContenance } from '@/domain/peinture';
import { BadgeStatut } from '@/components/catalogue/BadgeStatut';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Produits' };

const FILTRES = { actifs: 'Au catalogue', a_verifier: 'À vérifier', archives: 'Archivés' } as const;
const LIMITE = 300;

export default async function PageProduits({ searchParams }: PageProps<'/catalogue/produits'>) {
  await verifierSession();
  const sp = await searchParams;
  const filtre = z.enum(['actifs', 'a_verifier', 'archives']).catch('actifs').parse(sp.filtre);
  const q = z.string().trim().max(100).catch('').parse(sp.q ?? '');
  const supabase = await clientServeur();
  let requete = supabase.from('produits')
    .select('id, marque, gamme, reference_fabricant, designation, type, unite_mesure, statut_verification, conditionnements (contenance, prix_achat_ht_cents, actif)')
    .eq('actif', filtre !== 'archives').order('marque').order('designation').limit(LIMITE);
  if (filtre === 'a_verifier') requete = requete.neq('statut_verification', 'verifie');
  if (q) {
    // Recherche sur marque, désignation, référence et gamme (caractères spéciaux de PostgREST neutralisés).
    const motif = `%${q.replace(/[%_\\,()*"]/g, ' ')}%`;
    requete = requete.or(['marque', 'designation', 'reference_fabricant', 'gamme'].map((c) => `${c}.ilike.${motif}`).join(','));
  }
  const { data, error } = await requete;
  const lien = (f: string) => `/catalogue/produits?${new URLSearchParams({ ...(f !== 'actifs' ? { filtre: f } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div className="flex flex-col gap-4">
      <Link href="/catalogue" className="inline-flex min-h-12 items-center underline underline-offset-4">← Catalogue</Link>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Produits</h1>
        <Link href="/catalogue/produits/nouveau" className="inline-flex min-h-12 items-center rounded-xl bg-anthracite px-5 font-semibold text-creme">+ Nouveau</Link>
      </div>
      <form role="search" className="flex gap-2">
        {filtre !== 'actifs' ? <input type="hidden" name="filtre" value={filtre} /> : null}
        <label htmlFor="recherche-produit" className="sr-only">Rechercher un produit</label>
        <input id="recherche-produit" name="q" type="search" defaultValue={q} placeholder="Marque, désignation, référence…"
          className="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-trait bg-white px-3 text-base" />
        <button type="submit" className="min-h-12 rounded-xl border-2 border-anthracite bg-white px-4 font-semibold">Chercher</button>
      </form>
      <nav aria-label="Filtres" className="flex flex-wrap gap-2">
        {Object.entries(FILTRES).map(([k, l]) => (
          <Link key={k} href={lien(k)} aria-current={filtre === k ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 font-semibold ${filtre === k ? 'border-anthracite bg-anthracite text-creme' : 'border-trait bg-white'}`}>
            {l}
          </Link>
        ))}
      </nav>
      {error ? <Message type="erreur">La liste n’a pas pu être chargée. Rechargez la page.</Message> : null}
      {!error && !data?.length ? <p className="rounded-xl border border-trait bg-white p-4 text-encre-douce">Aucun produit{q ? ` pour « ${q} »` : ''}.</p> : null}
      {data?.length === LIMITE ? <Message type="info">Les {LIMITE} premiers produits sont affichés : affinez la recherche.</Message> : null}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((p) => {
          const formats = p.conditionnements.filter((c) => c.actif).sort((a, b) => a.contenance - b.contenance);
          const unite = p.unite_mesure === 'kg' ? 'kg' : 'L';
          return (
            <li key={p.id}>
              <Link href={`/catalogue/produits/${p.id}`} className="flex min-h-16 flex-col justify-center gap-1 rounded-xl border border-trait bg-white px-4 py-2">
                <span className="flex flex-wrap items-center gap-2 font-semibold">{[p.marque, p.gamme, p.designation].filter(Boolean).join(' ')} <BadgeStatut statut={p.statut_verification} /></span>
                <span className="text-sm text-encre-douce">
                  {[TYPES.find((t) => t.code === p.type)?.libelle, p.reference_fabricant ? `réf. ${p.reference_fabricant}` : null,
                    formats.length ? formats.map((f) => `${formaterContenance(f.contenance, unite)} ${f.prix_achat_ht_cents === null ? '(prix ?)' : formaterEuros(f.prix_achat_ht_cents)}`).join(' · ') : 'aucun format']
                    .filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
