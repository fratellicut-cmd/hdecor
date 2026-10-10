-- =============================================================================
-- Tests du schéma : RLS, isolation entre organisations, immuabilité,
-- contrôles de totaux, cycle devis -> acompte -> finale, paiements, journal,
-- stockage, liens publics. S'arrête à la première assertion fausse.
-- Lancement : tests/db/run.sh
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null

create schema tests;
grant usage on schema tests to authenticated, anon, service_role;

create table tests.resultats (n serial, libelle text, ok boolean);
grant all on tests.resultats to authenticated, anon, service_role;
grant all on sequence tests.resultats_n_seq to authenticated, anon, service_role;

create function tests.egal(p_obtenu anyelement, p_attendu anyelement, p_libelle text) returns void
language plpgsql as $$
begin
  if p_obtenu is distinct from p_attendu then
    raise exception 'ÉCHEC « % » : obtenu %, attendu %', p_libelle, p_obtenu, p_attendu;
  end if;
  insert into tests.resultats (libelle, ok) values (p_libelle, true);
end $$;

-- Exécute p_sql et exige une erreur dont le message contient p_extrait.
create function tests.echoue(p_sql text, p_extrait text, p_libelle text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_extrait) in lower(sqlerrm)) = 0 then
      raise exception 'ÉCHEC « % » : erreur inattendue : %', p_libelle, sqlerrm;
    end if;
    insert into tests.resultats (libelle, ok) values (p_libelle, true);
    return;
  end;
  raise exception 'ÉCHEC « % » : aucune erreur levée', p_libelle;
end $$;

-- Exécute p_sql (UPDATE/DELETE) et renvoie le nombre de lignes touchées.
create function tests.lignes(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- -----------------------------------------------------------------------------
-- 1. Structure
-- -----------------------------------------------------------------------------
select tests.egal(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0::bigint, 'RLS activée sur toutes les tables du schéma public');

select tests.egal(
  (select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'organisations'
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid
                     and a.attname = 'organisation_id' and not a.attisdropped)),
  null::text, 'organisation_id présent sur toutes les tables (sauf organisations)');

select tests.egal(
  (select string_agg(c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
     and c.relname not in ('sequences_documents')),
  null::text, 'chaque table RLS a au moins une politique');

select tests.egal(
  (select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  null::text, 'toutes les fonctions SECURITY DEFINER fixent search_path');

-- -----------------------------------------------------------------------------
-- 2. Jeu de données : deux organisations, deux utilisateurs
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'b@test');
insert into public.organisations (id, nom) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Org B');
insert into public.membres values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'proprietaire'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000001', 'proprietaire');
-- Taux de TVA de l'organisation A (comme initialiser_organisation).
insert into public.taux_tva (organisation_id, taux_bp, libelle, attestation_requise, a_verifier) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 0, '0 %', false, true),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 550, '5,5 %', true, true),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 1000, '10 %', true, true),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 2000, '20 %', false, true);

-- -----------------------------------------------------------------------------
-- 3. Utilisateur A
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

insert into public.parametres_entreprise (organisation_id, raison_sociale)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Entreprise A');
insert into public.clients (id, organisation_id, nom, prenom)
values ('aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Durand', 'Paul');
insert into public.chantiers (id, organisation_id, client_id, nom)
values ('aaaaaaaa-0000-0000-0000-0000000ca001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        'aaaaaaaa-0000-0000-0000-0000000c0001', 'Appartement Durand');

select tests.egal((select count(*) from public.clients), 1::bigint, 'A voit son client');
select tests.echoue(
  $$insert into public.clients (organisation_id, nom) values ('bbbbbbbb-0000-0000-0000-00000000000b', 'Intrus')$$,
  'row-level security', 'A ne peut pas créer un client dans B');
select tests.echoue(
  $$insert into public.membres values ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001', 'proprietaire')$$,
  'row-level security', 'A ne peut pas s''ajouter membre de B');

-- Pièce de référence : 4,00 x 3,00 x 2,50, une porte, une fenêtre
insert into public.pieces (id, organisation_id, chantier_id, nom, longueur_mm, largeur_mm, hauteur_mm)
values ('aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-00000000000a',
        'aaaaaaaa-0000-0000-0000-0000000ca001', 'Chambre', 4000, 3000, 2500);
insert into public.ouvertures (organisation_id, piece_id, type, largeur_mm, hauteur_mm) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000e001', 'porte', 830, 2040),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000e001', 'fenetre', 1200, 1150);
select tests.egal(
  (select 2 * (p.longueur_mm + p.largeur_mm)::bigint * p.hauteur_mm
          - (select sum(o.largeur_mm::bigint * o.hauteur_mm * o.quantite) from public.ouvertures o where o.piece_id = p.id)::bigint
   from public.pieces p where p.id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  31926800::bigint, 'stockage en mm : murs nets exacts = 31 926 800 mm² (31,9268 m²)');
select tests.echoue(
  $$insert into public.ouvertures (organisation_id, piece_id, type, largeur_mm, hauteur_mm, surface_directe_mm2)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000e001', 'porte', 830, 2040, 100)$$,
  'check constraint', 'ouverture : dimensions OU surface directe, pas les deux');
select tests.echoue(
  $$insert into public.pieces (organisation_id, chantier_id, nom, longueur_mm, largeur_mm, hauteur_mm)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', 'X', -1, 3000, 2500)$$,
  'check constraint', 'dimension négative refusée');

-- Devis 5 000,00 € HT à 10 % (assujetti, pour le cas de référence)
insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva,
  acompte_pct_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0001', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca001', 30, 'assujetti', 3000,
  500000, 50000, 550000, '[{"taux_bp":1000,"base_ht_cents":500000,"tva_cents":50000}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0001', 1,
  'Peinture murs et plafonds', 10000, 'forfait', 500000, 1000, 500000);

select tests.echoue(
  $$update public.devis set numero = 'DEV-2026-9999' where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'permission denied', 'le numéro n''est pas modifiable par l''API');
select tests.echoue(
  $$update public.devis set statut = 'accepte' where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'permission denied', 'le statut n''est pas modifiable par l''API');

-- Ventilation fausse : émission refusée
update public.devis set total_tva_cents = 50001, total_ttc_cents = 550001,
  ventilation_tva = '[{"taux_bp":1000,"base_ht_cents":500000,"tva_cents":50001}]'
where id = 'aaaaaaaa-0000-0000-0000-0000000d0001';
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0001', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/x.pdf', repeat('a', 64))$$,
  'Ventilation incohérente', 'émission refusée si la TVA ne correspond pas au taux');
update public.devis set total_tva_cents = 50000, total_ttc_cents = 550000,
  ventilation_tva = '[{"taux_bp":1000,"base_ht_cents":500000,"tva_cents":50000}]'
where id = 'aaaaaaaa-0000-0000-0000-0000000d0001';

select tests.egal(
  public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0001', '{"raison_sociale":"Entreprise A"}',
    '{"nom_affiche":"Paul Durand"}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/devis/d1.pdf', repeat('a', 64)),
  'DEV-' || extract(year from public.aujourd_hui_paris())::text || '-0001', 'premier devis numéroté DEV-AAAA-0001');

select tests.echoue(
  $$update public.devis set objet = 'modifié' where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'figé', 'un devis envoyé est figé');
select tests.echoue(
  $$update public.devis_lignes set prix_unitaire_ht_cents = 1 where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'figées', 'les lignes d''un devis envoyé sont figées');
select tests.echoue(
  $$delete from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'ne peut pas être supprimé', 'un devis envoyé ne se supprime pas');

-- Signature sur place avec une empreinte différente : refusée
select tests.echoue(
  $$select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0001', 'Paul Durand', 'Bon pour accord',
    'aaaaaaaa-0000-0000-0000-00000000000a/sig/1.png', repeat('b', 64), '{}', '10.0.0.1', 'test')$$,
  'ne correspond pas', 'signature refusée si le PDF signé n''est pas celui émis');
select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0001', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/1.png', repeat('a', 64), '{}', '10.0.0.1', 'test');
select tests.egal((select statut::text from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'),
  'accepte', 'devis accepté après signature');
select tests.echoue(
  $$select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0001', 'Paul Durand', 'Bon pour accord',
    'aaaaaaaa-0000-0000-0000-00000000000a/sig/2.png', repeat('a', 64), '{}', '10.0.0.1', 'test')$$,
  'ne peut plus être signé', 'pas de seconde signature');
select tests.echoue(
  $$update public.signatures set signataire_nom = 'Autre'$$,
  'permission denied', 'une signature n''est pas modifiable par l''API');

-- Facture d'acompte 30 % : 1 500,00 HT + 150,00 TVA = 1 650,00 TTC
insert into public.factures (id, organisation_id, type, client_id, chantier_id, devis_id, delai_paiement_jours,
  regime_tva, acompte_pct_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'acompte',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca001',
  'aaaaaaaa-0000-0000-0000-0000000d0001', 30, 'assujetti', 3000, 150000, 15000, 165000,
  '[{"taux_bp":1000,"base_ht_cents":150000,"tva_cents":15000}]', 165000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0001', 1,
  'Acompte 30 % sur devis', 10000, 'forfait', 150000, 1000, 150000);
select tests.egal(
  public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0001', '{}', '{"nom_affiche":"Paul Durand"}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f1.pdf', repeat('c', 64)),
  'FAC-' || extract(year from public.aujourd_hui_paris())::text || '-0001', 'facture d''acompte FAC-AAAA-0001');

-- Facture finale : 5 000 HT / 500 TVA / 5 500 TTC, acompte 1 650 déduit, net 3 850
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0001', 30, 'assujetti',
  500000, 50000, 550000, '[{"taux_bp":1000,"base_ht_cents":500000,"tva_cents":50000}]',
  (select jsonb_build_array(jsonb_build_object('facture_id', id, 'numero', numero, 'ht', total_ht_cents,
     'tva', total_tva_cents, 'ttc', total_ttc_cents)) from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0001'),
  385000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0002', 1,
  'Peinture murs et plafonds', 10000, 'forfait', 500000, 1000, 500000);

-- Net à payer faux : refusé
update public.factures set net_a_payer_cents = 385001 where id = 'aaaaaaaa-0000-0000-0000-0000000f0002';
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0002', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f2.pdf', repeat('d', 64))$$,
  'Net à payer incohérent', 'finale refusée si le net ne déduit pas exactement l''acompte');
update public.factures set net_a_payer_cents = 385000 where id = 'aaaaaaaa-0000-0000-0000-0000000f0002';
select tests.egal(
  public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0002', '{}', '{"nom_affiche":"Paul Durand"}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f2.pdf', repeat('d', 64)),
  'FAC-' || extract(year from public.aujourd_hui_paris())::text || '-0002', 'facture finale FAC-AAAA-0002 (net 3 850,00)');

-- Sur-facturation : une 3e facture sur le même devis est refusée
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0003', 'aaaaaaaa-0000-0000-0000-00000000000a', 'acompte',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0001', 30, 'assujetti',
  100, 10, 110, '[{"taux_bp":1000,"base_ht_cents":100,"tva_cents":10}]', 110);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0003', 1, 'X', 10000, 'u', 100, 1000, 100);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0003', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f3.pdf', repeat('e', 64))$$,
  'dépasserait le devis', 'impossible de facturer plus que le devis accepté');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0003';  -- brouillon : supprimable

-- Immuabilité des factures émises
select tests.echoue(
  $$update public.factures set notes_client = 'x' where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'$$,
  'établissez un avoir', 'facture émise non modifiable');
select tests.echoue(
  $$delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'$$,
  'établissez un avoir', 'facture émise non supprimable');
select tests.echoue(
  $$delete from public.facture_lignes where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f0002'$$,
  'figées', 'lignes de facture émise non supprimables');

-- Paiements
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0002', public.aujourd_hui_paris(), 200000, 'especes');
select tests.egal((select statut_affiche from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'),
  'partiellement_payee', 'statut dérivé : partiellement payée');
select tests.egal((select reste_a_payer_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'),
  185000::bigint, 'reste à payer 1 850,00');
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0002', public.aujourd_hui_paris(), 185001, 'virement')$$,
  'dépasse le reste', 'paiement supérieur au reste à payer refusé');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0002', public.aujourd_hui_paris(), 185000, 'virement');
select tests.egal((select statut_affiche from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'),
  'payee', 'statut dérivé : payée');
select tests.echoue($$update public.paiements set montant_cents = 1$$, 'permission denied',
  'paiement non modifiable par l''API');
select tests.echoue($$delete from public.paiements$$, 'permission denied',
  'paiement non supprimable par l''API');
select tests.egal((select sum(montant_cents) from public.v_livre_recettes), 385000::numeric,
  'livre des recettes = encaissements');

-- Journal d'audit
select tests.egal((select count(*) > 0 from public.journal_audit where table_nom = 'factures'), true,
  'le journal trace les factures');
select tests.echoue($$delete from public.journal_audit$$, 'permission denied', 'journal non supprimable par l''API');
select tests.echoue($$insert into public.journal_audit (organisation_id, action, table_nom) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'INSERT', 'faux')$$,
  'permission denied', 'journal : aucune écriture directe');

-- Stockage : PDF émis et tracés de signature déposés par le SERVEUR (clé service) uniquement.
select tests.echoue(
  $$insert into storage.objects (bucket_id, name) values ('documents', 'aaaaaaaa-0000-0000-0000-00000000000a/factures/f2.pdf')$$,
  'row-level security', 'un document émis n''est pas déposé directement par l''API, même chez soi');
select tests.echoue(
  $$insert into storage.objects (bucket_id, name) values ('signatures', 'aaaaaaaa-0000-0000-0000-00000000000a/devis/s.png')$$,
  'row-level security', 'un tracé de signature n''est pas déposé directement par l''API');
select tests.echoue(
  $$insert into storage.objects (bucket_id, name) values ('justificatifs', 'aaaaaaaa-0000-0000-0000-00000000000a/depenses/j.pdf')$$,
  'row-level security', 'un justificatif comptable n''est déposé que par le serveur (contenu vérifié)');
select tests.echoue(
  $$insert into storage.objects (bucket_id, name) values ('photos', 'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/c/photos/p.jpg')$$,
  'row-level security', 'une photo de chantier n''est déposée que par le serveur (contenu vérifié, rangée)');
select tests.echoue(
  $$insert into storage.objects (bucket_id, name) values ('marque', 'aaaaaaaa-0000-0000-0000-00000000000a/logo/aaaaaaaa-0000-0000-0000-0000000000c1.png')$$,
  'row-level security', 'le logo n''est déposé que par le serveur (contenu et dimensions vérifiés)');
reset role;
insert into storage.objects (bucket_id, name) values ('documents', 'aaaaaaaa-0000-0000-0000-00000000000a/factures/f2.pdf');
set role authenticated;
select tests.echoue(
  $$insert into storage.objects (bucket_id, name) values ('documents', 'bbbbbbbb-0000-0000-0000-00000000000b/x.pdf')$$,
  'row-level security', 'A ne peut pas déposer de fichier chez B');
select tests.egal(tests.lignes($$delete from storage.objects where bucket_id = 'documents'$$), 0::bigint,
  'un PDF émis ne se supprime pas du stockage');

-- Lien public : un utilisateur connecté ne peut pas appeler les fonctions par jeton
insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0001', 'consultation',
  encode(extensions.digest('jeton-de-test-suffisamment-long-pour-passer-le-controle', 'sha256'), 'hex'),
  now() + interval '30 days');
select tests.echoue($$select public.devis_par_jeton('jeton-de-test-suffisamment-long-pour-passer-le-controle')$$,
  'permission denied', 'devis_par_jeton réservé au serveur');
select tests.echoue($$select public.prochain_numero('aaaaaaaa-0000-0000-0000-00000000000a', 'FAC', 2026)$$,
  'permission denied', 'prochain_numero non appelable depuis l''API');

-- -----------------------------------------------------------------------------
-- 3 bis. Correctifs du refus chef-de-projet (phase 0)
-- -----------------------------------------------------------------------------

-- Remise globale : devis franchise 2 x 1 000,00, remise 10 % -> 1 800,00 ;
-- acompte 30 % = 540,00 ; finale 1 800,00 - 540,00 = 1 260,00.
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, remise_globale_bp,
  acompte_pct_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0002', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 1000, 3000, 180000, 0, 180000,
  '[{"taux_bp":0,"base_ht_cents":180000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents, cout_matiere_prevu_cents, minutes_prevues) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0002', 1, 'Murs', 10000, 'forfait', 100000, 0, 100000, 20000, 600),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0002', 2, 'Plafonds', 10000, 'forfait', 100000, 0, 100000, 15000, 480);

-- Achats retenus (produit d'exemple FICTIF) et échéancier
insert into public.produits (id, organisation_id, marque, designation, type, statut_verification)
values ('aaaaaaaa-0000-0000-0000-0000000e0001', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'Marque fictive', 'Acrylique mate (EXEMPLE FICTIF)', 'acrylique', 'fictif');
insert into public.conditionnements (id, organisation_id, produit_id, contenance, prix_achat_ht_cents)
values ('aaaaaaaa-0000-0000-0000-0000000e0002', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000e0001', 10000, 5000);
select tests.egal((select count(*) from public.historique_prix), 1::bigint, 'historique de prix créé automatiquement');
insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, nombre, prix_achat_retenu_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0002',
  'aaaaaaaa-0000-0000-0000-0000000e0002', 2, 5000);
insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0002', 1, 'Acompte', 3000, 'signature'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0002', 2, 'Solde', 7001, 'fin_travaux');
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0002', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/d2.pdf', repeat('f', 64))$$,
  'dépasse 100', 'échéancier supérieur à 100 % refusé');
update public.devis_echeances set pourcentage_bp = 7000 where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0002' and ordre = 2;
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0002', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/d2.pdf', repeat('f', 64));
select tests.echoue(
  $$update public.devis_echeances set pourcentage_bp = 1 where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0002'$$,
  'figées', 'échéancier figé après envoi');
select tests.echoue(
  $$update public.devis_achats set prix_achat_retenu_cents = 1 where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0002'$$,
  'figées', 'achats retenus figés après envoi');

-- Alerte de changement de prix : prix courant <> prix retenu
update public.conditionnements set prix_achat_ht_cents = 5500 where id = 'aaaaaaaa-0000-0000-0000-0000000e0002';
select tests.egal(
  (select count(*) from public.devis_achats a join public.conditionnements c on c.id = a.conditionnement_id
   where a.devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0002' and c.prix_achat_ht_cents <> a.prix_achat_retenu_cents),
  1::bigint, 'changement de prix détectable sur un devis en cours');
select tests.egal((select count(*) from public.historique_prix), 2::bigint, 'historique de prix : nouvelle entrée datée');

select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0002', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/3.png', repeat('f', 64), '{}', '10.0.0.1', 'test');

insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  acompte_pct_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0011', 'aaaaaaaa-0000-0000-0000-00000000000a', 'acompte',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0002', 30, 'franchise',
  3000, 54000, 0, 54000, '[{"taux_bp":0,"base_ht_cents":54000,"tva_cents":0}]', 54000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0011', 1,
  'Acompte 30 % sur devis remisé', 10000, 'forfait', 54000, 0, 54000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0011', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f11.pdf', repeat('1', 64));

insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  remise_globale_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0012', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0002', 30, 'franchise',
  1000, 180000, 0, 180000, '[{"taux_bp":0,"base_ht_cents":180000,"tva_cents":0}]',
  (select jsonb_build_array(jsonb_build_object('facture_id', id, 'numero', numero, 'ht', total_ht_cents,
     'tva', total_tva_cents, 'ttc', total_ttc_cents)) from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0011'),
  126000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0012', 1, 'Murs', 10000, 'forfait', 100000, 0, 100000),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0012', 2, 'Plafonds', 10000, 'forfait', 100000, 0, 100000);
