-- ============================================================================
-- LOT 4b — Vrai compteur horaire location (cible 1 du Lot 4)
-- - colonne rides.service_started_at
-- - bypass sûr du gel de prix (GUC 'app.loc_meter', posé uniquement dans le RPC
--   location_stop ; PostgREST isolant chaque requête client dans sa propre
--   transaction, un client ne peut pas le pré-poser avant un UPDATE direct).
-- - RPC location_start (arrive -> en_cours + horodatage)
-- - RPC location_stop : durée réelle arrondie à la 1/2 h sup. (min 0,5 h),
--   total = tarif horaire implicite (prix serveur / heures déclarées) x durée réelle.
-- ROLLBACK en bas.
-- ============================================================================

alter table public.rides add column if not exists service_started_at timestamptz;

create or replace function public.enforce_ride_update()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare uid uuid := auth.uid();
begin
  if coalesce(current_setting('app.loc_meter', true), '') = '1' then return new; end if;
  if uid is null or (select auth.role()) = 'service_role' or public.is_admin() then return new; end if;
  if new.prix is distinct from old.prix or new.user_id is distinct from old.user_id
     or new.driver_id is distinct from old.driver_id or new.distance_km is distinct from old.distance_km then
    raise exception 'Champ protégé non modifiable (course)';
  end if;
  if new.statut is distinct from old.statut then
    if uid = old.driver_id then
      if not ((old.statut,new.statut) in (('en_route','arrive'),('arrive','en_cours'),('en_cours','termine'))) then
        raise exception 'Transition course interdite (chauffeur): % -> %', old.statut, new.statut; end if;
    elsif uid = old.user_id then
      if new.statut <> 'annule' or old.statut in ('termine','annule') then
        raise exception 'Transition course interdite (client): % -> %', old.statut, new.statut; end if;
    else raise exception 'Modification de course non autorisée'; end if;
  else
    if new.paye is distinct from old.paye and uid is distinct from old.driver_id then
      raise exception 'Encaissement réservé au chauffeur'; end if;
  end if;
  return new;
end $function$;

create or replace function public.location_start(p_ride uuid)
 returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now();
begin
  if not exists (select 1 from rides where id=p_ride and driver_id=auth.uid() and statut='arrive') then
    raise exception 'Location non démarrable (course introuvable, non assignée ou statut invalide)';
  end if;
  update rides set statut='en_cours', service_started_at=v_now where id=p_ride;
  return v_now;
end $$;

create or replace function public.location_stop(p_ride uuid)
 returns table(billed_hours numeric, montant int) language plpgsql security definer set search_path = public as $$
declare r record; v_elapsed_min numeric; v_hours numeric; v_hourly numeric; v_prix int;
begin
  select * into r from rides where id=p_ride and driver_id=auth.uid() and statut='en_cours' for update;
  if not found then raise exception 'Location non arrêtable (course introuvable, non assignée ou non démarrée)'; end if;
  if r.service_started_at is null then raise exception 'Compteur non démarré'; end if;
  v_elapsed_min := extract(epoch from (now() - r.service_started_at)) / 60.0;
  v_hours := greatest(0.5, ceil(v_elapsed_min / 30.0) / 2.0);
  v_hourly := r.prix::numeric / nullif(r.location_hours, 0);
  v_prix := round(coalesce(v_hourly, r.prix) * v_hours);
  perform set_config('app.loc_meter', '1', true);
  update rides set statut='termine', prix=v_prix, location_hours=v_hours where id=p_ride;
  billed_hours := v_hours; montant := v_prix; return next;
end $$;

revoke execute on function public.location_start(uuid) from anon;
revoke execute on function public.location_stop(uuid) from anon;
grant execute on function public.location_start(uuid) to authenticated;
grant execute on function public.location_stop(uuid) to authenticated;

-- ============================================================================
-- ROLLBACK :
--   drop function if exists public.location_stop(uuid);
--   drop function if exists public.location_start(uuid);
--   alter table public.rides drop column if exists service_started_at;
--   (et restaurer enforce_ride_update sans la ligne 'app.loc_meter' — voir Lot 1)
-- ============================================================================
