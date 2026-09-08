import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

// Crée un marchand COMPLET (réservé admin) : compte de connexion + restaurant + lien merchants.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const auth = req.headers.get('Authorization') || '';
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ ok: false, reason: 'unauthorized', message: 'Session expirée. Reconnecte-toi.' }, 401);

    const sb = createClient(URL, SERVICE);
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
    if (!adminRow) return json({ ok: false, reason: 'forbidden', message: 'Réservé aux administrateurs.' }, 403);

    const body = await req.json();
    const nom = (body.nom || '').trim();
    const type = (body.type || 'Restaurant').trim();
    const eta = (body.eta || '30 min').trim();
    const adresse = (body.adresse || '').trim() || null;
    const telephone = (body.telephone || '').trim() || null;
    const password = (body.password || '').trim();
    // Photo de couverture (URL publique deja uploadee par l'admin), optionnelle.
    const cover = (String(body.cover || '').trim()) || null;

    // Identifiant de connexion : EMAIL réel si fourni, sinon numéro → 223<chiffres>@taga.app.
    const rawEmail = String(body.email || '').trim().toLowerCase();
    let digits = String(body.phone || '').replace(/\D/g, '');
    if (digits.startsWith('223')) digits = digits.slice(3);
    let email = '';
    let loginLabel = '';
    if (rawEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail)) {
      email = rawEmail; loginLabel = rawEmail;
    } else if (digits && digits.length >= 7) {
      email = '223' + digits + '@taga.app'; loginLabel = '223' + digits;
    } else {
      return json({ ok: false, reason: 'login_invalide', message: 'Renseigne un email valide ou un numéro (7 chiffres min).' }, 400);
    }
    if (!nom) return json({ ok: false, reason: 'nom_requis', message: 'Le nom du restaurant est requis.' }, 400);
    if (password.length < 6) return json({ ok: false, reason: 'mdp_court', message: 'Le mot de passe doit faire au moins 6 caractères.' }, 400);

    // L'identifiant de connexion est-il DÉJÀ pris ? (ex : l'admin a saisi son propre email par erreur)
    // NB: on await proprement le résultat {data,error} — ne PAS faire .catch() sur le builder
    // (selon la version supabase-js, le builder n'a pas de .catch → TypeError → 500).
    let existing: boolean | null = null;
    try {
      const r = await sb.rpc('email_exists', { p_email: email });
      existing = (r as any)?.data ?? null;
    } catch (_e) { existing = null; }
    if (existing === true) {
      return json({ ok: false, reason: 'email_pris', message: `« ${loginLabel} » est déjà utilisé par un autre compte. Choisis un autre email ou numéro pour le restaurant (pas celui d'un admin ou d'un chauffeur).` }, 409);
    }

    const base = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resto';
    let slug = base;
    for (let i = 0; i < 5; i++) {
      const { data: ex } = await sb.from('restaurants').select('id').eq('slug', slug).maybeSingle();
      if (!ex) break;
      slug = base + '-' + Math.random().toString(36).slice(2, 6);
    }

    const { data: created, error: cErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr || !created?.user) {
      const msg = String(cErr?.message || '');
      const dejaPris = /already|registered|exists|duplicate/i.test(msg);
      return json({
        ok: false,
        reason: dejaPris ? 'email_pris' : 'create_failed',
        message: dejaPris
          ? `« ${loginLabel} » est déjà utilisé. Choisis un autre email ou numéro pour le restaurant.`
          : `Impossible de créer le compte de connexion (${msg || 'erreur inconnue'}).`,
      }, dejaPris ? 409 : 400);
    }
    const ownerId = created.user.id;
    await sb.from('profiles').upsert({ id: ownerId, prenom: nom, nom: '', phone: digits || null }, { onConflict: 'id' });

    // `img` = image affichée sur la carte du resto (app client) ; `cover` = fiche resto. Même photo.
    const { data: resto, error: rErr } = await sb.from('restaurants')
      .insert({ slug, nom, type, eta, livraison: 'À partir de 1000 F', livraison_offerte: false, note: 0, avis: 0, ouvert: true, sort: 999, adresse, telephone, img: cover, cover })
      .select('id').single();
    if (rErr || !resto) { await sb.auth.admin.deleteUser(ownerId); return json({ ok: false, reason: 'resto_failed', message: `Création du restaurant impossible (${rErr?.message || 'erreur inconnue'}).` }, 400); }

    const { error: mErr } = await sb.from('merchants').insert({ user_id: ownerId, restaurant_id: resto.id });
    if (mErr) { await sb.auth.admin.deleteUser(ownerId); await sb.from('restaurants').delete().eq('id', resto.id); return json({ ok: false, reason: 'merchant_failed', message: `Liaison du compte marchand impossible (${mErr.message}).` }, 400); }

    return json({ ok: true, restaurantId: resto.id, ownerId, login: loginLabel });
  } catch (e) {
    return json({ ok: false, error: String(e), message: 'Erreur serveur inattendue. Réessaie.' }, 500);
  }
});
