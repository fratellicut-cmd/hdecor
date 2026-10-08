-- =============================================================================
-- H'DECOR (Phase 1) : recherche de clients et conservation des prospects.
-- =============================================================================

-- Texte « à plat » pour la recherche : minuscules, sans accents.
create or replace function public.texte_recherche(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(coalesce(p, '')),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ',
    'aaaaaaceeeeiiiinooooouuuuyyoa');
$$;

-- Recherche instantanée (nom, prénom, raison sociale, email, téléphone,
-- ville). SECURITY INVOKER : la RLS s'applique. Le texte saisi n'est jamais
-- interprété comme une syntaxe de filtre (paramètre de fonction).
create or replace function public.rechercher_clients(
  p_texte text default null,
  p_type public.type_client default null,
  p_inclure_anonymises boolean default false,
  p_limite integer default 50,
  p_decalage integer default 0)
returns setof public.clients
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
  from public.clients c
  where (p_inclure_anonymises or c.anonymise_le is null)
    and (p_type is null or c.type = p_type)
    and (
      coalesce(trim(p_texte), '') = ''
      or public.texte_recherche(concat_ws(' ', c.nom, c.prenom, c.raison_sociale, c.email,
           regexp_replace(coalesce(c.telephone, ''), '\D', '', 'g'), c.fact_ville))
         like '%' || replace(replace(replace(public.texte_recherche(trim(p_texte)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      -- Recherche par numéro (« 06 12 », « 06.12 », « +33 6 ») : seulement si
      -- la saisie EST un numéro (au moins 2 chiffres, aucune lettre), sinon
      -- « Dupont 2 » trouverait tous les téléphones contenant un 2.
      -- L'indicatif +33 / 0033 vaut 0 des deux côtés (« +33 6 12 » trouve « 06 12 »).
      or (p_texte ~ '^[\s\d.+()-]+$' and length(regexp_replace(p_texte, '\D', '', 'g')) >= 2
          and regexp_replace(regexp_replace(trim(coalesce(c.telephone, '')), '^(\+|00)33', '0'), '\D', '', 'g')
              like '%' || regexp_replace(regexp_replace(trim(p_texte), '^(\+|00)33', '0'), '\D', '', 'g') || '%')
    )
  order by c.anonymise_le nulls first, lower(coalesce(c.raison_sociale, c.nom)), lower(coalesce(c.prenom, ''))
  limit least(greatest(p_limite, 1), 200)
  offset greatest(p_decalage, 0);
$$;

-- -----------------------------------------------------------------------------
-- Conservation des prospects (clients sans aucun document ni chantier) :
-- durée paramétrable, À VÉRIFIER (registre des traitements).
-- -----------------------------------------------------------------------------
alter table public.parametres_entreprise
  add column duree_conservation_prospects_mois integer not null default 36
    check (duree_conservation_prospects_mois between 1 and 120);
alter table public.parametres_entreprise
  alter column valeurs_a_verifier set default array[
    'delai_paiement_jours', 'delai_paiement_max_jours', 'indemnite_recouvrement_cents',
    'escompte_texte', 'validite_devis_jours', 'acompte_pct_defaut_bp', 'taux_penalites_bp',
    'duree_conservation_prospects_mois'];
update public.parametres_entreprise
  set valeurs_a_verifier = array_append(valeurs_a_verifier, 'duree_conservation_prospects_mois')
  where not ('duree_conservation_prospects_mois' = any (valeurs_a_verifier));

-- Prospects inactifs au-delà de la durée : anonymisés. Réservé au serveur
-- (tâche planifiée). Renvoie le nombre de clients anonymisés.
create or replace function public.purger_prospects_inactifs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client record;
  n integer := 0;
begin
  for v_client in
    select c.id from public.clients c
    join public.parametres_entreprise p on p.organisation_id = c.organisation_id
    where c.anonymise_le is null
      and greatest(c.created_at, c.updated_at) < now() - make_interval(months => p.duree_conservation_prospects_mois)
      and not exists (select 1 from public.devis d where d.client_id = c.id)
      and not exists (select 1 from public.factures f where f.client_id = c.id)
      and not exists (select 1 from public.chantiers ch where ch.client_id = c.id)
  loop
    update public.clients set
      civilite = null, nom = 'Client anonymisé', prenom = null, raison_sociale = null,
      siret = null, tva_intra = null, email = null, telephone = null,
      fact_ligne1 = null, fact_ligne2 = null, fact_code_postal = null, fact_ville = null,
      notes = null, source = null, anonymise_le = now()
    where id = v_client.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.purger_prospects_inactifs() from public, anon, authenticated;
grant execute on function public.purger_prospects_inactifs() to service_role;

-- Les privilèges par défaut (migration 0800) ferment toute nouvelle fonction :
-- ouverture explicite des seules fonctions appelables par une session.
grant execute on function public.texte_recherche(text) to authenticated;
grant execute on function public.rechercher_clients(text, public.type_client, boolean, integer, integer) to authenticated;
