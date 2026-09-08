-- ============================================================================
-- LOT 6 — Intégrité commande marchand (audit taga-marchand)
-- P0-a : prix de commande recalculés côté serveur (anti "total = 1 F").
--        - order_items.item_id (traçabilité de l'article réel)
--        - enforce_order_insert : bloque tout insert direct hors create_order
--          (GUC app.order_ok posé seulement dans la RPC, même transaction)
--        - create_order(restaurant, items[], pourboire, paiement, credit, adresse)
--          recalcule sous-total/total depuis menu_items, insère commande + articles.
-- P1-a : notification CLIENT à toute annulation (marchand/admin), raison incluse.
-- P1-b : RLS permettant au marchand de gérer ses catégories (menu_sections).
-- Sécurité : un marchand ne peut pas changer slug/sort de son restaurant.
-- ROLLBACK en bas.
-- ============================================================================

alter table public.order_items add column if not exists item_id uuid references public.menu_items(id) on delete set null;

create or replace function public.enforce_order_insert()
 returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.order_ok', true), '') = '1' then return new; end if;
  if (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  raise exception 'Commande invalide : utilise create_order';
end $$;
drop trigger if exists trg_enforce_order_insert on public.orders;
create trigger trg_enforce_order_insert before insert on public.orders for each row execute function public.enforce_order_insert();

create or replace function public.create_order(
  p_restaurant_id uuid, p_items jsonb, p_pourboire int default 0,
  p_paiement text default 'Espèces', p_credit int default 0, p_adresse text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
        v_order uuid; v_sous int := 0; v_frais_service int := 200; v_frais_liv int := 0;
        v_pourboire int := greatest(0, coalesce(p_pourboire, 0));
        v_credit_req int := greatest(0, coalesce(p_credit, 0));
        v_wallet int; v_credit int; v_total int; v_resto_nom text; v_client_nom text;
        it jsonb; v_price int; v_qte int; v_item uuid;
begin
  if uid is null then raise exception 'Non connecté'; end if;
  if p_restaurant_id is null then raise exception 'Restaurant manquant'; end if;
  select nom into v_resto_nom from restaurants where id = p_restaurant_id and coalesce(ouvert, true) = true;
  if v_resto_nom is null then raise exception 'Restaurant indisponible ou fermé'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Panier vide'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'id')::uuid;
    v_qte := greatest(1, coalesce((it->>'qte')::int, 1));
    select prix into v_price from menu_items where id = v_item and restaurant_id = p_restaurant_id and coalesce(disponible, true) = true;
    if v_price is null then raise exception 'Article indisponible dans ce restaurant'; end if;
    v_sous := v_sous + v_price * v_qte;
  end loop;

  select coalesce(balance, 0) into v_wallet from wallet_credits where user_id = uid;
  v_credit := least(v_credit_req, coalesce(v_wallet, 0), v_sous + v_frais_service + v_frais_liv + v_pourboire);
  v_total := greatest(0, v_sous + v_frais_service + v_frais_liv + v_pourboire - v_credit);
  select nullif(btrim(coalesce(prenom,'') || ' ' || coalesce(nom,'')), '') into v_client_nom from profiles where id = uid;

  perform set_config('app.order_ok', '1', true);
  insert into orders(user_id, restaurant_id, restaurant_nom, client_nom, statut, sous_total, frais_livraison, frais_service, pourboire, total, paiement, credit_applied, adresse)
    values (uid, p_restaurant_id, v_resto_nom, v_client_nom, 'confirmee', v_sous, v_frais_liv, v_frais_service, v_pourboire, v_total, coalesce(p_paiement,'Espèces'), v_credit, p_adresse)
    returning id into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'id')::uuid;
    v_qte := greatest(1, coalesce((it->>'qte')::int, 1));
    insert into order_items(order_id, item_id, nom, prix, qte)
      select v_order, mi.id, mi.nom, mi.prix, v_qte from menu_items mi where mi.id = v_item and mi.restaurant_id = p_restaurant_id;
  end loop;

  if v_credit > 0 then perform consume_credit(v_credit); end if;
  return v_order;
end $$;
revoke execute on function public.create_order(uuid, jsonb, int, text, int, text) from anon;
grant execute on function public.create_order(uuid, jsonb, int, text, int, text) to authenticated;

create or replace function public.after_order_update()
 returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'annulee' and old.statut is distinct from 'annulee' then
    insert into public.notifications(user_id,titre,corps,type,lu)
      select driver_id,'Demande annulée','La livraison que tu venais de recevoir n''est plus disponible.','commande',false
      from public.delivery_offers where order_id = new.id and status = 'pending' and driver_id is not null;
    update public.delivery_offers set status='expired' where order_id = new.id and status='pending';
    if coalesce(new.annul_raison,'') not in ('aucun_coursier','coursier_indispo') then
      insert into public.notifications(user_id,titre,corps,type,lu)
        values (new.user_id, 'Commande annulée',
                case when new.annul_raison='refuse_restaurant' then 'Le restaurant n''a pas pu accepter ta commande. Tu n''es pas débité.'
                     else 'Ta commande a été annulée.' end, 'commande', false);
    end if;
  end if;
  if new.statut = 'livree' and old.statut is distinct from 'livree' and coalesce(new.paiement,'Espèces') = 'Espèces' then
    insert into public.cash_payments(driver_id, order_id, montant)
      values (new.driver_id, new.id, greatest(0, coalesce(new.total,0) - coalesce(new.credit_applied,0)));
  end if;
  return new;
end $$;

drop policy if exists menu_sections_merchant_all on public.menu_sections;
create policy menu_sections_merchant_all on public.menu_sections for all
  using (restaurant_id = public.my_restaurant_id()) with check (restaurant_id = public.my_restaurant_id());

create or replace function public.enforce_restaurant_update()
 returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  if new.slug is distinct from old.slug or new.sort is distinct from old.sort then
    raise exception 'Champ protégé (restaurant)';
  end if;
  return new;
end $$;
drop trigger if exists trg_enforce_restaurant_update on public.restaurants;
create trigger trg_enforce_restaurant_update before update on public.restaurants for each row execute function public.enforce_restaurant_update();

-- ============================================================================
-- ROLLBACK :
--   drop trigger if exists trg_enforce_order_insert on public.orders;
--   drop trigger if exists trg_enforce_restaurant_update on public.restaurants;
--   drop function if exists public.create_order(uuid,jsonb,int,text,int,text);
--   drop function if exists public.enforce_order_insert();
--   drop function if exists public.enforce_restaurant_update();
--   drop policy if exists menu_sections_merchant_all on public.menu_sections;
--   alter table public.order_items drop column if exists item_id;
--   (restaurer after_order_update depuis la migration Lot 4a)
-- ============================================================================
