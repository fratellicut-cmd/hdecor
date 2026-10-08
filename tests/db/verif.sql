-- Aides et INVARIANTS GLOBAUX des tests de base (repris de l'audit
-- chef-de-projet, passe 6). Créés dans la base de test uniquement.
-- verif.invariants() : chaque ligne doit compter 0 violation.
create schema verif;
grant usage on schema verif to authenticated;
create sequence verif.n;
grant usage on sequence verif.n to authenticated;

-- Devis franchise de p_ttc, émis et signé ; renvoie l'id.
create function verif.devis(p_chantier uuid, p_ttc bigint, p_client uuid default 'aaaaaaaa-0000-0000-0000-0000000c0001')
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); o uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
begin
  insert into public.devis (id, organisation_id, client_id, chantier_id, validite_jours, regime_tva, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva)
  values (v, o, p_client, p_chantier, 30, 'franchise', p_ttc, 0, p_ttc, jsonb_build_array(jsonb_build_object('taux_bp',0,'base_ht_cents',p_ttc,'tva_cents',0)));
  insert into public.devis_lignes (organisation_id, devis_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
  values (o, v, 1, 'Murs', 10000, 'forfait', p_ttc, 0, p_ttc);
  perform public.emettre_devis(v, '{}', '{}', '{}', o || '/d' || nextval('verif.n') || '.pdf', repeat('a', 64));
  perform public.signer_devis_sur_place(v, 'P D', 'Bon pour accord', o || '/s' || nextval('verif.n') || '.png', repeat('a', 64), '{}', '10.0.0.1', 't');
  return v;
end $$;

-- Facture (acompte/situation/finale/libre) de p_ttc, déduisant p_ded ; émise.
create function verif.fac(p_type text, p_devis uuid, p_chantier uuid, p_ttc bigint, p_ded uuid[] default '{}',
                        p_client uuid default 'aaaaaaaa-0000-0000-0000-0000000c0001')
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); o uuid := 'aaaaaaaa-0000-0000-0000-00000000000a'; d jsonb; s bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('facture_id', id, 'numero', numero, 'ht', total_ht_cents, 'tva', total_tva_cents, 'ttc', total_ttc_cents)), '[]'),
         coalesce(sum(total_ttc_cents), 0)
    into d, s from public.factures where id = any (p_ded);
  insert into public.factures (id, organisation_id, type, client_id, devis_id, chantier_id, delai_paiement_jours, regime_tva,
     avancement_bp, total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, deductions, net_a_payer_cents)
  values (v, o, p_type::public.type_facture, p_client, p_devis, p_chantier, 30, 'franchise',
     case when p_type = 'situation' then 5000 end, p_ttc, 0, p_ttc,
     jsonb_build_array(jsonb_build_object('taux_bp',0,'base_ht_cents',p_ttc,'tva_cents',0)), d, p_ttc - s);
  insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, avancement_bp, total_ht_cents)
  values (o, v, 1, 'Travaux', 10000, 'forfait', p_ttc, 0, case when p_type = 'situation' then 10000 end, p_ttc);
  perform public.emettre_facture(v, '{}', '{}', '{}', o || '/f' || nextval('verif.n') || '.pdf', repeat('a', 64));
  return v;
end $$;

create function verif.avoir(p_origine uuid, p_nature text, p_ttc bigint,
                          p_client uuid default 'aaaaaaaa-0000-0000-0000-0000000c0001')
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); o uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
begin
  insert into public.factures (id, organisation_id, type, client_id, facture_origine_id, nature_avoir, delai_paiement_jours, regime_tva,
     total_ht_cents, total_tva_cents, total_ttc_cents, ventilation_tva, net_a_payer_cents)
  values (v, o, 'avoir', p_client, p_origine, p_nature, 0, 'franchise', p_ttc, 0, p_ttc,
     jsonb_build_array(jsonb_build_object('taux_bp',0,'base_ht_cents',p_ttc,'tva_cents',0)), p_ttc);
  insert into public.facture_lignes (organisation_id, facture_id, ordre, designation, quantite_e4, unite, prix_unitaire_ht_cents, taux_tva_bp, total_ht_cents)
  values (o, v, 1, 'Avoir', 10000, 'forfait', p_ttc, 0, p_ttc);
  perform public.emettre_facture(v, '{}', '{}', '{}', o || '/a' || nextval('verif.n') || '.pdf', repeat('a', 64));
  return v;
end $$;

create function verif.pay(p_facture uuid, p_m bigint) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode)
  values ('aaaaaaaa-0000-0000-0000-00000000000a', p_facture, public.aujourd_hui_paris(), p_m, 'virement') returning id into v;
  return v;
end $$;

