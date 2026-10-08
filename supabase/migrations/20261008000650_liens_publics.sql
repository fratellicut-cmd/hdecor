-- =============================================================================
-- H'DECOR : liens publics (consultation / signature à distance du devis,
-- consultation de facture).
--
-- * Seule l'empreinte SHA-256 du jeton est stockée : une fuite de la base ne
--   donne aucun lien utilisable. Jeton : 32 octets aléatoires (256 bits).
-- * Le document est référencé par devis_id OU facture_id, avec clé étrangère
--   COMPOSITE (organisation_id, …) : un lien ne peut viser qu'un document de
--   sa propre organisation (correctif audit sécurité phase 0, critique 1).
-- * Les fonctions par jeton ne sont exécutables que par le rôle service : le
--   serveur Next les appelle après avoir relevé l'IP réelle de la requête.
-- * Durée maximale d'un lien : 90 jours (limite de sécurité, pas une règle
--   métier ; la durée choisie dans l'interface est plus courte).
-- =============================================================================

create table public.liens_publics (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  devis_id          uuid,
  facture_id        uuid,
  finalite          text not null check (finalite in ('consultation', 'signature')),
  jeton_sha256      text not null unique check (jeton_sha256 ~ '^[0-9a-f]{64}$'),
  expire_le         timestamptz not null,
  utilise_le        timestamptz,
  revoque_le        timestamptz,
  cree_le           timestamptz not null default now(),
  foreign key (organisation_id, devis_id) references public.devis (organisation_id, id) on delete restrict,
  foreign key (organisation_id, facture_id) references public.factures (organisation_id, id) on delete restrict,
  check ((devis_id is null) <> (facture_id is null)),
  check (finalite = 'consultation' or devis_id is not null),
  check (expire_le > cree_le and expire_le <= cree_le + interval '90 days')
);
create index liens_publics_devis_idx on public.liens_publics (devis_id);
create index liens_publics_facture_idx on public.liens_publics (facture_id);

alter table public.liens_publics enable row level security;
create policy liens_lecture on public.liens_publics
  for select to authenticated using (public.est_membre(organisation_id));
create policy liens_ajout on public.liens_publics
  for insert to authenticated with check (public.est_membre(organisation_id));
create policy liens_revocation on public.liens_publics
  for update to authenticated using (public.est_membre(organisation_id)) with check (public.est_membre(organisation_id));

-- L'API ne choisit ni cree_le, ni utilise_le, ni revoque_le à la création, et
-- ne peut modifier que revoque_le.
revoke insert, update, delete, truncate on public.liens_publics from authenticated;
grant insert (organisation_id, devis_id, facture_id, finalite, jeton_sha256, expire_le)
  on public.liens_publics to authenticated;
grant update (revoque_le) on public.liens_publics to authenticated;

create or replace function public.proteger_lien_public()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Un brouillon n'a pas de lien public.
    if exists (select 1 from public.devis where id = new.devis_id and statut = 'brouillon')
       or exists (select 1 from public.factures where id = new.facture_id and statut = 'brouillon') then
      raise exception 'Un brouillon ne peut pas être partagé.' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if old.revoque_le is not null and new.revoque_le is distinct from old.revoque_le then
    raise exception 'Une révocation est définitive.' using errcode = 'P0001';
  end if;
  if old.utilise_le is not null and new.utilise_le is distinct from old.utilise_le then
    raise exception 'Un lien utilisé le reste.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - array['revoque_le', 'utilise_le']) is distinct from (to_jsonb(old) - array['revoque_le', 'utilise_le']) then
    raise exception 'Un lien public ne se modifie pas.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger liens_publics_protection before insert or update on public.liens_publics
  for each row execute function public.proteger_lien_public();

