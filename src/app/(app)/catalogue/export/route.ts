import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { exporterProduits } from '@/domain/catalogue';
import { aujourdHuiParis } from '@/domain/dates';

const PAQUET = 1000;
const echec = () => new Response('L’export a échoué. Réessayez.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** Export des produits au catalogue (formats en vente), réimportable tel quel. */
export async function GET() {
  await verifierSession();
  const supabase = await clientServeur();
  const produits = [];
  for (let debut = 0; ; debut += PAQUET) {
    const { data, error } = await supabase.from('produits').select('*, conditionnements (contenance, prix_achat_ht_cents, actif)')
      .eq('actif', true).order('marque').order('designation').order('id').range(debut, debut + PAQUET - 1);
    if (error) return echec();
    produits.push(...data.map((p) => ({ ...p, formats: p.conditionnements.filter((c) => c.actif) })));
    if (data.length < PAQUET) break;
  }
  return new Response(exporterProduits(produits), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="catalogue-${aujourdHuiParis()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
