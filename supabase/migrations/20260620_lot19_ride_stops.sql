-- LOT 19 — Arrêts intermédiaires sur les courses (max 2) : départ → arrêt(s) → destination
-- Tarif = distance totale (pas de frais d'arrêt). Colonnes nullables, rétro-compatibles.
alter table public.rides add column if not exists stop1_label text;
alter table public.rides add column if not exists stop1_lat double precision;
alter table public.rides add column if not exists stop1_lng double precision;
alter table public.rides add column if not exists stop2_label text;
alter table public.rides add column if not exists stop2_lat double precision;
alter table public.rides add column if not exists stop2_lng double precision;
