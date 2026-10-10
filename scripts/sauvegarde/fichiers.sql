-- Fichiers référencés par la base : espace de stockage, chemin, empreinte
-- SHA-256 attendue (documents émis et signés ; vide sinon). Source unique de
-- la sauvegarde et du contrôle de la restauration.
copy (
  select espace, chemin, sha from (
    select 'documents' espace, pdf_chemin chemin, pdf_sha256 sha from public.devis where pdf_chemin is not null
    union all select 'documents', pdf_chemin, pdf_sha256 from public.factures where pdf_chemin is not null
    union all select 'documents', facturx_chemin, null from public.factures where facturx_chemin is not null
    union all select 'documents', pdf_chemin, pdf_sha256 from public.pv_reception where pdf_chemin is not null
    union all select 'documents', pdf_signe_chemin, pdf_signe_sha256 from public.signatures where pdf_signe_chemin is not null
    union all select 'documents', pdf_chemin, null from public.attestations_tva where pdf_chemin is not null
    union all select 'documents', attestation_chemin, null from public.assurances where attestation_chemin is not null
    union all select 'signatures', image_chemin, null from public.signatures where image_chemin is not null
    union all select 'signatures', signature_entreprise_chemin, null from public.pv_reception where signature_entreprise_chemin is not null
    union all select 'justificatifs', justificatif_chemin, null from public.depenses where justificatif_chemin is not null
    union all select 'justificatifs', chemin, null from public.documents_chantier where chemin is not null
    union all select 'photos', chemin, null from public.photos where chemin is not null
    union all select 'marque', logo_chemin, null from public.parametres_entreprise where logo_chemin is not null
  ) f order by 1, 2
) to stdout with (format csv);
