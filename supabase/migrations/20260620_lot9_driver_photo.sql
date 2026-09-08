-- ============================================================================
-- LOT 9 — Photo du chauffeur (visible côté client ET côté chauffeur)
-- - bucket public 'avatars' (le client doit voir la photo pendant la course)
-- - profiles.photo_url : photo de profil
-- - rides.chauffeur_photo / orders.livreur_photo : copie de l'URL à l'acceptation
--   (le client ne peut pas lire le profil d'un autre user → on copie l'URL publique).
-- L'edge function `dispatch` (v8) écrit chauffeur_photo / livreur_photo à l'accept.
-- ROLLBACK en bas.
-- ============================================================================
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table public.profiles add column if not exists photo_url text;
alter table public.rides add column if not exists chauffeur_photo text;
alter table public.orders add column if not exists livreur_photo text;

-- ============================================================================
-- ROLLBACK :
--   alter table public.orders drop column if exists livreur_photo;
--   alter table public.rides drop column if exists chauffeur_photo;
--   alter table public.profiles drop column if exists photo_url;
--   drop policy if exists avatars_read on storage.objects;
--   drop policy if exists avatars_insert on storage.objects;
--   drop policy if exists avatars_update on storage.objects;
--   delete from storage.buckets where id='avatars';
-- ============================================================================
