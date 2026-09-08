-- =====================================================================
-- Push système (FCM + APNs via Expo / send-push) sur les 4 transitions de
-- statut commande + géofence "coursier arrivé".
-- Appliqué en 3 lots via l'outil de migration ; consolidé ici pour le versioning.
-- Dépendances : extensions pg_net + pg_cron, edge function send-push (v3, flag record).
-- =====================================================================

-- 1) Colonnes / réglages ------------------------------------------------
alter table public.orders add column if not exists arrival_notified_at timestamptz;
alter table public.orders add column if not exists dest_lat double precision;  -- coords livraison client (géofence)
alter table public.orders add column if not exists dest_lng double precision;
insert into app_numbers(key, value) values ('arrival_radius_m', 100) on conflict (key) do nothing;

-- 2) Helper push (pg_net -> send-push, record=false = pas de doublon in-app) --
create or replace function public.taga_push(p_user uuid, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_user is null then return; end if;
  perform net.http_post(
    url := 'https://dquzsztxjsvwjefgztrh.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_GpwwDabYns_WRq2xD0F0Xw_kUO-TWiF',
      'Authorization','Bearer sb_publishable_GpwwDabYns_WRq2xD0F0Xw_kUO-TWiF'),
    body := jsonb_build_object('userId', p_user, 'title', p_title, 'body', p_body, 'record', false, 'type', 'commande', 'data', coalesce(p_data,'{}'::jsonb))
  );
exception when others then null; -- fire-and-forget
end $function$;

-- 3) Trigger transitions commande : in-app + push + push coursier si annulation --
create or replace function public.fn_order_status_notif()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_titre text; v_corps text; v_resto text; v_liv text; v_can_push boolean;
begin
  if new.statut is distinct from old.statut then
    v_resto := coalesce(nullif(btrim(new.restaurant_nom), ''), 'Le restaurant');
    v_liv   := coalesce(nullif(btrim(new.livreur_nom), ''), 'Ton livreur');
    v_can_push := (old.updated_at is null) or (now() - old.updated_at >= interval '2 seconds'); -- throttle < 2 s
    if new.statut = 'preparation' then
      v_titre := '🍽️ Commande acceptée'; v_corps := v_resto || ' a accepté ta commande. On prépare tes plats !';
    elsif new.statut = 'prete' then
      v_titre := '🎯 Commande prête'; v_corps := 'Ta commande est prête ! On cherche un coursier.';
    elsif new.statut = 'livraison' then
      v_titre := '🛵 En livraison'; v_corps := v_liv || ' a récupéré ta commande. Il arrive vers toi.';
    elsif new.statut = 'livree' then
      v_titre := '✅ Livrée'; v_corps := 'Bon appétit ! Ta commande a été livrée.';
    end if;
    if v_titre is not null then
      insert into public.notifications(user_id, titre, corps, type, ref_type, ref_id, lu)
      values (new.user_id, v_titre, v_corps, 'commande', 'order', new.id, false);
      if v_can_push then
        perform public.taga_push(new.user_id, v_titre, v_corps, jsonb_build_object('ref_type','order','ref_id', new.id::text, 'type','order_status'));
      end if;
    end if;
    if new.statut = 'annulee' and coalesce(new.driver_id, old.driver_id) is not null then
      insert into public.notifications(user_id, titre, corps, type, ref_type, ref_id, lu)
      values (coalesce(new.driver_id, old.driver_id), 'Commande annulée', 'Le client a annulé la commande. Tu peux reprendre d''autres livraisons.', 'commande', 'order', new.id, false);
      perform public.taga_push(coalesce(new.driver_id, old.driver_id), 'Commande annulée', 'Le client a annulé la commande.', jsonb_build_object('ref_type','order','ref_id', new.id::text, 'type','order_cancelled'));
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_order_status_notif on public.orders;
create trigger trg_order_status_notif after update on public.orders
  for each row execute function public.fn_order_status_notif();

-- 4) Géofence "coursier arrivé" (une seule push, colonne arrival_notified_at) --
create or replace function public.check_courier_arrival()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_radius int; v_dist double precision; v_liv text;
begin
  v_radius := coalesce((select value from app_numbers where key='arrival_radius_m'), 100)::int;
  for r in
    select id, user_id, livreur_nom, driver_lat, driver_lng, dest_lat, dest_lng
      from public.orders
     where statut = 'livraison' and arrival_notified_at is null
       and driver_lat is not null and driver_lng is not null and dest_lat is not null and dest_lng is not null
     for update skip locked
  loop
    v_dist := 6371000 * 2 * asin(sqrt(power(sin(radians(r.dest_lat - r.driver_lat)/2), 2)
              + cos(radians(r.driver_lat)) * cos(radians(r.dest_lat)) * power(sin(radians(r.dest_lng - r.driver_lng)/2), 2)));
    if v_dist <= v_radius then
      v_liv := coalesce(nullif(btrim(r.livreur_nom), ''), 'Ton coursier');
      update public.orders set arrival_notified_at = now() where id = r.id and arrival_notified_at is null;
      insert into public.notifications(user_id, titre, corps, type, ref_type, ref_id, lu)
      values (r.user_id, '📍 Coursier arrivé', v_liv || ' est arrivé. Retrouve-le à l''entrée.', 'commande', 'order', r.id, false);
      perform public.taga_push(r.user_id, '📍 ' || v_liv || ' est arrivé', 'Retrouve-le à l''entrée.', jsonb_build_object('ref_type','order','ref_id', r.id::text, 'type','order_arrival'));
    end if;
  end loop;
end $function$;

select cron.schedule('courier_arrival_geofence', '15 seconds', 'select public.check_courier_arrival()');

-- 5) create_order : stocke dest_lat/dest_lng (voir migration create_order_store_dest_coords
--    — insert étendu avec dest_lat, dest_lng = p_dest_lat, p_dest_lng).

-- =====================================================================
-- ROLLBACK :
--   select cron.unschedule('courier_arrival_geofence');
--   drop function if exists public.check_courier_arrival();
--   drop function if exists public.taga_push(uuid,text,text,jsonb);
--   drop trigger if exists trg_order_status_notif on public.orders;  -- puis restaurer fn_order_status_notif sans push
--   alter table public.orders drop column if exists arrival_notified_at, drop column if exists dest_lat, drop column if exists dest_lng;
-- =====================================================================
