import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Envoi d'un code OTP par WhatsApp (API Cloud Meta) pour : inscription ('signup') ou
// réinitialisation de mot de passe ('reset'). Fonction PUBLIQUE (appelée avant connexion) :
// protégée par un rate-limit strict côté serveur. Le code n'est JAMAIS renvoyé au client.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Secrets WhatsApp (à définir dans Supabase → Edge Functions → Secrets)
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || '';
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';
const WA_TEMPLATE = Deno.env.get('WHATSAPP_TEMPLATE_NAME') || 'taga_otp';
const WA_LANG = Deno.env.get('WHATSAPP_TEMPLATE_LANG') || 'fr';
const PEPPER = Deno.env.get('OTP_PEPPER') || 'taga-otp';

const OTP_TTL_MIN = 10;      // validité du code
const MAX_PER_HOUR = 5;      // nb max de codes par numéro / heure
const MIN_INTERVAL_S = 60;   // délai minimum entre deux envois

function toDigits223(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (!d.startsWith('223')) d = '223' + d;
  return d;
}
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    if (!WA_TOKEN || !WA_PHONE_ID) return json({ ok: false, reason: 'config', message: 'WhatsApp non configuré côté serveur.' }, 500);

    const body = await req.json().catch(() => ({}));
    const purpose = String(body.purpose || '');
    const digits = toDigits223(String(body.phone || ''));
    if (purpose !== 'signup' && purpose !== 'reset') return json({ ok: false, reason: 'purpose', message: 'Requête invalide.' }, 400);
    if (digits.replace(/\D/g, '').length < 10) return json({ ok: false, reason: 'phone', message: 'Numéro invalide.' }, 400);

    const email = `${digits}@taga.app`;
    const sb = createClient(URL, SERVICE);

    // Cohérence compte selon l'usage
    if (purpose === 'signup') {
      let exists = false;
      try { const r = await sb.rpc('email_exists', { p_email: email }); exists = (r as any)?.data === true; } catch (_e) { /* ignore */ }
      if (exists) return json({ ok: false, reason: 'deja_inscrit', message: 'Un compte existe déjà avec ce numéro. Connecte-toi.' }, 409);
    } else {
      let uid: string | null = null;
      try { const r = await sb.rpc('auth_uid_by_email', { p_email: email }); uid = (r as any)?.data ?? null; } catch (_e) { /* ignore */ }
      if (!uid) return json({ ok: false, reason: 'compte_introuvable', message: 'Aucun compte avec ce numéro.' }, 404);
    }

    // Rate-limit
    const sinceHour = new Date(Date.now() - 3600_000).toISOString();
    const { data: recent } = await sb.from('otp_codes').select('created_at').eq('phone', digits).gte('created_at', sinceHour).order('created_at', { ascending: false });
    if (recent && recent.length >= MAX_PER_HOUR) return json({ ok: false, reason: 'trop_de_tentatives', message: 'Trop de demandes. Réessaie dans 1 heure.' }, 429);
    if (recent && recent.length > 0) {
      const lastMs = new Date((recent[0] as any).created_at).getTime();
      if (Date.now() - lastMs < MIN_INTERVAL_S * 1000) return json({ ok: false, reason: 'trop_tot', message: 'Patiente un instant avant de redemander un code.' }, 429);
    }

    // Génère + stocke (hashé)
    const rnd = new Uint32Array(1); crypto.getRandomValues(rnd);
    const code = String(100000 + (rnd[0] % 900000)); // 6 chiffres
    const code_hash = await sha256(`${PEPPER}:${digits}:${code}`);
    await sb.from('otp_codes').update({ consumed: true }).eq('phone', digits).eq('purpose', purpose).eq('consumed', false);
    const { error: insErr } = await sb.from('otp_codes').insert({
      phone: digits, code_hash, purpose,
      expires_at: new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString(),
    });
    if (insErr) return json({ ok: false, reason: 'db', message: 'Erreur serveur. Réessaie.' }, 500);

    // Envoi via WhatsApp Cloud API (template d'authentification : code en corps + bouton copier)
    const waRes = await fetch(`https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: digits,
        type: 'template',
        template: {
          name: WA_TEMPLATE,
          language: { code: WA_LANG },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    });
    if (!waRes.ok) {
      const detail = await waRes.text().catch(() => '');
      // On invalide le code qu'on vient de créer : inutile de le laisser vivant si l'envoi a échoué.
      await sb.from('otp_codes').update({ consumed: true }).eq('phone', digits).eq('code_hash', code_hash);
      console.error('WhatsApp send failed', waRes.status, detail);
      return json({ ok: false, reason: 'envoi', message: "Impossible d'envoyer le code WhatsApp. Vérifie le numéro et réessaie." }, 502);
    }

    return json({ ok: true, ttl: OTP_TTL_MIN * 60 });
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: 'server', message: 'Erreur serveur inattendue.' }, 500);
  }
});
