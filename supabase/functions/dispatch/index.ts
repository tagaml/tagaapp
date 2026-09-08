import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Fenêtre d'offre : 30 s.
// Quand l'appli du chauffeur est TUÉE, il faut compter le push (1-3 s) + le temps qu'il
// remarque la notif (2-5 s) + le démarrage à froid de l'appli (3-6 s) = jusqu'à ~14 s avant
// même qu'il voie la carte. À 22 s il ne restait quasiment rien pour lire et décider.
const OFFER_SECONDS = 30;

// Durée de vie du PUSH, volontairement PLUS COURTE que l'offre elle-même.
// Le TTL court à partir de l'ENVOI (≈ T0), et l'offre meurt à T0 + OFFER_SECONDS.
// Sans marge, un téléphone qui se reconnecte juste avant l'expiration recevait quand même la
// notif et le chauffeur découvrait une offre avec 2 s restantes : il courait pour rien.
// Avec cette marge, FCM/APNs cessent d'essayer à T0+22 : soit la notif arrive avec au moins
// 8 s utilisables, soit elle n'arrive PAS DU TOUT (et le dispatch est déjà passé au suivant).
const PUSH_MARGIN_SECONDS = 8;
const PUSH_TTL = Math.max(5, OFFER_SECONDS - PUSH_MARGIN_SECONDS);

