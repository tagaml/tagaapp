-- LOT 22 — Le chauffeur ne voyait pas l'annulation client (il continuait vers le client)
--
-- Symptôme : quand le client annule (surtout pendant que le chauffeur est EN ROUTE, ex. « j'ai changé
-- d'avis »), le chauffeur ne voyait rien et continuait ; il devait quitter/rouvrir l'app pour que la
-- course disparaisse.
--
-- Cause : l'annulation GRATUITE (chauffeur pas encore arrivé) dans cancel_ride mettait `driver_id = null`
-- en même temps que `statut = 'annule'`. Or la policy `rides_select` n'autorise le chauffeur à voir la
-- course que si `driver_id = auth.uid()`. En vidant driver_id, le chauffeur perd instantanément la
-- visibilité RLS sur la ligne :
--   - l'événement temps réel « annule » ne lui est jamais livré (Realtime respecte la RLS) ;
--   - le filet de sécurité côté app (relecture getRide toutes les 5 s) reçoit NULL (plus de visibilité)
--     et n'interprète donc pas l'annulation.
--   → l'écran de course reste bloqué jusqu'à un redémarrage manuel.
--
-- Correctif : un trigger BEFORE UPDATE conserve `driver_id` quand la course passe à « annule ».
-- Le chauffeur garde ainsi sa visibilité et reçoit l'annulation (temps réel + relecture 5 s) →
-- l'app affiche « Course annulée » et revient au tableau de bord automatiquement.
--
-- Sûreté : getMyActiveRide() ne considère que les statuts en_route/arrive/en_cours, donc garder
-- driver_id sur une course annulée ne la « ressuscite » pas. C'est d'ailleurs déjà le comportement
-- de l'annulation AVEC frais (chauffeur arrivé), qui conservait déjà driver_id et fonctionnait bien.
--
-- Note : ce correctif est 100 % serveur — il agit immédiatement sur les apps déjà installées
-- (elles ont déjà la logique onCancelled + relecture 5 s), sans nouvel OTA.

create or replace function public.keep_driver_on_ride_cancel()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.statut = 'annule' and old.driver_id is not null and new.driver_id is null then
    new.driver_id := old.driver_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_keep_driver_on_ride_cancel on public.rides;
create trigger trg_keep_driver_on_ride_cancel
  before update on public.rides
  for each row execute function public.keep_driver_on_ride_cancel();
