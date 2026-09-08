-- ============================================================================
-- LOT 2 — Robustesse dispatch (P0#3 : courses/commandes zombies)
-- - updated_at / accepted_at / reclaim_count / annul_raison sur rides & orders
-- - trigger horodatage (updated_at + accepted_at à la 1ère assignation)
-- - enforce_*_update : bypass aussi quand auth.uid() is null (cron/reaper système)
-- - dispatch_reaper() : reclaim orphelins + péremption « aucun chauffeur/coursier »
-- - cron 'dispatch-reaper' chaque minute (réconcilié avec dispatch_stale_* qui ne fait
--   QUE l'offre ; le reaper ne fait QUE timeout/reclaim → pas de chevauchement d'action)
-- Testé : reclaim (count<2), reclaim max -> annulee, recherche timeout, prete sans coursier
-- + 4 notifications client créées.
-- ROLLBACK en bas de fichier.
-- ============================================================================

alter table public.rides  add column if not exists updated_at timestamptz not null default now();
alter table public.rides  add column if not exists accepted_at timestamptz;
alter table public.rides  add column if not exists annul_raison text;
alter table public.orders add column if not exists updated_at timestamptz not null default now();
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists reclaim_count int not null default 0;
alter table public.orders add column if not exists annul_raison text;

create or replace function public.touch_dispatch_row()
 returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if old.driver_id is null and new.driver_id is not null and new.accepted_at is null then
    new.accepted_at := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_touch_rides on public.rides;
create trigger trg_touch_rides before update on public.rides for each row execute function public.touch_dispatch_row();
drop trigger if exists trg_touch_orders on public.orders;
create trigger trg_touch_orders before update on public.orders for each row execute function public.touch_dispatch_row();

-- enforce_*_update : ajoute le bypass « auth.uid() is null » (contexte système : cron/reaper)
create or replace function public.enforce_ride_update()
 returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  if new.prix is distinct from old.prix or new.user_id is distinct from old.user_id
     or new.driver_id is distinct from old.driver_id or new.distance_km is distinct from old.distance_km then
    raise exception 'Champ protégé non modifiable (course)';
  end if;
  if new.statut is distinct from old.statut then
    if uid = old.driver_id then
      if not ((old.statut,new.statut) in (('en_route','arrive'),('arrive','en_cours'),('en_cours','termine'))) then
        raise exception 'Transition course interdite (chauffeur): % -> %', old.statut, new.statut; end if;
    elsif uid = old.user_id then
      if new.statut <> 'annule' or old.statut in ('termine','annule') then
        raise exception 'Transition course interdite (client): % -> %', old.statut, new.statut; end if;
    else raise exception 'Modification de course non autorisée'; end if;
  else
    if new.paye is distinct from old.paye and uid is distinct from old.driver_id then
      raise exception 'Encaissement réservé au chauffeur'; end if;
  end if;
  return new;
end $$;

create or replace function public.enforce_order_update()
 returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); my_resto uuid;
