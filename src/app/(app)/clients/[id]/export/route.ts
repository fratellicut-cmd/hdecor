import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Droit d'accès et à la portabilité (RGPD) : toutes les données d'un client,
 * dans un format lisible par machine (JSON). La RLS limite à l'organisation.
 */
export async function GET(_: Request, { params }: RouteContext<'/clients/[id]/export'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response('Client introuvable.', { status: 404 });
  const supabase = await clientServeur();
  const { data: client } = await supabase.from('clients')
    .select('type, civilite, nom, prenom, raison_sociale, siret, tva_intra, email, telephone, fact_ligne1, fact_ligne2, fact_code_postal, fact_ville, fact_pays, notes, source, consentement_le, anonymise_le, created_at, updated_at')
    .eq('id', id.data).maybeSingle();
  if (!client) return new Response('Client introuvable.', { status: 404 });

  const [chantiers, devis, factures] = await Promise.all([
    supabase.from('chantiers').select('nom, adresse_ligne1, adresse_ligne2, code_postal, ville, statut, date_debut_prevue, notes, created_at')
      .eq('client_id', id.data).order('created_at'),
    supabase.from('v_devis').select('numero, version, objet, statut_affiche, date_emission, valide_jusqu_au, total_ht_cents, total_tva_cents, total_ttc_cents, accepte_le, refuse_le')
      .eq('client_id', id.data).order('created_at'),
    supabase.from('v_factures').select('numero, type, statut_affiche, date_emission, date_echeance, total_ht_cents, total_tva_cents, total_ttc_cents, net_a_payer_cents, paye_cents, reste_a_payer_cents')
      .eq('client_id', id.data).order('created_at'),
  ]);
  if (chantiers.error || devis.error || factures.error) {
    return new Response('L’export a échoué. Réessayez.', { status: 500 });
  }

  const contenu = {
    exporte_le: new Date().toISOString(),
    note: 'Montants en centimes d’euro.',
    client,
    chantiers: chantiers.data,
    devis: devis.data,
    factures: factures.data,
  };
  return new Response(JSON.stringify(contenu, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="client-${id.data}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
