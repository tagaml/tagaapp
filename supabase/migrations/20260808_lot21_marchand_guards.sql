-- LOT 21 — Durcissement marchand
--
-- Contexte : les policies RLS UPDATE de `restaurants` et `restaurant_reviews` ne vérifient que
-- la PROPRIÉTÉ de la ligne (restaurant_id = my_restaurant_id()), pas les COLONNES écrites.
-- Un marchand pouvait donc, via l'API Supabase (hors app), écrire des colonnes qu'il ne devrait pas :
--
--   1. restaurants : mettre sa propre `commission` à 0, changer `frais_service` / `remuneration`
--      (vol de marge Taga), ou gonfler `note` / `avis` (fausse réputation).
--   2. restaurant_reviews : modifier la `note` et le `commentaire` des avis clients de son resto
--      (au lieu de seulement y répondre) → falsification des avis.
--
-- Note : les commandes sont déjà bien protégées (enforce_order_update interdit au marchand toute
-- transition hors des 4 légales et gèle les totaux ; guard_order_livree exige le code de remise).
-- Les colonnes financières côté commande n'étaient pas modifiables. Rien à corriger côté orders.

-- restaurants : gel des colonnes détenues par Taga pour tout compte non-admin (marchand).
create or replace function public.guard_restaurant_admin_cols()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.is_admin() or (select auth.role()) = 'service_role' then return new; end if;
  new.commission        := old.commission;      -- commission Taga (jamais éditable par le resto)
  new.frais_service     := old.frais_service;    -- frais de service client (revenu Taga)
  new.remuneration      := old.remuneration;     -- modèle de rémunération (commission / frais_service)
  new.livraison_offerte := old.livraison_offerte; -- déjà gelé auparavant, conservé
  new.note              := old.note;             -- note moyenne (agrégat, non éditable)
  new.avis              := old.avis;             -- nombre d'avis
  return new;
end $$;

-- restaurant_reviews : le marchand ne peut écrire QUE `reponse` ; tout le reste est gelé.
create or replace function public.guard_review_merchant_cols()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.is_admin() or (select auth.role()) = 'service_role' then return new; end if;
  new.id            := old.id;
  new.order_id      := old.order_id;
  new.user_id       := old.user_id;
  new.restaurant_id := old.restaurant_id;
  new.note          := old.note;          -- note du client (jamais modifiable par le resto)
  new.commentaire   := old.commentaire;   -- texte du client
  new.created_at    := old.created_at;
  return new;
end $$;

drop trigger if exists trg_guard_review_merchant_cols on public.restaurant_reviews;
create trigger trg_guard_review_merchant_cols
  before update on public.restaurant_reviews
  for each row execute function public.guard_review_merchant_cols();
