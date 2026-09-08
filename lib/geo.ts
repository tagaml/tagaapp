/* geo.ts — adresses & itinéraires via OpenStreetMap.
   Recherche d'adresse : Photon (komoot, gratuit, sans clé).
   Itinéraire/ETA : OpenRouteService si une clé est fournie (fiable), sinon repli OSRM public. */

export type GeoPoint = { latitude: number; longitude: number };
export type GeoPlace = { id: string; label: string; sub: string; point: GeoPoint; icon: string };
export type GeoRoute = { distanceKm: number; durationMin: number; coords: GeoPoint[] };

// Centre de Bamako (repli) pour biaiser les résultats de recherche.
const BAMAKO = { lat: 12.6392, lon: -8.0029 };

// Centre de biais RÉEL de la recherche d'adresse : par défaut Bamako, mais mis à jour sur la
// position réelle de l'utilisateur (utile pour tester depuis l'étranger — voir setSearchBias).
let searchBias = { lat: BAMAKO.lat, lon: BAMAKO.lon };
/** Recentre l'autocomplétion d'adresse sur une position (ta vraie position, par ex.). */
export function setSearchBias(lat: number, lon: number): void {
  if (typeof lat === 'number' && typeof lon === 'number') searchBias = { lat, lon };
}

// Clé OpenRouteService (routage fiable et gratuit). Deux façons de la fournir :
//  1) variable d'env EXPO_PUBLIC_ORS_KEY (recommandé, gérée par eas.json / .env)
//  2) collée directement dans ORS_KEY_FALLBACK ci-dessous.
const ORS_KEY_FALLBACK = ''; // ← colle ta clé ORS ici si tu ne passes pas par les variables d'env
const ORS_KEY = process.env.EXPO_PUBLIC_ORS_KEY || ORS_KEY_FALLBACK;

// Routage via OpenRouteService (POST + GeoJSON). Renvoie null si pas de clé ou en cas d'échec.
async function orsRoute(points: GeoPoint[], ms: number): Promise<GeoRoute | null> {
  if (!ORS_KEY) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/geo+json', Authorization: ORS_KEY },
      body: JSON.stringify({ coordinates: points.map((p) => [p.longitude, p.latitude]) }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = await res.json();
    const f = json.features?.[0];
    if (!f) return null;
    const summary = f.properties?.summary ?? {};
    const coords = (f.geometry?.coordinates ?? []).map((c: number[]) => ({ latitude: c[1], longitude: c[0] }));
    if (coords.length < 2) return null;
    return {
      distanceKm: (summary.distance ?? 0) / 1000,
      durationMin: Math.max(1, Math.round((summary.duration ?? 0) / 60)),
      coords,
    };
  } catch {
    return null;
  }
}

// fetch avec délai max (évite de bloquer l'UI si un service est lent/indisponible).
async function fetchT(url: string, ms: number): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

/** Autocomplétion d'adresse (réelle) autour de Bamako. */
export async function searchPlaces(q: string): Promise<GeoPlace[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${searchBias.lat}&lon=${searchBias.lon}&limit=6&lang=fr`;
    const res = await fetchT(url, 6000);
    if (!res || !res.ok) return [];
    const json = await res.json();
    return (json.features ?? []).map((f: any, i: number): GeoPlace => {
      const coords = f.geometry?.coordinates ?? [BAMAKO.lon, BAMAKO.lat];
      const p = f.properties || {};
      const label = p.name || p.street || p.city || 'Lieu';
      const sub = [p.street && p.name !== p.street ? p.street : null, p.district, p.city, p.state, p.country]
        .filter(Boolean)
        .join(', ');
      return {
        id: String(p.osm_id ?? `${coords[0]},${coords[1]}_${i}`),
        label,
        sub,
        point: { latitude: coords[1], longitude: coords[0] },
        icon: 'location-outline',
      };
    });
  } catch {
    return [];
  }
}

/**
 * Adresse réelle d'un point (reverse geocoding) via Photon/OSM — bien meilleure couverture
 * à Bamako que le géocodeur natif. Renvoie une ligne « n° rue, quartier, ville » ou null.
 */
export async function reverseGeocode(pt: GeoPoint): Promise<string | null> {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${pt.latitude}&lon=${pt.longitude}&lang=fr`;
    const res = await fetchT(url, 6000);
    if (res && res.ok) {
      const json = await res.json();
      const p = json.features?.[0]?.properties;
      if (p) {
        const rue = [p.housenumber, p.street].filter(Boolean).join(' ');
        const line = [rue || p.name, p.district || p.suburb || p.locality, p.city || p.county]
          .filter(Boolean)
          .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i)
          .join(', ');
        if (line) return line;
      }
    }
  } catch { /* repli */ }
  return null;
}