const RADIUS_KM = 8;
const PRESENCE_MS = 120000;
const DELIV_STATES = ['prete', 'livraison'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180, la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Rang de gamme canonique (identique à gamme_norm/gamme_rang côté SQL) :
//   eco/standard/null -> 1, fresh/confort/vip -> 2, suv/xl -> 3.
function gRank(g: string | null): number {
  const s = (g || '').toLowerCase();
  if (s === 'suv' || s === 'xl') return 3;
  if (s === 'fresh' || s === 'confort' || s === 'comfort' || s === 'vip') return 2;
  return 1;
}

/* ===================== SÉPARATION DES MÉTIERS =====================
   Avant, le dispatch ne connaissait que le TYPE DE VÉHICULE : un livreur à moto
   recevait donc les courses taxi, et un chauffeur VTC les livraisons de repas.
   Chaque chauffeur déclare désormais les SERVICES qu'il accepte
   (driver_presence.services), et le dispatch filtre strictement dessus.

     'courses'      -> courses VTC / moto-taxi (rides.type 'voiture' | 'moto')
     'colis'        -> livraison de colis      (rides.type 'colis')
     'livraison'    -> livraison de repas      (orders)
     'demenagement' -> camion (assigné par l'admin, hors auto-dispatch)

   RÈGLE MÉTIER (décision fondateur) : une VOITURE ne transporte QUE des passagers.
   Ni colis, ni repas. Les colis vont aux MOTOS (colis léger) et aux TRICYCLES
   (colis lourd). La livraison de repas se fait à MOTO uniquement. La moto peut tout
   faire (passagers, colis, repas) — le chauffeur coche ce qu'il accepte.

   Table de référence (identique à la fonction SQL `services_compatibles`) :
     voiture  -> ['courses']
     moto     -> ['courses','colis','livraison']
     tricycle -> ['colis']
     camion   -> ['demenagement']
   ================================================================= */

// Services compatibles avec un véhicule (repli pour un chauffeur pas encore migré).
function servicesParDefaut(veh: string | null): string[] {
  const raw = (veh || '').toLowerCase();
  const v = raw === 'car' ? 'voiture' : raw; // 'car' = alias historique de 'voiture'
  if (v === 'camion') return ['demenagement'];
  if (v === 'tricycle') return ['colis'];
  if (v === 'moto') return ['courses', 'colis', 'livraison'];
  if (v === 'voiture') return ['courses']; // passagers uniquement
  return ['courses']; // véhicule inconnu : au minimum des passagers
}

// Le chauffeur accepte-t-il ce service ? (services null/vide = pas encore choisi -> repli véhicule)
function faitService(service: string, pservices: string[] | null, pveh: string | null): boolean {
  const list = (pservices && pservices.length > 0) ? pservices : servicesParDefaut(pveh);
  return list.includes(service);
}

// Service requis par une course selon son type.
function serviceDeLaCourse(rideType: string): string {
  return rideType === 'colis' ? 'colis' : 'courses';
}

// Le véhicule ACTIF du chauffeur (driver_presence.vehicule) doit correspondre au type de course,
// et pour une voiture, la GAMME doit convenir : une course VIP ne part qu'aux voitures VIP,
// une SUV qu'aux SUV ; une course Standard part à toutes les voitures (VIP/SUV peuvent la prendre).
function vehMatch(rideType: string, tier: string | null, shared: boolean, pveh: string | null, pgamme: string | null): boolean {
  const v = pveh === 'car' ? 'voiture' : (pveh || '');
  if (rideType === 'colis') {
    // Un colis ne part JAMAIS en voiture : léger -> moto, lourd -> tricycle.
    if (tier === 'tricycle') return v === 'tricycle';
    return v === 'moto';
  }
  if (rideType === 'moto') return v === 'moto';
  if (rideType === 'voiture') {
    if (v !== 'voiture') return false;
    // Routage par gamme (décision fondateur / retour testeur) :
    //   • Eco (rang 1)  -> sonne chez Eco ET Fresh
    //   • Fresh (rang 2) -> sonne chez Fresh SEULEMENT
    //   • SUV (rang 3)  -> sonne chez SUV SEULEMENT
    // Le partage est toujours Eco (rang 1).
    const dr = gRank(pgamme);
    const cr = shared ? 1 : gRank(tier);
    if (cr === 1) return dr === 1 || dr === 2; // Eco : Eco + Fresh
    return dr === cr;                          // Fresh->Fresh, SUV->SUV
  }
  return v !== 'tricycle';
}

const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function numSetting(sb: any, key: string, def: number): Promise<number> {
  try {
    const { data } = await sb.from('app_settings').select('num_value').eq('key', key).maybeSingle();
    const v = data?.num_value;
    const n = Number(v);
    return (v == null || isNaN(n) || n <= 0) ? def : n;
  } catch (_) { return def; }
}

async function validatedSet(sb: any): Promise<Set<string>> {
  const { data } = await sb.from('driver_kyc').select('driver_id').eq('statut', 'valide');
  return new Set((data || []).map((d: any) => d.driver_id));
}

// Chauffeurs avec un ABONNEMENT actif et non expiré : seuls eux reçoivent des offres.
// (Modèle Taga : la plateforme se rémunère via l'abonnement, pas la commission.)
async function subscribedSet(sb: any): Promise<Set<string>> {
  const { data } = await sb.from('driver_subscriptions').select('driver_id').eq('statut', 'actif').gt('expires_at', new Date().toISOString());
  return new Set((data || []).map((d: any) => d.driver_id));
}

async function autoRidesEnabled(sb: any): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'rides_auto_dispatch').maybeSingle();
  return data ? data.value !== false : true;
}

// Covoiturage Taga Partage : dormant tant que ce drapeau est false (Partage part alors en solo, comportement actuel).
async function poolEnabled(sb: any): Promise<boolean> {
  const { data } = await sb.from('app_settings').select('value').eq('key', 'pool_enabled').maybeSingle();
  return data ? data.value === true : false;
}

async function busyDrivers(sb: any): Promise<Set<string>> {
  const [{ data: rd }, { data: od }] = await Promise.all([
    sb.from('rides').select('driver_id').in('statut', ['en_route', 'arrive', 'en_cours']).not('driver_id', 'is', null),
    sb.from('orders').select('driver_id').in('statut', DELIV_STATES).not('driver_id', 'is', null),
  ]);
  const s = new Set<string>();
  (rd || []).forEach((r: any) => r.driver_id && s.add(r.driver_id));
  (od || []).forEach((o: any) => o.driver_id && s.add(o.driver_id));
  return s;
}