create or replace function public.lien_valide(p_jeton text, p_finalite text)
returns public.liens_publics
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien public.liens_publics%rowtype;
begin
  if p_jeton is null or length(p_jeton) < 43 then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  select * into v_lien from public.liens_publics
  where jeton_sha256 = encode(extensions.digest(p_jeton, 'sha256'), 'hex')
    and finalite = p_finalite;
  if not found or v_lien.revoque_le is not null or v_lien.expire_le < now()
     or (v_lien.finalite = 'signature' and v_lien.utilise_le is not null) then
    -- Même message dans tous les cas : aucune information sur la cause.
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  return v_lien;
end;
$$;

create or replace function public.devis_par_jeton(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien  public.liens_publics%rowtype;
  v_devis public.devis%rowtype;
begin
  begin
    v_lien := public.lien_valide(p_jeton, 'signature');
  exception when sqlstate 'P0002' then
    v_lien := public.lien_valide(p_jeton, 'consultation');
  end;
  -- Défense en profondeur : même organisation que le lien (déjà garanti par la FK).
  select * into v_devis from public.devis
  where id = v_lien.devis_id and organisation_id = v_lien.organisation_id;
  if not found or v_devis.statut = 'brouillon' then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  if v_devis.consulte_le is null then
    update public.devis set consulte_le = now() where id = v_devis.id;
  end if;
  return jsonb_build_object(
    'devis_id', v_devis.id, 'numero', v_devis.numero, 'version', v_devis.version,
    'statut', v_devis.statut, 'pdf_chemin', v_devis.pdf_chemin, 'pdf_sha256', v_devis.pdf_sha256,
    'peut_signer', v_lien.finalite = 'signature' and v_devis.statut = 'envoye',
    'organisation_id', v_devis.organisation_id);
end;
$$;

create or replace function public.signer_devis_par_jeton(
  p_jeton text, p_nom text, p_mention text, p_image_chemin text, p_document_sha256 text,
  p_options uuid[], p_ip inet, p_user_agent text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien public.liens_publics%rowtype;
  v_sig  uuid;
begin
  perform 1 from public.liens_publics
  where jeton_sha256 = encode(extensions.digest(p_jeton, 'sha256'), 'hex')
  for update;                                   -- usage unique, même en double clic
  v_lien := public.lien_valide(p_jeton, 'signature');
  if not exists (select 1 from public.devis
                 where id = v_lien.devis_id and organisation_id = v_lien.organisation_id) then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  v_sig := public.signer_devis_interne(v_lien.devis_id, 'lien', p_nom, p_mention, p_image_chemin,
    p_document_sha256, p_options, p_ip, p_user_agent);
  update public.liens_publics set utilise_le = now() where id = v_lien.id;
  return v_sig;
end;
$$;

create or replace function public.facture_par_jeton(p_jeton text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lien public.liens_publics%rowtype;
  v_f    public.v_factures%rowtype;
begin
  v_lien := public.lien_valide(p_jeton, 'consultation');
  select * into v_f from public.v_factures
  where id = v_lien.facture_id and organisation_id = v_lien.organisation_id;
  if not found or v_f.statut = 'brouillon' then
    raise exception 'Lien invalide ou expiré.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'facture_id', v_f.id, 'numero', v_f.numero, 'type', v_f.type,
    'pdf_chemin', v_f.pdf_chemin, 'pdf_sha256', v_f.pdf_sha256,
    'date_echeance', v_f.date_echeance, 'reste_a_payer_cents', v_f.reste_a_payer_cents,
    'organisation_id', v_f.organisation_id);
end;
$$;

revoke execute on function public.lien_valide(text, text) from public, anon, authenticated;
revoke execute on function public.devis_par_jeton(text) from public, anon, authenticated;
revoke execute on function public.facture_par_jeton(text) from public, anon, authenticated;
revoke execute on function public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text)
  from public, anon, authenticated;
grant execute on function public.devis_par_jeton(text) to service_role;
grant execute on function public.facture_par_jeton(text) to service_role;
grant execute on function public.signer_devis_par_jeton(text, text, text, text, text, uuid[], inet, text)
  to service_role;
