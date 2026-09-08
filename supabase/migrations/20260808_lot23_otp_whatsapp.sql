-- LOT 23 — OTP WhatsApp (inscription + réinitialisation mot de passe)
--
-- Table des codes OTP (hashés) + fonction utilitaire pour retrouver un compte par email interne.
-- L'envoi et la vérification se font dans les Edge Functions whatsapp-send-otp / whatsapp-verify-otp
-- (service_role). Aucun accès client à otp_codes.

create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone text not null,                 -- international sans '+', ex. 22376000012
  code_hash text not null,             -- sha256(pepper:phone:code) — jamais le code en clair
  purpose text not null check (purpose in ('signup','reset')),
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_otp_phone_created on public.otp_codes(phone, created_at desc);

alter table public.otp_codes enable row level security;
-- Aucune policy : seul le service_role (Edge Functions) accède à cette table.
comment on table public.otp_codes is 'Codes OTP WhatsApp (hashés). Accès service_role uniquement.';

-- Retrouve l'id du compte auth à partir de l'email interne (223<chiffres>@taga.app).
-- Utilisé par whatsapp-verify-otp pour le reset de mot de passe. Réservé au service_role.
create or replace function public.auth_uid_by_email(p_email text)
returns uuid
language sql
security definer
set search_path to 'public'
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.auth_uid_by_email(text) from anon, authenticated;
