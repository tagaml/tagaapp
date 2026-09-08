-- LOT 5 (P1-5) — Message admin -> restaurant livré comme notification au(x) propriétaire(s).
-- SECURITY DEFINER + contrôle is_admin() interne (un non-admin ne peut rien envoyer).
-- Le marchand lit ses notifications au démarrage (merchant-live.js loadMerchantNotifs).
create or replace function public.admin_notify_restaurant(p_restaurant_id uuid, p_message text)
 returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administration'; end if;
  if coalesce(btrim(p_message),'') = '' then raise exception 'Message vide'; end if;
  insert into public.notifications(user_id, titre, corps, type, lu)
    select m.user_id, 'Message de Taga', p_message, 'marchand', false
    from public.merchants m where m.restaurant_id = p_restaurant_id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.admin_notify_restaurant(uuid, text) from anon;
grant execute on function public.admin_notify_restaurant(uuid, text) to authenticated;

-- ROLLBACK : drop function if exists public.admin_notify_restaurant(uuid, text);
