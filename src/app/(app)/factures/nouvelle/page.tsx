import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';
import { nomAffiche } from '@/domain/clients';
import { formaterEuros, pourcentageVersSaisie } from '@/domain/formats';
import { FormulaireNouvelleFacture, type DevisFacturable } from '@/components/factures/Formulaires';

export const metadata: Metadata = { title: 'Nouvelle facture' };

export default async function PageNouvelleFacture({ searchParams }: PageProps<'/factures/nouvelle'>) {
  await verifierSession();
  const sp = await searchParams;
  const devisId = z.uuid().safeParse(sp.devis);
  const type = z.enum(['acompte', 'situation', 'finale', 'libre']).safeParse(sp.type);
  const sb = await clientServeur();
  const [{ data: devis }, { data: clients }, { data: chantiers }] = await Promise.all([
    sb.from('devis').select('id, numero, version, objet, acompte_pct_bp, total_accepte_ttc_cents, regime_tva, copie_client')
      .eq('statut', 'accepte').order('accepte_le', { ascending: false }).limit(100),
    sb.from('clients').select('id, type, civilite, nom, prenom, raison_sociale, anonymise_le').is('anonymise_le', null).order('nom').limit(500),
    sb.from('chantiers').select('id, nom, ville, client_id').order('created_at', { ascending: false }).limit(500),
  ]);
  const ids = (devis ?? []).map((d) => d.id);
  const [{ data: echeances }, { data: factures }] = ids.length ? await Promise.all([
    sb.from('devis_echeances').select('devis_id, libelle, pourcentage_bp, ordre').in('devis_id', ids).order('ordre'),
    sb.from('factures').select('devis_id, type, statut, acompte_pct_bp').in('devis_id', ids).neq('statut', 'annulee'),
  ]) : [{ data: [] }, { data: [] }];

  const facturables: DevisFacturable[] = (devis ?? []).map((d) => {
    const fs = (factures ?? []).filter((f) => f.devis_id === d.id);
    const deja = fs.filter((f) => f.type === 'acompte').reduce((a, f) => a + (f.acompte_pct_bp ?? 0), 0);
    // Échéances proposées en acompte : toutes sauf le solde (qui fait l'objet de la facture finale).
    const propres = (echeances ?? []).filter((e) => e.devis_id === d.id);
    const liste = propres.length ? propres : [{ libelle: 'Acompte à la signature', pourcentage_bp: d.acompte_pct_bp, ordre: 1 }];
    let cumul = 0;
    const proposees = liste.flatMap((e) => {
      cumul += e.pourcentage_bp;
      return cumul >= 10_000 || e.pourcentage_bp <= 0 ? [] : [{ libelle: e.libelle, pourcentage_bp: e.pourcentage_bp, saisie: pourcentageVersSaisie(e.pourcentage_bp), facturee: deja >= cumul }];
    });
    const client = (d.copie_client as { nom_affiche?: string } | null)?.nom_affiche ?? '';
    return {
      id: d.id, echeances: proposees, dejaFacture: pourcentageVersSaisie(deja),
      finaleEmise: fs.some((f) => f.type === 'finale' && f.statut === 'emise'),
      libelle: `${d.numero}${d.version > 1 ? ` v${d.version}` : ''} · ${client}${d.objet ? ` · ${d.objet}` : ''} · ${formaterEuros(d.total_accepte_ttc_cents ?? 0)}`,
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/factures" className="inline-flex min-h-12 items-center underline underline-offset-4">← Factures</Link>
      <h1 className="text-2xl font-bold">Nouvelle facture</h1>
      <FormulaireNouvelleFacture devis={facturables} devisId={devisId.success ? devisId.data : null} type={type.success ? type.data : null}
        clients={(clients ?? []).map((c) => ({ id: c.id, libelle: nomAffiche(c) }))}
        chantiers={(chantiers ?? []).map((c) => ({ id: c.id, client_id: c.client_id, libelle: [c.nom, c.ville].filter(Boolean).join(' · ') }))} />
    </div>
  );
}
