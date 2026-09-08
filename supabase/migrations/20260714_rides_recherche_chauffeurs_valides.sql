-- Les courses ouvertes (recherche, non assignées) ne sont visibles que par les CHAUFFEURS
-- VALIDÉS (le pool de dispatch), plus par tout utilisateur connecté (fuite nom + coordonnées).
-- Gate indépendant du timing de présence : ne casse pas l'acceptation d'offre.
-- (Appliqué en prod le 2026-07-14 via apply_migration.)

create or replace function public.is_validated_driver()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from public.driver_kyc k where k.driver_id = auth.uid() and k.statut = 'valide');
$$;
revoke execute on function public.is_validated_driver() from public, anon;
grant execute on function public.is_validated_driver() to authenticated;

alter policy rides_select on public.rides using (
  (user_id = auth.uid())
  or (driver_id = auth.uid())
  or (driver_id is null and statut = 'recherche' and public.is_validated_driver())
);