// `opts` sert aux OFFRES chauffeur (appli en arrière-plan / écran verrouillé) :
//   - data : deep link (le tap ouvre directement l'offre)
//   - ttl  : l'offre expire en ~22 s. Sans durée de vie, un téléphone hors réseau ou en veille
//            profonde reçoit la notif bien plus tard et le chauffeur tape sur une offre morte.
//   - urgent : iOS -> 'time-sensitive' (traverse le mode Concentration). Android l'a déjà via
//            le canal 'urgent' (bypassDnd), mais iOS n'a aucun équivalent côté canal.
async function push(
  userId: string,
  title: string,
  body: string,
  opts?: { data?: Record<string, unknown>; ttl?: number; urgent?: boolean },
) {
  try {
    await fetch(`${URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ userId, title, body, ...(opts ?? {}) }),
    });
  } catch (_e) { /* ignore */ }
}

async function offerNext(sb: any, ride: any) {
  const radiusKm = await numSetting(sb, 'dispatch_radius_km', RADIUS_KM);
  const since = new Date(Date.now() - PRESENCE_MS).toISOString();
  const { data: presence } = await sb.from('driver_presence').select('driver_id,lat,lng,vehicule,gamme,services').eq('online', true).gt('updated_at', since);
  const { data: offers } = await sb.from('ride_offers').select('driver_id').eq('ride_id', ride.id);
  const seen = new Set((offers || []).map((o: any) => o.driver_id));
  const busy = await busyDrivers(sb);
  const valid = await validatedSet(sb);
  const subs = await subscribedSet(sb);
  // Location (louer un chauffeur) : métier 'location' (opt-in du chauffeur), et non 'courses'.
  const isLocation = (ride.location_hours ?? 0) > 0;
  const service = isLocation ? 'location' : serviceDeLaCourse(ride.type); // 'courses' | 'colis' | 'location'
  let cands = (presence || []).filter((p: any) =>
    p.lat != null && p.lng != null &&
    valid.has(p.driver_id) && subs.has(p.driver_id) &&
    !seen.has(p.driver_id) && !busy.has(p.driver_id) &&
    p.driver_id !== ride.user_id &&
    faitService(service, p.services, p.vehicule) &&           // le chauffeur accepte CE métier
    vehMatch(ride.type, ride.tier, !!ride.shared, p.vehicule, p.gamme)
  );
  const hasCenter = ride.depart_lat != null && ride.depart_lng != null;
  if (hasCenter) {
    const c = { lat: ride.depart_lat, lng: ride.depart_lng };
    cands = cands.map((p: any) => ({ p, d: distKm(c, { lat: p.lat, lng: p.lng }) })).filter((x: any) => x.d <= radiusKm).sort((a: any, b: any) => a.d - b.d).map((x: any) => ({ ...x.p, d: x.d }));
  }
  const next = cands[0];
  if (!next) return null;
  const { data: offer } = await sb.from('ride_offers').insert({ ride_id: ride.id, driver_id: next.driver_id, status: 'pending', distance_km: next.d ?? null, expires_at: new Date(Date.now() + OFFER_SECONDS * 1000).toISOString() }).select('id').single();
  const pushTitle = isLocation ? 'Nouvelle location' : 'Nouvelle course';
  const pushBody = isLocation
    ? `${ride.depart ?? 'Prise en charge'} · ${ride.location_hours} h`
    : `${ride.depart ?? ''} → ${ride.destination ?? ''}`;
  await push(next.driver_id, pushTitle, pushBody, {
    data: { type: 'ride_offer', ref_type: 'ride', ref_id: ride.id, offer_id: offer?.id },
    ttl: PUSH_TTL,
    urgent: true,
  });
  return { offerId: offer?.id, driverId: next.driver_id };
}

async function hasActiveOffer(sb: any, rideId: string) {
  const { data } = await sb.from('ride_offers').select('expires_at').eq('ride_id', rideId).eq('status', 'pending');
  return (data || []).some((o: any) => new Date(o.expires_at).getTime() > Date.now());
}

// ===================== COVOITURAGE (POOL) =====================
// Un pool jumelé = 2 courses Partage liées par pool_id (rôles 'a' et 'b'). On l'offre à UN SEUL
// chauffeur, qui encaisse les DEUX tarifs (~140 % d'une course). L'offre est ancrée sur la course
// 'a' (ride_offers.pool_id porte le lien). L'éligibilité chauffeur est calculée sur la prise en
// charge 'a' ; comme les 2 départs sont proches (≤ pool_pickup_km), le rayon couvre les deux.
async function poolStillOpen(sb: any, poolId: string): Promise<any[] | null> {
  const { data: legs } = await sb.from('rides').select('*').eq('pool_id', poolId).order('pool_role', { ascending: true });
  if (!legs || legs.length < 2) return null;
  if (legs.some((l: any) => l.driver_id || l.statut !== 'recherche')) return null;
  return legs;
}

async function offerPool(sb: any, poolId: string) {
  const legs = await poolStillOpen(sb, poolId);
  if (!legs) return null;
  const anchor = legs.find((l: any) => l.pool_role === 'a') ?? legs[0];

  const radiusKm = await numSetting(sb, 'dispatch_radius_km', RADIUS_KM);
  const since = new Date(Date.now() - PRESENCE_MS).toISOString();
  const { data: presence } = await sb.from('driver_presence').select('driver_id,lat,lng,vehicule,gamme,services').eq('online', true).gt('updated_at', since);
  const { data: offers } = await sb.from('ride_offers').select('driver_id').eq('pool_id', poolId);
  const seen = new Set((offers || []).map((o: any) => o.driver_id));
  const busy = await busyDrivers(sb);
  const valid = await validatedSet(sb);
  const subs = await subscribedSet(sb);
  const poolUsers = new Set(legs.map((l: any) => l.user_id));

  let cands = (presence || []).filter((p: any) =>
    p.lat != null && p.lng != null &&
    valid.has(p.driver_id) && subs.has(p.driver_id) &&
    !seen.has(p.driver_id) && !busy.has(p.driver_id) &&
    !poolUsers.has(p.driver_id) &&
    faitService('courses', p.services, p.vehicule) &&
    vehMatch('voiture', anchor.tier, true, p.vehicule, p.gamme)   // course voiture partagée
  );
  const hasCenter = anchor.depart_lat != null && anchor.depart_lng != null;
  if (hasCenter) {
    const c = { lat: anchor.depart_lat, lng: anchor.depart_lng };
    cands = cands.map((p: any) => ({ p, d: distKm(c, { lat: p.lat, lng: p.lng }) })).filter((x: any) => x.d <= radiusKm).sort((a: any, b: any) => a.d - b.d).map((x: any) => ({ ...x.p, d: x.d }));
  }
  const next = cands[0];
  if (!next) return null;

  const { data: offer } = await sb.from('ride_offers').insert({
    ride_id: anchor.id, pool_id: poolId, driver_id: next.driver_id, status: 'pending',
    distance_km: next.d ?? null, expires_at: new Date(Date.now() + OFFER_SECONDS * 1000).toISOString(),
  }).select('id').single();

  const gain = legs.reduce((s: number, l: any) => s + (l.prix ?? 0), 0);
  await push(next.driver_id, 'Course partagée · 2 passagers', `${anchor.depart ?? ''} → ${anchor.destination ?? ''} · ${gain} F`, {
    data: { type: 'ride_offer', ref_type: 'pool', ref_id: poolId, offer_id: offer?.id },
    ttl: PUSH_TTL,
    urgent: true,
  });
  return { offerId: offer?.id, driverId: next.driver_id, pool: true };
}

async function hasActivePoolOffer(sb: any, poolId: string) {
  const { data } = await sb.from('ride_offers').select('expires_at').eq('pool_id', poolId).eq('status', 'pending');
  return (data || []).some((o: any) => new Date(o.expires_at).getTime() > Date.now());
}

async function offerNextDelivery(sb: any, order: any) {
  const since = new Date(Date.now() - PRESENCE_MS).toISOString();
  const { data: presence } = await sb.from('driver_presence').select('driver_id,updated_at,vehicule,lat,lng,services').eq('online', true).gt('updated_at', since).order('updated_at', { ascending: false });
  const { data: offers } = await sb.from('delivery_offers').select('driver_id').eq('order_id', order.id);
  const seen = new Set((offers || []).map((o: any) => o.driver_id));
  const busy = await busyDrivers(sb);
  const valid = await validatedSet(sb);
  const subs = await subscribedSet(sb);
  let cands = (presence || []).filter((p: any) =>
    valid.has(p.driver_id) && subs.has(p.driver_id) &&
    !seen.has(p.driver_id) && !busy.has(p.driver_id) &&
    p.driver_id !== order.user_id &&
    faitService('livraison', p.services, p.vehicule) &&        // seuls les livreurs repas
    p.vehicule === 'moto'                                      // une voiture ne livre pas de repas
  );

  let resto: any = null;
  if (order.restaurant_id) {
    const { data } = await sb.from('restaurants').select('lat,lng,delivery_radius_km').eq('id', order.restaurant_id).maybeSingle();
    resto = data;
  }
  if (resto && resto.lat != null && resto.lng != null) {
    const globalR = await numSetting(sb, 'delivery_radius_km', 8);
    const radiusKm = (resto.delivery_radius_km != null && Number(resto.delivery_radius_km) > 0) ? Number(resto.delivery_radius_km) : globalR;
    const c = { lat: resto.lat, lng: resto.lng };
    cands = cands
      .filter((p: any) => p.lat != null && p.lng != null)
      .map((p: any) => ({ ...p, d: distKm(c, { lat: p.lat, lng: p.lng }) }))
      .filter((x: any) => x.d <= radiusKm)
      .sort((a: any, b: any) => a.d - b.d);
  }
  const next = cands[0];
  if (!next) return null;
  const { data: offer } = await sb.from('delivery_offers').insert({ order_id: order.id, driver_id: next.driver_id, status: 'pending', expires_at: new Date(Date.now() + OFFER_SECONDS * 1000).toISOString() }).select('id').single();
  await push(next.driver_id, 'Nouvelle livraison', `${order.restaurant_nom ?? 'Restaurant'} → client`, {
    data: { type: 'delivery_offer', ref_type: 'order', ref_id: order.id, offer_id: offer?.id },
    ttl: PUSH_TTL,
    urgent: true,
  });
  return { offerId: offer?.id, driverId: next.driver_id };
}

async function hasActiveDeliveryOffer(sb: any, orderId: string) {
  const { data } = await sb.from('delivery_offers').select('expires_at').eq('order_id', orderId).eq('status', 'pending');
  return (data || []).some((o: any) => new Date(o.expires_at).getTime() > Date.now());
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
  try {
    const { action, rideId, offerId, orderId } = await req.json();
    const sb = createClient(URL, KEY);

    if (action === 'start') {
      const { data: ride } = await sb.from('rides').select('*').eq('id', rideId).single();
      if (!ride) return json({ ok: false, reason: 'no_ride' }, 404);
      if (ride.statut !== 'recherche' || ride.driver_id) return json({ ok: false, reason: 'not_open' });
      if (!(await autoRidesEnabled(sb))) return json({ ok: true, manual: true });

      // Covoiturage : une course Partage (voiture). Dormant tant que pool_enabled = false.
      if (ride.type === 'voiture' && ride.shared && (await poolEnabled(sb))) {
        // Déjà jumelée (ex. redispatch de secours) : on (ré)offre le POOL, jamais en solo.
        if (ride.pool_id) {
          if (await hasActivePoolOffer(sb, ride.pool_id)) return json({ ok: true, already: true });
          return json({ ok: true, offered: await offerPool(sb, ride.pool_id) });
        }
        // Pas encore jumelée : on tente un binôme. Trouvé → offre le pool ; sinon → attend (repli Eco Phase 4).
        const { data: poolId } = await sb.rpc('try_match_pool', { p_ride: rideId });
        if (poolId) {
          if (await hasActivePoolOffer(sb, poolId)) return json({ ok: true, already: true });
          return json({ ok: true, offered: await offerPool(sb, poolId) });
        }
        return json({ ok: true, waiting: true }); // en attente d'un 2e passager
      }

      if (await hasActiveOffer(sb, rideId)) return json({ ok: true, already: true });
      return json({ ok: true, offered: await offerNext(sb, ride) });
    }
    if (action === 'decline' || action === 'expire') {
      const { data: off } = await sb.from('ride_offers').select('*').eq('id', offerId).single();
      if (!off) return json({ ok: false, reason: 'no_offer' }, 404);
      await sb.from('ride_offers').update({ status: action === 'expire' ? 'expired' : 'declined' }).eq('id', offerId).eq('status', 'pending');

      // Offre de pool refusée/expirée : on ré-offre le pool entier au chauffeur suivant.
      if (off.pool_id) {
        const legs = await poolStillOpen(sb, off.pool_id);
        if (!legs) return json({ ok: true, done: true });
        if (!(await autoRidesEnabled(sb))) return json({ ok: true, manual: true });
        if (await hasActivePoolOffer(sb, off.pool_id)) return json({ ok: true, already: true });
        return json({ ok: true, reoffered: await offerPool(sb, off.pool_id) });
      }

      const { data: ride } = await sb.from('rides').select('*').eq('id', off.ride_id).single();
      if (!ride || ride.statut !== 'recherche' || ride.driver_id) return json({ ok: true, done: true });
      if (!(await autoRidesEnabled(sb))) return json({ ok: true, manual: true });
      if (await hasActiveOffer(sb, off.ride_id)) return json({ ok: true, already: true });
      return json({ ok: true, reoffered: await offerNext(sb, ride) });
    }
    if (action === 'accept') {
      const { data: off } = await sb.from('ride_offers').select('*').eq('id', offerId).single();
      if (!off) return json({ ok: false, reason: 'no_offer' }, 404);
      if (off.status !== 'pending') return json({ ok: false, reason: 'expired' });
      const { data: prof } = await sb.from('profiles').select('prenom,nom,photo_url').eq('id', off.driver_id).maybeSingle();
      const { data: dp } = await sb.from('driver_profiles').select('vehicule,couleur,plaque').eq('driver_id', off.driver_id).maybeSingle();
      const nom = `${prof?.prenom ?? ''} ${prof?.nom ?? ''}`.trim() || 'Chauffeur';
      const vehicule = [dp?.vehicule, dp?.couleur].filter(Boolean).join(' · ') || 'Véhicule Taga';
      const plaque = dp?.plaque || '—';

      // ---- Acceptation d'un POOL : les 2 legs passent au même chauffeur, les 2 clients sont notifiés.
      if (off.pool_id) {
        const legs = await poolStillOpen(sb, off.pool_id);
        if (!legs) return json({ ok: false, reason: 'taken' });
        const { data: n } = await sb.rpc('assign_pool_driver', {
          p_pool: off.pool_id, p_driver: off.driver_id, p_nom: nom, p_photo: prof?.photo_url ?? null, p_vehicule: vehicule, p_plaque: plaque,
        });
        if (!n || n < 2) return json({ ok: false, reason: 'assign_failed' });
        await sb.from('ride_offers').update({ status: 'accepted' }).eq('id', offerId);
        await sb.from('ride_offers').update({ status: 'expired' }).eq('pool_id', off.pool_id).eq('status', 'pending');
        for (const l of legs) await push(l.user_id, 'Chauffeur trouvé !', `${nom} arrive · course partagée.`);
        return json({ ok: true, pool: off.pool_id, rideId: off.ride_id });
      }

      const { data: ride } = await sb.from('rides').select('*').eq('id', off.ride_id).single();
      if (!ride || ride.driver_id) return json({ ok: false, reason: 'taken' });
      const veh1 = vehicule !== 'Véhicule Taga' ? vehicule : (ride.vehicule || 'Véhicule Taga');
      // Claim ATOMIQUE : on vérifie qu'une ligne a RÉELLEMENT été prise (0 ligne = déjà pris par un
      // autre chauffeur — un update de 0 ligne n'est PAS une erreur, il faut le détecter explicitement).
      const { data: claimed, error } = await sb.from('rides').update({ driver_id: off.driver_id, chauffeur_nom: nom, chauffeur_photo: prof?.photo_url ?? null, vehicule: veh1, plaque, statut: 'en_route' }).eq('id', ride.id).eq('statut', 'recherche').is('driver_id', null).select('id');
      if (error) return json({ ok: false, reason: 'assign_failed' });
      if (!claimed || claimed.length === 0) { await sb.from('ride_offers').update({ status: 'expired' }).eq('id', offerId).eq('status', 'pending'); return json({ ok: false, reason: 'taken' }); }
      await sb.from('ride_offers').update({ status: 'accepted' }).eq('id', offerId);
      await sb.from('ride_offers').update({ status: 'expired' }).eq('ride_id', ride.id).eq('status', 'pending');
      await push(ride.user_id, 'Chauffeur trouvé !', `${nom} arrive vers toi.`);
      return json({ ok: true, rideId: ride.id });
    }

    if (action === 'start-delivery') {
      const { data: order } = await sb.from('orders').select('*').eq('id', orderId).single();
      if (!order) return json({ ok: false, reason: 'no_order' }, 404);
      if (!DELIV_STATES.includes(order.statut) || order.driver_id) return json({ ok: false, reason: 'not_open' });
      if (await hasActiveDeliveryOffer(sb, orderId)) return json({ ok: true, already: true });
      return json({ ok: true, offered: await offerNextDelivery(sb, order) });
    }
    if (action === 'decline-delivery' || action === 'expire-delivery') {
      const { data: off } = await sb.from('delivery_offers').select('*').eq('id', offerId).single();
      if (!off) return json({ ok: false, reason: 'no_offer' }, 404);
      await sb.from('delivery_offers').update({ status: action === 'expire-delivery' ? 'expired' : 'declined' }).eq('id', offerId).eq('status', 'pending');
      const { data: order } = await sb.from('orders').select('*').eq('id', off.order_id).single();
      if (!order || !DELIV_STATES.includes(order.statut) || order.driver_id) return json({ ok: true, done: true });
      if (await hasActiveDeliveryOffer(sb, off.order_id)) return json({ ok: true, already: true });
      return json({ ok: true, reoffered: await offerNextDelivery(sb, order) });
    }
    if (action === 'accept-delivery') {
      const { data: off } = await sb.from('delivery_offers').select('*').eq('id', offerId).single();
      if (!off) return json({ ok: false, reason: 'no_offer' }, 404);
      if (off.status !== 'pending') return json({ ok: false, reason: 'expired' });
      const { data: order } = await sb.from('orders').select('*').eq('id', off.order_id).single();
      if (!order || order.driver_id) return json({ ok: false, reason: 'taken' });
      const { data: prof } = await sb.from('profiles').select('prenom,nom,phone,photo_url').eq('id', off.driver_id).maybeSingle();
      const nom = `${prof?.prenom ?? ''} ${prof?.nom ?? ''}`.trim() || 'Livreur';
      const { data: oclaim, error } = await sb.from('orders').update({ driver_id: off.driver_id, livreur_nom: nom, livreur_tel: prof?.phone ?? null, livreur_photo: prof?.photo_url ?? null }).eq('id', order.id).in('statut', DELIV_STATES).is('driver_id', null).select('id');
      if (error) return json({ ok: false, reason: 'assign_failed' });
      if (!oclaim || oclaim.length === 0) { await sb.from('delivery_offers').update({ status: 'expired' }).eq('id', offerId).eq('status', 'pending'); return json({ ok: false, reason: 'taken' }); }
      await sb.from('delivery_offers').update({ status: 'accepted' }).eq('id', offerId);
      await sb.from('delivery_offers').update({ status: 'expired' }).eq('order_id', order.id).eq('status', 'pending');
      await push(order.user_id, 'Livreur assigné', `${nom} prend ta commande en charge.`);
      return json({ ok: true, orderId: order.id });
    }

    return json({ ok: false, reason: 'bad_action' }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
