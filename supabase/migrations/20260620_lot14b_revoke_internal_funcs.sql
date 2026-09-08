-- ============================================================================
-- LOT 14b — Révoque l'exécution publique des fonctions internes / triggers
-- (advisor : anon_security_definer_function_executable).
-- Risque réel fermé : _web_push était appelable par anon/authenticated via
--   /rest/v1/rpc/_web_push → un client pouvait déclencher des push arbitraires
--   (la fonction fournit elle-même le jeton interne). Désormais service_role only.
-- Les fonctions trigger continuent de s'exécuter (elles tournent au nom du
-- propriétaire de la table, pas via le privilège EXECUTE de l'appelant).
-- On GARDE is_admin / is_super / my_restaurant_id exécutables (requis par la RLS)
-- et les vrais RPC (create_order, consume_credit, location_*, admin_*) pour authenticated.
-- ============================================================================
revoke execute on function public._web_push(uuid[], text, text, text) from anon, authenticated, public;
revoke execute on function public.after_order_update() from anon, authenticated, public;
revoke execute on function public.after_ride_update() from anon, authenticated, public;
revoke execute on function public.enforce_order_insert() from anon, authenticated, public;
revoke execute on function public.enforce_order_update() from anon, authenticated, public;
revoke execute on function public.enforce_restaurant_update() from anon, authenticated, public;
revoke execute on function public.enforce_ride_update() from anon, authenticated, public;
revoke execute on function public.enforce_subscription_insert() from anon, authenticated, public;
revoke execute on function public.wp_admins() from anon, authenticated, public;
revoke execute on function public.wp_new_order() from anon, authenticated, public;
