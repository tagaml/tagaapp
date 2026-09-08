import { supabase } from './supabase';

// Appels OTP WhatsApp (Edge Functions). Fonctionnent AVANT connexion (clé anon).
export type OtpResult = { ok: true } | { ok: false; message: string; reason?: string };

async function callFn(name: string, body: Record<string, unknown>): Promise<OtpResult> {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      // supabase-js encapsule les réponses non-2xx : on tente de lire le message métier renvoyé.
      try {
        const ctx = (error as any).context;
        const j = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
        if (j?.message) return { ok: false, message: j.message, reason: j.reason };
      } catch { /* ignore */ }
      return { ok: false, message: 'Réessaie dans un instant.' };
    }
    if (data && (data as any).ok) return { ok: true };
    return { ok: false, message: (data as any)?.message || 'Réessaie.', reason: (data as any)?.reason };
  } catch {
    return { ok: false, message: 'Pas de connexion. Vérifie ton réseau.' };
  }
}

export function sendOtp(phone: string, purpose: 'signup' | 'reset') {
  return callFn('whatsapp-send-otp', { phone, purpose });
}
export function verifyOtpSignup(phone: string, code: string, data: { prenom: string; nom: string; password: string }) {
  return callFn('whatsapp-verify-otp', { phone, code, purpose: 'signup', ...data });
}
export function verifyOtpReset(phone: string, code: string, password: string) {
  return callFn('whatsapp-verify-otp', { phone, code, purpose: 'reset', password });
}