/** Itinéraire passant par plusieurs points (départ → arrêts → destination). */
export async function routeVia(points: GeoPoint[]): Promise<GeoRoute | null> {
  try {
    const valid = (points || []).filter((p) => p && typeof p.latitude === 'number' && typeof p.longitude === 'number');
    if (valid.length < 2) return null;
    // ORS d'abord (fiable), repli OSRM public ensuite.
    const ors = await orsRoute(valid, 9000);
    if (ors) return ors;
    const coordStr = valid.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
    const res = await fetchT(url, 9000);
    if (!res || !res.ok) return null;
    const json = await res.json();
    const r = json.routes?.[0];
    if (!r) return null;
    return {
      distanceKm: r.distance / 1000,
      durationMin: Math.max(1, Math.round(r.duration / 60)),
      coords: (r.geometry?.coordinates ?? []).map((c: number[]) => ({ latitude: c[1], longitude: c[0] })),
    };
  } catch {
    return null;
  }
}

/* ===================== Cap (orientation d'un véhicule sur la carte) ===================== */

/** Distance en mètres entre deux points (Haversine). */
function metresEntre(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const la1 = rad(a.latitude);
  const la2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Relèvement (cap) de `a` vers `b`, en degrés : 0 = nord, 90 = est, 180 = sud, 270 = ouest.
 * Formule standard du grand cercle. C'est exactement l'angle qu'attend `rotate: ${cap}deg`
 * sur les icônes vues du dessus (dessinées nez vers le haut).
 */
export function bearing(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const la1 = rad(a.latitude);
  const la2 = rad(b.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Cap DÉRIVÉ DU MOUVEMENT réel (repli honnête quand le GPS ne fournit pas de cap : véhicule à
 * l'arrêt, appareil sans magnétomètre, position relayée par la base de données…).
 * Renvoie `null` — et JAMAIS 0, qui ferait pointer le véhicule plein nord à tort — si :
 *   - on n'a pas de point précédent,
 *   - le véhicule n'a pas bougé d'au moins `minM` mètres (bruit GPS à l'arrêt → cap aléatoire),
 *   - le saut dépasse `maxM` mètres (premier point GPS réel après un repli : c'est un saut de
 *     position, pas un déplacement — en calculer un cap serait une invention).
 * L'appelant doit alors CONSERVER le dernier cap connu.
 */
export function moveHeading(
  prev: GeoPoint | null | undefined,
  next: GeoPoint,
  minM = 5,
  maxM = 1000,
): number | null {
  if (!prev) return null;
  const d = metresEntre(prev, next);
  if (d < minM || d > maxM) return null;
  return bearing(prev, next);
}

/** Itinéraire routier réel entre deux points : distance, durée et tracé. */
export async function routeBetween(from: GeoPoint, to: GeoPoint): Promise<GeoRoute | null> {
  try {
    // ORS d'abord (fiable), repli OSRM public ensuite.
    const ors = await orsRoute([from, to], 8000);
    if (ors) return ors;
    const url = `https://router.project-osrm.org/route/v1/driving/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson`;
    const res = await fetchT(url, 8000);
    if (!res || !res.ok) return null;
    const json = await res.json();
    const r = json.routes?.[0];
    if (!r) return null;
    return {
      distanceKm: r.distance / 1000,
      durationMin: Math.max(1, Math.round(r.duration / 60)),
      coords: (r.geometry?.coordinates ?? []).map((c: number[]) => ({ latitude: c[1], longitude: c[0] })),
    };
  } catch {
    return null;
  }
}
