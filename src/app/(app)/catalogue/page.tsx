import type { Metadata } from 'next';
import Link from 'next/link';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { formaterEuros } from '@/domain/formats';
import { formaterContenance } from '@/domain/peinture';
import { Carte } from '@/components/ui/Carte';
import { Message } from '@/components/ui/Message';

export const metadata: Metadata = { title: 'Catalogue' };

export default async function PageCatalogue() {
  await verifierSession();
  const supabase = await clientServeur();
  const compter = (table: 'produits' | 'teintes' | 'prestations') => supabase.from(table).select('id', { count: 'exact', head: true }).eq('actif', true);
  const [produits, aVerifier, fictifs, teintes, prestations, alertes] = await Promise.all([
    compter('produits'),
    supabase.from('produits').select('id', { count: 'exact', head: true }).eq('actif', true).eq('statut_verification', 'a_verifier'),
    supabase.from('produits').select('id', { count: 'exact', head: true }).eq('actif', true).eq('statut_verification', 'fictif'),
    compter('teintes'),
    compter('prestations'),
    supabase.from('v_alertes_prix').select('*').order('numero').limit(50),
  ]);

  const sections = [
    { href: '/catalogue/produits', titre: 'Produits', detail: `${produits.count ?? 0} produit(s)${aVerifier.count ? ` · ${aVerifier.count} À VÉRIFIER` : ''}${fictifs.count ? ` · ${fictifs.count} exemple(s) fictif(s)` : ''}` },
    { href: '/catalogue/teintes', titre: 'Nuancier', detail: `${teintes.count ?? 0} teinte(s)` },
    { href: '/catalogue/prestations', titre: 'Prestations', detail: `${prestations.count ?? 0} prestation(s) réutilisable(s) dans les devis` },
    { href: '/catalogue/import', titre: 'Importer ou exporter (tableur)', detail: 'Fichier CSV : modèle, contrôle ligne par ligne, aperçu' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Catalogue</h1>
      {fictifs.count ? (
        <Message type="alerte">Le catalogue contient des exemples FICTIFS (sans référence ni prix) : remplacez-les par vos vrais produits ou archivez-les.</Message>
      ) : null}
      {alertes.data?.length ? (
        <Carte titre="Prix d’achat changés sur des devis en cours">
          <ul className="flex flex-col gap-2 text-sm">
            {alertes.data.map((a) => (
              <li key={`${a.devis_id}-${a.conditionnement_id}`} className="rounded-lg bg-alerte-fond px-3 py-2 font-semibold text-alerte">
                Devis {a.numero ?? '(brouillon)'} : {a.marque} {a.designation} ({formaterContenance(a.contenance!, a.unite_mesure === 'kg' ? 'kg' : 'L')}) chiffré à{' '}
                {a.prix_achat_retenu_cents === null ? 'prix inconnu' : formaterEuros(a.prix_achat_retenu_cents)}, prix actuel{' '}
                {a.prix_actuel_cents === null ? 'non renseigné' : formaterEuros(a.prix_actuel_cents)}.
              </li>
            ))}
          </ul>
        </Carte>
      ) : null}
      <ul className="flex flex-col gap-3">
        {sections.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="flex min-h-16 flex-col justify-center gap-1 rounded-2xl border border-trait bg-white px-4 py-3">
              <span className="text-lg font-bold">{s.titre}</span>
              <span className="text-encre-douce">{s.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-encre-douce">Rendements, temps et formats par type : Paramètres &gt; <Link href="/parametres/calcul" className="underline underline-offset-4">Réglages de calcul</Link>.</p>
    </div>
  );
}