create function verif.annule_pay(p_pay uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.paiements (organisation_id, facture_id, date_paiement, montant_cents, mode, annule_paiement_id)
  select organisation_id, facture_id, public.aujourd_hui_paris(), -montant_cents, mode, id from public.paiements where id = p_pay
  returning id into v;
  return v;
end $$;

-- Exécute et renvoie OK / REFUS : message (sans interrompre le script).
create function verif.essai(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return 'OK ' || coalesce(r, '');
exception when others then
  return 'REFUS : ' || sqlerrm;
end $$;

-- Bilan d'un devis : tout ce que voit Yorick.
create function verif.bilan(p_devis uuid) returns text language sql as $$
  select format('accepté=%s engagé=%s reste_à_facturer=%s | exigible(reste à payer)=%s | encaissé net=%s | facturé net valable=%s',
    s.accepte_ttc_cents, s.engage_cents, s.reste_a_facturer_cents,
    (select coalesce(sum(reste_a_payer_cents),0) from public.v_factures where devis_id = p_devis),
    (select coalesce(sum(l.montant_cents),0) from public.v_livre_recettes l join public.factures f on f.id = l.facture_id
      where f.devis_id = p_devis or f.facture_origine_id in (select id from public.factures where devis_id = p_devis)),
    (select coalesce(sum(du_cents),0) from public.factures f, lateral public.solde_facture(f.id) where f.devis_id = p_devis and f.statut <> 'brouillon'))
  from public.solde_devis(p_devis) s;
$$;

-- Invariants globaux (plus stricts que ceux de la suite) : nombre de violations.
create function verif.invariants() returns table (invariant text, violations bigint) language sql as $$
  select 'I1 engagé <= accepté (devis acceptés)', count(*) from public.devis d, lateral public.solde_devis(d.id) s
    where d.statut = 'accepte' and s.engage_cents > s.accepte_ttc_cents
  union all
  select 'I2 somme des dus (net - avoirs) des factures du devis <= accepté', count(*) from public.devis d
    where d.statut = 'accepte' and (select coalesce(sum(s.du_cents),0) from public.factures f, lateral public.solde_facture(f.id) s
                                    where f.devis_id = d.id and f.statut <> 'brouillon') > d.total_accepte_ttc_cents
  union all
  select 'I3 encaissé net client (paiements - remboursements) <= accepté', count(*) from public.devis d
    where d.statut = 'accepte' and (select coalesce(sum(s.paye_cents - s.rembourse_cents),0) from public.factures f, lateral public.solde_facture(f.id) s
                                    where f.devis_id = d.id and f.statut <> 'brouillon') > d.total_accepte_ttc_cents
  union all
  select 'I4 avoirs <= net ; payé <= net ; remboursé <= payé ; remboursé <= trop-perçu', count(*)
    from public.factures f, lateral public.solde_facture(f.id) s
    where f.type <> 'avoir' and f.statut <> 'brouillon'
      and (s.avoirs_cents > f.net_a_payer_cents or s.paye_cents > f.net_a_payer_cents or s.rembourse_cents > s.paye_cents
           or s.rembourse_cents > greatest(0, s.paye_cents - s.du_cents) or s.paye_cents < 0)
  union all
  select 'I5 remboursement d''un avoir <= avoir', count(*) from public.factures a
    where a.type = 'avoir' and (select coalesce(sum(montant_cents),0) from public.paiements where facture_id = a.id) not between 0 and a.total_ttc_cents
  union all
  select 'I6 statut annulée <=> avoirs = net', count(*) from public.factures f, lateral public.solde_facture(f.id) s
    where f.type <> 'avoir' and f.statut <> 'brouillon' and ((f.statut = 'annulee') <> (s.avoirs_cents = f.net_a_payer_cents))
  union all
  select 'I7 déduction : acompte émis/valable, déduit par une seule facture valable', count(*) from (
    select (e ->> 'facture_id')::uuid a from public.factures g, jsonb_array_elements(g.deductions) e where g.statut = 'emise'
    group by 1 having count(*) > 1
       or bool_or((select statut from public.factures where id = (e ->> 'facture_id')::uuid) <> 'emise')) x
  union all
  select 'I8 client chantier = client des devis/factures émis', count(*) from public.chantiers c
    where exists (select 1 from public.devis d where d.chantier_id = c.id and d.statut <> 'brouillon' and d.client_id <> c.client_id)
       or exists (select 1 from public.factures f where f.chantier_id = c.id and f.statut <> 'brouillon' and f.client_id <> c.client_id)
       or exists (select 1 from public.factures f join public.devis d on d.id = f.devis_id where d.chantier_id = c.id and f.statut <> 'brouillon' and f.client_id <> c.client_id)
  union all
  select 'I9 v_chantiers.reste_a_payer = somme solde_facture.reste', count(*) from public.v_chantiers c
    where c.reste_a_payer_cents <> (select coalesce(sum(s.reste_a_payer_cents),0) from public.factures f, lateral public.solde_facture(f.id) s
      where f.type <> 'avoir' and f.statut = 'emise'
        and (f.chantier_id = c.id or f.devis_id in (select id from public.devis where chantier_id = c.id)));
$$;
grant execute on all functions in schema verif to authenticated;