select tests.egal(
  (select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0012', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f12.pdf', repeat('2', 64)) is not null),
  true, 'devis avec remise globale : facture finale émise (net 1 260,00)');
select tests.egal((select reste_a_payer_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0012'),
  126000::bigint, 'finale remisée : reste à payer 1 260,00');

-- Avoir sur facture déjà payée + remboursement
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0021', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 10000, 0, 10000,
  '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', 10000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0021', 1, 'Retouche', 10000, 'forfait', 10000, 0, 10000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0021', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f21.pdf', repeat('3', 64));
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0021', public.aujourd_hui_paris(), 10000, 'cheque');
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0022', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f0021', 0, 'franchise', 10000, 0, 10000,
  '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', 10000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0022', 1, 'Annulation', 10000, 'forfait', 10000, 0, 10000);
select tests.egal(
  public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0022', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/a1.pdf', repeat('4', 64)),
  'AVO-' || extract(year from public.aujourd_hui_paris())::text || '-0001', 'avoir numéroté AVO-AAAA-0001');
select tests.egal((select statut::text from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0021'),
  'annulee', 'avoir total : facture d''origine annulée');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0022', public.aujourd_hui_paris(), 10000, 'virement');
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0022', public.aujourd_hui_paris(), 1, 'virement')$$,
  'ou le montant de l''avoir', 'remboursement plafonné au montant de l''avoir');
select tests.egal(
  (select sum(montant_cents) from public.v_livre_recettes where facture_id in
     ('aaaaaaaa-0000-0000-0000-0000000f0021', 'aaaaaaaa-0000-0000-0000-0000000f0022')),
  0::numeric, 'livre des recettes : encaissement 100,00 puis remboursement -100,00');

-- Temps passés et statut de chantier dérivé
insert into public.temps_passes (organisation_id, chantier_id, jour, minutes)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), 420);
select tests.echoue(
  $$insert into public.temps_passes (organisation_id, chantier_id, jour, minutes)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), 0)$$,
  'check constraint', 'temps passé nul refusé');
update public.chantiers set statut = 'termine' where id = 'aaaaaaaa-0000-0000-0000-0000000ca001';
select tests.egal((select statut_affiche from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca001'),
  'facture', 'chantier terminé, acompte non encaissé : statut dérivé « facturé »');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0001', public.aujourd_hui_paris(), 165000, 'virement');
select tests.egal((select statut_affiche from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca001'),
  'paye', 'chantier terminé et factures soldées : statut dérivé « payé »');

-- Rappels
insert into public.rappels (organisation_id, type, echeance, titre, chantier_id)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'sechage', now() + interval '4 hours', 'Seconde couche salon',
  'aaaaaaaa-0000-0000-0000-0000000ca001');
select tests.egal((select count(*) from public.rappels), 1::bigint, 'rappel enregistré');

-- -----------------------------------------------------------------------------
-- 3 ter. Non-régression de l'audit sécurité (phase 0)
-- -----------------------------------------------------------------------------

-- HAUTE 1 : déplacer une ligne de brouillon vers un document émis
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0009', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (id, organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000a901', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000d0009', 1, 'Peinture', 10000, 'u', 10000, 0, 10000);
select tests.echoue(
  $$update public.devis_lignes set devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0001', ordre = 9
    where id = 'aaaaaaaa-0000-0000-0000-00000000a901'$$,
  'figées', 'sécurité : une ligne de brouillon ne peut pas rejoindre un devis émis');
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0009', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 0, 0, 0, '[]', 0);
insert into public.facture_lignes (id, organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000f901', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000f0009', 1, 'Ajout', 10000, 'u', 777700, 0, 777700);
select tests.echoue(
  $$update public.facture_lignes set facture_id = 'aaaaaaaa-0000-0000-0000-0000000f0002', ordre = 9
    where id = 'aaaaaaaa-0000-0000-0000-00000000f901'$$,
  'figées', 'sécurité : une ligne de brouillon ne peut pas rejoindre une facture émise');

-- MOYENNE 1 : chemin de PDF hors de l'organisation
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0009', '{}', '{}', '{}',
    'bbbbbbbb-0000-0000-0000-00000000000b/factures/secret.pdf', repeat('9', 64))$$,
  'pdf_chemin_org', 'sécurité : PDF hors du dossier de l''organisation refusé');
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0009', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/../bbbbbbbb-0000-0000-0000-00000000000b/x.pdf', repeat('9', 64))$$,
  'pdf_chemin_org', 'sécurité : remontée de dossier (..) refusée');

-- HAUTE 2 : le montant accepté est calculé par la base, jamais fourni
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0009', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d9.pdf', repeat('9', 64));
select tests.echoue(
  $$select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0009', 'Paul Durand', 'Bon pour accord',
    'bbbbbbbb-0000-0000-0000-00000000000b/sig/9.png', repeat('9', 64), '{}', '10.0.0.1', 'test')$$,
  'image_chemin_org', 'sécurité : image de signature hors organisation refusée');
select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0009', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/9.png', repeat('9', 64), '{}', '10.0.0.1', 'test');
select tests.egal((select total_accepte_ttc_cents from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0009'),
  10000::bigint, 'sécurité : montant accepté calculé par la base (100,00)');

-- Ventilation imposée par la base (règle R5) : 500 € à 20 % + 500 € à 5,5 %,
-- remise 10 % -> remise 100,00 répartie 50,00 / 50,00 ; bases 450,00 / 450,00 ;
-- TVA 90,00 + 24,75 = 114,75 (calcul à la main).
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, remise_globale_bp,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0041', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'assujetti', 1000, 90000, 10750, 100750,
  '[{"taux_bp":550,"base_ht_cents":50000,"tva_cents":2750},{"taux_bp":2000,"base_ht_cents":40000,"tva_cents":8000}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0041', 1, 'A', 10000, 'forfait', 50000, 2000, 50000),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0041', 2, 'B', 10000, 'forfait', 50000, 550, 50000);
select tests.egal(public.ventilation_attendue('[{"taux_bp":2000,"somme_ht_cents":50000},{"taux_bp":550,"somme_ht_cents":50000}]', 1000, 'assujetti'),
  '[{"taux_bp":550,"base_ht_cents":45000,"tva_cents":2475},{"taux_bp":2000,"base_ht_cents":45000,"tva_cents":9000}]'::jsonb,
  'R5 : remise répartie au prorata, TVA 114,75 € (calcul à la main)');
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0041', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/d41.pdf', repeat('4', 64))$$,
  'Ventilation incohérente', 'sécurité : remise reportée sur le taux à 20 % (TVA sous-déclarée) refusée');
select tests.egal(public.ventilation_attendue('[{"taux_bp":2000,"somme_ht_cents":3333},{"taux_bp":1000,"somme_ht_cents":3333},{"taux_bp":0,"somme_ht_cents":3334}]', 1000, 'assujetti'),
  '[{"taux_bp":0,"base_ht_cents":3000,"tva_cents":0},{"taux_bp":1000,"base_ht_cents":3000,"tva_cents":300},{"taux_bp":2000,"base_ht_cents":3000,"tva_cents":600}]'::jsonb,
  'R5 : centimes résiduels au plus fort reste (remise 10,00 sur 100,00 en 3 taux)');
select tests.echoue(
  $$insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
      prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0041', 3, 'C', 10000, 'u', 100000, 2000, 1)$$,
  'check constraint', 'R4 : total de ligne incohérent (1 u x 1 000,00 = 0,01) refusé');
select tests.egal(
  (select floor((319300::numeric * 1250 * 10000 + 50000000) / 100000000)::bigint),
  39913::bigint, 'R4 : 31,93 m² x 12,50 € = 399,125 -> 399,13 € (demi-supérieur)');

-- Contrôle des totaux à l'émission : total HT gonflé par rapport aux lignes
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, remise_globale_bp,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0008', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 1000, 9500, 0, 9500, '[{"taux_bp":0,"base_ht_cents":9500,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0008', 1, 'X', 10000, 'u', 10000, 0, 10000);
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0008', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/d8.pdf', repeat('8', 64))$$,
  'Ventilation incohérente', 'remise 10 % sur 100,00 : total HT 95,00 refusé (attendu 90,00)');

-- MOYENNE 2 : déduction d'un acompte inexistant
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0008', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0001', 30, 'assujetti',
  100, 10, 110, '[{"taux_bp":1000,"base_ht_cents":100,"tva_cents":10}]',
  '[{"facture_id":"aaaaaaaa-0000-0000-0000-0000000fffff","numero":"FAC-2026-9999","ht":100,"tva":10,"ttc":110}]', 0);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0008', 1, 'X', 10000, 'u', 100, 1000, 100);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0008', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/f8.pdf', repeat('8', 64))$$,
  'Acompte déduit introuvable', 'sécurité : déduction d''un acompte inexistant refusée');
update public.factures set deductions = (select jsonb_build_array(jsonb_build_object('facture_id', id, 'numero', numero,
    'ht', total_ht_cents, 'tva', total_tva_cents, 'ttc', total_ttc_cents)) from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0001')
where id = 'aaaaaaaa-0000-0000-0000-0000000f0008';
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0008', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/f8.pdf', repeat('8', 64))$$,
  'déjà été déduit', 'sécurité : un acompte ne se déduit pas deux fois');
select tests.echoue(
  $$update public.factures set deductions = '[{"facture_id":"aaaaaaaa-0000-0000-0000-0000000f0001","numero":"FAC-INVENTE-9999","ttc":165000}]'
    where id = 'aaaaaaaa-0000-0000-0000-0000000f0008'$$,
  'check constraint', 'sécurité : déduction avec numéro inventé ou montants manquants refusée');
-- Même acompte écrit en majuscules (double déduction déguisée) : la forme
-- stricte n'admet que des UUID en minuscules.
select tests.echoue(
  $$update public.factures set deductions = (
      select jsonb_build_array(jsonb_build_object('facture_id', upper(id::text), 'numero', numero,
        'ht', total_ht_cents, 'tva', total_tva_cents, 'ttc', total_ttc_cents))
      from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0001')
    where id = 'aaaaaaaa-0000-0000-0000-0000000f0008'$$,
  'check constraint', 'sécurité : identifiant d''acompte en majuscules refusé (pas de double déduction déguisée)');
-- Texte libre glissé dans la ventilation : refusé
select tests.echoue(
  $$update public.factures set ventilation_tva = '[{"taux_bp":1000,"base_ht_cents":100,"tva_cents":10,"note":"Paul Durand 12 rue des Lilas"}]'
    where id = 'aaaaaaaa-0000-0000-0000-0000000f0008'$$,
  'check constraint', 'sécurité : aucune clé libre dans la ventilation de TVA');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0008';

-- MOYENNE 3 : liens publics (durée, dates imposées, révocation définitive)
select tests.echoue(
  $$insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0001', 'consultation',
            repeat('1', 64), '2999-12-31')$$,
  'check constraint', 'sécurité : lien public de plus de 90 jours refusé');
select tests.echoue(
  $$insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le, cree_le)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0001', 'consultation',
            repeat('2', 64), now() + interval '1 day', '2000-01-01')$$,
  'permission denied', 'sécurité : date de création d''un lien non choisie par l''API');
select tests.echoue(
  $$insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0008', 'consultation',
            repeat('3', 64), now() + interval '1 day')$$,
  'brouillon', 'sécurité : pas de lien public sur un brouillon');
insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
values ('aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000d0001', 'consultation', repeat('4', 64), now() + interval '7 days');
update public.liens_publics set revoque_le = now() where jeton_sha256 = repeat('4', 64);
select tests.echoue(
  $$update public.liens_publics set revoque_le = null where jeton_sha256 = repeat('4', 64)$$,
  'définitive', 'sécurité : une révocation ne s''annule pas');

-- MOYENNE 4 : paiement Stripe forgé, auteur usurpé
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0012', public.aujourd_hui_paris(), 500, 'stripe')$$,
  'webhook', 'sécurité : mode Stripe réservé au webhook');
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, cree_par)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0012', public.aujourd_hui_paris(), 500, 'especes',
            'bbbbbbbb-0000-0000-0000-000000000001')$$,
  'permission denied', 'sécurité : auteur d''un paiement non choisi par l''API');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0012', public.aujourd_hui_paris(), 500, 'especes');
select tests.egal((select bool_and(cree_par = 'aaaaaaaa-0000-0000-0000-000000000001') from public.paiements
                   where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f0012'), true, 'sécurité : auteur du paiement = session');

-- MOYENNE 7 : historique des prix écrit seulement par le trigger, jamais effacé
select tests.echoue($$delete from public.historique_prix$$, 'permission denied', 'sécurité : historique des prix non supprimable');
select tests.echoue(
  $$insert into public.historique_prix (organisation_id, conditionnement_id, prix_achat_ht_cents, date_effet)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000e0002', 1, '2020-01-01')$$,
  'permission denied', 'sécurité : pas de prix antidaté inséré à la main');
select tests.echoue($$delete from public.produits where id = 'aaaaaaaa-0000-0000-0000-0000000e0001'$$,
  'foreign key', 'un produit avec historique ne se supprime pas (il s''archive)');

-- HAUTE 3 : anonymisation RGPD complète
insert into public.clients (id, organisation_id, nom, prenom, email)
values ('aaaaaaaa-0000-0000-0000-0000000c0002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Lefèvre', 'Anne', 'anne@exemple.test');
insert into public.chantiers (id, organisation_id, client_id, nom, adresse_ligne1, notes)
values ('aaaaaaaa-0000-0000-0000-0000000ca002', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0002', 'Maison Lefèvre', '12 rue des Lilas', 'Code porte 4521');
insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0007', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0002', 'aaaaaaaa-0000-0000-0000-0000000ca002', 30, 'franchise',
  10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0007', 1, 'X', 10000, 'u', 10000, 0, 10000);
update public.devis set notes_client = 'Mme Lefèvre est allergique, digicode 4521', conditions_paiement = 'Chèque de Mme Lefèvre',
  delai_debut_texte = 'Au retour de vacances de Mme Lefèvre' where id = 'aaaaaaaa-0000-0000-0000-0000000d0007';
insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0007', 1, 'Solde payé par Mme Lefèvre', 10000, 'fin_travaux');
insert into public.pieces (organisation_id, chantier_id, nom, etage, longueur_mm, largeur_mm, hauteur_mm)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca002', 'Chambre de Léa', 'Chez Lefèvre, 3e gauche', 3000, 3000, 2500);
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0007', '{}',
  '{"nom_affiche":"Anne Lefèvre","adresse":"12 rue des Lilas"}', '{"adresse":"12 rue des Lilas"}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d7.pdf', repeat('7', 64));
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'devis', 'aaaaaaaa-0000-0000-0000-0000000d0007', 'envoi', 'email', 'anne@exemple.test');
insert into public.photos (organisation_id, chantier_id, chemin)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca002',
  'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca002/photos/aaaaaaaa-0000-0000-0000-0000000f0e01.jpg');
insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0007', 'signature', repeat('7', 64), now() + interval '7 days');
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0007', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0002', 30, 'franchise', 1000, 0, 1000, '[{"taux_bp":0,"base_ht_cents":1000,"tva_cents":0}]', 1000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0007', 1, 'X', 10000, 'u', 1000, 0, 1000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0007', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f7.pdf', repeat('7', 64));
insert into public.liens_publics (organisation_id, facture_id, finalite, jeton_sha256, expire_le)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0007', 'consultation', repeat('e', 64), now() + interval '7 days');
insert into public.evenements (id, organisation_id, chantier_id, type, titre, debut, fin, notes)
values ('aaaaaaaa-0000-0000-0000-0000000e7001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca002', 'rendez_vous',
  'RDV Anne Lefèvre 0600000000', now(), now() + interval '1 hour', 'Code porte 4521');
insert into public.rappels (organisation_id, type, echeance, titre, evenement_id)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'libre', now(), 'Appeler Anne Lefèvre 0600000000', 'aaaaaaaa-0000-0000-0000-0000000e7001');
insert into public.pv_reception (id, organisation_id, chantier_id, date_reception)
values ('aaaaaaaa-0000-0000-0000-0000000b0007', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca002', public.aujourd_hui_paris());
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'pv_reception', 'aaaaaaaa-0000-0000-0000-0000000b0007', 'envoi', 'email', 'anne@exemple.test');
insert into public.rappels (organisation_id, type, echeance, titre, chantier_id)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'libre', now(), 'Rappeler Mme Lefèvre 0600000000', 'aaaaaaaa-0000-0000-0000-0000000ca002');
insert into public.temps_passes (organisation_id, chantier_id, jour, minutes, note)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca002', public.aujourd_hui_paris(), 60, 'Mme Lefèvre absente');
select tests.echoue($$select public.anonymiser_client_interne('aaaaaaaa-0000-0000-0000-0000000c0002')$$, 'permission denied',
  'RGPD : une session passe obligatoirement par effacer_client (file des fichiers)');
select tests.echoue($$select * from public.fichiers_a_supprimer$$, 'permission denied',
  'RGPD : la file des fichiers à supprimer est invisible pour une session');
select tests.egal(public.effacer_client('aaaaaaaa-0000-0000-0000-0000000c0002'), 2,
  'RGPD : effacement du client, 2 fichiers mis en file');
reset role;
select tests.egal((select array_agg(espace || ':' || chemin order by espace || ':' || chemin) from public.fichiers_a_supprimer),
  array['documents:aaaaaaaa-0000-0000-0000-00000000000a/d7.pdf', 'photos:aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca002/photos/aaaaaaaa-0000-0000-0000-0000000f0e01.jpg'],
  'RGPD : PDF du devis non accepté et photos inscrits dans la file, avec leur espace de stockage');
set role authenticated;
-- Faille H1 (audit sécurité, boucle 2) : un fichier de chantier ne peut pas
-- désigner un document émis, et la file n'accepte jamais un fichier protégé.
insert into public.chantiers (id, organisation_id, client_id, nom)
values ('aaaaaaaa-0000-0000-0000-0000000ca0f1', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'Leurre');
select tests.echoue($$insert into public.documents_chantier (organisation_id, chantier_id, type, nom, chemin, espace)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca0f1', 'autre', 'x',
          'aaaaaaaa-0000-0000-0000-00000000000a/f7.pdf', 'justificatifs')$$,
  'chemin_du_chantier', 'H1 : un document de chantier ne peut pas désigner le PDF d''une facture');
select tests.echoue($$insert into public.documents_chantier (organisation_id, chantier_id, type, nom, chemin, espace)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca0f1', 'autre', 'x',
          'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca0f1/documents/aaaaaaaa-0000-0000-0000-0000000f0e03.pdf', 'documents')$$,
  'espace_check', 'H1 : un document de chantier ne vit que dans l''espace justificatifs');
select tests.echoue($$insert into public.photos (organisation_id, chantier_id, chemin)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca0f1',
          'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca0f1/../../f7.pdf')$$,
  'chemin_du_chantier', 'H1 : pas de remontée « .. » dans un chemin de photo');
insert into public.photos (id, organisation_id, chantier_id, chemin)
values ('aaaaaaaa-0000-0000-0000-0000000f0f01', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca0f1',
        'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca0f1/photos/aaaaaaaa-0000-0000-0000-0000000f0e02.jpg');
select tests.echoue($$update public.photos set chemin = 'aaaaaaaa-0000-0000-0000-00000000000a/f7.pdf' where id = 'aaaaaaaa-0000-0000-0000-0000000f0f01'$$,
  'permission denied', 'H1 : le chemin d''une photo n''est plus modifiable par une session');
-- Phase 2 : un chantier ne se supprime plus directement (fichiers orphelins) ;
-- la fonction dédiée met ses fichiers en file dans la même transaction.
select tests.echoue($$delete from public.chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca0f1'$$,
  'permission denied', 'chantier : pas de suppression directe par une session');
