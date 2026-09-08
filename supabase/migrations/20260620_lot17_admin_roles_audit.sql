-- ============================================================================
-- LOT 17 — Rôles admin métier (super/finance/support/viewer) + enforcement
--          serveur + journal d'audit (qui a fait quoi / qui a modifié quoi)
-- Rôles : 'super' (tout + équipe + config), 'finance' (versements/litiges/crédits/promo),
--         'support'|'ops' (courses/commandes/restos/chauffeurs/dispatch), 'viewer' (lecture seule)
-- ============================================================================

-- 1) Helpers de rôle (SECURITY DEFINER : lisent public.admins)
create or replace function public.admin_role() returns text
  language sql stable security definer set search_path=public
  as $$ select role from public.admins where user_id = auth.uid() $$;
create or replace function public.is_super() returns boolean
  language sql stable security definer set search_path=public
  as $$ select exists(select 1 from public.admins where user_id=auth.uid() and role='super') $$;
create or replace function public.can_finance() returns boolean
  language sql stable security definer set search_path=public
  as $$ select exists(select 1 from public.admins where user_id=auth.uid() and role in ('super','finance')) $$;
create or replace function public.can_support() returns boolean
  language sql stable security definer set search_path=public
  as $$ select exists(select 1 from public.admins where user_id=auth.uid() and role in ('super','support','ops')) $$;
grant execute on function public.admin_role() to anon, authenticated, service_role;
grant execute on function public.is_super() to anon, authenticated, service_role;
grant execute on function public.can_finance() to anon, authenticated, service_role;
grant execute on function public.can_support() to anon, authenticated, service_role;

-- 2) Table admins : écriture réservée au super (lecture déjà ouverte à tous les admins)
drop policy if exists admins_super_write on public.admins;
create policy admins_super_write on public.admins for all to authenticated
  using (public.is_super()) with check (public.is_super());

-- 3) SUPER uniquement (configuration système / tarification)
drop policy if exists app_numbers_admin_write on public.app_numbers;
create policy app_numbers_admin_read on public.app_numbers for select to authenticated using (public.is_admin());
create policy app_numbers_super_write on public.app_numbers for all to authenticated using (public.is_super()) with check (public.is_super());

drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_read on public.app_settings for select to authenticated using (public.is_admin());
create policy app_settings_super_write on public.app_settings for all to authenticated using (public.is_super()) with check (public.is_super());

drop policy if exists pricing_admin_insert on public.pricing;
create policy pricing_super_insert on public.pricing for insert to authenticated with check (public.is_super());
drop policy if exists pricing_admin_update on public.pricing;
create policy pricing_super_update on public.pricing for update to authenticated using (public.is_super()) with check (public.is_super());

drop policy if exists location_gammes_admin_ins on public.location_gammes;
create policy location_gammes_super_ins on public.location_gammes for insert to authenticated with check (public.is_super());
drop policy if exists location_gammes_admin_upd on public.location_gammes;
create policy location_gammes_super_upd on public.location_gammes for update to authenticated using (public.is_super()) with check (public.is_super());

drop policy if exists loctarif_admin_update on public.location_tarifs;
create policy loctarif_super_update on public.location_tarifs for update to authenticated using (public.is_super()) with check (public.is_super());

drop policy if exists admin_update_plans on public.driver_plans;
create policy super_update_plans on public.driver_plans for update to authenticated using (public.is_super()) with check (public.is_super());

-- 4) FINANCE (versements / litiges / crédits / promo)
drop policy if exists payouts_admin_update on public.payouts;
create policy payouts_finance_update on public.payouts for update to authenticated using (public.can_finance()) with check (public.can_finance());

drop policy if exists cash_payments_admin on public.cash_payments;
create policy cash_payments_finance on public.cash_payments for all to authenticated using (public.can_finance()) with check (public.can_finance());

drop policy if exists disputes_admin_all on public.disputes;
create policy disputes_admin_read on public.disputes for select to authenticated using (public.is_admin());
create policy disputes_finance_write on public.disputes for all to authenticated using (public.can_finance()) with check (public.can_finance());

drop policy if exists wallet_admin_write on public.wallet_credits;
create policy wallet_admin_read on public.wallet_credits for select to authenticated using (public.is_admin());
create policy wallet_finance_write on public.wallet_credits for all to authenticated using (public.can_finance()) with check (public.can_finance());

