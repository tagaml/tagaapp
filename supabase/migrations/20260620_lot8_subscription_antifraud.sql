-- ============================================================================
-- LOT 8 — Abonnement chauffeur : anti-fraude
-- Avant : le chauffeur insérait statut='actif' lui-même → accès gratuit sans payer,
--         et getActiveSubscription ne regardait que expires_at (ignorait statut/paiement).
-- Après : le chauffeur ne crée qu'une DEMANDE (en_attente) ; l'admin active après
--         paiement (espèces / OM manuel) et l'expiration est recalculée côté serveur.
-- Mobile : getActiveSubscription exige statut='actif' ; createOrder→demande.
-- ROLLBACK en bas.
-- ============================================================================

create or replace function public.enforce_subscription_insert()
 returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  new.statut := 'en_attente';
  new.paiement := 'en_attente';
  return new;
end $$;
drop trigger if exists trg_enforce_sub_insert on public.driver_subscriptions;
create trigger trg_enforce_sub_insert before insert on public.driver_subscriptions for each row execute function public.enforce_subscription_insert();

drop policy if exists admin_update_subs on public.driver_subscriptions;
create policy admin_update_subs on public.driver_subscriptions for update using (public.is_admin()) with check (public.is_admin());

create or replace function public.admin_activate_subscription(p_sub_id uuid, p_paiement text default 'especes')
 returns void language plpgsql security definer set search_path = public as $$
declare v_driver uuid; v_plan text; v_dur int; v_base timestamptz;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administration'; end if;
  select driver_id, plan_code into v_driver, v_plan from driver_subscriptions where id = p_sub_id;
  if v_driver is null then raise exception 'Abonnement introuvable'; end if;
  select duree_jours into v_dur from driver_plans where code = v_plan;
  if v_dur is null then raise exception 'Forfait introuvable'; end if;
  select coalesce(max(expires_at), now()) into v_base
    from driver_subscriptions where driver_id = v_driver and statut = 'actif' and expires_at > now() and id <> p_sub_id;
  if v_base < now() then v_base := now(); end if;
  update driver_subscriptions set statut = 'actif', paiement = coalesce(p_paiement,'especes'), expires_at = v_base + (v_dur || ' days')::interval
    where id = p_sub_id;
  insert into notifications(user_id, titre, corps, type, lu)
    values (v_driver, 'Abonnement activé', 'Ton abonnement Taga est actif. Tu peux passer en ligne et recevoir des courses.', 'abonnement', false);
end $$;
revoke execute on function public.admin_activate_subscription(uuid, text) from anon, authenticated;
grant execute on function public.admin_activate_subscription(uuid, text) to authenticated;

-- ============================================================================
-- ROLLBACK :
--   drop trigger if exists trg_enforce_sub_insert on public.driver_subscriptions;
--   drop function if exists public.enforce_subscription_insert();
--   drop policy if exists admin_update_subs on public.driver_subscriptions;
--   drop function if exists public.admin_activate_subscription(uuid, text);
-- ============================================================================
