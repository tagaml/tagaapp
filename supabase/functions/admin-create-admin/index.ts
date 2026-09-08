import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const ROLES = ['super', 'finance', 'support', 'viewer'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const auth = req.headers.get('Authorization') || '';
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ ok: false, reason: 'unauthorized' }, 401);

    const sb = createClient(URL, SERVICE);
    // Seul un SUPER admin peut créer des comptes admin (vérif côté serveur)
    const { data: me } = await sb.from('admins').select('role').eq('user_id', uid).maybeSingle();
    if (!me || me.role !== 'super') return json({ ok: false, reason: 'forbidden' }, 403);

    const body = await req.json();
    const nom = (body.nom || '').trim();
    const password = (body.password || '').trim();
    let role = (body.role || 'viewer').trim();
    if (!ROLES.includes(role)) role = 'viewer';
    let digits = String(body.phone || '').replace(/\D/g, '');
    if (!digits || digits.length < 7 || password.length < 6) return json({ ok: false, reason: 'invalid' }, 400);
    const email = digits + '@taga.app';

    const { data: created, error: cErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr || !created?.user) return json({ ok: false, reason: cErr?.message || 'create_failed' }, 400);
    const aid = created.user.id;

    await sb.from('profiles').upsert({ id: aid, prenom: nom || 'Admin', nom: '', phone: digits }, { onConflict: 'id' });
    const { error: aErr } = await sb.from('admins').upsert({ user_id: aid, role, nom: nom || null }, { onConflict: 'user_id' });
    if (aErr) return json({ ok: false, reason: aErr.message }, 400);

    // Journal d'audit : qui a créé quel admin
    await sb.rpc('log_admin_action', { p_actor: uid, p_action: 'CREATE_ADMIN', p_table: 'admins', p_rowid: aid, p_summary: 'Création admin ' + (nom || digits) + ' · rôle ' + role });

    return json({ ok: true, adminId: aid, login: digits, role });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
