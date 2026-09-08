-- ============================================================================
-- LOT 15 — L'admin gère un restaurant de A à Z (pour les restos sans temps/savoir-faire)
-- Policies admin manquantes : l'admin (is_admin()) peut créer/éditer un restaurant
-- et gérer son menu (sections + plats : prix, stock, dispo, variantes).
-- (Côté admin UI : éditeur de menu complet dans le drawer « Menu » + éditeur des
--  frais de livraison deliv_base/deliv_per_km dans Tarifs.)
-- ============================================================================
drop policy if exists restaurants_admin_write on public.restaurants;
create policy restaurants_admin_write on public.restaurants for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists menu_items_admin_all on public.menu_items;
create policy menu_items_admin_all on public.menu_items for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists menu_sections_admin_all on public.menu_sections;
create policy menu_sections_admin_all on public.menu_sections for all using (public.is_admin()) with check (public.is_admin());

-- ROLLBACK :
--   drop policy if exists restaurants_admin_write on public.restaurants;
--   drop policy if exists menu_items_admin_all on public.menu_items;
--   drop policy if exists menu_sections_admin_all on public.menu_sections;
