-- ============================================================================
-- LOT 10 — Photo du client (visible côté chauffeur / livreur)
-- Symétrique au Lot 9 : le client met sa photo (profiles.photo_url), elle est
-- copiée sur la course (passager_photo, à la création) et sur la commande
-- (client_photo, via create_order). Le chauffeur/livreur la voit.
-- ROLLBACK en bas. (Voir create_order complet dans 20260620_lot6_merchant_order_integrity.sql
--  — ici on ajoute v_client_photo + colonne client_photo dans l'INSERT.)
-- ============================================================================
alter table public.rides add column if not exists passager_photo text;
alter table public.orders add column if not exists client_photo text;

create or replace function public.create_order(
  p_restaurant_id uuid, p_items jsonb, p_pourboire int default 0,
  p_paiement text default 'Espèces', p_credit int default 0, p_adresse text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
        v_order uuid; v_sous int := 0; v_frais_service int := 200; v_frais_liv int := 0;
        v_pourboire int := greatest(0, coalesce(p_pourboire, 0));
        v_credit_req int := greatest(0, coalesce(p_credit, 0));
        v_wallet int; v_credit int; v_total int; v_resto_nom text; v_client_nom text; v_client_photo text;
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
  select nullif(btrim(coalesce(prenom,'') || ' ' || coalesce(nom,'')), ''), photo_url into v_client_nom, v_client_photo from profiles where id = uid;

  perform set_config('app.order_ok', '1', true);
  insert into orders(user_id, restaurant_id, restaurant_nom, client_nom, client_photo, statut, sous_total, frais_livraison, frais_service, pourboire, total, paiement, credit_applied, adresse)
    values (uid, p_restaurant_id, v_resto_nom, v_client_nom, v_client_photo, 'confirmee', v_sous, v_frais_liv, v_frais_service, v_pourboire, v_total, coalesce(p_paiement,'Espèces'), v_credit, p_adresse)
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

-- ROLLBACK :
--   alter table public.rides drop column if exists passager_photo;
--   alter table public.orders drop column if exists client_photo;
--   (restaurer create_order depuis 20260620_lot6_merchant_order_integrity.sql)
