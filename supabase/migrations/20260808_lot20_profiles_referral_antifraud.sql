-- LOT 20 — Anti-fraude parrainage
--
-- Faille corrigée : la policy RLS `profiles_update_own` (USING auth.uid()=id, sans WITH CHECK)
-- laissait un client écrire DIRECTEMENT (PATCH PostgREST) les colonnes de parrainage de `profiles`.
-- Conséquences possibles :
--   1. Auto-parrainage : referred_by = son propre id (contournait le garde `soi_meme` de apply_referral).
--   2. Farming de crédit illimité : remettre referral_rewarded=false puis refaire une course/commande
--      re-déclenchait fn_referral_reward → bonus filleul + parrain à chaque fois.
--   3. Réécriture de son referral_code.
--
-- Correctif : trigger BEFORE UPDATE qui GÈLE referral_code / referred_by / referral_rewarded pour
-- tout update client, et n'autorise leur écriture que par les fonctions de parrainage
-- (apply_referral, fn_referral_reward) via un drapeau de session `app.referral_op`.
-- Les clients ne peuvent pas poser ce drapeau (aucune RPC exposée ne le fait hors de ces fonctions),
-- et chaque appel RPC est sa propre transaction : un PATCH direct n'hérite jamais du drapeau.
--
-- Note : les autres tables sensibles sont déjà verrouillées côté serveur et n'ont PAS été modifiées :
--   - wallet_credits : aucune policy d'écriture client (crédit uniquement via fonctions SECURITY DEFINER).
--   - driver_kyc     : UPDATE client interdit de poser statut='valide' (WITH CHECK statut <> 'valide').
--   - driver_subscriptions : enforce_subscription_insert force 'en_attente'; activation admin-only.

create or replace function public.guard_profile_referral()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Admin / service_role : aucune restriction.
  if (select auth.role()) = 'service_role' or public.is_admin() then
    return new;
  end if;

  -- Écritures internes de parrainage (apply_referral / fn_referral_reward) via drapeau de session.
  if coalesce(current_setting('app.referral_op', true), '') = '1' then
    new.referral_code := old.referral_code;   -- le code n'est jamais réécrit après création
    if new.referred_by = new.id then          -- défense en profondeur : jamais soi-même
      new.referred_by := old.referred_by;
    end if;
    return new;
  end if;

  -- Client normal : colonnes de parrainage totalement gelées.
  new.referral_code     := old.referral_code;
  new.referred_by       := old.referred_by;
  new.referral_rewarded := old.referral_rewarded;
  return new;
end $$;

drop trigger if exists trg_guard_profile_referral on public.profiles;
create trigger trg_guard_profile_referral
  before update on public.profiles
  for each row execute function public.guard_profile_referral();

-- apply_referral : pose le drapeau autour de l'écriture de referred_by, puis le réinitialise.
create or replace function public.apply_referral(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare uid uuid := auth.uid(); v_norm text; v_ref uuid; v_referred uuid;
begin
  if uid is null then raise exception 'Non connecté'; end if;
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if v_norm = '' then return jsonb_build_object('ok', false, 'reason', 'vide'); end if;
  select referred_by into v_referred from profiles where id = uid;
  if v_referred is not null then return jsonb_build_object('ok', false, 'reason', 'deja'); end if;
  select id into v_ref from profiles where referral_code = v_norm limit 1;
  if v_ref is null then return jsonb_build_object('ok', false, 'reason', 'introuvable'); end if;
  if v_ref = uid then return jsonb_build_object('ok', false, 'reason', 'soi_meme'); end if;
  perform set_config('app.referral_op', '1', true);
  update profiles set referred_by = v_ref where id = uid and referred_by is null;
  perform set_config('app.referral_op', '', true);
  return jsonb_build_object('ok', true);
end $$;

-- fn_referral_reward : pose le drapeau avant de marquer referral_rewarded (récompense filleul + parrain).
create or replace function public.fn_referral_reward(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_bonus int; v_max int; v_ref uuid; v_rewarded boolean; v_count int;
begin
  select referred_by, referral_rewarded into v_ref, v_rewarded from profiles where id = p_user;
  if v_ref is null or coalesce(v_rewarded, false) then return; end if;
  select coalesce((select value from app_numbers where key='referral_bonus'), 2000)::int into v_bonus;
  select coalesce((select value from app_numbers where key='referral_max'), 0)::int into v_max;

  perform set_config('app.referral_op', '1', true);
  update profiles set referral_rewarded = true where id = p_user and coalesce(referral_rewarded,false) = false;

  -- crédite TOUJOURS le filleul (bonus de bienvenue)
  insert into wallet_credits(user_id, balance, updated_at) values (p_user, v_bonus, now())
    on conflict (user_id) do update set balance = wallet_credits.balance + excluded.balance, updated_at = now();
  insert into notifications(user_id, titre, corps, type, lu)
    values (p_user, 'Parrainage validé 🎁', 'Bienvenue ! Ton crédit de '||v_bonus||' F a été ajouté à ton compte.', 'parrainage', false);

  -- crédite le PARRAIN seulement sous le plafond (compte les filleuls récompensés, celui-ci inclus)
  select count(*) into v_count from profiles where referred_by = v_ref and referral_rewarded = true;
  if v_max = 0 or v_count <= v_max then
    insert into wallet_credits(user_id, balance, updated_at) values (v_ref, v_bonus, now())
      on conflict (user_id) do update set balance = wallet_credits.balance + excluded.balance, updated_at = now();
    insert into notifications(user_id, titre, corps, type, lu)
      values (v_ref, 'Ton filleul a commandé 🎁', 'Ton crédit de parrainage de '||v_bonus||' F a été ajouté.', 'parrainage', false);
  else
    insert into notifications(user_id, titre, corps, type, lu)
      values (v_ref, 'Nouveau filleul', 'Un filleul a fait sa première course. Tu as atteint le plafond de parrainages récompensés.', 'parrainage', false);
  end if;
end $$;
