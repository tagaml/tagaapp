-- Anti-usurpation de gamme : la présence dérive la gamme du profil validé, et la gamme se
-- verrouille après validation KYC (comme le type de véhicule).
-- (Appliqué en prod le 2026-07-14 via apply_migration.)

create or replace function public.presence_coherente()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_type text; v_services text[]; v_possible text[]; v_final text[]; v_gamme text;
begin
  select p.type, p.services, p.gamme into v_type, v_services, v_gamme
  from driver_profiles p where p.driver_id = new.driver_id;
  if v_type is null then return new; end if;

  new.vehicule := v_type;
  v_possible := public.services_possibles(v_type);
  v_final := coalesce(nullif(v_services, '{}'), nullif(new.services, '{}'), public.services_defaut(v_type));
  select array(select unnest(v_final) intersect select unnest(v_possible)) into v_final;
  if v_final is null or array_length(v_final, 1) is null then
    v_final := public.services_defaut(v_type);
  end if;
  new.services := v_final;

  if lower(v_type) <> 'voiture' then
    new.gamme := null;
  else
    new.gamme := coalesce(v_gamme, 'standard');
  end if;
  return new;
end $$;

create or replace function public.guard_vehicule_chauffeur()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_statut text;
begin
  if new.type is not distinct from old.type and new.gamme is not distinct from old.gamme then
    return new;
  end if;
  if public.is_admin() or auth.uid() is null then
    return new;
  end if;
  select statut into v_statut from driver_kyc where driver_id = new.driver_id;
  if v_statut = 'valide' then
    raise exception 'Véhicule/gamme verrouillés : dossier validé. Fais une demande de changement.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