select tests.egal(public.supprimer_chantier('aaaaaaaa-0000-0000-0000-0000000ca0f1'), 1,
  'chantier sans document supprimé, sa photo mise en file de suppression');
select tests.echoue($$select public.supprimer_chantier('aaaaaaaa-0000-0000-0000-0000000ca002')$$,
  'ne peut pas être supprimé', 'chantier avec devis ou factures : suppression refusée');
reset role;
insert into public.fichiers_a_supprimer (organisation_id, espace, chemin)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'documents', 'aaaaaaaa-0000-0000-0000-00000000000a/f7.pdf');
select tests.egal((select count(*) from public.fichiers_a_supprimer where chemin = 'aaaaaaaa-0000-0000-0000-00000000000a/f7.pdf'),
  0::bigint, 'H1 : le PDF d''une facture émise est écarté de la file de suppression (dernière défense)');
set role authenticated;
select tests.echoue($$update public.clients set nom = 'Durand', anonymise_le = null where id = 'aaaaaaaa-0000-0000-0000-0000000c0002'$$,
  'Fiche anonymisée', 'RGPD : une fiche anonymisée ne peut pas être « dé-anonymisée » par l''API');
select tests.echoue($$select public.effacer_client('aaaaaaaa-0000-0000-0000-0000000c0002')$$,
  'déjà anonymisé', 'RGPD : un second effacement est refusé proprement');
select tests.egal(
  (select count(*) from public.evenements where chantier_id = 'aaaaaaaa-0000-0000-0000-0000000ca002' and (titre ilike '%lef%' or notes is not null))
  + (select count(*) from public.rappels where chantier_id = 'aaaaaaaa-0000-0000-0000-0000000ca002' and titre ilike '%lef%')
  + (select count(*) from public.temps_passes where chantier_id = 'aaaaaaaa-0000-0000-0000-0000000ca002' and note is not null)
  + (select count(*) from public.devis_lignes where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0007' and designation <> 'Prestation (anonymisée)')
  + (select count(*) from public.liens_publics where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0007' and revoque_le is null)
  + (select count(*) from public.liens_publics where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f0007' and revoque_le is null)
  + (select count(*) from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0007'
       and (notes_client is not null or conditions_paiement is not null or delai_debut_texte is not null
            or motif_refus <> 'Anonymisation (RGPD)'))
  + (select count(*) from public.devis_echeances where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0007' and libelle ilike '%lef%')
  + (select count(*) from public.pieces where chantier_id = 'aaaaaaaa-0000-0000-0000-0000000ca002' and (etage is not null or nom ilike '%léa%'))
  + (select count(*) from public.rappels where titre ilike '%lef%')
  + (select count(*) from public.envois where destinataire ilike '%anne%')
  + (select count(*) from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b0007'),
  0::bigint, 'RGPD : planning, rappels, temps, pièces, devis non accepté (notes, conditions, délai, motif, échéances, lignes) effacés ; liens révoqués');
select tests.egal((select statut::text from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0007'),
  'refuse', 'RGPD : un devis anonymisé ne peut plus être signé');
select tests.egal(
  (select count(*) from public.clients c where c.id = 'aaaaaaaa-0000-0000-0000-0000000c0002' and (c.email is not null or c.prenom is not null))
  + (select count(*) from public.chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca002' and (adresse_ligne1 is not null or notes is not null))
  + (select count(*) from public.envois where document_id = 'aaaaaaaa-0000-0000-0000-0000000d0007' and destinataire is not null)
  + (select count(*) from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0007' and (copie_client::text ilike '%lilas%' or copie_chantier::text ilike '%lilas%'))
  + (select count(*) from public.photos where chantier_id = 'aaaaaaaa-0000-0000-0000-0000000ca002'),
  0::bigint, 'RGPD : client, chantier, envois, copies du devis non accepté et photos anonymisés');
select tests.egal((select count(*) from public.journal_audit
                   where avant::text ilike any (array['%lilas%', '%lefèvre%', '%durand%'])
                      or apres::text ilike any (array['%lilas%', '%lefèvre%', '%durand%'])),
  0::bigint, 'RGPD : le journal d''audit ne contient aucune donnée personnelle');
select tests.egal((select count(*) from public.journal_audit
                   where table_nom = 'clients' and action = 'UPDATE' and ligne_id = 'aaaaaaaa-0000-0000-0000-0000000c0002'
                     and apres ? 'anonymise_le' and not (apres ? 'nom') and not (avant ? 'nom')),
  1::bigint, 'RGPD : l''effacement est tracé au journal (date, fiche), sans le nom');
select tests.egal((select copie_client ->> 'nom_affiche' from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'),
  'Paul Durand', 'conservation : les factures émises gardent leur copie figée');

-- MOYENNE 5 : seules les fonctions prévues sont appelables par une session
select tests.egal(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')),
  'archiver_pv_signe,effacer_client,emettre_devis,emettre_facture,enregistrer_facturx,est_membre,lever_reserve,marquer_facture_envoyee,nouvelle_version_devis,presenter_pv,refuser_devis,signer_devis_sur_place,signer_pv_sur_place,supprimer_chantier',
  'sécurité : liste exacte des fonctions SECURITY DEFINER appelables par une session');
select tests.egal(
  (select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')),
  'archiver_pv_signe,aujourd_hui_paris,chemin_de_l_organisation,chemin_du_chantier,confirmer_valeurs,copier_poste,date_iso_valide,deductions_bien_formees,definir_preparations,deplacer_ligne_devis,deplacer_ligne_facture,dupliquer_devis,dupliquer_piece,effacer_client,emettre_devis,emettre_facture,emettre_facture_attendue,enregistrer_facturx,est_membre,importer_produits,initialiser_categories_depenses,lever_reserve,marquer_facture_envoyee,nouvelle_version_devis,numero_devis_previsionnel,numero_facture_previsionnel,organisation_du_chemin,presenter_pv,rechercher_clients,refuser_devis,remplacer_achats_devis,reserves_valides,signer_devis_sur_place,signer_pv_sur_place,solde_avoir,solde_devis,solde_facture,supprimer_chantier,texte_recherche,textes_legaux_valides,ventilation_attendue,ventilation_bien_formee',
  'sécurité : liste COMPLÈTE des fonctions appelables par une session');
select tests.echoue($$select public.purger_journal_audit(now() - interval '20 years')$$, 'permission denied',
  'sécurité : purge du journal réservée au serveur');

-- -----------------------------------------------------------------------------
-- 3 quater. Correctifs du 2e refus chef-de-projet
-- -----------------------------------------------------------------------------

-- Chantier : seul l'acompte est facturé et payé -> pas « payé », reste à facturer
insert into public.chantiers (id, organisation_id, client_id, nom)
values ('aaaaaaaa-0000-0000-0000-0000000ca003', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'Cuisine');
insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva, acompte_pct_bp,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0031', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca003', 30, 'franchise', 3000,
  100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0031', 1, 'Cuisine', 10000, 'forfait', 100000, 0, 100000);
insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0031', 1, 'Acompte', 5000, 'signature'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0031', 2, 'Solde', 5000, 'fin_travaux');
select tests.echoue(
  $$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0031', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/d31.pdf', repeat('3', 64))$$,
  'ne correspond pas à l''échéancier', 'acompte : une seule source (acompte 30 % contre échéancier 50 % refusé)');
update public.devis_echeances set pourcentage_bp = 3000 where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0031' and ordre = 1;
update public.devis_echeances set pourcentage_bp = 7000 where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0031' and ordre = 2;
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0031', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d31.pdf', repeat('3', 64));
select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0031', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/31.png', repeat('3', 64), '{}', '10.0.0.1', 'test');
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  acompte_pct_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0031', 'aaaaaaaa-0000-0000-0000-00000000000a', 'acompte',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0031', 200, 'franchise',
  3000, 30000, 0, 30000, '[{"taux_bp":0,"base_ht_cents":30000,"tva_cents":0}]', 30000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0031', 1, 'Acompte 30 %', 10000, 'forfait', 30000, 0, 30000);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0031', '{}', '{}', '{}',
    'aaaaaaaa-0000-0000-0000-00000000000a/f31.pdf', repeat('3', 64))$$,
  'maximum paramétré', 'délai de paiement de 200 jours refusé (maximum paramétré 60)');
update public.factures set delai_paiement_jours = 30 where id = 'aaaaaaaa-0000-0000-0000-0000000f0031';
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0031', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/f31.pdf', repeat('3', 64));
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0031', public.aujourd_hui_paris(), 30000, 'especes');
update public.chantiers set statut = 'termine' where id = 'aaaaaaaa-0000-0000-0000-0000000ca003';
select tests.egal((select statut_affiche from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca003'),
  'termine', 'chantier : acompte seul payé -> pas « payé » (reste à facturer)');
select tests.egal((select reste_a_facturer_cents from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca003'),
  70000::bigint, 'chantier : reste à facturer 700,00');

-- Avoir partiel sur facture NON payée : aucun remboursement possible
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0041', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 100000, 0, 100000,
  '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]', 100000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0041', 1, 'Travaux', 10000, 'forfait', 100000, 0, 100000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0041', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/f41.pdf', repeat('4', 64));
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0042', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'reduction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f0041', 0, 'franchise', 30000, 0, 30000,
  '[{"taux_bp":0,"base_ht_cents":30000,"tva_cents":0}]', 30000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0042', 1, 'Geste commercial', 10000, 'forfait', 30000, 0, 30000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0042', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/a42.pdf', repeat('4', 64));
select tests.egal((select reste_a_rembourser_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0042'),
  0::bigint, 'avoir sur facture non payée : rien à rembourser');
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0042', public.aujourd_hui_paris(), 30000, 'virement')$$,
  'payé en trop', 'remboursement refusé si le client n''a rien payé en trop');
select tests.egal((select reste_a_payer_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0041'),
  70000::bigint, 'facture 1 000,00 avec avoir de 300,00 : reste 700,00');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0041', public.aujourd_hui_paris(), 70000, 'virement');
select tests.egal((select sum(montant_cents) from public.v_livre_recettes where facture_id in
     ('aaaaaaaa-0000-0000-0000-0000000f0041', 'aaaaaaaa-0000-0000-0000-0000000f0042')),
  70000::numeric, 'livre des recettes : 700,00 réellement encaissés');

-- Paiement erroné sur une facture ensuite annulée par avoir : annulable ;
-- reste à payer jamais négatif
select tests.egal((select reste_a_payer_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0021'),
  0::bigint, 'reste à payer borné à zéro (facture payée puis annulée)');
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0051', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 5000, 0, 5000,
  '[{"taux_bp":0,"base_ht_cents":5000,"tva_cents":0}]', 5000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0051', 1, 'X', 10000, 'u', 5000, 0, 5000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0051', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/f51.pdf', repeat('5', 64));
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, reference)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0051',
  public.aujourd_hui_paris(), 5000, 'cheque', 'ERREUR-51');
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0052', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f0051', 0, 'franchise', 5000, 0, 5000,
  '[{"taux_bp":0,"base_ht_cents":5000,"tva_cents":0}]', 5000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0052', 1, 'Annulation', 10000, 'u', 5000, 0, 5000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0052', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/a52.pdf', repeat('5', 64));
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, annule_paiement_id)
select 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0051', public.aujourd_hui_paris(), -5000, 'cheque', id
from public.paiements where reference = 'ERREUR-51';
select tests.egal((select paye_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0051'),
  0::bigint, 'paiement erroné annulable sur une facture annulée par avoir');
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0051', public.aujourd_hui_paris(), 100, 'cheque')$$,
  'facture émise', 'aucun nouvel encaissement sur une facture annulée');

-- Geste commercial après facture finale (avoir de RÉDUCTION) : le chantier
-- est soldé, et la somme abandonnée ne se refacture pas.
insert into public.chantiers (id, organisation_id, client_id, nom)
values ('aaaaaaaa-0000-0000-0000-0000000ca061', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'Salon');
insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0061', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca061', 30, 'franchise',
  100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0061', 1, 'Salon', 10000, 'forfait', 100000, 0, 100000);
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0061', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/d61.pdf', repeat('6', 64));
select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0061', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/61.png', repeat('6', 64), '{}', '10.0.0.1', 'test');
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0061', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0061', 30, 'franchise',
  100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]', 100000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0061', 1, 'Salon', 10000, 'forfait', 100000, 0, 100000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0061', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f61.pdf', repeat('6', 64));
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0062', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'reduction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f0061', 0, 'franchise',
  10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', 10000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0062', 1, 'Geste commercial', 10000, 'forfait', 10000, 0, 10000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0062', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/a62.pdf', repeat('6', 64));
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0061', public.aujourd_hui_paris(), 90000, 'virement');
update public.chantiers set statut = 'termine' where id = 'aaaaaaaa-0000-0000-0000-0000000ca061';
select tests.egal((select statut_affiche || '/' || reste_a_facturer_cents from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca061'),
  'paye/0', 'geste commercial (avoir de réduction) : chantier « payé », rien à refacturer');
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0063', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0061', 30, 'franchise',
  10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', 10000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0063', 1, 'Refacturation', 10000, 'forfait', 10000, 0, 10000);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0063', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f63.pdf', repeat('6', 64))$$,
  'dépasserait le devis', 'la somme abandonnée par un geste commercial ne se refacture pas');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0063';

-- Situation : avancement obligatoire sur chaque ligne
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  avancement_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0071', 'aaaaaaaa-0000-0000-0000-00000000000a', 'situation',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000d0031', 30, 'franchise', 5000,
  100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]', 100000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0071', 1, 'Cuisine', 10000, 'forfait', 100000, 0, 100000);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0071', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f71.pdf', repeat('7', 64))$$,
  'avancement manquant', 'situation : une ligne sans avancement est refusée');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0071';

-- Annuler un encaissement déjà remboursé : refusé
select tests.echoue(
  $$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, annule_paiement_id)
    select 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0021', public.aujourd_hui_paris(), -10000, 'cheque', id
    from public.paiements where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f0021' and montant_cents > 0$$,
  'déjà été remboursé', 'annulation d''un encaissement déjà remboursé refusée');

-- Paliers d'alerte ordonnés
select tests.echoue(
  $$update public.parametres_entreprise set seuil_alerte_1_bp = 9900, seuil_alerte_2_bp = 100$$,
  'check constraint', 'paliers d''alerte : le premier ne dépasse pas le second');

-- Passe 3 sécurité : ligne reprise d'un devis non accepté refusée à l'émission
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0081', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (id, organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000a811', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000d0081', 1, 'X', 10000, 'u', 10000, 0, 10000);
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0081', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', 10000);
select tests.echoue(
  $$insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
      prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents, devis_ligne_id)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0081', 1, 'X', 10000, 'u', 10000, 0, 10000,
      'aaaaaaaa-0000-0000-0000-00000000a811')$$,
  'devis de la facture', 'sécurité : une facture ne reprend que des lignes de SON devis (effacement RGPD toujours possible)');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0081';
delete from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0081';

-- Autoliquidation : lignes à 20 %, aucune TVA facturée
update public.parametres_entreprise set regime_tva = 'assujetti' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, autoliquidation,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0091', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'assujetti', true, 100000, 0, 100000,
  '[{"taux_bp":2000,"base_ht_cents":100000,"tva_cents":0}]', 100000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0091', 1, 'Sous-traitance', 10000, 'forfait', 100000, 2000, 100000);
select tests.egal(
  (select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0091', '{}', '{}', '{}',
     'aaaaaaaa-0000-0000-0000-00000000000a/f91.pdf', repeat('9', 64)) is not null),
  true, 'autoliquidation : facture à 20 % émise sans TVA');

-- Passe 4 chef-de-projet : tous les rattachements qui alimentent un cumul sont contraints
select tests.echoue(
  $$insert into public.factures (organisation_id, type, nature_avoir, client_id, facture_origine_id, devis_id,
      delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction', 'aaaaaaaa-0000-0000-0000-0000000c0001',
      'aaaaaaaa-0000-0000-0000-0000000f0041', 'aaaaaaaa-0000-0000-0000-0000000d0061', 0, 'franchise', 100, 0, 100,
      '[{"taux_bp":0,"base_ht_cents":100,"tva_cents":0}]', 100)$$,
  'check constraint', 'un avoir ne porte ni devis ni chantier propres (pas de sur-facturation détournée)');
select tests.echoue(
  $$insert into public.factures (organisation_id, type, nature_avoir, client_id, facture_origine_id, chantier_id,
      delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction', 'aaaaaaaa-0000-0000-0000-0000000c0001',
      'aaaaaaaa-0000-0000-0000-0000000f0041', 'aaaaaaaa-0000-0000-0000-0000000ca061', 0, 'franchise', 100, 0, 100,
      '[{"taux_bp":0,"base_ht_cents":100,"tva_cents":0}]', 100)$$,
  'check constraint', 'un avoir ne rouvre pas un autre chantier');
-- Facture sur un devis, mais pour un autre client
insert into public.factures (id, organisation_id, type, client_id, devis_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0002', 'aaaaaaaa-0000-0000-0000-0000000d0031', 30, 'franchise', 100, 0, 100,
  '[{"taux_bp":0,"base_ht_cents":100,"tva_cents":0}]', 100);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0101', 1, 'X', 10000, 'u', 100, 0, 100);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0101', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f101.pdf', repeat('1', 64))$$,
  'client et le chantier de son devis', 'facture rattachée au devis d''un autre client refusée');
-- Même devis, autre chantier
update public.factures set client_id = 'aaaaaaaa-0000-0000-0000-0000000c0001', chantier_id = 'aaaaaaaa-0000-0000-0000-0000000ca061'
where id = 'aaaaaaaa-0000-0000-0000-0000000f0101';
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0101', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f101.pdf', repeat('1', 64))$$,
  'client et le chantier de son devis', 'facture rattachée à un autre chantier que celui de son devis refusée');
-- Chantier d'un autre client
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0101';
insert into public.factures (id, organisation_id, type, client_id, chantier_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0103', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca002', 30, 'franchise', 100, 0, 100,
  '[{"taux_bp":0,"base_ht_cents":100,"tva_cents":0}]', 100);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0103', 1, 'X', 10000, 'u', 100, 0, 100);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0103', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f103.pdf', repeat('1', 64))$$,
  'autre client', 'facture sur le chantier d''un autre client refusée');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0103';
-- Avoir d'un avoir
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0102', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f0042', 0, 'franchise', 100, 0, 100,
  '[{"taux_bp":0,"base_ht_cents":100,"tva_cents":0}]', 100);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0102', 1, 'X', 10000, 'u', 100, 0, 100);
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0102', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/a102.pdf', repeat('1', 64))$$,
  'pas un avoir', 'un avoir ne corrige pas un avoir');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0102';
-- Montants de déduction en texte : refusés (nombres JSON exigés)
select tests.echoue(
  $$update public.factures set deductions = '[{"facture_id":"aaaaaaaa-0000-0000-0000-0000000f0001","numero":"FAC-2026-0001","ht":"1","tva":"0","ttc":"1"}]'
    where id = 'aaaaaaaa-0000-0000-0000-0000000f0009'$$,
  'check constraint', 'déductions : montants en nombres JSON uniquement');

-- Passe 4 sécurité : PV de réception et attestations signés figés
insert into public.pv_reception (id, organisation_id, chantier_id, date_reception, avec_reserves, reserves)
values ('aaaaaaaa-0000-0000-0000-0000000b0001', 'aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), true, '[{"description":"Retouche plinthe"}]');
select tests.echoue(
  $$update public.pv_reception set signature_id = (select id from public.signatures where document_id = 'aaaaaaaa-0000-0000-0000-0000000d0001')
    where id = 'aaaaaaaa-0000-0000-0000-0000000b0001'$$,
  'permission denied', 'sécurité : l''API ne rattache pas de signature à un PV');
select tests.echoue(
  $$insert into public.pv_reception (organisation_id, chantier_id, date_reception, signature_id)
    select 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), id
    from public.signatures where document_id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'permission denied', 'sécurité : pas de PV créé « déjà signé »');