begin
  if uid is null or (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  if new.total is distinct from old.total or new.sous_total is distinct from old.sous_total
     or new.user_id is distinct from old.user_id or new.restaurant_id is distinct from old.restaurant_id
     or new.driver_id is distinct from old.driver_id or new.credit_applied is distinct from old.credit_applied then
    raise exception 'Champ protégé non modifiable (commande)';
  end if;
  if new.statut is distinct from old.statut then
    my_resto := public.my_restaurant_id();
    if my_resto is not null and (my_resto = old.restaurant_id or old.restaurant_nom = (select nom from restaurants where id = my_resto)) then
      if not ((old.statut,new.statut) in (('confirmee','preparation'),('preparation','prete'),('prete','livraison'),
                                          ('confirmee','annulee'),('preparation','annulee'),('prete','annulee'))) then
        raise exception 'Transition commande interdite (marchand): % -> %', old.statut, new.statut; end if;
    elsif uid = old.driver_id then
      if not ((old.statut,new.statut) in (('prete','livraison'),('livraison','livree'))) then
        raise exception 'Transition commande interdite (coursier): % -> %', old.statut, new.statut; end if;
    elsif uid = old.user_id then
      if not ((old.statut,new.statut) in (('confirmee','annulee'),('preparation','annulee'))) then
        raise exception 'Transition commande interdite (client): % -> %', old.statut, new.statut; end if;
    else raise exception 'Modification de commande non autorisée'; end if;
  end if;
  return new;
end $$;

create or replace function public.dispatch_reaper()
 returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- A : commande prete/livraison orpheline (coursier disparu) ; reclaim <2 sinon annulée
  for r in
    select id, user_id, driver_id, statut, reclaim_count from public.orders
     where driver_id is not null and statut in ('prete','livraison')
       and accepted_at is not null and accepted_at < now() - interval '10 minutes'
       and updated_at < now() - interval '10 minutes'
     for update skip locked
  loop
    if coalesce(r.reclaim_count,0) < 2 then
      update public.orders set driver_id=null, livreur_nom=null, livreur_tel=null, statut='prete',
             accepted_at=null, reclaim_count=coalesce(reclaim_count,0)+1, annul_raison='coursier_indispo'
        where id=r.id and driver_id=r.driver_id and statut=r.statut;
      update public.delivery_offers set status='expired' where order_id=r.id and status='pending';
      insert into public.notifications(user_id,titre,corps,type,lu)
        values (r.user_id,'Coursier indisponible','Ton coursier n''a pas pu continuer — nous cherchons un autre livreur.','commande',false);
    else
      update public.orders set statut='annulee', annul_raison='aucun_coursier'
        where id=r.id and driver_id=r.driver_id and statut=r.statut;
      update public.delivery_offers set status='expired' where order_id=r.id and status='pending';
      insert into public.notifications(user_id,titre,corps,type,lu)
        values (r.user_id,'Commande annulée','Aucun livreur disponible pour le moment. Tu peux réessayer.','commande',false);
    end if;
  end loop;
  -- C : commande prete sans coursier > 10 min
  for r in
    select id, user_id from public.orders
     where statut='prete' and driver_id is null and updated_at < now() - interval '10 minutes'
     for update skip locked
  loop
    update public.orders set statut='annulee', annul_raison='aucun_coursier'
      where id=r.id and statut='prete' and driver_id is null;
    update public.delivery_offers set status='expired' where order_id=r.id and status='pending';
    insert into public.notifications(user_id,titre,corps,type,lu)
      values (r.user_id,'Commande annulée','Aucun livreur disponible pour le moment. Tu peux réessayer.','commande',false);
  end loop;
  -- B : course en recherche > 10 min sans chauffeur
  for r in
    select id, user_id from public.rides
     where statut='recherche' and driver_id is null
       and ((scheduled_at is null and created_at < now() - interval '10 minutes')
            or (scheduled_at is not null and scheduled_at < now() - interval '10 minutes'))
     for update skip locked
  loop
    update public.rides set statut='annule', annul_raison='aucun_chauffeur'
      where id=r.id and statut='recherche' and driver_id is null;
    update public.ride_offers set status='expired' where ride_id=r.id and status='pending';
    insert into public.notifications(user_id,titre,corps,type,lu)
      values (r.user_id,'Course annulée','Aucun chauffeur disponible. Réessaie dans quelques minutes.','course',false);
  end loop;
end $$;
revoke execute on function public.dispatch_reaper() from anon, authenticated;

do $$ begin perform cron.unschedule('dispatch-reaper'); exception when others then null; end $$;
select cron.schedule('dispatch-reaper', '* * * * *', 'select public.dispatch_reaper()');

-- ============================================================================
-- ROLLBACK :
--   do $$ begin perform cron.unschedule('dispatch-reaper'); exception when others then null; end $$;
--   drop function if exists public.dispatch_reaper();
--   drop trigger if exists trg_touch_rides on public.rides;
--   drop trigger if exists trg_touch_orders on public.orders;
--   drop function if exists public.touch_dispatch_row();
--   -- (optionnel) retirer le bypass auth.uid() is null des enforce_* (revoir migration Lot 1)
--   -- (optionnel) alter table rides drop column updated_at, accepted_at, annul_raison;
--   -- (optionnel) alter table orders drop column updated_at, accepted_at, reclaim_count, annul_raison;
-- ============================================================================
