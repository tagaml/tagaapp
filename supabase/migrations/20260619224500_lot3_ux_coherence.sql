-- ============================================================================
-- LOT 3 — Cohérence & UX (P1)
-- 1) Réservation planifiée : dispatch dès 15 min AVANT l'heure prévue (retry cron),
--    annulation à +10 min avec raison dédiée 'aucun_chauffeur_horaire'.
-- 2) Non-lus coursier/client persistants : table order_reads.
-- (Admin/marchand : libellés harmonisés dans taga-admin / taga-marchand — hors git, à redéployer)
-- Canonique statuts : Confirmée / En préparation / Prête / En livraison / Livrée / Annulée
-- ROLLBACK en bas.
-- ============================================================================

-- 1) Fenêtre planifiée élargie (offre dès 15 min avant scheduled_at)
create or replace function public.dispatch_stale_rides()
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record; v_driver uuid; v_dist double precision; v_auto boolean; v_tri boolean;
begin
  update public.ride_offers set status='expired' where status='pending' and expires_at < now();
  select coalesce(value, true) into v_auto from public.app_settings where key='rides_auto_dispatch';
  if v_auto is not null and v_auto = false then return; end if;
  for r in
    select * from public.rides
     where statut='recherche' and driver_id is null
       and (
         (scheduled_at is null and created_at > now() - interval '15 minutes')
         or (scheduled_at is not null and scheduled_at <= now() + interval '15 minutes' and scheduled_at > now() - interval '15 minutes')
       )
       and not exists (select 1 from public.ride_offers o where o.ride_id=rides.id and o.status='pending')
  loop
    v_tri := (r.type='colis' and r.tier='tricycle');
    select p.driver_id,
           (6371*2*asin(sqrt(power(sin(radians(p.lat-r.depart_lat)/2),2)+cos(radians(r.depart_lat))*cos(radians(p.lat))*power(sin(radians(p.lng-r.depart_lng)/2),2)))) as dist
      into v_driver, v_dist
      from public.driver_presence p
     where p.online=true and p.updated_at > now()-interval '120 seconds'
       and p.lat is not null and p.lng is not null and p.driver_id <> r.user_id
       and ((v_tri and p.vehicule='tricycle') or (not v_tri and coalesce(p.vehicule,'') <> 'tricycle'))
       and not public.driver_busy(p.driver_id)
       and not exists (select 1 from public.ride_offers o where o.ride_id=r.id and o.driver_id=p.driver_id)
       and (r.depart_lat is null or
            (6371*2*asin(sqrt(power(sin(radians(p.lat-r.depart_lat)/2),2)+cos(radians(r.depart_lat))*cos(radians(p.lat))*power(sin(radians(p.lng-r.depart_lng)/2),2)))) <= 8)
     order by dist nulls last limit 1;
    if v_driver is not null then
      insert into public.ride_offers(ride_id,driver_id,status,distance_km,expires_at)
      values (r.id,v_driver,'pending',v_dist, now()+interval '18 seconds');
    end if;
    v_driver:=null; v_dist:=null;
  end loop;
end; $function$;

-- Reaper : Case B raison distincte planifiée (voir Lot 2 pour A/C)
create or replace function public.dispatch_reaper()
 returns void language plpgsql security definer set search_path = public as $$
declare r record; v_raison text; v_msg text;
begin
  for r in
    select id,user_id,driver_id,statut,reclaim_count from public.orders
     where driver_id is not null and statut in ('prete','livraison')
       and accepted_at is not null and accepted_at < now()-interval '10 minutes'
       and updated_at < now()-interval '10 minutes'
     for update skip locked
  loop
    if coalesce(r.reclaim_count,0) < 2 then
      update public.orders set driver_id=null,livreur_nom=null,livreur_tel=null,statut='prete',
             accepted_at=null,reclaim_count=coalesce(reclaim_count,0)+1,annul_raison='coursier_indispo'
        where id=r.id and driver_id=r.driver_id and statut=r.statut;
      update public.delivery_offers set status='expired' where order_id=r.id and status='pending';
      insert into public.notifications(user_id,titre,corps,type,lu)
        values (r.user_id,'Coursier indisponible','Ton coursier n''a pas pu continuer — nous cherchons un autre livreur.','commande',false);
    else
      update public.orders set statut='annulee',annul_raison='aucun_coursier' where id=r.id and driver_id=r.driver_id and statut=r.statut;
      update public.delivery_offers set status='expired' where order_id=r.id and status='pending';
      insert into public.notifications(user_id,titre,corps,type,lu)
        values (r.user_id,'Commande annulée','Aucun livreur disponible pour le moment. Tu peux réessayer.','commande',false);
    end if;
  end loop;
  for r in
    select id,user_id from public.orders where statut='prete' and driver_id is null and updated_at < now()-interval '10 minutes' for update skip locked
  loop
    update public.orders set statut='annulee',annul_raison='aucun_coursier' where id=r.id and statut='prete' and driver_id is null;
    update public.delivery_offers set status='expired' where order_id=r.id and status='pending';
    insert into public.notifications(user_id,titre,corps,type,lu)
      values (r.user_id,'Commande annulée','Aucun livreur disponible pour le moment. Tu peux réessayer.','commande',false);
  end loop;
  for r in
    select id,user_id,scheduled_at from public.rides
     where statut='recherche' and driver_id is null
       and ((scheduled_at is null and created_at < now()-interval '10 minutes')
            or (scheduled_at is not null and scheduled_at < now()-interval '10 minutes'))
     for update skip locked
  loop
    if r.scheduled_at is not null then v_raison:='aucun_chauffeur_horaire'; v_msg:='Aucun chauffeur disponible pour ta réservation. Réessaie.';
    else v_raison:='aucun_chauffeur'; v_msg:='Aucun chauffeur disponible. Réessaie dans quelques minutes.'; end if;
    update public.rides set statut='annule',annul_raison=v_raison where id=r.id and statut='recherche' and driver_id is null;
    update public.ride_offers set status='expired' where ride_id=r.id and status='pending';
    insert into public.notifications(user_id,titre,corps,type,lu) values (r.user_id,'Course annulée',v_msg,'course',false);
  end loop;
end $$;

-- 2) Non-lus coursier/client persistants
create table if not exists public.order_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, order_id)
);
alter table public.order_reads enable row level security;
drop policy if exists order_reads_own on public.order_reads;
create policy order_reads_own on public.order_reads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================================
-- ROLLBACK : drop table public.order_reads;
--   (et restaurer dispatch_stale_rides / dispatch_reaper depuis la migration Lot 2)
-- ============================================================================
