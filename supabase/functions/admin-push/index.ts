import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

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
    const { data: me } = await sb.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
    if (!me) return json({ ok: false, reason: 'forbidden' }, 403);

    const body = await req.json();
    const title = (body.title || 'Taga').toString().slice(0, 100);
    const msg = (body.body || '').toString().slice(0, 240);
    const audience = (body.audience || 'all').toString(); // all | clients | drivers
    if (!msg) return json({ ok: false, reason: 'empty' }, 400);

    // On cible par push_variant (fiable, posé par l'app à l'enregistrement du token).
    // Repli pour les anciens tokens sans variante : appartenance à driver_profiles.
    const { data: profs } = await sb.from('profiles').select('id, push_token, push_variant');
    const all = profs || [];
    let targets = all;
    if (audience === 'drivers' || audience === 'clients') {
      const { data: dp } = await sb.from('driver_profiles').select('driver_id');
      const driverIds = new Set((dp || []).map((d: any) => d.driver_id));
      const isDriver = (p: any) => p.push_variant === 'chauffeur' || (!p.push_variant && driverIds.has(p.id));
      const isClient = (p: any) => p.push_variant === 'client' || (!p.push_variant && !driverIds.has(p.id));
      targets = audience === 'drivers' ? all.filter(isDriver) : all.filter(isClient);
    }

    if (targets.length) {
      const rows = targets.map((p: any) => ({ user_id: p.id, titre: title, corps: msg, type: 'info' }));
      for (let i = 0; i < rows.length; i += 500) await sb.from('notifications').insert(rows.slice(i, i + 500));
    }

    const tokens = targets.map((p: any) => p.push_token).filter((t: any) => typeof t === 'string' && t.startsWith('ExponentPushToken'));
    let pushed = 0;
    for (let i = 0; i < tokens.length; i += 100) {
      const chunk = tokens.slice(i, i + 100).map((t: string) => ({ to: t, title, body: msg, sound: 'default', priority: 'high', channelId: 'taga' }));
      try {
        await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(chunk) });
        pushed += chunk.length;
      } catch (_) { /* continue */ }
    }

    await sb.rpc('log_admin_action', { p_actor: uid, p_action: 'PUSH', p_table: 'notifications', p_rowid: null, p_summary: `Push « ${title} » → ${audience} (${targets.length} destinataires, ${pushed} push)` });
    return json({ ok: true, recipients: targets.length, pushed });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
