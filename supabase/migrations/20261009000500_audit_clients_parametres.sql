-- =============================================================================
-- H'DECOR (Phase 1) : journal d'audit étendu aux clients, assurances et taux
-- de TVA. La liste blanche audit_sans_donnees_perso s'applique : pour un
-- client, le journal garde QUI a créé / modifié / anonymisé QUELLE fiche et
-- QUAND, jamais le nom, l'adresse ni le téléphone.
-- =============================================================================
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function public.tracer_audit();
create trigger assurances_audit after insert or update or delete on public.assurances
  for each row execute function public.tracer_audit();
create trigger taux_tva_audit after insert or update or delete on public.taux_tva
  for each row execute function public.tracer_audit();
