-- Prix serveur autoritaire pour les courses + garde d'insertion + supplément manut colis.
-- (Appliqué en prod le 2026-07-14 via apply_migration.)

alter table public.rides add column if not exists manut boolean not null default false;

create or replace function public.set_ride_price()
returns trigger language plpgsql set search_path to 'public' as $$
declare v int; v_hourly int; v_mult numeric; v_pct numeric; v_dist double precision; v_wallet int;
begin
  if new.location_hours is not null and new.location_hours > 0 then
    select tarif_heure into v_hourly from public.location_tarifs where vehicule = new.type;
    if v_hourly is null then
      raise exception 'Location indisponible pour ce véhicule.' using errcode = 'check_violation';
    end if;
    v_mult := 1;
    if new.tier is not null then
      select mult into v_mult from public.location_gammes where tier = new.tier;
      v_mult := coalesce(v_mult, 1);
    end if;
    new.prix := (round((v_hourly * v_mult) / 500.0) * 500)::int * new.location_hours;
  else
    if new.depart_lat is not null and new.depart_lng is not null
       and new.dest_lat is not null and new.dest_lng is not null then
      v_dist := 1.3 * (6371*2*asin(sqrt(power(sin(radians(new.dest_lat - new.depart_lat)/2),2)
                + cos(radians(new.depart_lat))*cos(radians(new.dest_lat))
                  *power(sin(radians(new.dest_lng - new.depart_lng)/2),2))));
      new.distance_km := round(v_dist::numeric, 2);
    else
      new.distance_km := least(greatest(coalesce(new.distance_km,0),0), 100);
    end if;
    if new.tier is not null then
      v := public.compute_ride_price(new.tier, new.distance_km);
      if v is not null then
        if coalesce(new.shared,false) and new.type = 'voiture' then
          select value into v_pct from public.app_numbers where key = 'shared_discount_pct';
          v_pct := coalesce(v_pct, 30);
          v := (round(v * (100 - v_pct) / 100.0 / 50.0) * 50)::int;
        end if;
        if coalesce(new.manut,false) and new.type = 'colis' then
          v := v + coalesce((select value from public.app_numbers where key = 'colis_manut_fee'), 2000)::int;
        end if;
        new.prix := v;
      end if;
    end if;
  end if;
  select coalesce(balance,0) into v_wallet from public.wallet_credits where user_id = new.user_id;
  new.credit_applied := least(greatest(coalesce(new.credit_applied,0),0),
                              coalesce(v_wallet,0), coalesce(new.prix,0));
  return new;
end $$;

create or replace function public.enforce_ride_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(current_setting('app.ride_ok', true), '') = '1'
     or (select auth.role()) = 'service_role'
     or public.is_admin()
     or coalesce(new.location_hours, 0) > 0 then
    return new;
  end if;
  raise exception 'Course invalide : utilise create_ride.' using errcode = 'check_violation';
end $$;

drop trigger if exists trg_enforce_ride_insert on public.rides;
create trigger trg_enforce_ride_insert before insert on public.rides
  for each row execute function public.enforce_ride_insert();

-- create_ride (surcharge app) : pose le drapeau interne app.ride_ok + persiste manut.
-- Corps complet dans la fonction déployée ; voir migration appliquée en prod.