select tests.echoue(
  $$update public.pv_reception set pdf_sha256 = repeat('0', 64) where id = 'aaaaaaaa-0000-0000-0000-0000000b0001'$$,
  'permission denied', 'sécurité : l''empreinte du PV n''est pas posée par l''API');
-- Même hors API (propriétaire) : la signature d'un DEVIS ne peut pas servir pour un PV
reset role;
select tests.echoue(
  $$update public.pv_reception set signature_id = (select id from public.signatures where document_id = 'aaaaaaaa-0000-0000-0000-0000000d0001')
    where id = 'aaaaaaaa-0000-0000-0000-0000000b0001'$$,
  'ne correspond pas', 'signature d''un devis réutilisée pour un PV : refusée même hors API');
-- Attestation signée sur un devis brouillon : refusée (l'effacement RGPD doit rester possible)
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0b01', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001',
  30, 'assujetti', 0, 0, 0, '[]');
insert into public.taux_tva (organisation_id, taux_bp, libelle, attestation_requise)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 1000, '10 % (EXEMPLE)', true) on conflict do nothing;
insert into public.attestations_tva (id, organisation_id, devis_id, taux_bp)
values ('aaaaaaaa-0000-0000-0000-0000000b7001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0b01', 1000);
insert into public.signatures (id, organisation_id, document_type, document_id, methode, signataire_nom, mention,
  image_chemin, document_sha256)
values ('aaaaaaaa-0000-0000-0000-0000000b7501', 'aaaaaaaa-0000-0000-0000-00000000000a', 'attestation_tva',
  'aaaaaaaa-0000-0000-0000-0000000b7001', 'sur_place', 'Paul Durand', 'Lu et approuvé',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/at1.png', repeat('b', 64));
select tests.echoue(
  $$update public.attestations_tva set signature_id = 'aaaaaaaa-0000-0000-0000-0000000b7501' where id = 'aaaaaaaa-0000-0000-0000-0000000b7001'$$,
  'devis envoyé ou accepté', 'attestation signée sur un devis brouillon refusée (même hors API)');
delete from public.attestations_tva where id = 'aaaaaaaa-0000-0000-0000-0000000b7001';
delete from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0b01';
-- PV réellement signé : figé
insert into public.signatures (id, organisation_id, document_type, document_id, methode, signataire_nom, mention,
  image_chemin, document_sha256)
values ('aaaaaaaa-0000-0000-0000-0000000b5001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'pv_reception',
  'aaaaaaaa-0000-0000-0000-0000000b0001', 'sur_place', 'Paul Durand', 'Lu et approuvé',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/pv1.png', repeat('b', 64));
update public.pv_reception set signature_id = 'aaaaaaaa-0000-0000-0000-0000000b5001' where id = 'aaaaaaaa-0000-0000-0000-0000000b0001';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.echoue(
  $$update public.pv_reception set avec_reserves = false, reserves = '[]' where id = 'aaaaaaaa-0000-0000-0000-0000000b0001'$$,
  'Ce PV est signé', 'sécurité : réserves d''un PV signé non effaçables');
select tests.echoue($$delete from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b0001'$$,
  'PV signé ne peut pas être supprimé', 'sécurité : PV signé non supprimable');
select tests.echoue(
  $$insert into public.attestations_tva (organisation_id, devis_id, taux_bp, signature_id)
    select 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0001', 1000, id
    from public.signatures where document_id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'permission denied', 'sécurité : pas d''attestation de TVA créée « déjà signée »');
-- Formes : élément vide refusé
select tests.egal(public.ventilation_bien_formee('[{}]') or public.deductions_bien_formees('[{}]'), false,
  'formes strictes : un élément vide est refusé');

-- =============================================================================
-- REFONTE (source unique des cumuls) : matrice des chemins de rattachement
-- =============================================================================
insert into public.chantiers (id, organisation_id, client_id, nom)
values ('aaaaaaaa-0000-0000-0000-0000000ca201', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'Séjour');
insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva, acompte_pct_bp,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0201', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca201', 30, 'franchise', 3000,
  100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0201', 1, 'Séjour', 10000, 'forfait', 100000, 0, 100000);

-- Chemin « client du chantier » (P22) : libre tant que rien n'est émis
update public.chantiers set client_id = 'aaaaaaaa-0000-0000-0000-0000000c0002' where id = 'aaaaaaaa-0000-0000-0000-0000000ca201';
update public.chantiers set client_id = 'aaaaaaaa-0000-0000-0000-0000000c0001' where id = 'aaaaaaaa-0000-0000-0000-0000000ca201';
select tests.egal(true, true, 'chantier sans document émis : client modifiable');
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0201', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/d201.pdf', repeat('2', 64));
select tests.echoue($$update public.chantiers set client_id = 'aaaaaaaa-0000-0000-0000-0000000c0002' where id = 'aaaaaaaa-0000-0000-0000-0000000ca201'$$,
  'ne peut plus changer', 'P22 : client du chantier figé dès qu''un devis est émis');
select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0201', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/201.png', repeat('2', 64), '{}', '10.0.0.1', 'test');

-- Chemin « devis_id » : acompte 300 (non payé), finale 1 000 qui le déduit (net 700)
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, devis_id)
values ('aaaaaaaa-0000-0000-0000-0000000f0201', 'aaaaaaaa-0000-0000-0000-00000000000a', 'acompte', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 30000, 0, 30000, '[{"taux_bp":0,"base_ht_cents":30000,"tva_cents":0}]', 30000, 'aaaaaaaa-0000-0000-0000-0000000d0201');
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0201', 1, 'Travaux', 10000, 'forfait', 30000, 0, 30000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0201', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0201.pdf', repeat('a', 64));
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, devis_id)
values ('aaaaaaaa-0000-0000-0000-0000000f0202', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]', 70000, 'aaaaaaaa-0000-0000-0000-0000000d0201');
update public.factures set deductions = (select jsonb_agg(jsonb_build_object('facture_id', id, 'numero', numero,
  'ht', total_ht_cents, 'tva', total_tva_cents, 'ttc', total_ttc_cents)) from public.factures where id in ('aaaaaaaa-0000-0000-0000-0000000f0201'))
where id = 'aaaaaaaa-0000-0000-0000-0000000f0202';
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0202', 1, 'Travaux', 10000, 'forfait', 100000, 0, 100000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0202', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0202.pdf', repeat('a', 64));
select tests.egal((select reste_a_facturer_cents from public.solde_devis('aaaaaaaa-0000-0000-0000-0000000d0201')), 0::bigint,
  'source unique : devis entièrement facturé (300 + 700)');

-- Chemin « facture_origine_id » (P21) : l'avoir porte sur le NET (700), pas sur le total (1 000)
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, facture_origine_id, nature_avoir)
values ('aaaaaaaa-0000-0000-0000-0000000f0203', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]', 100000, 'aaaaaaaa-0000-0000-0000-0000000f0202', 'correction');
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0203', 1, 'Travaux', 10000, 'forfait', 100000, 0, 100000);
select tests.echoue($$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0203', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0203.pdf', repeat('a', 64))$$, 'net à payer',
  'P21 : avoir de 1 000 sur une finale au net de 700 refusé');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0203';
-- Chemin « deductions » : on ne corrige pas un acompte encore déduit par une facture valable
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours,
  regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f0205', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f0201', 0, 'franchise', 30000, 0, 30000,
  '[{"taux_bp":0,"base_ht_cents":30000,"tva_cents":0}]', 30000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0205', 1, 'Annulation acompte', 10000, 'forfait', 30000, 0, 30000);
select tests.echoue($$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0205', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0205.pdf', repeat('a', 64))$$, 'annulez d''abord', 'acompte déduit par une facture en cours : avoir refusé');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0205';
-- Avoir de 700 = net : la finale est annulée, ses acomptes sont libérés
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, facture_origine_id, nature_avoir)
values ('aaaaaaaa-0000-0000-0000-0000000f0203', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 70000, 0, 70000, '[{"taux_bp":0,"base_ht_cents":70000,"tva_cents":0}]', 70000, 'aaaaaaaa-0000-0000-0000-0000000f0202', 'correction');
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0203', 1, 'Travaux', 10000, 'forfait', 70000, 0, 70000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0203', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0203.pdf', repeat('a', 64));
select tests.egal((select statut::text from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0202'), 'annulee',
  'P21 : avoir égal au net : finale annulée');
select tests.egal((select reste_a_rembourser_cents from public.v_factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0203'), 0::bigint,
  'P21 : rien à rembourser (le client n''avait rien payé)');
select tests.echoue($$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0203', public.aujourd_hui_paris(), 30000, 'virement')$$, 'payé en trop',
  'P21 : aucun « remboursement » de 300 sans encaissement');
select tests.egal((select engage_cents || '/' || reste_a_facturer_cents from public.solde_devis('aaaaaaaa-0000-0000-0000-0000000d0201')), '30000/70000',
  'P21 : après annulation, seul l''acompte reste engagé (700 à refacturer)');
-- Nouvelle finale : elle peut re-déduire l'acompte libéré ; total exigible = 1 000, pas 1 300
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, devis_id)
values ('aaaaaaaa-0000-0000-0000-0000000f0204', 'aaaaaaaa-0000-0000-0000-00000000000a', 'finale', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]', 70000, 'aaaaaaaa-0000-0000-0000-0000000d0201');
update public.factures set deductions = (select jsonb_agg(jsonb_build_object('facture_id', id, 'numero', numero,
  'ht', total_ht_cents, 'tva', total_tva_cents, 'ttc', total_ttc_cents)) from public.factures where id in ('aaaaaaaa-0000-0000-0000-0000000f0201'))
where id = 'aaaaaaaa-0000-0000-0000-0000000f0204';
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0204', 1, 'Travaux', 10000, 'forfait', 100000, 0, 100000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0204', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0204.pdf', repeat('a', 64));
select tests.egal((select sum(reste_a_payer_cents) from public.v_factures where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0201'), 100000::numeric,
  'P21 : exigible total = 1 000 (acompte 300 + finale 700), jamais 1 300');
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, devis_id)
values ('aaaaaaaa-0000-0000-0000-0000000f0206', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 1, 0, 1, '[{"taux_bp":0,"base_ht_cents":1,"tva_cents":0}]', 1, 'aaaaaaaa-0000-0000-0000-0000000d0201');
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0206', 1, 'Travaux', 10000, 'forfait', 1, 0, 1);
select tests.echoue($$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0206', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0206.pdf', repeat('a', 64))$$, 'dépasserait le devis', 'P21 : plus un centime au-delà du devis');
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f0206';
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0201', public.aujourd_hui_paris(), 30000, 'virement');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0204', public.aujourd_hui_paris(), 70000, 'virement');
update public.chantiers set statut = 'termine' where id = 'aaaaaaaa-0000-0000-0000-0000000ca201';
select tests.egal((select statut_affiche from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca201'), 'paye',
  'refonte : chantier soldé (acompte + nouvelle finale payés) -> « payé »');

-- Chemin « chantier_id » (P23) : une facture libre payée ne solde pas le devis du chantier
insert into public.chantiers (id, organisation_id, client_id, nom)
values ('aaaaaaaa-0000-0000-0000-0000000ca211', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'Entrée');
insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0211', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000ca211', 30, 'franchise',
  100000, 0, 100000, '[{"taux_bp":0,"base_ht_cents":100000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0211', 1, 'Entrée', 10000, 'forfait', 100000, 0, 100000);
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d0211', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/d211.pdf', repeat('2', 64));
select public.signer_devis_sur_place('aaaaaaaa-0000-0000-0000-0000000d0211', 'Paul Durand', 'Bon pour accord',
  'aaaaaaaa-0000-0000-0000-00000000000a/sig/211.png', repeat('2', 64), '{}', '10.0.0.1', 'test');
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents, chantier_id)
values ('aaaaaaaa-0000-0000-0000-0000000f0211', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 20000, 0, 20000, '[{"taux_bp":0,"base_ht_cents":20000,"tva_cents":0}]', 20000, 'aaaaaaaa-0000-0000-0000-0000000ca211');
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite,
  prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0211', 1, 'Travaux', 10000, 'forfait', 20000, 0, 20000);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0211', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/0f0211.pdf', repeat('a', 64));
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f0211', public.aujourd_hui_paris(), 20000, 'virement');
update public.chantiers set statut = 'termine' where id = 'aaaaaaaa-0000-0000-0000-0000000ca211';
select tests.egal((select statut_affiche || '/' || reste_a_facturer_cents from public.v_chantiers where id = 'aaaaaaaa-0000-0000-0000-0000000ca211'),
  'termine/100000', 'P23 : travaux supplémentaires payés, devis jamais facturé -> « à facturer » 1 000');

-- Invariants globaux, sur TOUTES les données de test (garde-fou de la cause racine)
select tests.egal((select count(*) from public.devis d, lateral public.solde_devis(d.id) s
                   where d.statut = 'accepte' and s.engage_cents > s.accepte_ttc_cents), 0::bigint,
  'invariant : aucun devis accepté facturé au-delà de son total');
select tests.egal((select count(*) from public.factures f, lateral public.solde_facture(f.id) s
                   where f.type <> 'avoir' and f.statut <> 'brouillon'
                     and (s.avoirs_cents > f.net_a_payer_cents
                          or s.rembourse_cents > greatest(0, s.paye_cents - s.du_cents))), 0::bigint,
  'invariant : avoirs <= net à payer, remboursé <= trop-perçu, pour chaque facture');
select tests.egal((select count(*) from public.factures f
                   where f.statut = 'emise' and f.type <> 'avoir' and exists (
                     select 1 from public.factures g, jsonb_array_elements(g.deductions) e
                     where g.statut = 'emise' and g.id <> f.id and (e ->> 'facture_id')::uuid = f.id
                     group by (e ->> 'facture_id') having count(*) > 1)), 0::bigint,
  'invariant : un acompte n''est déduit que par une seule facture valable');
select tests.egal((select count(*) from public.v_chantiers c
                   where exists (select 1 from public.devis d where d.chantier_id = c.id and d.statut <> 'brouillon'
                                 and d.client_id <> c.client_id)), 0::bigint,
  'invariant : chaque devis émis a le client de son chantier');

-- Invariants globaux complets (tests/db/verif.sql) sur toutes les données de test
reset role;
\ir verif.sql
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.egal((select string_agg(invariant || ' : ' || violations, ' | ') from verif.invariants() where violations > 0),
  null::text, 'invariants globaux I1 à I9 : aucune violation');

-- Phase 1 : double authentification imposée par la base (RLS)
reset role;
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'totp', 'verified', now(), now());
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","aal":"aal1"}';
select tests.egal((select count(*) from public.clients), 0::bigint,
  'double authentification : session aal1 d''un compte avec code TOTP -> aucune donnée');
select tests.echoue($$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0009', '{}', '{}', '{}', 'x', repeat('a', 64))$$,
  'introuvable', 'double authentification : aucune fonction métier en aal1');
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","aal":"aal2"}';
select tests.egal((select count(*) > 0 from public.clients), true,
  'double authentification : session aal2 -> données visibles');
reset role;
delete from auth.mfa_factors where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset request.jwt.claims;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Phase 1 : recherche de clients (RLS, accents, téléphone, caractères spéciaux)
insert into public.clients (organisation_id, nom, prenom, email, telephone, fact_ville)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Hélène', 'Müller', 'h.muller@exemple.test', '06 12 34 56 78', 'Thionville'),
       ('aaaaaaaa-0000-0000-0000-00000000000a', 'Pourcent%', 'Test_', null, '+33 7 99 88 77 66', null);
select tests.egal((select count(*) from public.rechercher_clients('helene')), 1::bigint, 'recherche sans accent trouve « Hélène »');
insert into public.clients (organisation_id, nom, prenom) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Œuvray', 'Lætitia');
select tests.egal((select count(*) from public.rechercher_clients('laetitia oeuvray')), 0::bigint, 'recherche : mots dans l''ordre de la fiche');
select tests.egal((select count(*) from public.rechercher_clients('oeuvray laetitia')), 1::bigint, 'recherche : ligatures œ et æ développées');
select tests.egal(public.confirmer_valeurs('aaaaaaaa-0000-0000-0000-00000000000a', array['delai_paiement_jours']), true,
  'confirmation atomique d''une valeur À VÉRIFIER');
