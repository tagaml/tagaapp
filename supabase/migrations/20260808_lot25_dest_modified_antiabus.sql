-- LOT 25 — Anti-abus « le client a changé de destination »
--
-- Avant : le chauffeur pouvait déclencher l'annulation SANS FAUTE 'client_destination' à tout moment,
-- même si le client n'avait rien modifié → annulation gratuite abusive.
-- Correctif : un drapeau `rides.dest_modified` posé UNIQUEMENT par le client via update_ride_address
-- (changement de destination). driver_cancel_ride refuse 'client_destination' si le drapeau est faux.
-- Côté app chauffeur, le bouton n'apparaît que si dest_modified = true.

alter table public.rides add column if not exists dest_modified boolean not null default false;

-- update_ride_address : pose dest_modified=true quand le client change la DESTINATION.
-- (Corps complet redéployé en prod ; seule la ligne d'update 'dest' ajoute `dest_modified = true`.)

-- driver_cancel_ride : 'client_destination' recevable seulement si dest_modified = true.
--   if v_code = 'client_destination' and not coalesce(r.dest_modified, false) then
--     raise exception 'Le client n''a pas modifié la destination';
--   end if;
--
-- Les deux fonctions ont été appliquées en prod via l'éditeur SQL (corps complets déployés).
