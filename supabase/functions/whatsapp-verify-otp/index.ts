import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Vérifie un code OTP WhatsApp puis exécute l'action :
//  - 'signup' : crée le compte (numéro + mot de passe) après preuve du numéro.
//  - 'reset'  : change le mot de passe du compte lié au numéro.
// Le compte n'est créé / modifié que si le code est valide. Max 5 tentatives par code.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PEPPER = Deno.env.get('OTP_PEPPER') || 'taga-otp';
const MAX_ATTEMPTS = 5;

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
    const body = await req.json().catch(() => ({}));
    const purpose = String(body.purpose || '');
    const digits = toDigits223(String(body.phone || ''));
    const code = String(body.code || '').replace(/\D/g, '');
    const password = String(body.password || '');
    if (purpose !== 'signup' && purpose !== 'reset') return json({ ok: false, reason: 'purpose', message: 'Requête invalide.' }, 400);
    if (code.length !== 6) return json({ ok: false, reason: 'code_invalide', message: 'Code à 6 chiffres attendu.' }, 400);
    if (password.length < 6) return json({ ok: false, reason: 'mdp_court', message: 'Le mot de passe doit faire au moins 6 caractères.' }, 400);

    const email = `${digits}@taga.app`;
    const sb = createClient(URL, SERVICE);

    // Dernier code non consommé pour ce numéro + usage
    const { data: rows } = await sb.from('otp_codes')
      .select('id, code_hash, expires_at, attempts')
      .eq('phone', digits).eq('purpose', purpose).eq('consumed', false)
      .order('created_at', { ascending: false }).limit(1);
    const row = rows && rows[0];
    if (!row) return json({ ok: false, reason: 'code_invalide', message: 'Aucun code en attente. Redemande un code.' }, 400);
    if (new Date((row as any).expires_at).getTime() < Date.now()) {
      await sb.from('otp_codes').update({ consumed: true }).eq('id', (row as any).id);
      return json({ ok: false, reason: 'code_expire', message: 'Code expiré. Redemande un code.' }, 400);
    }
    if ((row as any).attempts >= MAX_ATTEMPTS) {
      await sb.from('otp_codes').update({ consumed: true }).eq('id', (row as any).id);
      return json({ ok: false, reason: 'trop_de_tentatives', message: 'Trop d\'essais. Redemande un code.' }, 429);
    }

    await sb.from('otp_codes').update({ attempts: (row as any).attempts + 1 }).eq('id', (row as any).id);
    const expected = await sha256(`${PEPPER}:${digits}:${code}`);
    if (expected !== (row as any).code_hash) {
      const left = MAX_ATTEMPTS - ((row as any).attempts + 1);
      return json({ ok: false, reason: 'code_invalide', message: left > 0 ? `Code incorrect. ${left} essai(s) restant(s).` : 'Code incorrect. Redemande un code.' }, 400);
    }

    // Code valide → on le consomme
    await sb.from('otp_codes').update({ consumed: true }).eq('id', (row as any).id);

    if (purpose === 'signup') {
      let exists = false;
      try { const r = await sb.rpc('email_exists', { p_email: email }); exists = (r as any)?.data === true; } catch (_e) { /* ignore */ }
      if (exists) return json({ ok: false, reason: 'deja_inscrit', message: 'Un compte existe déjà avec ce numéro. Connecte-toi.' }, 409);

      const prenom = String(body.prenom || '').trim();
      const nom = String(body.nom || '').trim();
      const phoneLocal = digits.startsWith('223') ? digits.slice(3) : digits;
      const { data: created, error: cErr } = await sb.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { prenom, nom, phone: phoneLocal },
      });
      if (cErr || !created?.user) {
        const dejaPris = /already|registered|exists|duplicate/i.test(String(cErr?.message || ''));
        return json({ ok: false, reason: dejaPris ? 'deja_inscrit' : 'create_failed', message: dejaPris ? 'Un compte existe déjà avec ce numéro.' : 'Création du compte impossible. Réessaie.' }, dejaPris ? 409 : 400);
      }
      await sb.from('profiles').upsert({ id: created.user.id, prenom, nom, phone: phoneLocal }, { onConflict: 'id' });
      return json({ ok: true });
    }

    // purpose === 'reset'
    let uid: string | null = null;
    try { const r = await sb.rpc('auth_uid_by_email', { p_email: email }); uid = (r as any)?.data ?? null; } catch (_e) { /* ignore */ }
    if (!uid) return json({ ok: false, reason: 'compte_introuvable', message: 'Aucun compte avec ce numéro.' }, 404);
    const { error: uErr } = await sb.auth.admin.updateUserById(uid, { password });
    if (uErr) return json({ ok: false, reason: 'reset_failed', message: 'Changement de mot de passe impossible. Réessaie.' }, 400);
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, reason: 'server', message: 'Erreur serveur inattendue.' }, 500);
  }
});
