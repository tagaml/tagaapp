-- ============================================================================
-- LOT 12 — Variantes produit (groupes d'options + supplément)
-- menu_items.variantes : [{"g":"Taille","req":true,"opts":[{"n":"Petit","d":0},{"n":"Grand","d":500}]}]
-- order_items.options  : choix figés à la commande [{"g":"Taille","n":"Grand"}]
-- create_order : valide les options choisies, refuse un groupe requis non rempli,
--   calcule le prix unitaire = base + suppléments (côté serveur, non manipulable).
-- (Cumule prix serveur, stock, client_photo des lots précédents.)
-- ============================================================================
alter table public.menu_items add column if not exists variantes jsonb not null default '[]'::jsonb;
alter table public.order_items add column if not exists options jsonb;

create or replace function public.create_order(
  p_restaurant_id uuid, p_items jsonb, p_pourboire int default 0,
  p_paiement text default 'Espèces', p_credit int default 0, p_adresse text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
        v_order uuid; v_sous int := 0; v_frais_service int := 200; v_frais_liv int := 0;
        v_pourboire int := greatest(0, coalesce(p_pourboire, 0));
        v_credit_req int := greatest(0, coalesce(p_credit, 0));
        v_wallet int; v_credit int; v_total int; v_resto_nom text; v_client_nom text; v_client_photo text;
        it jsonb; v_price int; v_qte int; v_item uuid; v_stock int; v_nom text; v_var jsonb;
        v_opts jsonb; v_opt jsonb; v_grp jsonb; v_d int; v_unit int;
begin
  if uid is null then raise exception 'Non connecté'; end if;
  if p_restaurant_id is null then raise exception 'Restaurant manquant'; end if;
  select nom into v_resto_nom from restaurants where id = p_restaurant_id and coalesce(ouvert, true) = true;
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

-- ROLLBACK : alter table public.menu_items drop column if exists variantes;
--            alter table public.order_items drop column if exists options;
--            (restaurer create_order depuis 20260620_lot11_stock_quantitatif.sql)
