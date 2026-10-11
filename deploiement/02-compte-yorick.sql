-- =============================================================================
-- H'DECOR : rattachement du compte de Yorick (Supabase, SQL Editor)
--
-- Équivalent de scripts/creer-compte.ts SANS la création de l'utilisateur :
-- l'utilisateur est créé à la main dans Authentication > Users (« Add user »,
-- email et mot de passe, case « Auto Confirm User » cochée).
-- Ce script retrouve son id par l'email puis appelle, comme creer-compte.ts,
-- public.initialiser_organisation, qui crée en une transaction :
-- l'organisation, le membre (rôle « proprietaire »), les paramètres de
-- l'entreprise (raison sociale, dirigeant, email ; tout le reste à ses valeurs
-- par défaut) et les 4 taux de TVA marqués « À VÉRIFIER ».
--
-- AVANT D'EXÉCUTER : remplacer [email de Yorick] ci-dessous (une seule fois).
-- À exécuter APRÈS deploiement/01-migrations.sql. Une seconde exécution est
-- refusée (« Ce compte est déjà rattaché à une organisation. »).
-- =============================================================================

begin;

do $compte$
declare
  v_email          constant text := '[email de Yorick]';
  v_raison_sociale constant text := 'H’DECOR';
  v_dirigeant      constant text := 'Yorick Heussler';
  v_nb             integer;
  v_user           uuid;
  v_confirme       timestamptz;
  v_org            uuid;
begin
  if v_email !~ '^[^@\s\[\]]+@[^@\s\[\]]+\.[^@\s\[\]]+$' then
    raise exception 'Remplacez [email de Yorick] par son adresse email en haut du script.';
  end if;

  select count(*) into v_nb from auth.users where lower(email) = lower(trim(v_email));
  if v_nb = 0 then
    raise exception 'Aucun utilisateur % dans Authentication > Users : créez-le d''abord (Auto Confirm coché).', v_email;
  elsif v_nb > 1 then
    raise exception 'Plusieurs utilisateurs avec l''email % : vérifiez Authentication > Users.', v_email;
  end if;

  select id, email_confirmed_at into v_user, v_confirme from auth.users where lower(email) = lower(trim(v_email));
  -- creer-compte.ts crée l'utilisateur avec l'email confirmé (email_confirm: true).
  if v_confirme is null then
    raise exception 'L''email de % n''est pas confirmé : recréez l''utilisateur avec « Auto Confirm User » coché.', v_email;
  end if;

  -- Même appel et mêmes arguments que creer-compte.ts.
  v_org := public.initialiser_organisation(v_user, v_raison_sociale, v_dirigeant, trim(v_email));
  raise notice 'Compte rattaché : % (organisation %).', v_email, v_org;
end
$compte$;

commit;

-- Contrôle (à lancer après) : une ligne attendue, rôle « proprietaire », 4 taux.
-- select o.nom, m.role, p.raison_sociale, p.nom_dirigeant, p.email,
--        (select count(*) from public.taux_tva t where t.organisation_id = o.id) as taux_tva
-- from public.organisations o
-- join public.membres m on m.organisation_id = o.id
-- join public.parametres_entreprise p on p.organisation_id = o.id;
