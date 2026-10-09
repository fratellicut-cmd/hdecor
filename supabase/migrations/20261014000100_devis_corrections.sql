-- =============================================================================
-- H'DECOR, phase 4 : corrections après la première boucle de contrôle.
-- =============================================================================

-- 1. Garde-fou d'émission en base (indépendant de l'interface) : taux de TVA
--    des lignes cohérents avec le régime et les Paramètres, total HT > 0.
create or replace function public.controler_emission_devis()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.statut = 'brouillon' and new.statut = 'envoye' then
    if new.total_ht_cents <= 0 then
      raise exception 'Un devis à 0 € HT ne peut pas être émis.' using errcode = 'P0001';
    end if;
    if new.regime_tva = 'franchise' and exists (
         select 1 from public.devis_lignes l
         where l.devis_id = new.id and l.type = 'ligne' and l.taux_tva_bp <> 0) then
      raise exception 'Franchise en base de TVA : toutes les lignes doivent être à 0 %%.' using errcode = 'P0001';
    end if;
    if new.regime_tva = 'assujetti' and exists (
         select 1 from public.devis_lignes l
         where l.devis_id = new.id and l.type = 'ligne'
           and (l.taux_tva_bp = 0 or not exists (
                  select 1 from public.taux_tva t
                  where t.organisation_id = new.organisation_id and t.taux_bp = l.taux_tva_bp and t.actif))) then
      raise exception 'Taux de TVA d''une ligne absent des Paramètres ou à 0 %% sans justification.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.controler_emission_devis() from public, anon, authenticated;
create trigger devis_controle_emission before update on public.devis
  for each row execute function public.controler_emission_devis();

-- 2. Version remplacée : ses liens publics sont désactivés dans la même
--    transaction (plus d'appel séparé qui pourrait échouer).
create or replace function public.revoquer_liens_devis_remplace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.statut = 'remplace' and old.statut is distinct from 'remplace' then
    update public.liens_publics set revoque_le = now()
    where devis_id = new.id and organisation_id = new.organisation_id and revoque_le is null;
  end if;
  return null;
end;
$$;
revoke execute on function public.revoquer_liens_devis_remplace() from public, anon, authenticated;
create trigger devis_remplace_revoque_liens after update on public.devis
  for each row execute function public.revoquer_liens_devis_remplace();

-- 3. Relances : seulement après un ENVOI réel (email ou lien partagé), le délai
--    courant depuis le dernier envoi (et non depuis l'émission).
create or replace function public.devis_a_relancer()
returns table (organisation_id uuid, devis_id uuid, numero text, version smallint, email text,
               client text, entreprise text, valide_jusqu_au date)
language sql
stable
security definer
set search_path = ''
as $$
  select d.organisation_id, d.id, d.numero, d.version, c.email,
         coalesce(d.copie_client ->> 'nom_affiche', c.nom), coalesce(p.raison_sociale, ''),
         d.date_emission + d.validite_jours
  from public.devis d
  join public.parametres_entreprise p on p.organisation_id = d.organisation_id
  join public.clients c on c.id = d.client_id and c.organisation_id = d.organisation_id
  join lateral (
    select max(e.envoye_le) as dernier from public.envois e
    where e.document_type = 'devis' and e.document_id = d.id and e.organisation_id = d.organisation_id
      and e.nature = 'envoi' and e.statut = 'envoye'
  ) envoi on envoi.dernier is not null
  where d.statut = 'envoye'
    and p.relance_devis_active
    and envoi.dernier <= now() - make_interval(days => p.relance_devis_jours)
    and d.date_emission + d.validite_jours >= public.aujourd_hui_paris()
    and c.email is not null and c.anonymise_le is null
    and not exists (select 1 from public.envois e
                    where e.document_type = 'devis' and e.document_id = d.id and e.nature = 'relance_devis' and e.statut = 'envoye');
$$;
revoke execute on function public.devis_a_relancer() from public, anon, authenticated;
grant execute on function public.devis_a_relancer() to service_role;

-- 4. Achats retenus d'un brouillon remplacés en une seule transaction.
create or replace function public.remplacer_achats_devis(p_devis_id uuid, p_achats jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.devis where id = p_devis_id;
  if v_org is null then
    raise exception 'Devis introuvable.' using errcode = 'P0002';
  end if;
  delete from public.devis_achats where devis_id = p_devis_id;
  insert into public.devis_achats (organisation_id, devis_id, conditionnement_id, nombre, prix_achat_retenu_cents)
  select v_org, p_devis_id, a.conditionnement_id, a.nombre, a.prix_achat_retenu_cents
  from jsonb_to_recordset(p_achats) as a(conditionnement_id uuid, nombre integer, prix_achat_retenu_cents bigint);
end;
$$;
revoke execute on function public.remplacer_achats_devis(uuid, jsonb) from public, anon;
grant execute on function public.remplacer_achats_devis(uuid, jsonb) to authenticated;

-- 5. Les PDF émis et les tracés de signature sont déposés par le SERVEUR
--    (clé service) : l'API n'y dépose plus rien directement.
drop policy hdecor_ajout on storage.objects;
create policy hdecor_ajout on storage.objects for insert to authenticated
  with check (bucket_id in ('photos', 'justificatifs', 'marque')
              and public.est_membre(public.organisation_du_chemin(name)));
