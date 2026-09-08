-- =====================================================================
-- Push système sur les messages du chat (course ou livraison), app fermée.
-- Réutilise taga_push (pg_net -> send-push v3, record=false : pas d'entrée dans le
-- centre de notifs ; le message reste dans le chat + realtime). Throttle 15 s par
-- (conversation, expéditeur). Deep link géré côté mobile via data.type='chat'.
-- Dépendances : public.taga_push (migration 20260707_push_on_order_transitions_and_geofence).
-- =====================================================================

-- Throttle : dernière push par conversation+expéditeur (usage interne, verrouillé).
create table if not exists public.chat_push_throttle (
  conv text primary key,
  last_pushed_at timestamptz not null default now()
);
alter table public.chat_push_throttle enable row level security; -- aucune policy => inaccessible aux clients

create or replace function public.fn_chat_message_push()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_client uuid; v_driver uuid; v_recipient uuid; v_reftype text; v_refid uuid;
        v_prenom text; v_title text; v_body text; v_conv text; v_last timestamptz;
begin
  if new.ride_id is not null then
    select user_id, driver_id into v_client, v_driver from public.rides where id = new.ride_id;
    v_reftype := 'ride'; v_refid := new.ride_id;
  elsif new.order_id is not null then
    select user_id, driver_id into v_client, v_driver from public.orders where id = new.order_id;
    v_reftype := 'order'; v_refid := new.order_id;
  else
    return new;
  end if;

  -- Destinataire = l'autre participant (par sender_id, repli sur le rôle).
  if new.sender_id = v_client then v_recipient := v_driver;
  elsif new.sender_id = v_driver then v_recipient := v_client;
  else v_recipient := case when new.sender_role = 'client' then v_driver else v_client end;
  end if;
  if v_recipient is null then return new; end if;

  -- Anti-bruit : une seule push par (conversation, expéditeur) toutes les 15 s.
  v_conv := v_reftype || ':' || v_refid::text || ':' || new.sender_id::text;
  select last_pushed_at into v_last from public.chat_push_throttle where conv = v_conv;
  if v_last is not null and now() - v_last < interval '15 seconds' then
    return new;
  end if;
  insert into public.chat_push_throttle(conv, last_pushed_at) values (v_conv, now())
    on conflict (conv) do update set last_pushed_at = now();

  select prenom into v_prenom from public.profiles where id = new.sender_id;
  v_title := '💬 ' || coalesce(nullif(btrim(v_prenom), ''), 'Nouveau message');
  v_body := left(coalesce(new.texte, ''), 80);
  if length(coalesce(new.texte, '')) > 80 then v_body := v_body || '…'; end if;

  perform public.taga_push(v_recipient, v_title, v_body,
    jsonb_build_object('type','chat','ref_type',v_reftype,'ref_id',v_refid::text,'sender_id',new.sender_id::text));
  return new;
end $function$;

drop trigger if exists trg_chat_message_push on public.messages;
create trigger trg_chat_message_push after insert on public.messages
  for each row execute function public.fn_chat_message_push();

-- =====================================================================
-- ROLLBACK :
--   drop trigger if exists trg_chat_message_push on public.messages;
--   drop function if exists public.fn_chat_message_push();
--   drop table if exists public.chat_push_throttle;
-- =====================================================================