select tests.egal((select 'delai_paiement_jours' = any (valeurs_a_verifier) or not ('validite_devis_jours' = any (valeurs_a_verifier))
                   from public.parametres_entreprise where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  false, 'confirmation : seule la valeur confirmée est retirée de la liste');
select tests.egal((select count(*) from public.rechercher_clients('MULLER')), 1::bigint, 'recherche insensible à la casse et aux trémas');
select tests.egal((select count(*) from public.rechercher_clients('0612345678')), 1::bigint, 'recherche par téléphone sans espaces');
select tests.egal((select count(*) from public.rechercher_clients('+33 6.12')), 1::bigint, 'recherche par numéro avec indicatif et points');
select tests.egal((select count(*) from public.rechercher_clients('07 99 88')), 1::bigint, 'recherche nationale trouve aussi un numéro saisi en +33');
select tests.egal((select count(*) from public.rechercher_clients('Dupont-6')), 0::bigint, 'un chiffre dans un nom ne déclenche pas la recherche par téléphone');
select tests.egal((select count(*) from public.rechercher_clients('12 34')), 1::bigint, 'recherche par morceau de téléphone avec espace');
select tests.egal((select count(*) from public.rechercher_clients('%')), 1::bigint, '« % » cherché comme caractère, pas comme joker');
select tests.egal((select count(*) from public.rechercher_clients('t_')), 1::bigint, '« _ » cherché comme caractère, pas comme joker');
select tests.egal((select count(*) from public.rechercher_clients('thion')), 1::bigint, 'recherche par ville');
select tests.egal((select count(*) from public.rechercher_clients(p_type => 'professionnel')), 0::bigint, 'filtre par type');
select tests.echoue($$select public.purger_prospects_inactifs()$$, 'permission denied', 'purge des prospects réservée au serveur');

-- -----------------------------------------------------------------------------
-- 4. Utilisateur B : ne voit ni ne touche rien de A
-- -----------------------------------------------------------------------------
-- Phase 2 : valeurs de départ du calcul, toutes À VÉRIFIER, créées pour chaque organisation.
select tests.egal((select count(*) from public.referentiel_calcul where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and statut_verification = 'a_verifier'),
  13::bigint, 'calcul : une ligne par type de produit (13), toutes À VÉRIFIER');
select tests.egal((select string_agg(type_produit, ',' order by type_produit) from public.referentiel_calcul
                   where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and rendement_min is null),
  'anti_humidite,anti_rouille,autre,facade,sous_couche_bloquante', 'calcul : sans fourchette au cahier des charges, rendement vide (rien d''inventé)');
select tests.egal((select count(*) from public.referentiel_calcul where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and sechage_recouvrable_h is not null),
  0::bigint, 'calcul : aucun temps de séchage inventé');
select tests.egal((select string_agg(code || ':' || type_produit || ':' || couches, ',' order by code) from public.etapes_preparation
                   where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type_produit is not null),
  'enduit_1_passe:enduit:1,enduit_2_passes:enduit:2,impression:impression:1,sous_couche_bloquante:sous_couche_bloquante:1',
  'préparation : matière des étapes par type de produit (impression, bloquante, enduit)');
select tests.echoue($$update public.referentiel_calcul set rendement_min = 12, rendement_max = 10
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type_produit = 'laque'$$, 'referentiel_rendements',
  'référentiel : minimum supérieur au maximum refusé');
select tests.egal((select rendement_min::text || '-' || rendement_max::text from public.referentiel_calcul
                   where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type_produit = 'acrylique'),
  '10.00-12.00', 'calcul : acrylique 10 à 12 m²/L (cahier des charges §5.4)');
select tests.egal((select count(*) from public.referentiel_calcul where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and minutes_par_m2_couche is not null),
  0::bigint, 'calcul : aucun temps de pose inventé');
select tests.egal((select count(*) from public.coefficients_support where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and coef_rendement_bp = 10000 and statut_verification = 'a_verifier'),
  10::bigint, 'calcul : 10 supports, coefficient neutre 1,00 À VÉRIFIER');
select tests.egal((select count(*) from public.etapes_preparation where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and minutes_par_m2 = 0 and statut_verification = 'a_verifier'),
  11::bigint, 'calcul : 11 étapes de préparation, temps à renseigner');
select tests.egal((select porte_largeur_mm || 'x' || porte_hauteur_mm || ' ' || array_to_string(formats_pots_ml, ',') from public.parametres_entreprise
                   where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  '830x2040 1000,2500,5000,10000,15000', 'paramètres : porte 83 × 204 cm, pots 1 / 2,5 / 5 / 10 / 15 L');
select tests.echoue($$update public.parametres_entreprise set formats_pots_ml = array[1000, 0] where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'check', 'paramètres : format de pot nul refusé');
select tests.echoue($$insert into public.postes_travaux (organisation_id, piece_id, cible, support)
  select organisation_id, id, 'murs', 'beton' from public.pieces where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' limit 1$$,
  'poste_produit_ou_type', 'poste : un produit ou un type de produit est exigé');
select tests.echoue($$insert into public.consommables (organisation_id, libelle, mode, prix_ht_cents)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Bâches', 'par_m2', -1)$$, 'check', 'consommable : prix négatif refusé');
insert into public.consommables (organisation_id, libelle, mode, prix_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Bâches et adhésif', 'par_chantier', 2500);

-- Duplication atomique d'une pièce (ouvertures, éléments, postes, préparations).
insert into public.pieces (id, organisation_id, chantier_id, nom, mode_saisie, longueur_mm, largeur_mm, hauteur_mm)
values ('aaaaaaaa-0000-0000-0000-0000000d1e01', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', 'Chambre 1', 'rectangle', 4000, 3000, 2500);
insert into public.ouvertures (organisation_id, piece_id, type, largeur_mm, hauteur_mm)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d1e01', 'porte', 830, 2040);
insert into public.elements (id, organisation_id, piece_id, type, unite, quantite_e4, developpe_mm)
values ('aaaaaaaa-0000-0000-0000-0000000d1e02', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d1e01', 'plinthe', 'ml', 140000, 100);
insert into public.postes_travaux (id, organisation_id, piece_id, cible, element_id, support, type_produit)
values ('aaaaaaaa-0000-0000-0000-0000000d1e03', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d1e01', 'element',
        'aaaaaaaa-0000-0000-0000-0000000d1e02', 'bois_brut', 'laque');
select public.definir_preparations('aaaaaaaa-0000-0000-0000-0000000d1e03',
  array(select id from public.etapes_preparation where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and code in ('poncage', 'impression')));
select tests.egal((select count(*) from public.postes_preparations where poste_id = 'aaaaaaaa-0000-0000-0000-0000000d1e03'), 2::bigint,
  'préparations : deux étapes enregistrées');
select public.definir_preparations('aaaaaaaa-0000-0000-0000-0000000d1e03',
  array(select id from public.etapes_preparation where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and code = 'poncage'));
select tests.egal((select count(*) from public.postes_preparations where poste_id = 'aaaaaaaa-0000-0000-0000-0000000d1e03'), 1::bigint,
  'préparations : remplacées en bloc');
-- (Duplication d'abord, vérification ensuite : une même requête ne voit pas
-- les lignes insérées par la fonction qu'elle appelle.)
select set_config('tests.copie', public.dupliquer_piece('aaaaaaaa-0000-0000-0000-0000000d1e01', 'Chambre 2')::text, false);
select tests.egal((select count(*) from public.pieces p
  join public.ouvertures o on o.piece_id = p.id
  join public.elements e on e.piece_id = p.id
  join public.postes_travaux t on t.piece_id = p.id and t.element_id = e.id
  join public.postes_preparations x on x.poste_id = t.id
  where p.id = current_setting('tests.copie')::uuid and p.nom = 'Chambre 2'), 1::bigint,
  'duplication : ouverture, élément, poste rattaché au NOUVEL élément, préparation');

-- Copie d'un poste (murs) vers d'autres pièces : préparations comprises, sans doublon au second envoi.
insert into public.postes_travaux (id, organisation_id, piece_id, cible, support, type_produit, finition, teinte_libre, exterieur)
values ('aaaaaaaa-0000-0000-0000-0000000d1e04', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d1e01', 'murs',
        'platre_neuf', 'acrylique', 'velours', 'Blanc RAL 9010', true);
select public.definir_preparations('aaaaaaaa-0000-0000-0000-0000000d1e04',
  array(select id from public.etapes_preparation where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and code = 'impression'));
select tests.egal(public.copier_poste('aaaaaaaa-0000-0000-0000-0000000d1e04', array[current_setting('tests.copie')::uuid, 'aaaaaaaa-0000-0000-0000-0000000d1e01']),
  1, 'copie de poste : une pièce copiée (la pièce d''origine est ignorée)');
select tests.egal(public.copier_poste('aaaaaaaa-0000-0000-0000-0000000d1e04', array[current_setting('tests.copie')::uuid]),
  0, 'copie de poste : un second envoi ne crée pas de doublon');
select tests.egal((select bool_and(id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') from public.postes_travaux
  where piece_id = current_setting('tests.copie')::uuid and cible = 'murs'), true, 'copie de poste : identifiant au format UUID (version 5, variante RFC)');
select tests.egal(public.dupliquer_piece('aaaaaaaa-0000-0000-0000-0000000d1e01', 'Chambre 3', 'aaaaaaaa-0000-4000-8000-0000000d1e09'),
  'aaaaaaaa-0000-4000-8000-0000000d1e09'::uuid, 'duplication : identifiant fixé par le formulaire');
select tests.egal(public.dupliquer_piece('aaaaaaaa-0000-0000-0000-0000000d1e01', 'Chambre 3', 'aaaaaaaa-0000-4000-8000-0000000d1e09'),
  'aaaaaaaa-0000-4000-8000-0000000d1e09'::uuid, 'duplication : un second envoi renvoie la même copie');
select tests.egal((select count(*) from public.pieces where nom = 'Chambre 3'), 1::bigint, 'duplication : pas de doublon au second envoi');
select tests.egal((select count(*) from public.postes_travaux t join public.postes_preparations x on x.poste_id = t.id
  where t.piece_id = current_setting('tests.copie')::uuid and t.cible = 'murs' and t.finition = 'velours'
    and t.teinte_libre = 'Blanc RAL 9010' and t.exterieur), 1::bigint, 'copie de poste : finition, teinte libre, extérieur et préparation recopiés');
select tests.echoue($$select public.copier_poste('aaaaaaaa-0000-0000-0000-0000000d1e03', array[current_setting('tests.copie')::uuid])$$,
  'élément', 'copie de poste : refusée pour un poste sur un élément');
select tests.echoue($$select public.copier_poste('aaaaaaaa-0000-0000-0000-0000000d1e04', array[gen_random_uuid()])$$,
  'introuvable', 'copie de poste : pièce hors du chantier refusée');
select tests.echoue($$update public.postes_travaux set teinte_libre = '  ' where id = 'aaaaaaaa-0000-0000-0000-0000000d1e04'$$,
  'check', 'teinte libre : texte vide refusé');

-- -----------------------------------------------------------------------------
-- Phase 3 : catalogue
-- -----------------------------------------------------------------------------
select tests.egal((select count(*) from public.produits where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'
  and marque = 'Exemple fictif' and statut_verification = 'fictif' and rendement_m2_par_unite is null and reference_fabricant is null), 2::bigint,
  'catalogue : 2 produits d''exemple FICTIFS, sans référence ni rendement');
select tests.egal((select count(*) from public.conditionnements c join public.produits p on p.id = c.produit_id
  where p.marque = 'Exemple fictif' and c.prix_achat_ht_cents is not null), 0::bigint, 'catalogue : aucun prix inventé sur les exemples');
select tests.egal((select count(*) from public.teintes where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and statut_verification = 'fictif'), 1::bigint,
  'nuancier : une teinte d''exemple FICTIVE');
select tests.echoue($$select public.initialiser_catalogue('aaaaaaaa-0000-0000-0000-00000000000a')$$, 'permission denied',
  'catalogue : une session ne peut pas réinitialiser les exemples');

-- Import : création, puis mise à jour (prix vide conservé, nouveau prix historisé, statut À VÉRIFIER).
select set_config('tests.import', public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": "Marque Test", "reference_fabricant": "REF-1", "designation": "Acrylique test", "type": "acrylique", "usages": ["mur"],
   "finition": "mat", "unite_mesure": "L", "rendement": 10.5, "couches": 2, "sechage_h": 6,
   "formats": [{"contenance": 2500, "prix_cents": 3000}, {"contenance": 10000, "prix_cents": 9000}]},
  {"marque": "Marque Test", "designation": "Enduit sans référence", "type": "enduit", "usages": ["mur"], "unite_mesure": "kg",
   "formats": [{"contenance": 5000, "prix_cents": null}]}
]')::text, false);
select tests.egal(current_setting('tests.import')::jsonb, '{"crees": 2, "mis_a_jour": 0}'::jsonb, 'import : 2 produits créés');
select tests.egal((select statut_verification::text from public.produits where reference_fabricant = 'REF-1'), 'a_verifier', 'import : statut À VÉRIFIER');
update public.produits set statut_verification = 'verifie', verifie_le = '2026-10-01', source_verification = 'fiche technique'
where reference_fabricant = 'REF-1';
select set_config('tests.import', public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": " marque test ", "reference_fabricant": "ref-1", "designation": "Acrylique test v2", "type": "acrylique", "usages": ["mur", "plafond"],
   "unite_mesure": "L", "formats": [{"contenance": 2500, "prix_cents": 3200}, {"contenance": 10000, "prix_cents": null}]}
]')::text, false);
select tests.egal(current_setting('tests.import')::jsonb, '{"crees": 0, "mis_a_jour": 1}'::jsonb, 'import : même marque + référence (casse, espaces) -> mise à jour');
select tests.egal((select designation || ' ' || statut_verification::text || ' ' || coalesce(verifie_le::text, '-') from public.produits where reference_fabricant = 'REF-1'),
  'Acrylique test v2 a_verifier -', 'import : une valeur importée redevient À VÉRIFIER');
select tests.egal((select string_agg(c.contenance || '=' || c.prix_achat_ht_cents, ',' order by c.contenance) from public.conditionnements c
  join public.produits p on p.id = c.produit_id where p.reference_fabricant = 'REF-1'), '2500=3200,10000=9000', 'import : prix vide conservé, prix changé appliqué');
select tests.egal((select count(*) from public.historique_prix h join public.conditionnements c on c.id = h.conditionnement_id
  join public.produits p on p.id = c.produit_id where p.reference_fabricant = 'REF-1'), 3::bigint, 'import : changement de prix historisé (3 entrées)');
select tests.echoue($$insert into public.produits (organisation_id, marque, reference_fabricant, designation, type)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'MARQUE TEST', 'Ref-1', 'Doublon', 'acrylique')$$, 'duplicate key', 'produit : même référence dans la même marque refusée');
-- Mise à jour partielle : colonnes absentes conservées ; rien de technique changé -> « vérifié » conservé.
update public.produits set rendement_m2_par_unite = 11, couches_recommandees = 2, sechage_recouvrable_h = 6, fournisseur = 'Négoce',
  statut_verification = 'verifie', verifie_le = '2026-10-01', source_verification = 'fiche' where reference_fabricant = 'REF-1';
select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": "Marque Test", "reference_fabricant": "REF-1", "designation": "Acrylique test v2", "type": "acrylique",
   "formats": [{"contenance": 2500, "prix_cents": 3200}]}
]');
select tests.egal((select concat_ws(' ', rendement_m2_par_unite, couches_recommandees, sechage_recouvrable_h, fournisseur, array_to_string(usages, ','), statut_verification, verifie_le)
  from public.produits where reference_fabricant = 'REF-1'), '11.00 2 6.0 Négoce mur,plafond verifie 2026-10-01',
  'import partiel (prix seuls) : rien d''effacé, vérification conservée');
select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": "Marque Test", "reference_fabricant": "REF-1", "designation": "Acrylique test v2", "type": "acrylique", "rendement": "12.00"}
]');
select tests.egal((select statut_verification::text || ' ' || rendement_m2_par_unite from public.produits where reference_fabricant = 'REF-1'),
  'a_verifier 12.00', 'import : rendement changé -> À VÉRIFIER');
update public.produits set statut_verification = 'verifie', verifie_le = '2026-10-01', source_verification = 'fiche' where reference_fabricant = 'REF-1';
select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": "Marque Test", "reference_fabricant": "REF-1", "designation": "Acrylique test v2", "type": "acrylique", "fiche_technique_url": " https://exemple.fr/nouvelle.pdf "}]');
select tests.egal((select statut_verification::text || ' ' || fiche_technique_url from public.produits where reference_fabricant = 'REF-1'),
  'a_verifier https://exemple.fr/nouvelle.pdf', 'import : lien de fiche changé (espaces retirés) -> À VÉRIFIER');
select tests.echoue($$select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": "Marque Test", "reference_fabricant": "REF-1", "designation": "Acrylique test v2", "type": "acrylique", "unite_mesure": "kg"}]')$$,
  'changement d''unité refusé', 'import : changement d''unité refusé quand le produit a des formats');
select tests.echoue($$select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[
  {"marque": "Marque Test", "reference_fabricant": "REF-1", "designation": "Acrylique test v2", "type": "acrylique", "rendement": "10.555"}]')$$,
  'décimales en trop', 'import : pas d''arrondi silencieux');
insert into public.produits (organisation_id, marque, designation, type) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Double', 'Sans ref', 'acrylique'), ('aaaaaaaa-0000-0000-0000-00000000000a', 'Double', 'Sans ref', 'acrylique');
select tests.echoue($$select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[{"marque": "Double", "designation": "Sans ref", "type": "acrylique"}]')$$,
  'plusieurs produits', 'import : correspondance ambiguë refusée (pas de mise à jour au hasard)');
select tests.echoue($$insert into public.conditionnements (organisation_id, produit_id, contenance)
  select organisation_id, id, 1 from public.produits where reference_fabricant = 'REF-1'$$, 'conditionnements_contenance_min', 'format de moins de 100 ml refusé');
select tests.echoue($$insert into public.teintes (organisation_id, nom, statut_verification) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'T', 'verifie')$$,
  'teintes_verification', 'teinte « vérifiée » sans date ni source refusée');
select tests.echoue($$select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[{"marque": "X", "designation": "Y", "type": "inconnu", "usages": [], "unite_mesure": "L"}]')$$,
  'check', 'import : type invalide refusé par la base (toute la transaction)');
select tests.egal((select count(*) from public.produits where marque = 'X'), 0::bigint, 'import : rien d''écrit après une ligne refusée');
select tests.echoue($$select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[]')$$, '1 à 2 000', 'import : vide refusé');

-- Alerte de prix : devis brouillon chiffré à 32,00 € ; prix passé à 34,00 € ensuite.
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d0a01', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 0, 0, 0, '[]');
insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, nombre, prix_achat_retenu_cents)
select 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0a01', c.id, 1, 3200
from public.conditionnements c join public.produits p on p.id = c.produit_id where p.reference_fabricant = 'REF-1' and c.contenance = 2500;
select tests.egal((select count(*) from public.v_alertes_prix where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0a01'), 0::bigint, 'alerte de prix : rien tant que le prix n''a pas changé');
update public.conditionnements set prix_achat_ht_cents = 3400
where produit_id = (select id from public.produits where reference_fabricant = 'REF-1') and contenance = 2500;
select tests.egal((select string_agg(prix_achat_retenu_cents || '->' || prix_actuel_cents, ',') from public.v_alertes_prix
  where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0a01'), '3200->3400', 'alerte de prix : devis en cours, prix changé');

-- Formats par type : bornés.
select tests.echoue($$update public.referentiel_calcul set formats_ml = array[50] where type_produit = 'laque'$$, 'check', 'formats par type : format de moins de 100 ml refusé');
update public.referentiel_calcul set formats_ml = array[500, 1000, 2500] where type_produit = 'laque';


-- -----------------------------------------------------------------------------
-- Phase 4 : devis (numéro attendu, duplication, messages, relances)
-- -----------------------------------------------------------------------------
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d4001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise',
        10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d4001', 1, 'Peinture', 10000, 'forfait', 10000, 0, 10000);
select set_config('tests.prev', public.numero_devis_previsionnel('aaaaaaaa-0000-0000-0000-0000000d4001')::text, false);
select set_config('tests.seq', (select dernier::text from public.sequences_documents
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type = 'DEV' and annee = extract(year from public.aujourd_hui_paris())::integer), false);
-- Numéro attendu faux : refusé ET compteur intact (pas de trou).
select tests.echoue($$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4001', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4001.pdf', repeat('4', 64), 'DEV-1999-0001', public.aujourd_hui_paris())$$,
  'changés pendant l''émission', 'émission : numéro attendu différent -> refusée');
select tests.egal((select dernier::text from public.sequences_documents
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type = 'DEV' and annee = extract(year from public.aujourd_hui_paris())::integer),
  current_setting('tests.seq'), 'émission refusée : le compteur n''a pas bougé (aucun trou)');
select tests.egal(public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4001', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4001.pdf', repeat('4', 64),
  current_setting('tests.prev')::jsonb ->> 'numero', (current_setting('tests.prev')::jsonb ->> 'date_emission')::date),
  current_setting('tests.prev')::jsonb ->> 'numero', 'émission : le numéro prévisionnel du PDF est celui attribué');
-- Duplication : nouveau brouillon, sans numéro, lignes recopiées.
select set_config('tests.dup', public.dupliquer_devis('aaaaaaaa-0000-0000-0000-0000000d4001')::text, false);
select tests.egal((select statut::text || ' ' || coalesce(numero, '-') || ' ' || version || ' ' || (select count(*) from public.devis_lignes where devis_id = d.id)
  from public.devis d where id = current_setting('tests.dup')::uuid), 'brouillon - 1 1', 'duplication : brouillon v1 sans numéro, lignes recopiées');
select tests.egal((select string_agg(code, ',' order by code) from public.modeles_messages
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and code in ('envoi_devis', 'relance_devis')),
  'envoi_devis,relance_devis', 'messages : modèles d''envoi et de relance de devis créés');
select tests.echoue($$select * from public.devis_a_relancer()$$, 'permission denied', 'relances : réservées au rôle service');
-- Déplacement d'une ligne : échange d'ordre atomique ; devis émis figé.
insert into public.devis_lignes (id, organisation_id, devis_id, ordre, type, designation)
values ('aaaaaaaa-0000-0000-0000-0000000d4011', 'aaaaaaaa-0000-0000-0000-00000000000a', current_setting('tests.dup')::uuid, 2, 'section', 'Séjour');
select public.deplacer_ligne_devis('aaaaaaaa-0000-0000-0000-0000000d4011', -1);
select tests.egal((select string_agg(designation, ',' order by ordre) from public.devis_lignes where devis_id = current_setting('tests.dup')::uuid),
  'Séjour,Peinture', 'déplacement : la section passe en tête');
select public.deplacer_ligne_devis('aaaaaaaa-0000-0000-0000-0000000d4011', -1);
select tests.egal((select string_agg(ordre::text, ',' order by ordre) from public.devis_lignes where devis_id = current_setting('tests.dup')::uuid),
  '1,2', 'déplacement : déjà en tête, rien ne change');
select tests.echoue($$select public.deplacer_ligne_devis((select id from public.devis_lignes where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4001'), 1)$$,
  'figées', 'déplacement : refusé sur un devis émis');
select tests.echoue($$select public.deplacer_ligne_devis('aaaaaaaa-0000-0000-0000-0000000d4011', 2)$$, 'Sens invalide', 'déplacement : sens contrôlé');

-- Achats retenus remplacés d'un bloc (pas de perte entre suppression et ajout).
select public.remplacer_achats_devis(current_setting('tests.dup')::uuid,
  '[{"conditionnement_id":"aaaaaaaa-0000-0000-0000-0000000e0002","nombre":2,"prix_achat_retenu_cents":5000}]');
select public.remplacer_achats_devis(current_setting('tests.dup')::uuid,
  '[{"conditionnement_id":"aaaaaaaa-0000-0000-0000-0000000e0002","nombre":3,"prix_achat_retenu_cents":5000}]');
select tests.egal((select string_agg(nombre::text, ',') from public.devis_achats where devis_id = current_setting('tests.dup')::uuid), '3',
  'achats retenus : remplacés, pas cumulés');
select tests.echoue($$select public.remplacer_achats_devis('aaaaaaaa-0000-0000-0000-0000000d4001',
  '[{"conditionnement_id":"aaaaaaaa-0000-0000-0000-0000000e0002","nombre":1,"prix_achat_retenu_cents":1}]')$$,
  'figé', 'achats retenus : figés sur un devis émis');

-- Garde-fou d'émission : taux des lignes cohérents avec le régime et les Paramètres.
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d4002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'assujetti',
        10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (id, organisation_id, devis_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-0000000d4021', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d4002', 1, 'Peinture', 10000, 'forfait', 10000, 0, 10000);
select tests.echoue($$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4002', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4002.pdf', repeat('5', 64))$$, 'sans justification', 'émission : ligne à 0 % sur un devis assujetti refusée');
update public.devis_lignes set taux_tva_bp = 1500 where id = 'aaaaaaaa-0000-0000-0000-0000000d4021';
update public.devis set total_tva_cents = 1500, total_ttc_cents = 11500, ventilation_tva = '[{"taux_bp":1500,"base_ht_cents":10000,"tva_cents":1500}]'
where id = 'aaaaaaaa-0000-0000-0000-0000000d4002';
select tests.echoue($$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4002', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4002.pdf', repeat('5', 64))$$, 'absent des Paramètres', 'émission : taux absent des Paramètres refusé');
update public.devis set regime_tva = 'franchise', total_tva_cents = 0, total_ttc_cents = 10000,
  ventilation_tva = '[{"taux_bp":1500,"base_ht_cents":10000,"tva_cents":0}]' where id = 'aaaaaaaa-0000-0000-0000-0000000d4002';
select tests.echoue($$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4002', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4002.pdf', repeat('5', 64))$$, 'toutes les lignes doivent être à 0', 'émission : ligne taxée en franchise refusée');

-- Échéancier : les échéances « à la signature » doivent être en tête.
update public.devis set regime_tva = 'franchise' where id = 'aaaaaaaa-0000-0000-0000-0000000d4002';
update public.devis_lignes set taux_tva_bp = 0 where id = 'aaaaaaaa-0000-0000-0000-0000000d4021';
update public.devis set total_tva_cents = 0, total_ttc_cents = 10000, ventilation_tva = '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]', acompte_pct_bp = 5000
where id = 'aaaaaaaa-0000-0000-0000-0000000d4002';
insert into public.devis_echeances (organisation_id, devis_id, ordre, libelle, pourcentage_bp, declencheur) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d4002', 1, 'Début', 5000, 'debut_travaux'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d4002', 2, 'Acompte', 5000, 'signature');
select tests.echoue($$select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4002', '{}', '{}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4002.pdf', repeat('5', 64))$$, 'à la signature doivent venir en premier',
  'émission : échéance « à la signature » après une autre refusée');

-- Nouvelle version : les liens de l'ancienne sont désactivés dans la même transaction.
insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d4001', 'signature', repeat('6', 64), now() + interval '10 days');
select set_config('tests.v2', public.nouvelle_version_devis('aaaaaaaa-0000-0000-0000-0000000d4001')::text, false);
select tests.egal((select revoque_le is not null from public.liens_publics where jeton_sha256 = repeat('6', 64)), true,
  'nouvelle version : liens de la version remplacée désactivés');

-- Relances : devis émis, client avec email ; aucun envoi encore (voir le rôle serveur plus bas).
update public.clients set email = 'paul.durand@test' where id = 'aaaaaaaa-0000-0000-0000-0000000c0001';
insert into public.devis (id, organisation_id, client_id, validite_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
values ('aaaaaaaa-0000-0000-0000-0000000d4003', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise',
        10000, 0, 10000, '[{"taux_bp":0,"base_ht_cents":10000,"tva_cents":0}]');
insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d4003', 1, 'Peinture', 10000, 'forfait', 10000, 0, 10000);
select public.emettre_devis('aaaaaaaa-0000-0000-0000-0000000d4003', '{}', '{"nom_affiche":"Paul Durand"}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/d4003.pdf', repeat('7', 64));


-- -----------------------------------------------------------------------------
-- Phase 5 : factures (numéro attendu, messages, lignes, relances d'impayés)
-- -----------------------------------------------------------------------------
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f5001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'franchise', 20000, 0, 20000, '[{"taux_bp":0,"base_ht_cents":20000,"tva_cents":0}]', 20000);
insert into public.facture_lignes (id, organisation_id, facture_id, ordre, type, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f5011', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', 1, 'ligne', 'Travaux supplémentaires', 10000, 'forfait', 20000, 0, 20000),
       ('aaaaaaaa-0000-0000-0000-0000000f5012', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', 2, 'texte', 'Note', null, null, null, null, null);
select public.deplacer_ligne_facture('aaaaaaaa-0000-0000-0000-0000000f5012', -1);
select tests.egal((select string_agg(designation, ',' order by ordre) from public.facture_lignes where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'),
  'Note,Travaux supplémentaires', 'facture : déplacement d''une ligne de brouillon');
select set_config('tests.fprev', public.numero_facture_previsionnel('aaaaaaaa-0000-0000-0000-0000000f5001')::text, false);
select tests.egal((current_setting('tests.fprev')::jsonb ->> 'date_echeance')::date - (current_setting('tests.fprev')::jsonb ->> 'date_emission')::date, 30,
  'facture : échéance prévisionnelle = émission + délai');
select set_config('tests.fseq', (select dernier::text from public.sequences_documents
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type = 'FAC' and annee = extract(year from public.aujourd_hui_paris())::integer), false);
select tests.echoue($$select public.emettre_facture_attendue('aaaaaaaa-0000-0000-0000-0000000f5001', '{}', '{"nom_affiche":"Paul Durand"}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/f5001.pdf', repeat('8', 64), 'FAC-1999-0001', public.aujourd_hui_paris())$$,
  'changés pendant l''émission', 'facture : numéro attendu différent -> émission refusée');
select tests.egal((select dernier::text from public.sequences_documents
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and type = 'FAC' and annee = extract(year from public.aujourd_hui_paris())::integer),
  current_setting('tests.fseq'), 'facture refusée : compteur intact (aucun trou)');
select tests.egal((select statut::text from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f5001'), 'brouillon',
  'facture refusée : reste brouillon');
select tests.egal(public.emettre_facture_attendue('aaaaaaaa-0000-0000-0000-0000000f5001', '{}', '{"nom_affiche":"Paul Durand"}', '{}',
  'aaaaaaaa-0000-0000-0000-00000000000a/f5001.pdf', repeat('8', 64),
  current_setting('tests.fprev')::jsonb ->> 'numero', (current_setting('tests.fprev')::jsonb ->> 'date_emission')::date),
  current_setting('tests.fprev')::jsonb ->> 'numero', 'facture : le numéro prévisionnel du PDF est celui attribué');
select tests.echoue($$select public.deplacer_ligne_facture('aaaaaaaa-0000-0000-0000-0000000f5012', 1)$$, 'figées',
  'facture émise : lignes non déplaçables');
select tests.echoue($$select public.enregistrer_facturx('aaaaaaaa-0000-0000-0000-0000000f5001', 'aaaaaaaa-0000-0000-0000-00000000000a/f5001.pdf')$$,
  'invalide', 'Factur-X : un autre fichier de l''organisation (PDF) refusé');
select tests.echoue($$select public.enregistrer_facturx('aaaaaaaa-0000-0000-0000-0000000f5001',
  'aaaaaaaa-0000-0000-0000-00000000000a/factures/aaaaaaaa-0000-0000-0000-0000000f0002/facturx-' || repeat('a', 64) || '.xml')$$,
  'invalide', 'Factur-X : dossier d''une autre facture refusé');
select public.enregistrer_facturx('aaaaaaaa-0000-0000-0000-0000000f5001', 'aaaaaaaa-0000-0000-0000-00000000000a/factures/aaaaaaaa-0000-0000-0000-0000000f5001/facturx-' || repeat('a', 64) || '.xml');
select public.enregistrer_facturx('aaaaaaaa-0000-0000-0000-0000000f5001', 'aaaaaaaa-0000-0000-0000-00000000000a/factures/aaaaaaaa-0000-0000-0000-0000000f5001/facturx-' || repeat('b', 64) || '.xml');
select tests.egal((select facturx_chemin from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f5001'),
  'aaaaaaaa-0000-0000-0000-00000000000a/factures/aaaaaaaa-0000-0000-0000-0000000f5001/facturx-' || repeat('a', 64) || '.xml', 'Factur-X : chemin fixé une seule fois');
select tests.echoue($$select public.enregistrer_facturx('aaaaaaaa-0000-0000-0000-0000000f0002', 'bbbbbbbb-0000-0000-0000-00000000000b/x.xml')$$,
  'invalide', 'Factur-X : chemin hors de l''organisation refusé');
insert into public.paiements (id, organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-0000000f5091', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', public.aujourd_hui_paris(), 5000, 'cheque');
select tests.echoue($$insert into public.paiements (id, organisation_id, facture_id, date_paiement, montant_cents, mode)
  values ('aaaaaaaa-0000-0000-0000-0000000f5091', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', public.aujourd_hui_paris(), 5000, 'cheque')$$,
  'duplicate key', 'paiement : même identifiant renvoyé -> pas de second paiement');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, annule_paiement_id)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', public.aujourd_hui_paris(), -5000, 'cheque', 'aaaaaaaa-0000-0000-0000-0000000f5091');
select tests.egal((select string_agg(code, ',' order by code) from public.modeles_messages where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  'demande_avis,envoi_devis,envoi_facture,impaye_1,impaye_2,impaye_3,relance_devis', 'messages : envoi de facture, 3 niveaux d''impayés et demande d''avis');
select tests.egal((select string_agg(delai_jours::text, ',' order by code) from public.modeles_messages
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a' and code like 'impaye_%'), '7,15,30', 'impayés : délais de départ après l''échéance');
select tests.echoue($$select * from public.factures_a_relancer()$$, 'permission denied', 'relances d''impayés : réservées au rôle service');

set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
select tests.egal((select count(*) from public.clients), 0::bigint, 'B ne voit pas les clients de A');
select tests.egal((select count(*) from public.rechercher_clients('helene')), 0::bigint, 'B ne trouve pas les clients de A par la recherche');
select tests.egal((select count(*) from public.consommables), 0::bigint, 'B ne voit pas les consommables de A');
select tests.echoue($$select public.dupliquer_piece('aaaaaaaa-0000-0000-0000-0000000d1e01', 'Vol')$$, 'introuvable', 'B ne duplique pas une pièce de A');
select tests.echoue($$select public.definir_preparations('aaaaaaaa-0000-0000-0000-0000000d1e03', '{}')$$, 'introuvable', 'B ne modifie pas les préparations de A');
select tests.echoue($$select public.copier_poste('aaaaaaaa-0000-0000-0000-0000000d1e04', '{}')$$, 'introuvable', 'B ne copie pas un poste de A');
select tests.echoue($$select public.importer_produits('aaaaaaaa-0000-0000-0000-00000000000a', '[{"marque": "X", "designation": "Y", "type": "acrylique", "usages": [], "unite_mesure": "L"}]')$$,
  'introuvable', 'B n''importe pas dans le catalogue de A');
select tests.egal((select count(*) from public.v_alertes_prix), 0::bigint, 'B ne voit pas les alertes de prix de A');
select tests.echoue($$select public.dupliquer_devis('aaaaaaaa-0000-0000-0000-0000000d4001')$$, 'introuvable', 'B ne duplique pas un devis de A');
select tests.echoue($$select public.numero_devis_previsionnel('aaaaaaaa-0000-0000-0000-0000000d4001')$$, 'introuvable', 'B ne lit pas le numéro prévisionnel de A');
select tests.echoue($$select public.deplacer_ligne_devis('aaaaaaaa-0000-0000-0000-0000000d4011', 1)$$, 'introuvable', 'B ne déplace pas une ligne de A');
select tests.egal((select count(*) from public.referentiel_calcul where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 0::bigint,
  'B ne voit pas le référentiel de calcul de A');
select tests.egal(public.confirmer_valeurs('aaaaaaaa-0000-0000-0000-00000000000a', array['validite_devis_jours']), false,
  'B ne peut pas confirmer les valeurs de A');
select tests.echoue($$select public.effacer_client('aaaaaaaa-0000-0000-0000-0000000c0001')$$, 'introuvable', 'B ne peut pas effacer un client de A (identifiant deviné)');
select tests.egal((select count(*) from public.devis), 0::bigint, 'B ne voit pas les devis de A');
select tests.egal((select count(*) from public.factures), 0::bigint, 'B ne voit pas les factures de A');
select tests.egal((select count(*) from public.v_factures), 0::bigint, 'B ne voit rien via la vue v_factures');
select tests.egal((select count(*) from public.paiements), 0::bigint, 'B ne voit pas les paiements de A');
select tests.egal((select count(*) from public.journal_audit), 0::bigint, 'B ne voit pas le journal de A');
select tests.egal((select count(*) from public.temps_passes) + (select count(*) from public.rappels) + (select count(*) from public.devis_achats) + (select count(*) from public.devis_echeances), 0::bigint, 'B ne voit ni temps, ni rappels, ni achats, ni échéancier de A');
select tests.egal((select count(*) from storage.objects), 0::bigint, 'B ne voit pas les fichiers de A');
select tests.egal(tests.lignes($$update public.clients set nom = 'pirate'$$), 0::bigint, 'B ne modifie pas les clients de A');
select tests.echoue($$delete from public.chantiers$$, 'permission denied', 'B ne supprime pas les chantiers de A (aucune suppression directe)');
select tests.echoue($$select public.supprimer_chantier('aaaaaaaa-0000-0000-0000-0000000ca002')$$, 'introuvable',
  'B ne supprime pas un chantier de A par la fonction');
select tests.echoue(
  $$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f0001', '{}', '{}', '{}', 'x', repeat('a', 64))$$,
  'introuvable', 'B ne peut pas émettre une facture de A');
select tests.echoue(
  $$select public.nouvelle_version_devis('aaaaaaaa-0000-0000-0000-0000000d0001')$$,
  'introuvable', 'B ne peut pas versionner un devis de A');

-- Référence polymorphe : B enregistre un envoi visant une facture de A
select tests.echoue(
  $$insert into public.envois (organisation_id, document_type, document_id, nature, canal)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f0002', 'envoi', 'manuel')$$,
  'introuvable', 'sécurité : un envoi ne peut viser un document d''une autre organisation');
select tests.echoue(
  $$insert into public.rappels (organisation_id, type, echeance, titre, document_type, document_id)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', 'echeance_facture', now(), 'x', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f0002')$$,
  'introuvable', 'sécurité : un rappel ne peut viser un document d''une autre organisation');

-- CRITIQUE 1 : B crée chez lui un lien public vers un devis de A
select tests.echoue(
  $$insert into public.liens_publics (organisation_id, devis_id, finalite, jeton_sha256, expire_le)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-0000000d0009', 'signature',
            encode(extensions.digest('jeton-pirate-de-B-tres-long-0123456789-0123456789', 'sha256'), 'hex'),
            now() + interval '1 day')$$,
  'foreign key', 'sécurité (critique) : B ne peut pas créer de lien vers un devis de A');

-- Clé étrangère composite : B connaît l'identifiant d'un client de A et tente
-- de créer un chantier qui le référence dans sa propre organisation.
insert into public.clients (id, organisation_id, nom)
values ('bbbbbbbb-0000-0000-0000-0000000c0001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'Martin');
select tests.echoue(
  $$insert into public.chantiers (organisation_id, client_id, nom)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-0000000c0001', 'Vol')$$,
  'foreign key', 'B ne peut pas référencer un client de A (FK composite)');

-- -----------------------------------------------------------------------------
-- 5. Anonyme : aucun accès
-- -----------------------------------------------------------------------------
reset request.jwt.claim.sub;
set role anon;
select tests.echoue($$select * from public.clients$$, 'permission denied', 'anonyme : aucun accès aux clients');
select tests.echoue($$select * from public.v_factures$$, 'permission denied', 'anonyme : aucun accès aux factures');
select tests.echoue($$select public.devis_par_jeton('x')$$, 'permission denied', 'anonyme : pas d''appel direct par jeton');

-- -----------------------------------------------------------------------------
-- 6. Rôle serveur : lien public
-- -----------------------------------------------------------------------------
set role service_role;
select tests.egal((public.devis_par_jeton('jeton-de-test-suffisamment-long-pour-passer-le-controle') ->> 'numero'),
  'DEV-' || extract(year from public.aujourd_hui_paris())::text || '-0001', 'lien de consultation valide');
select tests.echoue($$select public.devis_par_jeton('jeton-de-test-suffisamment-long-mais-faux-faux-faux-faux')$$,
  'invalide ou expiré', 'jeton inconnu refusé');
select tests.egal((select consulte_le is not null from public.devis where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'),
  true, 'consultation tracée');

-- Relances d'impayés : facture envoyée, échue, avec un reste ; un niveau à la fois.
select tests.egal((select count(*) from public.factures_a_relancer() where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'), 0::bigint,
  'impayés : facture non envoyée et non échue -> rien');
-- Dates de test : préparées par le superutilisateur, triggers de protection contournés.
reset role;
set session_replication_role = replica;
update public.factures set envoyee_le = now() - interval '40 days', date_echeance = public.aujourd_hui_paris() - 10
where id = 'aaaaaaaa-0000-0000-0000-0000000f5001';
set session_replication_role = origin;
set role service_role;
select tests.egal((select niveau || ' ' || code || ' ' || reste_cents from public.factures_a_relancer() where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'),
  '1 impaye_1 20000', 'impayés : échue depuis 10 jours -> 1er rappel (délai 7)');
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f5001', 'impaye_1', 'email', 'paul.durand@test');
select tests.egal((select count(*) from public.factures_a_relancer() where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'), 0::bigint,
  'impayés : 1er rappel envoyé, 2e pas avant 15 jours');
reset role;
set session_replication_role = replica;
update public.factures set date_echeance = public.aujourd_hui_paris() - 40 where id = 'aaaaaaaa-0000-0000-0000-0000000f5001';
set session_replication_role = origin;
set role service_role;
select tests.egal((select count(*) from public.factures_a_relancer() where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'), 0::bigint,
  'impayés : facture très en retard -> le 2e rappel attend l''écart entre délais (15 - 7 = 8 jours) après le 1er');
reset role;
update public.envois set envoye_le = now() - interval '9 days'
where document_id = 'aaaaaaaa-0000-0000-0000-0000000f5001' and nature = 'impaye_1';
set role service_role;
select tests.egal((select string_agg(code, ',') from public.factures_a_relancer() where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'),
  'impaye_2', 'impayés : 1er rappel envoyé il y a 9 jours -> 2e seulement (le 3e attend le 2e)');
insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', public.aujourd_hui_paris(), 20000, 'virement');
select tests.egal((select count(*) from public.factures_a_relancer() where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'), 0::bigint,
  'impayés : facture payée -> plus de relance');

-- Envois réservés avant l'email : une relance par niveau, conclusion seulement d'un envoi en cours.
select tests.echoue(
  $$insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire, statut)
    values ('aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f5001', 'impaye_1', 'email', 'x@test', 'en_cours')$$,
  'envois_relance_unique', 'envois : 2e relance du même niveau refusée (deux passages simultanés)');
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire, statut, erreur)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f5001', 'impaye_1', 'email', 'x@test', 'echec', 'test');
select tests.egal((select count(*) from public.envois where document_id = 'aaaaaaaa-0000-0000-0000-0000000f5001' and nature = 'impaye_1'),
  2::bigint, 'envois : une relance en échec s''ajoute (ne bloque pas un nouvel essai)');
reset role;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.envois (id, organisation_id, document_type, document_id, nature, canal, destinataire, statut)
values ('aaaaaaaa-0000-0000-0000-0000000e5001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f5001',
        'envoi', 'email', 'x@test', 'en_cours');
select tests.echoue(
  $$insert into public.envois (id, organisation_id, document_type, document_id, nature, canal, destinataire, statut)
    values ('aaaaaaaa-0000-0000-0000-0000000e5001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f5001',
            'envoi', 'email', 'x@test', 'en_cours')$$,
  'envois_pkey', 'envois : même identifiant de formulaire -> réservé une seule fois (pas de 2e email)');
select tests.echoue($$update public.envois set destinataire = 'autre@test' where id = 'aaaaaaaa-0000-0000-0000-0000000e5001'$$,
  'permission denied', 'envois : le destinataire ne se modifie pas');
select tests.egal(tests.lignes($$update public.envois set statut = 'envoye', fournisseur_id = 'r1' where id = 'aaaaaaaa-0000-0000-0000-0000000e5001'$$),
  1::bigint, 'envois : conclusion d''un envoi en cours');
select tests.egal(tests.lignes($$update public.envois set statut = 'echec' where id = 'aaaaaaaa-0000-0000-0000-0000000e5001'$$),
  0::bigint, 'envois : un envoi conclu ne se modifie plus');
reset role;
set role service_role;

-- Paiements par carte : un payment_intent une seule fois ; incident consigné, visible et traitable par l'organisation seule.
insert into public.incidents_paiement (organisation_id, facture_id, stripe_evenement_id, reference, montant_cents, motif)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', 'evt_test_1', 'pi_1', 1000, 'Ce paiement dépasse le reste à payer.');
reset role;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
select tests.egal((select count(*) from public.incidents_paiement), 0::bigint, 'incidents de paiement : invisibles pour une autre organisation');
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.egal((select count(*) from public.incidents_paiement where stripe_evenement_id = 'evt_test_1'), 1::bigint, 'incidents de paiement : visibles par l''organisation');
select tests.echoue($$insert into public.incidents_paiement (organisation_id, facture_id, stripe_evenement_id, montant_cents, motif)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', 'evt_faux', 1, 'x')$$,
  'permission denied', 'incidents de paiement : écrits par le serveur seulement');
select tests.echoue($$update public.incidents_paiement set montant_cents = 1 where stripe_evenement_id = 'evt_test_1'$$,
  'permission denied', 'incidents de paiement : montant non modifiable');
select tests.egal(tests.lignes($$update public.incidents_paiement set traite_le = now() where stripe_evenement_id = 'evt_test_1'$$),
  1::bigint, 'incidents de paiement : marqué traité');
select tests.egal(tests.lignes($$update public.incidents_paiement set traite_le = null where stripe_evenement_id = 'evt_test_1'$$),
  0::bigint, 'incidents de paiement : traitement définitif');
reset role;
set role service_role;
-- Contrôles de solde contournés (facture déjà soldée ici) : seul l'index unique est testé.
reset role;
set session_replication_role = replica;
select tests.echoue($$insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, reference, stripe_evenement_id)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', public.aujourd_hui_paris(), 1, 'stripe', 'pi_double', 'evt_a'),
         ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f5001', public.aujourd_hui_paris(), 1, 'stripe', 'pi_double', 'evt_b')$$,
  'paiements_stripe_reference_unique', 'paiement par carte : un même payment_intent n''est enregistré qu''une fois');
set session_replication_role = origin;
set role service_role;

-- Relances : jamais sans envoi réel ; délai compté depuis le dernier envoi ; une seule relance.
select tests.egal((select count(*) from public.devis_a_relancer() where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4003'), 0::bigint,
  'relance : devis émis mais jamais envoyé -> pas de relance');
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire, envoye_le)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'devis', 'aaaaaaaa-0000-0000-0000-0000000d4003', 'envoi', 'email', 'paul.durand@test', now() - interval '2 days');
select tests.egal((select count(*) from public.devis_a_relancer() where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4003'), 0::bigint,
  'relance : envoyé il y a 2 jours (délai 7) -> pas encore');
update public.envois set envoye_le = now() - interval '8 days' where document_id = 'aaaaaaaa-0000-0000-0000-0000000d4003';
select tests.egal((select email || ' ' || client from public.devis_a_relancer() where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4003'),
  'paul.durand@test Paul Durand', 'relance : envoyé il y a 8 jours -> à relancer');
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire, statut, erreur)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'devis', 'aaaaaaaa-0000-0000-0000-0000000d4003', 'relance_devis', 'email', 'paul.durand@test', 'echec', 'test');
select tests.egal((select count(*) from public.devis_a_relancer() where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4003'), 1::bigint,
  'relance : une relance en échec ne compte pas');
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'devis', 'aaaaaaaa-0000-0000-0000-0000000d4003', 'relance_devis', 'email', 'paul.durand@test');
select tests.egal((select count(*) from public.devis_a_relancer() where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4003'), 0::bigint,
  'relance : une seule relance par devis');
update public.parametres_entreprise set relance_devis_active = false where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
delete from public.envois where nature = 'relance_devis' and document_id = 'aaaaaaaa-0000-0000-0000-0000000d4003';
select tests.egal((select count(*) from public.devis_a_relancer() where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d4003'), 0::bigint,
  'relance : désactivée dans les Paramètres -> aucune');
update public.parametres_entreprise set relance_devis_active = true where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a';

select tests.echoue($$select public.purger_journal_audit(now() - interval '1 day')$$, 'trop récente',
  'purge du journal refusée pour des entrées récentes');
select tests.egal(public.purger_journal_audit(now() - interval '2 years'), 0::bigint,
  'purge du journal : aucune entrée échue, rien supprimé');

-- Défenses côté rôle service
select tests.echoue($$truncate public.journal_audit$$, 'permission denied', 'service : pas de TRUNCATE du journal');
select tests.echoue($$truncate public.factures cascade$$, 'permission denied', 'service : pas de TRUNCATE des factures');
select set_config('hdecor.purge_journal', 'on', false);
select tests.echoue($$delete from public.journal_audit$$, 'ni modifié ni supprimé',
  'service : même avec le drapeau de purge, une entrée récente ne s''efface pas');
select set_config('hdecor.purge_journal', 'off', false);
select set_config('hdecor.anonymisation', 'on', false);
select tests.echoue(
  $$update public.devis set copie_client = '{"nom_affiche":"Autre"}' where id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'figé', 'service : le crochet d''anonymisation n''accepte que la valeur constante (et jamais un devis accepté)');
select set_config('hdecor.anonymisation', 'off', false);
select set_config('hdecor.anonymisation', 'on', false);
select tests.echoue(
  $$update public.devis_lignes set designation = 'Prestation (anonymisée)', description = null, origine = null
    where devis_id = 'aaaaaaaa-0000-0000-0000-0000000d0001'$$,
  'figées', 'service : crochet d''anonymisation fermé pour un devis accepté ou encore signable');
select set_config('hdecor.anonymisation', 'off', false);

-- Vieillissement de la fiche : le trigger maj_updated_at remettrait la date à
-- now(), on le contourne le temps de préparer la donnée (superutilisateur).
reset role;
set session_replication_role = replica;
update public.clients set created_at = now() - interval '5 years', updated_at = now() - interval '5 years'
where nom = 'Hélène';
set session_replication_role = origin;
set role service_role;
select tests.egal(public.purger_prospects_inactifs(), 0,
  'purge : aucune anonymisation tant que la durée de conservation est À VÉRIFIER');
update public.parametres_entreprise set valeurs_a_verifier = array_remove(valeurs_a_verifier, 'duree_conservation_prospects_mois')
where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a';
select tests.egal(public.purger_prospects_inactifs() >= 1, true, 'purge : prospect inactif depuis 5 ans anonymisé');
select tests.egal((select count(*) from public.clients where nom = 'Hélène'), 0::bigint, 'purge : plus de nom en clair');
select tests.egal((select count(*) from public.clients where id = 'aaaaaaaa-0000-0000-0000-0000000c0001' and anonymise_le is null), 1::bigint,
  'purge : un client avec documents n''est pas touché');

-- -----------------------------------------------------------------------------
-- Phase 6 : pilotage
-- -----------------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name) values ('justificatifs', 'aaaaaaaa-0000-0000-0000-00000000000a/depenses/j.pdf');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.egal(tests.lignes($$delete from storage.objects where bucket_id = 'justificatifs'$$), 0::bigint,
  'pilotage : un justificatif comptable ne se supprime pas depuis le navigateur');
select tests.egal(tests.lignes($$update storage.objects set name = name || '.x' where bucket_id = 'justificatifs'$$), 0::bigint,
  'pilotage : un justificatif comptable ne se remplace pas depuis le navigateur');
select public.initialiser_categories_depenses();
select public.initialiser_categories_depenses();
select tests.egal((select count(*) from public.categories_depenses where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 7::bigint,
  'pilotage : catégories de dépenses par défaut créées une seule fois');
insert into public.depenses (id, organisation_id, date_depense, fournisseur, montant_ht_cents, tva_cents, montant_ttc_cents)
values ('aaaaaaaa-0000-0000-0000-0000000e6001', 'aaaaaaaa-0000-0000-0000-00000000000a', '2026-10-01', 'Fournisseur fictif', 10000, 2000, 12000);
select tests.echoue($$update public.depenses set justificatif_chemin = 'aaaaaaaa-0000-0000-0000-00000000000a/f5001.pdf'
  where id = 'aaaaaaaa-0000-0000-0000-0000000e6001'$$, 'justificatif_chemin_depense', 'pilotage : justificatif hors du dossier de sa dépense refusé');
select tests.egal(tests.lignes($$update public.depenses set justificatif_chemin =
  'aaaaaaaa-0000-0000-0000-00000000000a/depenses/aaaaaaaa-0000-0000-0000-0000000e6001/' || gen_random_uuid() || '.jpg'
  where id = 'aaaaaaaa-0000-0000-0000-0000000e6001'$$), 1::bigint, 'pilotage : justificatif rattaché dans le dossier de sa dépense');
select tests.echoue($$insert into public.depenses (organisation_id, date_depense, fournisseur, montant_ht_cents, tva_cents, montant_ttc_cents)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', '2026-10-01', 'X', 10000, 2000, 12001)$$, 'check', 'pilotage : TTC = HT + TVA exigé');
select tests.echoue($$insert into public.evenements (organisation_id, type, titre, debut, fin)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'chantier', 'Sans chantier', now(), now())$$,
  'evenement_chantier_porte_son_chantier', 'planning : un événement de chantier porte son chantier');
select tests.echoue($$insert into public.evenements (organisation_id, type, titre, debut, fin)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'rendez_vous', 'Trop long', now(), now() + interval '400 days')$$,
  'evenement_duree_raisonnable', 'planning : durée d''un an au plus');
select tests.egal((select count(*) || ':' || bool_and(v.facture_net_ht_cents = f.total_ht_cents and v.facture_net_ttc_cents = f.net_a_payer_cents
                           and jsonb_array_length(f.deductions) = 0)::text
                    from public.v_livre_recettes v join public.factures f on f.id = v.facture_id
                    where v.facture_id = 'aaaaaaaa-0000-0000-0000-0000000f5001'), '3:true',
  'livre des recettes : net HT et TTC de la facture fournis (facture sans acompte déduit)');
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
select tests.egal((select count(*) from public.depenses), 0::bigint, 'pilotage : B ne voit pas les dépenses de A');
select tests.egal((select count(*) from public.v_livre_recettes where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 0::bigint,
  'pilotage : B ne voit pas le livre des recettes de A');
reset role;

-- Part HT en cumulé : facture 100,00 HT / 120,00 TTC (assujetti) réglée en 3 × 40,00, puis une annulation de 40,00.
-- Fixture posée déclencheurs suspendus (superutilisateur ; la vue ne dépend pas du statut), retirée ensuite.
set session_replication_role = replica;
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f6001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre', 'aaaaaaaa-0000-0000-0000-0000000c0001', 30,
  'assujetti', 10000, 2000, 12000, '[{"taux_bp":2000,"base_ht_cents":10000,"tva_cents":2000}]', 12000);
insert into public.paiements (id, organisation_id, facture_id, date_paiement, montant_cents, mode, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000f6011', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f6001', '2026-10-01', 4000, 'virement', '2026-10-01 10:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000f6012', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f6001', '2026-10-02', 4000, 'virement', '2026-10-02 10:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000f6013', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f6001', '2026-10-03', 4000, 'virement', '2026-10-03 10:00+00');
set session_replication_role = origin;
select tests.egal((select string_agg(part_ht_cents::text, ',' order by date_paiement) || ' = ' || sum(part_ht_cents)
                   from public.v_livre_recettes where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f6001'),
  '3333,3334,3333 = 10000', 'livre des recettes : 3 × 40,00 sur 100,00 HT / 120,00 TTC -> parts HT en cumulé, total exact 100,00');
set session_replication_role = replica;
insert into public.paiements (id, organisation_id, facture_id, date_paiement, montant_cents, mode, created_at, annule_paiement_id) values
  ('aaaaaaaa-0000-0000-0000-0000000f6014', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f6001', '2026-10-04', -4000, 'virement', '2026-10-04 10:00+00',
   'aaaaaaaa-0000-0000-0000-0000000f6013');
set session_replication_role = origin;
select tests.egal((select part_ht_cents::text || ' / ' || sum(part_ht_cents) over () from public.v_livre_recettes
                   where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f6001' order by date_paiement desc limit 1),
  '-3333 / 6667', 'livre des recettes : annulation de 40,00 -> total HT = arrondi(80,00 × 100/120) = 66,67');
set session_replication_role = replica;
delete from public.paiements where facture_id = 'aaaaaaaa-0000-0000-0000-0000000f6001';
delete from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f6001';
set session_replication_role = origin;

-- -----------------------------------------------------------------------------
-- Phase 7 : documents et finitions
-- -----------------------------------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
-- PV de réception : brouillon, présentation, signature sur place, levée des réserves.
insert into public.pv_reception (id, organisation_id, chantier_id, date_reception, avec_reserves, reserves, travaux)
values ('aaaaaaaa-0000-0000-0000-0000000b7101', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001',
  public.aujourd_hui_paris() - 2, true, '[{"description":"Reprendre l''angle du plafond"},{"description":"Plinthe tachée"}]', 'Peinture du séjour');
select tests.echoue($$insert into public.pv_reception (organisation_id, chantier_id, date_reception, avec_reserves, reserves)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), true, '[{"description":"x","prix":1}]')$$,
  'reserves_valides', 'PV : une réserve ne porte aucune clé libre');
select tests.echoue($$insert into public.pv_reception (organisation_id, chantier_id, date_reception, avec_reserves, reserves)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), false, '[{"description":"x"}]')$$,
  'reserves_coherentes', 'PV : « avec réserves » cohérent avec la liste');
select tests.echoue($$select public.presenter_pv('aaaaaaaa-0000-0000-0000-0000000b7101', 'aaaaaaaa-0000-0000-0000-00000000000a/factures/f.pdf', repeat('1', 64))$$,
  'Chemin du PDF invalide', 'PV : le PDF présenté est rangé dans le dossier du PV');
select public.presenter_pv('aaaaaaaa-0000-0000-0000-0000000b7101',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7111.pdf', repeat('1', 64));
update public.pv_reception set observations = 'Client satisfait' where id = 'aaaaaaaa-0000-0000-0000-0000000b7101';
reset role;
select tests.egal((select count(*) from public.fichiers_a_supprimer
                   where chemin = 'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7111.pdf'), 1::bigint,
  'PV : le PDF présenté puis abandonné (brouillon modifié) est mis en file de suppression');
set role authenticated;
select tests.egal((select pdf_sha256 from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'), null::text,
  'PV : un brouillon modifié doit être présenté à nouveau (empreinte effacée)');
select public.presenter_pv('aaaaaaaa-0000-0000-0000-0000000b7101',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7112.pdf', repeat('2', 64));
select tests.echoue($$select public.signer_pv_sur_place('aaaaaaaa-0000-0000-0000-0000000b7101', 'Paul Durand', 'Réception prononcée',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7121.png',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7122.png',
  repeat('1', 64), null, null)$$, 'a changé depuis sa présentation', 'PV : signature refusée sur une version périmée');
select tests.echoue($$select public.signer_pv_sur_place('aaaaaaaa-0000-0000-0000-0000000b7101', 'Paul Durand', 'Réception prononcée',
  'aaaaaaaa-0000-0000-0000-00000000000a/devis/x/aaaaaaaa-0000-0000-0000-0000000b7121.png',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7122.png',
  repeat('2', 64), null, null)$$, 'Tracés de signature invalides', 'PV : tracés rangés dans le dossier du PV');
select tests.echoue($$select public.lever_reserve('aaaaaaaa-0000-0000-0000-0000000b7101', 0, public.aujourd_hui_paris(), null)$$,
  'PV signé', 'PV : pas de levée de réserve avant la signature');
select tests.echoue($$update public.pv_reception set reserves = '[{"description":"Reprendre l''angle du plafond","levee_le":"2000-01-01","levee_note":"déjà levée"},{"description":"Plinthe tachée"}]'
  where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$, 'qu''après la signature', 'PV brouillon : aucune levée écrite avant la signature (levée antidatée)');
select tests.echoue($$insert into public.pv_reception (organisation_id, chantier_id, date_reception, avec_reserves, reserves)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris(), true, '[{"description":"x","levee_note":"faite"}]')$$,
  'qu''après la signature', 'PV : création sans aucune levée');
insert into public.pv_reception (id, organisation_id, chantier_id, date_reception)
values ('aaaaaaaa-0000-0000-0000-0000000b7201', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', public.aujourd_hui_paris() + 3);
select public.presenter_pv('aaaaaaaa-0000-0000-0000-0000000b7201',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7201/aaaaaaaa-0000-0000-0000-0000000b7211.pdf', repeat('5', 64));
select tests.echoue($$select public.signer_pv_sur_place('aaaaaaaa-0000-0000-0000-0000000b7201', 'Paul Durand', 'Lu et approuvé',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7201/aaaaaaaa-0000-0000-0000-0000000b7221.png',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7201/aaaaaaaa-0000-0000-0000-0000000b7222.png',
  repeat('5', 64), null, null)$$, 'date de réception est future', 'PV : pas de signature d''une réception datée dans le futur');
delete from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b7201';
select public.signer_pv_sur_place('aaaaaaaa-0000-0000-0000-0000000b7101', 'Paul Durand', 'Réception prononcée',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7121.png',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7122.png',
  repeat('2', 64), null, null);
select tests.egal((select statut || ':' || (signature_id is not null)::text from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'),
  'signe:true', 'PV : signé sur place, signature rattachée');
select tests.echoue($$update public.pv_reception set observations = 'Modifié' where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$,
  'Ce PV est signé', 'PV signé : contenu figé');
select tests.echoue($$update public.pv_reception set reserves = jsonb_set(reserves, '{0,description}', '"Autre"') where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$,
  'Ce PV est signé', 'PV signé : description d''une réserve figée');
select tests.echoue($$select public.lever_reserve('aaaaaaaa-0000-0000-0000-0000000b7101', 0, public.aujourd_hui_paris() + 1, null)$$,
  'entre la réception et aujourd', 'PV : levée datée au plus tard aujourd''hui');
select public.lever_reserve('aaaaaaaa-0000-0000-0000-0000000b7101', 0, public.aujourd_hui_paris(), 'Angle repris');
select tests.egal((select (reserves -> 0 ->> 'levee_le') = public.aujourd_hui_paris()::text and (reserves -> 1 ->> 'levee_le') is null
                   from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'), true, 'PV : réserve 1 levée, réserve 2 encore ouverte');
select tests.echoue($$select public.lever_reserve('aaaaaaaa-0000-0000-0000-0000000b7101', 0, public.aujourd_hui_paris(), null)$$,
  'déjà levée', 'PV : une réserve ne se lève qu''une fois');
select tests.echoue($$update public.pv_reception set reserves = jsonb_set(reserves, '{0,levee_le}', 'null') where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$,
  'Ce PV est signé', 'PV : une levée enregistrée ne s''efface pas');
select tests.echoue($$delete from public.pv_reception where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$,
  'PV signé ne peut pas être supprimé', 'PV signé non supprimable');
select tests.echoue($$update public.pv_reception set reserves = jsonb_set(reserves, '{1}', (reserves -> 1) || '{"levee_le":"2026-10-01"}')
  where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$, 'Ce PV est signé', 'PV signé : une levée ne s''écrit que par lever_reserve (contrôle de date)');
-- Même avec le verrou de levée posé à la main (hors API), la date reste contrôlée par le déclencheur.
select set_config('hdecor.levee', 'on', false);
select tests.echoue($$update public.pv_reception set reserves = jsonb_set(reserves, '{1}', (reserves -> 1) || '{"levee_le":"2099-01-01"}')
  where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$, 'Date de levée invalide', 'PV signé : levée future refusée par le déclencheur');
select tests.echoue($$update public.pv_reception set reserves = jsonb_set(reserves, '{1}', (reserves -> 1) || '{"levee_le":"2000-01-01"}')
  where id = 'aaaaaaaa-0000-0000-0000-0000000b7101'$$, 'Date de levée invalide', 'PV signé : levée antérieure à la réception refusée par le déclencheur');
select set_config('hdecor.levee', '', false);
reset role;
select tests.egal(public.reserves_valides('[{"description":"x","levee_le":"2099-02-31"}]'), false, 'PV : une date de levée inexistante (31/02) est refusée');
select tests.egal(public.reserves_valides('[{"description":"x","levee_le":"2026-02-28"}]'), true, 'PV : date de levée réelle acceptée');
set role authenticated;
select tests.echoue($$select public.archiver_pv_signe('aaaaaaaa-0000-0000-0000-0000000b7101', 'aaaaaaaa-0000-0000-0000-00000000000a/factures/x.pdf', repeat('3', 64))$$,
  'Archive invalide', 'PV : archive rangée dans le dossier du PV');
select public.archiver_pv_signe('aaaaaaaa-0000-0000-0000-0000000b7101',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7131.pdf', repeat('3', 64));
select tests.echoue($$select public.archiver_pv_signe('aaaaaaaa-0000-0000-0000-0000000b7101',
  'aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7132.pdf', repeat('4', 64))$$,
  'déjà archivé', 'PV : l''archive signée ne se remplace pas');
reset role;
select tests.egal(public.fichier_protege('aaaaaaaa-0000-0000-0000-00000000000a/pv/aaaaaaaa-0000-0000-0000-0000000b7101/aaaaaaaa-0000-0000-0000-0000000b7112.pdf'),
  true, 'PV signé : son PDF est protégé de la file de suppression');
set role authenticated;
-- Photos : rangées, galerie modifiable, chemin figé.
select tests.echoue($$insert into public.photos (organisation_id, chantier_id, chemin) values ('aaaaaaaa-0000-0000-0000-00000000000a',
  'aaaaaaaa-0000-0000-0000-0000000ca001', 'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca001/photos/x.svg')$$,
  'photo_chemin_rangee', 'photos : nom de fichier et format imposés (pas de SVG)');
insert into public.photos (id, organisation_id, chantier_id, moment, chemin) values ('aaaaaaaa-0000-0000-0000-0000000f7a01',
  'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', 'avant',
  'aaaaaaaa-0000-0000-0000-00000000000a/chantiers/aaaaaaaa-0000-0000-0000-0000000ca001/photos/aaaaaaaa-0000-0000-0000-0000000f7a01.jpg');
select tests.egal(tests.lignes($$update public.photos set en_galerie = true, moment = 'apres' where id = 'aaaaaaaa-0000-0000-0000-0000000f7a01'$$),
  1::bigint, 'photos : galerie et moment modifiables');
-- Liste de fin de chantier : modèle paramétrable, forme contrôlée.
select tests.egal((select cardinality(liste_fin_chantier) > 0 from public.parametres_entreprise
                   where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), true, 'fin de chantier : modèle de liste par défaut');
select tests.echoue($$insert into public.checklists_fin_chantier (organisation_id, chantier_id, items)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', '{"a":1}')$$,
  'items_forme', 'fin de chantier : liste au format tableau');
-- Demande d'avis : lien https, une seule par facture.
select tests.echoue($$update public.parametres_entreprise set avis_google_url = 'javascript:alert(1)'
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$, 'avis_google_url_https', 'avis : lien https uniquement');
insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f0002', 'demande_avis', 'manuel', null);
select tests.echoue($$insert into public.envois (organisation_id, document_type, document_id, nature, canal, destinataire)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'facture', 'aaaaaaaa-0000-0000-0000-0000000f0002', 'demande_avis', 'manuel', null)$$,
  'envois_demande_avis_unique', 'avis : une seule demande par facture');
-- Notifications : créées par la base seulement ; Yorick les marque lues.
select tests.echoue($$insert into public.notifications (organisation_id, type, titre, lien, cle)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', 'rappel', 'x', '/', 'x')$$, 'permission denied', 'notifications : pas d''insertion par une session');
reset role;
insert into public.rappels (id, organisation_id, type, echeance, titre)
values ('aaaaaaaa-0000-0000-0000-0000000a7001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'sechage', now() - interval '1 minute', 'Couche suivante');
set role service_role;
select tests.egal(public.notifier_rappels_echus() >= 1, true, 'notifications : rappel échu signalé');
select tests.egal(public.notifier_rappels_echus(), 0, 'notifications : un rappel n''est signalé qu''une fois');
reset role;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.egal((select count(*) from public.notifications where cle = 'rappel:aaaaaaaa-0000-0000-0000-0000000a7001'), 1::bigint,
  'notifications : visible par l''organisation');
select tests.egal(tests.lignes($$update public.notifications set lu_le = now() where cle = 'rappel:aaaaaaaa-0000-0000-0000-0000000a7001'$$),
  1::bigint, 'notifications : marquée lue');
select tests.echoue($$update public.notifications set titre = 'x'$$, 'permission denied', 'notifications : titre non modifiable');
select tests.echoue($$select public.notifier_rappels_echus()$$, 'permission denied', 'notifications : tâche réservée au serveur');
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000001';
select tests.egal((select count(*) from public.notifications where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 0::bigint,
  'notifications : B ne voit pas celles de A');
select tests.egal((select count(*) from public.pv_reception where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 0::bigint,
  'PV : B ne voit pas ceux de A');
reset role;
set session_replication_role = replica;
insert into public.attestations_tva (id, organisation_id, devis_id, taux_bp, signature_id, pdf_chemin)
values ('aaaaaaaa-0000-0000-0000-0000000b7801', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000d0001', 1000,
  'aaaaaaaa-0000-0000-0000-0000000b7501', 'aaaaaaaa-0000-0000-0000-00000000000a/attestations/at-test.pdf');
set session_replication_role = origin;
select tests.egal(public.fichier_protege('aaaaaaaa-0000-0000-0000-00000000000a/attestations/at-test.pdf'), true,
  'fichiers protégés : le PDF d''une attestation de TVA signée reste protégé');
set session_replication_role = replica;
delete from public.attestations_tva where id = 'aaaaaaaa-0000-0000-0000-0000000b7801';
set session_replication_role = origin;
-- RGPD : notifications d'un client effacé supprimées.
insert into public.notifications (organisation_id, type, titre, lien, cle)
select organisation_id, 'devis_consulte', 'Devis ouvert par Mme Test', '/devis/' || id, 'test-rgpd:' || id
from public.devis where client_id = 'aaaaaaaa-0000-0000-0000-0000000c0001' limit 1;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.accords_diffusion_photos (organisation_id, chantier_id, texte)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', 'Le client accepte la diffusion des photos (test).');
select tests.echoue($$delete from public.accords_diffusion_photos$$, 'permission denied', 'accords de diffusion : historique non supprimable');
select tests.echoue($$update public.accords_diffusion_photos set texte = 'autre'$$, 'permission denied', 'accords de diffusion : texte non modifiable');
select tests.egal(tests.lignes($$update public.accords_diffusion_photos set retire_le = now() where retire_le is null$$), 1::bigint,
  'accords de diffusion : retrait daté');
reset role;
-- Signature d'un devis À DISTANCE : notification (sur place, Yorick est présent : aucune).
insert into public.signatures (organisation_id, document_type, document_id, methode, signataire_nom, mention, image_chemin, document_sha256)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'attestation_tva', 'aaaaaaaa-0000-0000-0000-0000000a7999', 'lien', 'Xavier Test', 'Lu', 'aaaaaaaa-0000-0000-0000-00000000000a/s.png', repeat('c', 64));
select tests.egal((select count(*) from public.notifications where type = 'devis_signe'),
  (select count(*) from public.signatures where document_type = 'devis' and methode = 'lien'),
  'notifications : une par devis signé à distance, aucune pour une attestation ou une signature sur place');
insert into public.evenements (id, organisation_id, chantier_id, type, titre, debut, fin)
values ('aaaaaaaa-0000-0000-0000-0000000e7901', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000ca001', 'rendez_vous', 'RDV Durand', now(), now());
insert into public.rappels (id, organisation_id, type, echeance, titre, evenement_id)
values ('aaaaaaaa-0000-0000-0000-0000000e7902', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre', now(), 'Appeler M. Durand', 'aaaaaaaa-0000-0000-0000-0000000e7901');
insert into public.notifications (organisation_id, type, titre, lien, cle)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'rappel', 'Rappel : Appeler M. Durand', '/planning', 'rappel:aaaaaaaa-0000-0000-0000-0000000e7902');
select tests.egal((select count(*) from public.notifications where cle like 'test-rgpd:%'), 1::bigint, 'RGPD : notification du client présente avant effacement');
update public.clients set anonymise_le = now() where id = 'aaaaaaaa-0000-0000-0000-0000000c0001';
select tests.egal((select count(*) from public.notifications where cle like 'test-rgpd:%'), 0::bigint,
  'RGPD : à l''anonymisation, les notifications du client sont supprimées');
select tests.egal((select count(*) from public.notifications where cle = 'rappel:aaaaaaaa-0000-0000-0000-0000000e7902'), 0::bigint,
  'RGPD : notification d''un rappel lié à un rendez-vous du chantier supprimée aussi');
update public.clients set anonymise_le = null where id = 'aaaaaaaa-0000-0000-0000-0000000c0001';

-- Conservation : notifications de plus de 90 jours purgées par la tâche du serveur seulement.
insert into public.notifications (organisation_id, type, titre, lien, cle, cree_le) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'rappel', 'Ancienne', '/planning', 'test-purge:vieille', now() - interval '91 days'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'rappel', 'Récente', '/planning', 'test-purge:recente', now() - interval '89 days');
set role authenticated;
select tests.echoue($$select public.purger_notifications()$$, 'permission denied', 'conservation : purge des notifications réservée au serveur');
set role service_role;
select tests.egal(public.purger_notifications() >= 1, true, 'conservation : purge des notifications exécutée');
reset role;
select tests.egal((select array_agg(cle order by cle) from public.notifications where cle like 'test-purge:%'), array['test-purge:recente'],
  'conservation : notifications de plus de 90 jours supprimées, les récentes gardées');

-- Phase 8 : textes légaux modifiables, logo, cumul des acomptes.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select tests.echoue($$update public.parametres_entreprise set textes_legaux = '{"inconnu":"x"}' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'textes_legaux_forme', 'textes légaux : clé inconnue refusée');
select tests.echoue($$update public.parametres_entreprise set textes_legaux = jsonb_build_object('devis_recu', 'a' || chr(7) || 'b') where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'textes_legaux_forme', 'textes légaux : caractère de contrôle refusé');
select tests.echoue($$update public.parametres_entreprise set textes_legaux = '{"devis_recu":"   "}' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'textes_legaux_forme', 'textes légaux : texte vide refusé');
select tests.egal(tests.lignes($$update public.parametres_entreprise set textes_legaux = jsonb_build_object('devis_recu', 'Devis reçu.' || chr(10) || 'Merci.')
  where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$), 1::bigint, 'textes légaux : texte personnalisé sur plusieurs lignes accepté');
select tests.echoue($$update public.parametres_entreprise set logo_chemin = 'aaaaaaaa-0000-0000-0000-00000000000a/logo/aaaaaaaa-0000-0000-0000-0000000000c1.png' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'permission denied', 'logo : chemin écrit par le serveur seulement, jamais par une session');
select tests.egal(tests.lignes($$update public.parametres_entreprise set textes_legaux = '{}' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$),
  1::bigint, 'paramètres : les autres colonnes restent modifiables par la session');
reset role;
select tests.echoue($$update public.parametres_entreprise set logo_chemin = 'aaaaaaaa-0000-0000-0000-00000000000a/logo/x.svg' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'logo_chemin_range', 'logo : rangé sous logo/<uuid>.(png|jpg), jamais un SVG (même par le serveur)');
select tests.echoue($$update public.parametres_entreprise set logo_chemin = 'aaaaaaaa-0000-0000-0000-00000000000b/logo/aaaaaaaa-0000-0000-0000-0000000000c1.png' where organisation_id = 'aaaaaaaa-0000-0000-0000-00000000000a'$$,
  'logo_chemin', 'logo : dans le dossier de l''organisation seulement');
set role authenticated;
reset role;
select tests.egal(has_column_privilege('authenticated', 'public.factures', 'acompte_cumul_avant_bp', 'INSERT')
  and not has_column_privilege('authenticated', 'public.factures', 'acompte_cumul_avant_bp', 'UPDATE'), true,
  'acompte : cumul de calcul fixé à la création, jamais modifié par une session');

-- Phase 8 (recette) : avoirs soldés taux par taux, cumul de calcul des acomptes.
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.factures (id, organisation_id, type, client_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f8001', 'aaaaaaaa-0000-0000-0000-00000000000a', 'libre',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 30, 'assujetti', 100002, 20000, 120002,
  '[{"taux_bp":2000,"base_ht_cents":100002,"tva_cents":20000}]', 120002);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f8001', 1, 'Travaux', 10000, 'forfait', 100002, 2000, 100002);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f8001', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f8001.pdf', repeat('8', 64));
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f8002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'reduction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f8001', 0, 'assujetti', 833, 167, 1000,
  '[{"taux_bp":2000,"base_ht_cents":833,"tva_cents":167}]', 1000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f8002', 1, 'Geste', 10000, 'forfait', 833, 2000, 833);
select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f8002', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/a8002.pdf', repeat('8', 64));
-- Reste 991,69 HT + 198,33 TVA ; un avoir de 991,68 + 198,34 (même TTC) créditerait 200,01 de TVA pour 200,00 facturés.
insert into public.factures (id, organisation_id, type, nature_avoir, client_id, facture_origine_id, delai_paiement_jours, regime_tva,
  total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f8003', 'aaaaaaaa-0000-0000-0000-00000000000a', 'avoir', 'correction',
  'aaaaaaaa-0000-0000-0000-0000000c0001', 'aaaaaaaa-0000-0000-0000-0000000f8001', 0, 'assujetti', 99168, 19834, 119002,
  '[{"taux_bp":2000,"base_ht_cents":99168,"tva_cents":19834}]', 119002);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f8003', 1, 'Solde', 10000, 'forfait', 99168, 2000, 99168);
select tests.echoue($$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f8003', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/a8003.pdf', repeat('8', 64))$$,
  'dépasserait la facture d''origine', 'avoir : TVA créditée par taux jamais supérieure à la TVA facturée');
select tests.egal((select statut from public.factures where id = 'aaaaaaaa-0000-0000-0000-0000000f8001'), 'emise'::public.statut_facture,
  'avoir refusé : la facture d''origine reste émise');

-- Acompte calculé sur un cumul (30 %) qui ne correspond pas aux acomptes émis (aucun) : refusé.
select verif.devis('aaaaaaaa-0000-0000-0000-0000000ca001', 100000) as devis_recette \gset
insert into public.factures (id, organisation_id, type, client_id, chantier_id, devis_id, delai_paiement_jours, regime_tva,
  acompte_pct_bp, acompte_cumul_avant_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
values ('aaaaaaaa-0000-0000-0000-0000000f8011', 'aaaaaaaa-0000-0000-0000-00000000000a', 'acompte', 'aaaaaaaa-0000-0000-0000-0000000c0001',
  'aaaaaaaa-0000-0000-0000-0000000ca001', :'devis_recette', 30, 'franchise', 3000, 3000, 30000, 0, 30000,
  '[{"taux_bp":0,"base_ht_cents":30000,"tva_cents":0}]', 30000);
insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
values ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-0000000f8011', 1, 'Acompte', 10000, 'forfait', 30000, 0, 30000);
select tests.echoue($$select public.emettre_facture('aaaaaaaa-0000-0000-0000-0000000f8011', '{}', '{}', '{}', 'aaaaaaaa-0000-0000-0000-00000000000a/f8011.pdf', repeat('8', 64))$$,
  'recréez-le', 'acompte : cumul de calcul différent des acomptes émis, émission refusée par la base');
reset role;

-- Triggers : même le propriétaire de la base ne modifie pas une facture émise
reset role;
select tests.echoue(
  $$update public.factures set total_ht_cents = 1 where id = 'aaaaaaaa-0000-0000-0000-0000000f0002'$$,
  'établissez un avoir', 'facture émise protégée même hors API (trigger)');
select tests.echoue($$update public.journal_audit set action = 'DELETE'$$, 'ni modifié ni supprimé',
  'journal protégé même hors API (trigger)');
select tests.echoue($$delete from public.paiements$$, 'ne se modifie pas', 'paiements protégés même hors API (trigger)');

create function public.zz_fonction_future() returns int language sql as 'select 1';
select tests.egal(has_function_privilege('authenticated', 'public.zz_fonction_future()', 'execute'), false,
  'sécurité : une future fonction n''est pas exécutable par défaut');
drop function public.zz_fonction_future();
select tests.egal((select 'image/svg+xml' = any (allowed_mime_types) from storage.buckets where id = 'marque'), false,
  'sécurité : pas de SVG dans le bucket du logo');

\o
\set QUIET 0
select count(*) as tests_passes from tests.resultats where ok;
