-- LOT 17b — fn_audit() est une fonction de TRIGGER (s'exécute avec les droits du
-- propriétaire de la table) : aucun besoin de l'exposer en RPC. Retrait de l'EXECUTE.
revoke all on function public.fn_audit() from public;
revoke all on function public.fn_audit() from anon;
revoke all on function public.fn_audit() from authenticated;
