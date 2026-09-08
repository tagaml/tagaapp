-- ============================================================================
-- SECURITY LOT 1 — durcissement RLS + machine d'états (appliqué sur Supabase)
-- P0#1 rides/orders : WITH CHECK strict + triggers de transition
-- P0#2 KYC : pas d'auto-validation
-- P0#4 : consume_credit non anonyme + pool 'prete' visible aux coursiers
-- Testé par impersonation (rôle authenticated + claims JWT) : attaques bloquées,
-- actions légitimes (chauffeur/client/coursier/marchand) OK.
-- Rollback : voir bas de fichier.
-- ============================================================================

-- ---------- RIDES ----------
drop policy if exists rides_select on public.rides;
create policy rides_select on public.rides for select
  using (user_id = auth.uid() OR driver_id = auth.uid()
         OR (driver_id IS NULL AND statut = 'recherche'));

drop policy if exists rides_update on public.rides;
create policy rides_update on public.rides for update
  using (user_id = auth.uid() OR driver_id = auth.uid())
  with check (user_id = auth.uid() OR driver_id = auth.uid());

create or replace function public.enforce_ride_update()
 returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  if new.prix is distinct from old.prix
     or new.user_id is distinct from old.user_id
     or new.driver_id is distinct from old.driver_id
     or new.distance_km is distinct from old.distance_km then
    raise exception 'Champ protégé non modifiable (course)';
  end if;
  if new.statut is distinct from old.statut then
    if uid = old.driver_id then
      if not ((old.statut, new.statut) in (('en_route','arrive'),('arrive','en_cours'),('en_cours','termine'))) then
        raise exception 'Transition course interdite (chauffeur): % -> %', old.statut, new.statut;
      end if;
    elsif uid = old.user_id then
      if new.statut <> 'annule' or old.statut in ('termine','annule') then
        raise exception 'Transition course interdite (client): % -> %', old.statut, new.statut;
      end if;
    else
      raise exception 'Modification de course non autorisée';
    end if;
  else
    if new.paye is distinct from old.paye and uid is distinct from old.driver_id then
      raise exception 'Encaissement réservé au chauffeur';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_enforce_ride_update on public.rides;
create trigger trg_enforce_ride_update before update on public.rides
  for each row execute function public.enforce_ride_update();

-- ---------- ORDERS ----------
drop policy if exists orders_driver_select on public.orders;
create policy orders_driver_select on public.orders for select
  using (driver_id = auth.uid()
         OR (driver_id IS NULL AND statut IN ('prete','livraison')));

drop policy if exists orders_driver_update on public.orders;
create policy orders_driver_update on public.orders for update
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists orders_merchant_update on public.orders;
create policy orders_merchant_update on public.orders for update
  using ((restaurant_id = my_restaurant_id()) OR (restaurant_nom = (select nom from restaurants where id = my_restaurant_id())))
  with check ((restaurant_id = my_restaurant_id()) OR (restaurant_nom = (select nom from restaurants where id = my_restaurant_id())));

drop policy if exists orders_update_own on public.orders;
create policy orders_update_own on public.orders for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.enforce_order_update()
 returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); my_resto uuid;
begin
  if (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  if new.total is distinct from old.total
     or new.sous_total is distinct from old.sous_total
     or new.user_id is distinct from old.user_id
     or new.restaurant_id is distinct from old.restaurant_id
     or new.driver_id is distinct from old.driver_id
     or new.credit_applied is distinct from old.credit_applied then
    raise exception 'Champ protégé non modifiable (commande)';
  end if;
  if new.statut is distinct from old.statut then
    my_resto := public.my_restaurant_id();
    if my_resto is not null and (my_resto = old.restaurant_id or old.restaurant_nom = (select nom from restaurants where id = my_resto)) then
      if not ((old.statut,new.statut) in (('confirmee','preparation'),('preparation','prete'),('prete','livraison'),
                                          ('confirmee','annulee'),('preparation','annulee'),('prete','annulee'))) then
        raise exception 'Transition commande interdite (marchand): % -> %', old.statut, new.statut;
      end if;
    elsif uid = old.driver_id then
      if not ((old.statut,new.statut) in (('prete','livraison'),('livraison','livree'))) then
        raise exception 'Transition commande interdite (coursier): % -> %', old.statut, new.statut;
      end if;
    elsif uid = old.user_id then
      if not ((old.statut,new.statut) in (('confirmee','annulee'),('preparation','annulee'))) then
        raise exception 'Transition commande interdite (client): % -> %', old.statut, new.statut;
      end if;
    else
      raise exception 'Modification de commande non autorisée';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_enforce_order_update on public.orders;
create trigger trg_enforce_order_update before update on public.orders
  for each row execute function public.enforce_order_update();

-- ---------- P0#2 KYC : pas d'auto-validation ----------
drop policy if exists driver_kyc_update on public.driver_kyc;
create policy driver_kyc_update on public.driver_kyc for update
  using (auth.uid() = driver_id)
  with check (auth.uid() = driver_id and statut <> 'valide');

-- ---------- P0#4 : consume_credit non anonyme ----------
revoke execute on function public.consume_credit(integer) from anon;

-- ============================================================================
-- ROLLBACK (à exécuter manuellement si besoin) :
--   drop trigger if exists trg_enforce_ride_update on public.rides;
--   drop trigger if exists trg_enforce_order_update on public.orders;
--   drop function if exists public.enforce_ride_update();
--   drop function if exists public.enforce_order_update();
--   drop policy rides_update on public.rides;
--   create policy rides_update on public.rides for update using (user_id=auth.uid() OR driver_id=auth.uid() OR statut='recherche');
--   drop policy rides_select on public.rides;
--   create policy rides_select on public.rides for select using (user_id=auth.uid() OR driver_id=auth.uid() OR statut='recherche');
--   drop policy orders_driver_update on public.orders;
--   create policy orders_driver_update on public.orders for update using (statut='livraison' OR driver_id=auth.uid());
--   drop policy orders_driver_select on public.orders;
--   create policy orders_driver_select on public.orders for select using (statut='livraison' OR driver_id=auth.uid());
--   -- (orders_update_own / orders_merchant_update / driver_kyc_update : retirer le with_check)
--   grant execute on function public.consume_credit(integer) to anon;
-- ============================================================================
