import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

// Assigne un chauffeur à une LOCATION (louer un chauffeur) — réservé admin.
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
    const { data: adminRow } = await sb.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
    if (!adminRow) return json({ ok: false, reason: 'forbidden' }, 403);

    const { rideId, driverId } = await req.json();
    if (!rideId || !driverId) return json({ ok: false, reason: 'missing_params' }, 400);

    const { data: ride } = await sb.from('rides').select('*').eq('id', rideId).single();
    if (!ride) return json({ ok: false, reason: 'no_ride' }, 404);
    if ((ride.location_hours ?? 0) <= 0) return json({ ok: false, reason: 'not_location' }, 400);
    if (ride.driver_id) return json({ ok: false, reason: 'already_assigned' }, 409);
    if (ride.statut !== 'recherche') return json({ ok: false, reason: 'not_open' }, 409);

    // Délai (min) avant l'heure programmée où le chauffeur reçoit la course — réglable en admin.
    const { data: leadRow } = await sb.from('app_numbers').select('value').eq('key', 'schedule_lead_min').maybeSingle();
    let leadMin = Number((leadRow as any)?.value);
    if (!isFinite(leadMin) || leadMin < 0) leadMin = 30;

    const { data: prof } = await sb.from('profiles').select('prenom,nom,photo_url').eq('id', driverId).maybeSingle();
    const { data: dp } = await sb.from('driver_profiles').select('vehicule,couleur,plaque,services').eq('driver_id', driverId).maybeSingle();
    // Le chauffeur doit ACCEPTER le service « location » (case cochée dans « Que veux-tu transporter »).
    // Par défaut la location est décochée : on n'assigne jamais une location à qui ne l'a pas activée.
    const svc = Array.isArray((dp as any)?.services) ? (dp as any).services : [];
    if (!svc.includes('location')) return json({ ok: false, reason: 'service_desactive', message: "Ce chauffeur n'accepte pas les locations." }, 409);
    const nom = `${prof?.prenom ?? ''} ${prof?.nom ?? ''}`.trim() || 'Chauffeur';
    const vehicule = [dp?.vehicule, dp?.couleur].filter(Boolean).join(' · ') || ride.vehicule || 'Véhicule Taga';
    const plaque = dp?.plaque || '—';

    // Programmée (heure future > lead) => PRÉ-assignation ; le chauffeur ne reçoit la course active que lead min avant.
    const startMs = ride.scheduled_at ? new Date(ride.scheduled_at).getTime() : 0;
    const scheduled = startMs > Date.now() + leadMin * 60000;
    const newStatut = scheduled ? 'programme' : 'en_route';
    const quand = ride.scheduled_at ? new Date(ride.scheduled_at).toLocaleString('fr-FR') : 'maintenant';

    const { error: upErr } = await sb.from('rides')
      .update({ driver_id: driverId, chauffeur_nom: nom, chauffeur_photo: prof?.photo_url ?? null, vehicule, plaque, statut: newStatut })
      .eq('id', rideId).eq('statut', 'recherche').is('driver_id', null);
    if (upErr) return json({ ok: false, reason: 'assign_failed', detail: upErr.message }, 400);

    if (scheduled) {
      await sb.from('notifications').insert([
        { user_id: driverId, titre: 'Location programmée', corps: `Tu es programmé pour une location (${ride.location_hours}h) le ${quand}. Elle t'arrivera ${leadMin} min avant l'heure.`, type: 'course', ref_type: 'ride', ref_id: rideId, lu: false },
        { user_id: ride.user_id, titre: 'Chauffeur pré-assigné', corps: `${nom} est réservé pour ta location du ${quand}.`, type: 'course', ref_type: 'ride', ref_id: rideId, lu: false },
      ]);
    } else {
      await sb.from('notifications').insert([
        { user_id: driverId, titre: 'Location assignée', corps: `Tu es assigné à une location (${ride.location_hours}h) · ${ride.depart ?? 'point de prise en charge'} · ${quand}.`, type: 'course', ref_type: 'ride', ref_id: rideId, lu: false },
        { user_id: ride.user_id, titre: 'Chauffeur assigné', corps: `${nom} a été assigné à ta location. Il te contactera au point de prise en charge.`, type: 'course', ref_type: 'ride', ref_id: rideId, lu: false },
      ]);
      try {
        // Push URGENT (sonnerie) : le chauffeur doit l'entendre même app fermée, puis accepter/refuser.
        await fetch(`${URL}/functions/v1/send-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE}` },
          body: JSON.stringify({ userId: driverId, title: 'Nouvelle location', body: `Location de ${ride.location_hours}h · ${ride.depart ?? ''}`, urgent: true, ttl: 25, data: { type: 'location_assign', ref_type: 'ride', ref_id: rideId } }),
        });
      } catch (_e) { /* ignore */ }
    }

    return json({ ok: true, rideId, driverId, chauffeur: nom, scheduled });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
