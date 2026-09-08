-- ============================================================================
-- LOT 14 — Durcissements sécurité (suite audit indépendant + advisor Supabase)
-- 1) search_path figé sur touch_dispatch_row (warning function_search_path_mutable)
-- 2) Bucket 'avatars' : suppression de la policy SELECT large → empêche de LISTER
--    tous les fichiers (warning public_bucket_allows_listing). L'accès aux photos
--    par URL publique fonctionne toujours (bucket public).
-- (Côté code : XSS stocké échappé à la source dans admin/marchand ; fonction
--  validateKycDemo supprimée du mobile — la RLS la bloquait déjà.)
-- ============================================================================
alter function public.touch_dispatch_row() set search_path = public;
drop policy if exists avatars_read on storage.objects;

-- ROLLBACK :
--   create policy avatars_read on storage.objects for select using (bucket_id='avatars');
