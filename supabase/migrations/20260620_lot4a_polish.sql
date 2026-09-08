-- ============================================================================
-- LOT 4a — Polish (P2)
-- Cible 3 : log d'encaissement espèces (table cash_payments + triggers AFTER UPDATE)
-- Cible 7 : suppression du tier mort 'motoplus'
-- Cible 8 : offre fantôme — à l'annulation d'une course/commande, expiration de
--           toutes les offres 'pending' + notification au coursier qui la détenait.
-- (Cible 1 — vrai compteur horaire location — reportée en Lot 4b : impacte la facturation.)
-- ROLLBACK en bas.
-- ============================================================================

-- Cible 3 : log d'encaissement espèces (non répudiable, pour l'admin/litiges)
create table if not exists public.cash_payments (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references auth.users(id) on delete set null,
  ride_id uuid references public.rides(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  montant int not null,
  created_at timestamptz not null default now()
);
alter table public.cash_payments enable row level security;
drop policy if exists cash_payments_select on public.cash_payments;
create policy cash_payments_select on public.cash_payments for select using (driver_id = auth.uid() or public.is_admin());
drop policy if exists cash_payments_admin on public.cash_payments;
create policy cash_payments_admin on public.cash_payments for all using (public.is_admin()) with check (public.is_admin());
-- (inserts uniquement par trigger SECURITY DEFINER ci-dessous)

-- Cible 8 + 3 : AFTER UPDATE rides
create or replace function public.after_ride_update()
 returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'annule' and old.statut is distinct from 'annule' then
    insert into public.notifications(user_id,titre,corps,type,lu)
      select driver_id,'Demande annulée','La course que tu venais de recevoir n''est plus disponible.','course',false
      from public.ride_offers where ride_id = new.id and status = 'pending' and driver_id is not null;
    update public.ride_offers set status='expired' where ride_id = new.id and status='pending';
  end if;
  if new.paye is true and old.paye is distinct from true and coalesce(new.paiement,'Espèces') = 'Espèces' then
    insert into public.cash_payments(driver_id, ride_id, montant)
      values (new.driver_id, new.id, greatest(0, coalesce(new.prix,0) - coalesce(new.credit_applied,0)));
  end if;
  return new;
end $$;
drop trigger if exists trg_after_ride_update on public.rides;
create trigger trg_after_ride_update after update on public.rides for each row execute function public.after_ride_update();

-- Cible 8 + 3 : AFTER UPDATE orders
create or replace function public.after_order_update()
 returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'annulee' and old.statut is distinct from 'annulee' then
    insert into public.notifications(user_id,titre,corps,type,lu)
      select driver_id,'Demande annulée','La livraison que tu venais de recevoir n''est plus disponible.','commande',false
      from public.delivery_offers where order_id = new.id and status = 'pending' and driver_id is not null;
    update public.delivery_offers set status='expired' where order_id = new.id and status='pending';
  end if;
  if new.statut = 'livree' and old.statut is distinct from 'livree' and coalesce(new.paiement,'Espèces') = 'Espèces' then
    insert into public.cash_payments(driver_id, order_id, montant)
      values (new.driver_id, new.id, greatest(0, coalesce(new.total,0) - coalesce(new.credit_applied,0)));
  end if;
  return new;
end $$;
drop trigger if exists trg_after_order_update on public.orders;
create trigger trg_after_order_update after update on public.orders for each row execute function public.after_order_update();

-- Cible 7 : retirer le tier mort 'motoplus'
delete from public.pricing where tier = 'motoplus';

-- ============================================================================
-- ROLLBACK :
--   drop trigger if exists trg_after_ride_update on public.rides;
--   drop trigger if exists trg_after_order_update on public.orders;
--   drop function if exists public.after_ride_update();
--   drop function if exists public.after_order_update();
--   drop table if exists public.cash_payments;
-- ============================================================================
