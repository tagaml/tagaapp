-- ============================================================================
-- LOT 7 — Web Push (admin + marchand)
-- Notifications navigateur même onglet fermé (PWA), via Push API + VAPID.
-- - pg_net : déclenche l'edge function web-push depuis des triggers DB.
-- - web_push_subscriptions : abonnements navigateur (RLS : propre à chaque user).
-- - _web_push(targets, title, body, url) : appelle l'edge function (jeton interne).
-- - triggers : nouvelle commande -> marchand ; litige/retrait/ticket -> admins.
-- Edge function : supabase/functions/web-push/index.ts (verify_jwt=false, jeton interne).
-- ROLLBACK en bas.
-- ============================================================================
create extension if not exists pg_net;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  app text,
  created_at timestamptz not null default now()
);
alter table public.web_push_subscriptions enable row level security;
drop policy if exists wps_own on public.web_push_subscriptions;
create policy wps_own on public.web_push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public._web_push(p_targets uuid[], p_title text, p_body text, p_url text default '/')
 returns void language plpgsql security definer set search_path = public as $$
begin
  if p_targets is null or array_length(p_targets,1) is null then return; end if;
  perform net.http_post(
    url := 'https://dquzsztxjsvwjefgztrh.supabase.co/functions/v1/web-push',
    body := jsonb_build_object('targets', to_jsonb(p_targets), 'title', p_title, 'body', p_body, 'url', p_url),
    headers := jsonb_build_object('Content-Type','application/json','X-Internal-Token','tgwp_b7d1f3a9c4e2486fa1c0d9e8b5a6f3c2')
  );
exception when others then raise warning 'web_push failed: %', sqlerrm;
end $$;

create or replace function public.wp_new_order() returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid[];
begin
  select array_agg(user_id) into t from merchants where restaurant_id = new.restaurant_id;
  perform public._web_push(t, 'Nouvelle commande', coalesce(new.restaurant_nom,'Commande') || ' · ' || coalesce(new.total,0)::text || ' F', '/');
  return new;
end $$;
drop trigger if exists trg_wp_new_order on public.orders;
create trigger trg_wp_new_order after insert on public.orders for each row execute function public.wp_new_order();

create or replace function public.wp_admins() returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid[]; v_title text; v_body text;
begin
  select array_agg(user_id) into t from admins;
  if TG_TABLE_NAME = 'disputes' then v_title := 'Nouveau litige'; v_body := coalesce(new.raison,'Litige signalé');
  elsif TG_TABLE_NAME = 'payouts' then v_title := 'Demande de retrait'; v_body := coalesce(new.montant,0)::text || ' F à verser';
  else v_title := 'Nouveau ticket support'; v_body := coalesce(new.sujet,'Ticket'); end if;
  perform public._web_push(t, v_title, v_body, '/');
  return new;
end $$;
drop trigger if exists trg_wp_dispute on public.disputes;
create trigger trg_wp_dispute after insert on public.disputes for each row execute function public.wp_admins();
drop trigger if exists trg_wp_payout on public.payouts;
create trigger trg_wp_payout after insert on public.payouts for each row execute function public.wp_admins();
drop trigger if exists trg_wp_ticket on public.support_tickets;
create trigger trg_wp_ticket after insert on public.support_tickets for each row execute function public.wp_admins();

-- ============================================================================
-- ROLLBACK :
--   drop trigger if exists trg_wp_new_order on public.orders;
--   drop trigger if exists trg_wp_dispute on public.disputes;
--   drop trigger if exists trg_wp_payout on public.payouts;
--   drop trigger if exists trg_wp_ticket on public.support_tickets;
--   drop function if exists public.wp_new_order(); drop function if exists public.wp_admins();
--   drop function if exists public._web_push(uuid[],text,text,text);
--   drop table if exists public.web_push_subscriptions;
-- (pg_net peut rester installé)
-- ============================================================================
