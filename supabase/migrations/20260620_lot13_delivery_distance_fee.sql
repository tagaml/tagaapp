-- ============================================================================
-- LOT 13 — Frais de livraison selon la distance (resto -> client)
-- restaurants.lat/lng (saisis par le marchand) ; config app_numbers
-- (deliv_base, deliv_per_km, éditables par l'admin).
-- create_order : frais = base + per_km × distance(resto, adresse client).
--   Repli sur la base si coordonnées absentes. NB : nouvelle signature à 8 args
--   (p_dest_lat/p_dest_lng) — l'ancienne surcharge à 6 args a été supprimée.
-- (Cumule prix serveur, stock, variantes, client_photo des lots précédents.)
-- ============================================================================
alter table public.restaurants add column if not exists lat double precision;
alter table public.restaurants add column if not exists lng double precision;
insert into public.app_numbers(key, value) values ('deliv_base', 500) on conflict (key) do nothing;
insert into public.app_numbers(key, value) values ('deliv_per_km', 150) on conflict (key) do nothing;

drop function if exists public.create_order(uuid, jsonb, int, text, int, text);

create or replace function public.create_order(
  p_restaurant_id uuid, p_items jsonb, p_pourboire int default 0,
  p_paiement text default 'Espèces', p_credit int default 0, p_adresse text default null,
  p_dest_lat double precision default null, p_dest_lng double precision default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
        v_order uuid; v_sous int := 0; v_frais_service int := 200; v_frais_liv int := 0;
        v_pourboire int := greatest(0, coalesce(p_pourboire, 0));
        v_credit_req int := greatest(0, coalesce(p_credit, 0));
        v_wallet int; v_credit int; v_total int; v_resto_nom text; v_client_nom text; v_client_photo text;
        it jsonb; v_price int; v_qte int; v_item uuid; v_stock int; v_nom text; v_var jsonb;
        v_opts jsonb; v_opt jsonb; v_grp jsonb; v_d int; v_unit int;
        v_rlat double precision; v_rlng double precision; v_base int; v_perkm int; v_dist double precision;
begin
  if uid is null then raise exception 'Non connecté'; end if;
  if p_restaurant_id is null then raise exception 'Restaurant manquant'; end if;
  select nom, lat, lng into v_resto_nom, v_rlat, v_rlng from restaurants where id = p_restaurant_id and coalesce(ouvert, true) = true;
  if v_resto_nom is null then raise exception 'Restaurant indisponible ou fermé'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'Panier vide'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    v_item := (it->>'id')::uuid;
    v_qte := greatest(1, coalesce((it->>'qte')::int, 1));
    select prix, stock, nom, coalesce(variantes, '[]'::jsonb) into v_price, v_stock, v_nom, v_var
      from menu_items where id = v_item and restaurant_id = p_restaurant_id and coalesce(disponible, true) = true;
    if v_price is null then raise exception 'Article indisponible dans ce restaurant'; end if;
    if v_stock is not null and v_stock < v_qte then raise exception 'Stock insuffisant pour « % » (reste %)', v_nom, v_stock; end if;
    v_opts := coalesce(it->'options', '[]'::jsonb);
    for v_opt in select * from jsonb_array_elements(v_opts) loop
      select (o->>'d')::int into v_d from jsonb_array_elements(v_var) g, jsonb_array_elements(g->'opts') o
        where g->>'g' = v_opt->>'g' and o->>'n' = v_opt->>'n' limit 1;
      if v_d is null then raise exception 'Option invalide pour « % »', v_nom; end if;
      v_sous := v_sous + v_d * v_qte;
    end loop;
    for v_grp in select * from jsonb_array_elements(v_var) loop
      if coalesce((v_grp->>'req')::boolean, false)
         and not exists (select 1 from jsonb_array_elements(v_opts) x where x->>'g' = v_grp->>'g') then
        raise exception 'Choix requis : % (pour « % »)', v_grp->>'g', v_nom;
      end if;
    end loop;
    v_sous := v_sous + v_price * v_qte;
  end loop;

  select coalesce((select value from app_numbers where key='deliv_base'), 500)::int into v_base;
  select coalesce((select value from app_numbers where key='deliv_per_km'), 150)::int into v_perkm;
  if v_rlat is not null and v_rlng is not null and p_dest_lat is not null and p_dest_lng is not null then
    v_dist := 6371 * 2 * asin(sqrt(power(sin(radians(p_dest_lat - v_rlat)/2),2) + cos(radians(v_rlat))*cos(radians(p_dest_lat))*power(sin(radians(p_dest_lng - v_rlng)/2),2)));
    v_frais_liv := v_base + round(v_perkm * greatest(0, v_dist));
  else
    v_frais_liv := v_base;
  end if;

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
    select prix, coalesce(variantes, '[]'::jsonb) into v_price, v_var from menu_items where id = v_item and restaurant_id = p_restaurant_id;
    v_opts := coalesce(it->'options', '[]'::jsonb); v_unit := v_price;
    for v_opt in select * from jsonb_array_elements(v_opts) loop
      select (o->>'d')::int into v_d from jsonb_array_elements(v_var) g, jsonb_array_elements(g->'opts') o
        where g->>'g' = v_opt->>'g' and o->>'n' = v_opt->>'n' limit 1;
      v_unit := v_unit + coalesce(v_d, 0);
    end loop;
    insert into order_items(order_id, item_id, nom, prix, qte, options)
      select v_order, mi.id, mi.nom, v_unit, v_qte, case when jsonb_array_length(v_opts) > 0 then v_opts else null end
      from menu_items mi where mi.id = v_item and mi.restaurant_id = p_restaurant_id;
    update menu_items set stock = greatest(0, stock - v_qte) where id = v_item and restaurant_id = p_restaurant_id and stock is not null;
  end loop;

  if v_credit > 0 then perform consume_credit(v_credit); end if;
  return v_order;
end $$;
revoke execute on function public.create_order(uuid, jsonb, int, text, int, text, double precision, double precision) from anon;
grant execute on function public.create_order(uuid, jsonb, int, text, int, text, double precision, double precision) to authenticated;

-- ROLLBACK : alter table public.restaurants drop column if exists lat, drop column if exists lng;
--   delete from app_numbers where key in ('deliv_base','deliv_per_km');
--   (restaurer create_order 8→6 args depuis le lot 12)
