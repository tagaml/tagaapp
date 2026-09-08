-- LOT 24 — Partage v2 (modèle A : empilement admin)
--
-- Nouveau flux : le chauffeur accepte d'abord une 1re commande Partage (course simple, en_route).
-- L'ADMIN peut ensuite empiler une 2e commande Partage sur ce même chauffeur → elle arrive comme
-- une offre « +1 » ; à l'acceptation, les deux legs forment un pool (rôles a/b) et le chauffeur
-- bascule sur l'écran course partagée (récupération/dépose ordonnées du plus proche au plus loin —
-- déjà géré par pool-trip). Max 2 commandes Partage par chauffeur.
--
-- L'appariement automatique (try_match_pool) reste DÉSACTIVÉ (pool_enabled=false) : le contrôle est
-- 100 % admin, comme demandé.

-- Délai d'annulation d'une commande Partage sans co-passager (réglable admin ; défaut 10 min).
insert into public.app_numbers(key, value) values ('pool_timeout_min', 10)
  on conflict (key) do nothing;

-- ADMIN : propose une 2e commande Partage à un chauffeur qui a déjà une commande Partage EN ROUTE.
create or replace function public.admin_offer_partage_addon(p_ride2 uuid, p_driver uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare r1 public.rides; r2 public.rides; v_pool uuid; v_win int;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administration'; end if;

  select * into r1 from public.rides
    where driver_id = p_driver and type = 'voiture' and coalesce(shared,false)
      and statut = 'en_route' and pool_id is null
    order by created_at desc limit 1;
  if not found then raise exception 'Ce chauffeur n''a pas de commande partage en route à empiler.'; end if;

  select * into r2 from public.rides
    where id = p_ride2 and type = 'voiture' and coalesce(shared,false)
      and statut = 'recherche' and driver_id is null and pool_id is null;
  if not found then raise exception 'La 2e commande n''est pas une commande partage disponible.'; end if;
  if r2.user_id = r1.user_id then raise exception 'Même client sur les deux commandes.'; end if;

  select coalesce((select value from app_numbers where key='offer_seconds'), 60)::int into v_win;
  v_pool := gen_random_uuid();
  update public.rides set pool_id = v_pool, pool_role = 'a', pool_state = 'propose' where id = r1.id;
  update public.rides set pool_id = v_pool, pool_role = 'b', pool_state = 'propose' where id = r2.id;

  insert into public.ride_offers(ride_id, driver_id, pool_id, status, distance_km, expires_at)
    values (r2.id, p_driver, v_pool, 'pending', 0, now() + (v_win || ' seconds')::interval);
  insert into public.notifications(user_id, titre, corps, type, ref_type, ref_id, lu)
    values (p_driver, 'Course partagée +1', 'Une 2e course partagée peut s''ajouter à ta course en cours.', 'course', 'pool', v_pool, false);
  return v_pool;
end $$;

-- CHAUFFEUR : accepter l'empilement → fusionne le pool, démarre le trajet à 2.
create or replace function public.accept_partage_addon(p_offer uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid(); o public.ride_offers; r1 public.rides; n int;
begin
  select * into o from public.ride_offers where id = p_offer;
  if not found or o.driver_id <> uid or o.status <> 'pending' or o.pool_id is null then
    raise exception 'Offre invalide ou expirée.';
  end if;
  if o.expires_at < now() then raise exception 'Offre expirée.'; end if;

  select * into r1 from public.rides where pool_id = o.pool_id and pool_role = 'a' and driver_id = uid;
  if not found then raise exception 'Course d''origine introuvable.'; end if;

  -- Écriture contrôlée (assignation) : on lève enforce_ride_update le temps de l'opération.
  perform set_config('app.ride_op', '1', true);
  update public.rides
     set driver_id = uid, chauffeur_nom = r1.chauffeur_nom, chauffeur_photo = r1.chauffeur_photo,
         vehicule = r1.vehicule, plaque = r1.plaque, statut = 'en_route', pool_state = 'jumele'
   where id = o.ride_id and statut = 'recherche' and driver_id is null;
  get diagnostics n = row_count;
  if n < 1 then raise exception 'La 2e course n''est plus disponible.'; end if;
  update public.rides set pool_state = 'jumele' where pool_id = o.pool_id and pool_role = 'a';
  perform set_config('app.ride_op', '', true);

  update public.ride_offers set status = 'accepted' where id = p_offer;
  update public.ride_offers set status = 'expired' where pool_id = o.pool_id and status = 'pending' and id <> p_offer;
  insert into public.notifications(user_id, titre, corps, type, ref_type, ref_id, lu)
    select user_id, 'Course partagée confirmée', 'Ton chauffeur arrive · course partagée.', 'course', 'ride', id, false
    from public.rides where pool_id = o.pool_id;
  return o.pool_id;
end $$;

-- CHAUFFEUR : refuser l'empilement → délie le pool (la course #1 continue seule, #2 repart en attente).
create or replace function public.decline_partage_addon(p_offer uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid(); o public.ride_offers;
begin
  select * into o from public.ride_offers where id = p_offer;
  if not found or o.driver_id <> uid then raise exception 'Offre invalide.'; end if;
  update public.ride_offers set status = 'declined' where id = p_offer;
  perform set_config('app.ride_op', '1', true);
  update public.rides set pool_id = null, pool_role = null, pool_state = null
    where pool_id = o.pool_id and pool_role = 'a';
  update public.rides set pool_id = null, pool_role = null, pool_state = 'attente'
    where pool_id = o.pool_id and pool_role = 'b';
  perform set_config('app.ride_op', '', true);
end $$;