drop policy if exists promo_admin_insert on public.promo_codes;
create policy promo_finance_insert on public.promo_codes for insert to authenticated with check (public.can_finance());
drop policy if exists promo_admin_write on public.promo_codes;
create policy promo_finance_update on public.promo_codes for update to authenticated using (public.can_finance()) with check (public.can_finance());

-- 5) SUPPORT / OPÉRATIONS (courses / commandes / restos / chauffeurs / dispatch)
drop policy if exists admin_update_orders on public.orders;
create policy support_update_orders on public.orders for update to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists admin_update_rides on public.rides;
create policy support_update_rides on public.rides for update to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists admin_update_kyc on public.driver_kyc;
create policy support_update_kyc on public.driver_kyc for update to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists admin_update_subs on public.driver_subscriptions;
create policy support_update_subs on public.driver_subscriptions for update to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists tickets_admin_update on public.support_tickets;
create policy support_update_tickets on public.support_tickets for update to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists restaurants_admin_write on public.restaurants;
create policy restaurants_support_write on public.restaurants for all to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists menu_items_admin_all on public.menu_items;
create policy menu_items_support_all on public.menu_items for all to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists menu_sections_admin_all on public.menu_sections;
create policy menu_sections_support_all on public.menu_sections for all to authenticated using (public.can_support()) with check (public.can_support());

drop policy if exists delivery_offers_admin_insert on public.delivery_offers;
create policy delivery_offers_support_insert on public.delivery_offers for insert to authenticated with check (public.can_support());

drop policy if exists ride_offers_admin_insert on public.ride_offers;
create policy ride_offers_support_insert on public.ride_offers for insert to authenticated with check (public.can_support());

-- 6) Journal d'audit
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_nom text,
  actor_role text,
  action text not null,
  table_name text,
  row_id text,
  diff jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (public.is_admin());
grant select on public.audit_log to authenticated;

-- Trigger générique : ne journalise QUE les actions faites par un admin (qui a fait quoi)
create or replace function public.fn_audit() returns trigger
  language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid(); v_role text; v_nom text; v_rowid text; v_diff jsonb;
begin
  if v_actor is null then return case when TG_OP='DELETE' then OLD else NEW end; end if;
  select role, nom into v_role, v_nom from public.admins where user_id=v_actor;
  if v_role is null then return case when TG_OP='DELETE' then OLD else NEW end; end if;
  if TG_OP='DELETE' then v_rowid := to_jsonb(OLD)->>'id'; else v_rowid := to_jsonb(NEW)->>'id'; end if;
  if TG_OP='UPDATE' then
    select jsonb_object_agg(o.key, jsonb_build_object('old', o.value, 'new', n.value))
      into v_diff
      from jsonb_each(to_jsonb(OLD)) o join jsonb_each(to_jsonb(NEW)) n on n.key=o.key
      where o.value is distinct from n.value;
  end if;
  insert into public.audit_log(actor,actor_nom,actor_role,action,table_name,row_id,diff)
    values(v_actor,v_nom,v_role,TG_OP,TG_TABLE_NAME,v_rowid,v_diff);
  return case when TG_OP='DELETE' then OLD else NEW end;
end $$;

do $$ declare t text; tbls text[] := array[
  'orders','rides','payouts','cash_payments','disputes','wallet_credits',
  'restaurants','menu_items','menu_sections','promo_codes','driver_kyc',
  'driver_subscriptions','driver_plans','pricing','location_tarifs',
  'location_gammes','app_settings','app_numbers','admins'];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.fn_audit()', t);
  end loop;
end $$;

-- RPC pour journaliser les actions des edge functions (création de comptes, etc.)
create or replace function public.log_admin_action(p_actor uuid, p_action text, p_table text, p_rowid text, p_summary text)
  returns void language plpgsql security definer set search_path=public as $$
declare v_role text; v_nom text;
begin
  select role, nom into v_role, v_nom from public.admins where user_id=p_actor;
  insert into public.audit_log(actor,actor_nom,actor_role,action,table_name,row_id,diff)
    values(p_actor,v_nom,v_role,p_action,p_table,p_rowid,
           case when p_summary is null then null else jsonb_build_object('note',p_summary) end);
end $$;
revoke all on function public.log_admin_action(uuid,text,text,text,text) from public;
revoke all on function public.log_admin_action(uuid,text,text,text,text) from anon;
revoke all on function public.log_admin_action(uuid,text,text,text,text) from authenticated;
grant execute on function public.log_admin_action(uuid,text,text,text,text) to service_role;

-- ROLLBACK indicatif : restaurer les anciennes policies is_admin() + drop audit_log/fn_audit/log_admin_action/helpers.
