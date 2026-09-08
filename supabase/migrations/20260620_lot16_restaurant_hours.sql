-- ============================================================================
-- LOT 16 — Horaires d'ouverture structurés + (côté marchand) prépa & position persistées
-- restaurants.horaires : [{d:'Lundi', o:'11:00', c:'23:00', open:true}, ...] (éditable par jour)
-- (Le temps de préparation est persisté dans restaurants.eta « N min » ; la position
--  accepte un lien Google Maps ou « lat, lng » → extraction des coordonnées côté UI.)
-- ============================================================================
alter table public.restaurants add column if not exists horaires jsonb;

-- ROLLBACK : alter table public.restaurants drop column if exists horaires;
