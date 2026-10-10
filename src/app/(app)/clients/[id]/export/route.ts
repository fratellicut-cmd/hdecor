import { z } from 'zod';
import { verifierSession } from '@/lib/dal';
import { clientServeur } from '@/lib/supabase/serveur';

/**
 * Droit d'accès et à la portabilité (RGPD) : toutes les données qui
 * concernent un client, dans un format lisible par machine (JSON). La RLS
 * limite à l'organisation. Les fichiers (PDF, photos) sont listés par leur
 * nom : ils se transmettent à part. Les données internes de l'entreprise
 * (coûts prévus, marges) ne sont pas des données du client et sont exclues.
 */
const COLONNES = {
  client: 'type, civilite, nom, prenom, raison_sociale, siret, tva_intra, email, telephone, fact_ligne1, fact_ligne2, fact_code_postal, fact_ville, fact_pays, notes, source, consentement_le, refus_sollicitations_le, anonymise_le, created_at, updated_at',
  chantiers: 'id, nom, adresse_ligne1, adresse_ligne2, code_postal, ville, statut, date_debut_prevue, notes, accord_diffusion_photos_le, created_at',
  devis: 'id, numero, version, objet, statut, date_emission, validite_jours, total_ht_cents, total_tva_cents, total_ttc_cents, notes_client, conditions_paiement, accepte_le, refuse_le, motif_refus, consulte_le, envoye_le, pdf_chemin',
  devisLignes: 'devis_id, ordre, type, designation, description, quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents, optionnelle',
  echeances: 'devis_id, ordre, libelle, pourcentage_bp, declencheur, date_prevue',
  factures: 'id, numero, type, statut, date_emission, date_echeance, total_ht_cents, total_tva_cents, total_ttc_cents, notes_client, envoyee_le, annulee_le, pdf_chemin',
  factureLignes: 'facture_id, ordre, type, designation, description, quantite_e4, unite, prix_unitaire_ht_cents, remise_bp, taux_tva_bp, total_ht_cents',
  paiements: 'facture_id, date_paiement, mode, montant_cents, reference, notes',
  pv: 'id, chantier_id, statut, date_reception, travaux, avec_reserves, reserves, delai_levee_jours, observations, pdf_chemin, signature_entreprise_chemin, created_at',
  attestations: 'id, devis_id, taux_bp, pdf_chemin, created_at',
  signatures: 'document_type, document_id, signataire_nom, mention, methode, signe_le, ip, user_agent, image_chemin, pdf_signe_chemin',
  envois: 'document_type, document_id, nature, canal, destinataire, statut, envoye_le',
  photos: 'chantier_id, moment, legende, en_galerie, chemin, prise_le',
  accords: 'chantier_id, texte, accorde_le, retire_le',
  documents: 'chantier_id, type, nom, chemin, created_at',
} as const;

const echec = () => new Response('L’export a échoué. Réessayez.', { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function GET(_: Request, { params }: RouteContext<'/clients/[id]/export'>) {
  await verifierSession();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response('Client introuvable.', { status: 404 });
  const supabase = await clientServeur();
  const { data: client, error } = await supabase.from('clients').select(COLONNES.client).eq('id', id.data).maybeSingle();
  if (error) return echec();
  if (!client) return new Response('Client introuvable.', { status: 404 });

  const [chantiers, devis, factures] = await Promise.all([
    supabase.from('chantiers').select(COLONNES.chantiers).eq('client_id', id.data).order('created_at'),
    supabase.from('devis').select(COLONNES.devis).eq('client_id', id.data).order('created_at'),
    supabase.from('factures').select(COLONNES.factures).eq('client_id', id.data).order('created_at'),
  ]);
  if (chantiers.error || devis.error || factures.error) return echec();
  const idsChantiers = chantiers.data.map((c) => c.id);
  const idsDevis = devis.data.map((d) => d.id);
  const idsFactures = factures.data.map((f) => f.id);

  const [devisLignes, echeances, factureLignes, paiements, pv, attestations, photos, documents, accords] = await Promise.all([
    supabase.from('devis_lignes').select(COLONNES.devisLignes).in('devis_id', idsDevis).order('ordre'),
    supabase.from('devis_echeances').select(COLONNES.echeances).in('devis_id', idsDevis).order('ordre'),
    supabase.from('facture_lignes').select(COLONNES.factureLignes).in('facture_id', idsFactures).order('ordre'),
    supabase.from('paiements').select(COLONNES.paiements).in('facture_id', idsFactures).order('date_paiement'),
    supabase.from('pv_reception').select(COLONNES.pv).in('chantier_id', idsChantiers),
    supabase.from('attestations_tva').select(COLONNES.attestations).in('devis_id', idsDevis),
    supabase.from('photos').select(COLONNES.photos).in('chantier_id', idsChantiers),
    supabase.from('documents_chantier').select(COLONNES.documents).in('chantier_id', idsChantiers),
    supabase.from('accords_diffusion_photos').select(COLONNES.accords).in('chantier_id', idsChantiers).order('accorde_le'),
  ]);
  if ([devisLignes, echeances, factureLignes, paiements, pv, attestations, photos, documents, accords].some((r) => r.error)) return echec();

  const idsDocuments = [...idsDevis, ...idsFactures, ...(pv.data ?? []).map((p) => p.id), ...idsChantiers];
  const [signatures, envois] = await Promise.all([
    supabase.from('signatures').select(COLONNES.signatures).in('document_id', idsDocuments),
    supabase.from('envois').select(COLONNES.envois).in('document_id', idsDocuments),
  ]);
  if (signatures.error || envois.error) return echec();

  const contenu = {
    exporte_le: new Date().toISOString(),
    notes: [
      'Montants en centimes d’euro ; quantités en dix-millièmes (quantite_e4) ; taux en points de base (2000 = 20 %).',
      'Les fichiers (PDF, photos, signatures) sont désignés par leur chemin et transmis séparément sur demande.',
    ],
    client,
    chantiers: chantiers.data,
    devis: devis.data.map((d) => ({
      ...d,
      lignes: (devisLignes.data ?? []).filter((l) => l.devis_id === d.id),
      echeances: (echeances.data ?? []).filter((e) => e.devis_id === d.id),
    })),
    factures: factures.data.map((f) => ({
      ...f,
      lignes: (factureLignes.data ?? []).filter((l) => l.facture_id === f.id),
      paiements: (paiements.data ?? []).filter((p) => p.facture_id === f.id),
    })),
    pv_reception: pv.data,
    accords_diffusion_photos: accords.data,
    attestations_tva: attestations.data,
    signatures: signatures.data,
    envois: envois.data,
    photos: photos.data,
    documents_chantier: documents.data,
  };
  return new Response(JSON.stringify(contenu, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="client-${id.data}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
