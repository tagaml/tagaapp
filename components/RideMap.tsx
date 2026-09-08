import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import MapView, { PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { router } from 'expo-router';
import { colors, radius, shadow, space } from '../theme';
import { TripMap, placesBamako } from './TripMap';
import { Btn } from './ui';
import { searchPlaces, routeBetween, routeVia, setSearchBias, reverseGeocode, type GeoRoute } from '../lib/geo';
import { getNearbyDrivers, getRecentDestinations, getNearbyRadiusKm, getAddresses, repairAddressCoords, type Address } from '../lib/db';
import { RESTRICT_TO_MALI, inMaliBox } from '../lib/geoGuard';

type AdjustKind = 'pickup' | 'dest' | 'stop0' | 'stop1';

// Voitures d'ambiance : quand AUCUN chauffeur réel n'est en ligne dans le rayon, on affiche quand
// même quelques véhicules autour du départ pour que la carte ne soit jamais vide. Repli purement
// VISUEL (non contractuel) : dès qu'un vrai chauffeur est en ligne, on n'affiche QUE les vrais.
// Positions déterministes (dérivées du départ) → les voitures ne « sautent » pas à chaque refresh.
function ambientDrivers(origin: { latitude: number; longitude: number }): { latitude: number; longitude: number; heading?: number }[] {
  let s = (Math.abs((Math.round(origin.latitude * 1000) * 73856093) ^ (Math.round(origin.longitude * 1000) * 19349663)) || 1) >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const n = 5;
  const out: { latitude: number; longitude: number; heading?: number }[] = [];
  const cosLat = Math.cos((origin.latitude * Math.PI) / 180) || 1;
  for (let i = 0; i < n; i++) {
    const bearing = (i / n) * 2 * Math.PI + rnd() * 0.9;
    const distKm = 0.25 + rnd() * 0.65; // entre ~250 m et ~900 m du départ
    out.push({
      latitude: origin.latitude + (distKm / 111) * Math.cos(bearing),
      longitude: origin.longitude + (distKm / (111 * cosLat)) * Math.sin(bearing),
      heading: Math.round(rnd() * 360),
    });
  }
  return out;
}

/* ============ Adresses enregistrées : « maison », « boulot »… ============
   Le client tape « maison » : on doit lui proposer SON adresse enregistrée
   (coordonnées GPS exactes), pas un géocodage libre qui renvoie n'importe quoi. */

/** Minuscules + accents retirés, pour comparer « École » et « ecole ». */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "") // retire les accents combinants
    .toLowerCase()
    .trim();
}

// Synonymes courants : le libellé enregistré peut différer du mot tapé.
// (« domicile » doit trouver le libellé « Maison », « boulot » → « Travail »…)
const SYNONYMES: Record<string, string[]> = {
  maison: ['maison', 'domicile', 'chez moi', 'home', 'kunu'],
  travail: ['travail', 'boulot', 'bureau', 'job', 'work'],
  ecole: ['ecole', 'school', 'fac', 'universite', 'lycee', 'campus'],
};

/** Icône selon le libellé enregistré (maison / mallette / sac d'école). */
function iconeAdresse(label: string): string {
  const n = normalise(label);
  if (SYNONYMES.maison.some((m) => n.includes(m))) return 'home';
  if (SYNONYMES.travail.some((m) => n.includes(m))) return 'briefcase';
  if (SYNONYMES.ecole.some((m) => n.includes(m))) return 'school';
  return 'bookmark';
}

/** Une adresse enregistrée correspond-elle à ce que le client tape ? */
function correspond(a: Address, requete: string): boolean {
  const q = normalise(requete);
  if (!q) return false;
  const label = normalise(a.label);
  const detail = normalise(a.detail ?? '');
  if (label.includes(q) || detail.includes(q)) return true;
  // Le mot tapé est un synonyme d'une famille ; le libellé appartient-il à la même famille ?
  for (const mots of Object.values(SYNONYMES)) {
    const requeteDansFamille = mots.some((m) => m.startsWith(q) || q.startsWith(m));
    const labelDansFamille = mots.some((m) => label.includes(m));
    if (requeteDansFamille && labelDansFamille) return true;
  }
  return false;
}

/** Adresse enregistrée -> Place utilisable directement (GPS exact, aucun géocodage). */
function versPlace(a: Address): Place {
  return {
    id: `saved:${a.id}`,
    label: a.label,
    sub: a.detail ?? '',
    point: { latitude: a.lat as number, longitude: a.lng as number },
    icon: iconeAdresse(a.label),
  };
}

type Pt = { latitude: number; longitude: number };
export type Place = { id: string; label: string; sub: string; point: Pt; icon: string };

export function RideMap({
  vehicle,
  defaultOrigin,
  height = 200,
  onChange,
  pickupEditable = false,
  departCaption,
  destCaption,
  destPrompt = 'Où vas-tu ?',
  allowStops = false,
  initialDest = null,
}: {
  vehicle: 'car' | 'moto';
  defaultOrigin: Pt;
  height?: number;
  onChange?: (dest: Place | null, origin: Pt, route?: GeoRoute | null, stops?: Place[], departLabel?: string) => void;
  pickupEditable?: boolean;
  departCaption?: string;
  destCaption?: string;
  destPrompt?: string;
  allowStops?: boolean;
  initialDest?: Place | null; // destination pré-remplie (ex : « Refaire ce trajet »)
}) {
  const [myLoc, setMyLoc] = useState<Pt | null>(null);
  const [myAddr, setMyAddr] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'denied'>('loading');
  const [dest, setDest] = useState<Place | null>(initialDest);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [picker, setPicker] = useState<'dest' | 'pickup' | 'stop0' | 'stop1' | null>(null);
  const [route, setRoute] = useState<GeoRoute | null>(null);
  const [nearby, setNearby] = useState<Pt[]>([]);
  const [nearbyR, setNearbyR] = useState(6); // rayon d'affichage des chauffeurs (réglable admin)
  useEffect(() => { getNearbyRadiusKm().then(setNearbyR).catch(() => {}); }, []);
  const [recenterN, setRecenterN] = useState(0); // bouton crosshair → recentre sur le départ
  const [adjust, setAdjust] = useState<{ kind: AdjustKind; point: Pt; label: string } | null>(null);
  const [recents, setRecents] = useState<Place[]>([]);

  // Destinations récentes (façon Uber) pour les suggestions.
  useEffect(() => { getRecentDestinations().then((r) => setRecents(r as Place[])).catch(() => {}); }, []);

  // Active la géolocalisation au chargement
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setStatus('denied'); return; }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        // Restriction Mali activée : hors du Mali on ignore la position et on reste sur Bamako.
        if (RESTRICT_TO_MALI && !inMaliBox(pos.coords.latitude, pos.coords.longitude)) { setStatus('ok'); return; }
        setMyLoc({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setSearchBias(pos.coords.latitude, pos.coords.longitude); // l'autocomplétion suit ta vraie position
        setStatus('ok');
        // Géocodage inverse : vraie adresse de rue (Photon/OSM d'abord, meilleure couverture Bamako).
        try {
          let label = await reverseGeocode({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          if (!label) {
            const g = (await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }))[0];
            if (g) label = [g.name || g.street, g.district || g.city].filter(Boolean).join(', ');
          }
          if (label) setMyAddr(label);
        } catch { /* garde « Ma position » */ }
      } catch {
        setStatus('denied');
      }
    })();
  }, []);

  const origin = pickup?.point ?? myLoc ?? defaultOrigin;

  // Libellé de départ RÉSOLU (adresse réelle) à remonter au parent — undefined si encore inconnu
  // (localisation en cours / refusée), pour que le parent retombe sur « Ma position ».
  const departLabelResolved = pickup ? pickup.label : status === 'ok' ? (myAddr ?? undefined) : undefined;

  // Clé qui change dès qu'un arrêt est ajouté/retiré/déplacé.
  const stopsKey = stops.map((s) => `${s.point.latitude},${s.point.longitude}`).join('|');

  // Calcule l'itinéraire routier réel (OSRM) : départ → arrêt(s) → destination.
  useEffect(() => {
    let actif = true;
    if (!dest) { setRoute(null); return; }
    const pts = [origin, ...stops.map((s) => s.point), dest.point];
    const p = pts.length > 2 ? routeVia(pts) : routeBetween(origin, dest.point);
    p.then((r) => { if (actif) setRoute(r); }).catch(() => {});
    return () => { actif = false; };
  }, [dest, origin.latitude, origin.longitude, stopsKey]);

  useEffect(() => { onChange?.(dest, origin, route, stops, departLabelResolved); }, [dest, route, origin.latitude, origin.longitude, stopsKey, departLabelResolved]);

  // Affiche les vrais chauffeurs en ligne autour de toi (rafraîchi toutes les 10 s).
  useEffect(() => {
    let on = true;
    // Chauffeurs du bon type : voitures pour un taxi, motos pour une moto/livraison.
    const refresh = () => getNearbyDrivers(origin, nearbyR, vehicle).then((d) => { if (on) setNearby(d); }).catch(() => {});
    refresh();
    const iv = setInterval(refresh, 10000);
    return () => { on = false; clearInterval(iv); };
  }, [origin.latitude, origin.longitude, vehicle, nearbyR]);

  // Véhicules affichés : les VRAIS chauffeurs en ligne s'il y en a, sinon des voitures d'ambiance
  // qui DÉRIVENT lentement autour du départ (la carte n'est jamais figée ni vide). Dès qu'un vrai
  // chauffeur passe en ligne, on n'affiche QUE les vrais.
  const [ambient, setAmbient] = useState<{ latitude: number; longitude: number; heading?: number }[]>([]);
  const ambientRef = useRef<{ latitude: number; longitude: number; heading: number }[]>([]);
  const originKey = `${origin.latitude.toFixed(3)},${origin.longitude.toFixed(3)}`;
  useEffect(() => {
    if (nearby.length > 0) { ambientRef.current = []; setAmbient([]); return; } // vrais chauffeurs → pas d'ambiance
    const cosLat = Math.cos((origin.latitude * Math.PI) / 180) || 1;
    ambientRef.current = ambientDrivers(origin).map((d) => ({ latitude: d.latitude, longitude: d.longitude, heading: d.heading ?? 0 }));
    setAmbient(ambientRef.current.map((d) => ({ ...d })));
    // Chaque voiture avance de ~15–35 m toutes les 1,2 s, avec de légers virages, et se réoriente
    // vers le départ si elle s'éloigne de plus d'~1 km → mouvement crédible, borné autour du client.
    const iv = setInterval(() => {
      ambientRef.current = ambientRef.current.map((d) => {
        let h = d.heading + (Math.random() - 0.5) * 26;
        const stepKm = 0.015 + Math.random() * 0.02;
        const lat = d.latitude + (stepKm / 111) * Math.cos((h * Math.PI) / 180);
        const lng = d.longitude + (stepKm / (111 * cosLat)) * Math.sin((h * Math.PI) / 180);
        const dNorthKm = (lat - origin.latitude) * 111;
        const dEastKm = (lng - origin.longitude) * 111 * cosLat;
        if (Math.hypot(dNorthKm, dEastKm) > 1) {
          h = (Math.atan2(origin.longitude - lng, origin.latitude - lat) * 180) / Math.PI;
        }
        return { latitude: lat, longitude: lng, heading: (h + 360) % 360 };
      });
      setAmbient(ambientRef.current.map((d) => ({ ...d })));
    }, 1200);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearby.length, originKey]);
  const driversShown = nearby.length > 0 ? nearby : ambient;

  const departLabel = pickup
    ? pickup.label
    : status === 'ok' ? (myAddr ?? 'Ma position') : status === 'loading' ? 'Localisation en cours…' : 'Position non autorisée';

  // Inverse départ ↔ destination (trajet retour).
  const inverser = () => {
    if (!dest) return;
    const dep: Place = pickup ?? { id: 'me', label: myAddr || 'Ma position', sub: '', point: origin, icon: 'locate' };
    setStops([]);
    setPickup(dest);
    setDest(dep);
  };

  return (
    <View style={{ paddingHorizontal: space.lg }}>
      <TripMap
        origin={origin}
        destination={dest?.point}
        routeCoords={route?.coords}
        stops={stops.map((s) => s.point)}
        drivers={driversShown}
        height={height}
        vehicle={vehicle}
        recenterKey={recenterN}
        fitRoute
        abMarkers
        /* UN SEUL repère « moi » : avant destination, le point bleu custom (`self`) — jamais le point
           bleu NATIF en plus (il se dessine par-dessus tout et n'est pas pilotable). Une fois la
           destination posée, on n'affiche plus que les repères A/B : plus aucun doublon.
           Les chauffeurs proches collés à A ou à B sont écartés par TripMap → aucun véhicule
           n'est dessiné sous un repère. */
        self={dest ? undefined : origin}
      />

      {/* Carte départ / destination */}
      <View style={st.card}>
        <Pressable
          style={st.row}
          disabled={!pickupEditable}
          onPress={() => setPicker('pickup')}
        >
          <View style={st.departDot}>
            {status === 'loading' && !pickup ? <ActivityIndicator size="small" color={colors.ink} /> : <View style={st.departInner} />}
          </View>
          <View style={{ flex: 1 }}>
            {departCaption ? <Text style={st.caption}>{departCaption}</Text> : null}
            <Text style={[st.rowText, !pickup && status !== 'ok' && { color: colors.inkSoft }]} numberOfLines={1}>{departLabel}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable hitSlop={10} onPress={() => setAdjust({ kind: 'pickup', point: origin, label: departLabel })} style={st.adjBtn}>
              <Ionicons name="location" size={16} color={colors.brand} />
            </Pressable>
            {status === 'ok' ? (
              <Pressable hitSlop={12} onPress={() => setRecenterN((n) => n + 1)} style={st.recenter}>
                <Ionicons name="locate" size={18} color={colors.green} />
              </Pressable>
            ) : null}
          </View>
        </Pressable>

        {stops.map((s, i) => (
          <View key={i}>
            <View style={st.connector} />
            <View style={st.row}>
              <View style={st.stopDot}><View style={st.stopInner} /></View>
              <Pressable style={{ flex: 1 }} onPress={() => setPicker(i === 0 ? 'stop0' : 'stop1')}>
                <Text style={st.caption}>Stop {i + 1}</Text>
                <Text style={st.rowText} numberOfLines={1}>{s.label}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setAdjust({ kind: i === 0 ? 'stop0' : 'stop1', point: s.point, label: s.label })} style={st.adjBtn}>
                <Ionicons name="location" size={16} color={colors.brand} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => setStops((arr) => arr.filter((_, j) => j !== i))}>
                <Ionicons name="close-circle" size={20} color={colors.inkMute} />
              </Pressable>
            </View>
          </View>
        ))}

        {allowStops && stops.length < 2 ? (
          <>
            <View style={st.connector} />
            <Pressable style={st.row} onPress={() => setPicker(stops.length === 0 ? 'stop0' : 'stop1')}>
              <View style={st.addDot}><Ionicons name="add" size={15} color={colors.brand} /></View>
              <Text style={[st.rowText, { color: colors.brand }]}>Ajouter un stop</Text>
            </Pressable>
          </>
        ) : null}

        <View style={st.connector} />

        <Pressable style={st.row} onPress={() => setPicker('dest')}>
          <View style={st.destWrap}><View style={st.destSquare} /></View>
          <View style={{ flex: 1 }}>
            {destCaption ? <Text style={st.caption}>{destCaption}</Text> : null}
            <Text style={[st.rowText, !dest && { color: colors.inkMute }]} numberOfLines={1}>
              {dest ? dest.label : destPrompt}
            </Text>
          </View>
          {dest ? (
            <Pressable hitSlop={8} onPress={() => setAdjust({ kind: 'dest', point: dest.point, label: dest.label })} style={st.adjBtn}>
              <Ionicons name="location" size={16} color={colors.brand} />
            </Pressable>
          ) : <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />}
        </Pressable>

        {/* Bouton inverser départ ↔ destination (trajet retour) */}
        {dest && stops.length === 0 ? (
          <Pressable style={st.swapBtn} onPress={inverser} hitSlop={8} accessibilityLabel="Inverser le trajet">
            <Ionicons name="swap-vertical" size={18} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      <DestinationPicker
        open={picker !== null}
        title={picker === 'pickup' ? 'Adresse de départ' : (picker === 'stop0' || picker === 'stop1') ? 'Adresse du stop' : destPrompt}
        recents={recents}
        onPickOnMap={() => {
          const k = picker; if (!k) return;
          const seed: Pt = k === 'pickup' ? origin
            : k === 'dest' ? (dest?.point ?? myLoc ?? origin)
            : ((k === 'stop0' ? stops[0]?.point : stops[1]?.point) ?? myLoc ?? origin);
          setPicker(null);
          setAdjust({ kind: k, point: seed, label: '' });
        }}
        onClose={() => setPicker(null)}
        onSelect={(p) => {
          if (picker === 'pickup') setPickup(p);
          else if (picker === 'stop0' || picker === 'stop1') {
            const idx = picker === 'stop0' ? 0 : 1;
            setStops((arr) => { const n = arr.slice(); n[idx] = p; return n; });
          } else setDest(p);
          setPicker(null);
        }}
      />

      <AdjustOnMap
        open={adjust !== null}
        initial={adjust?.point ?? origin}
        title={adjust?.kind === 'pickup' ? 'Ajuster le départ' : adjust?.kind === 'dest' ? "Ajuster l'arrivée" : 'Ajuster le stop'}
        onClose={() => setAdjust(null)}
        onConfirm={(pt, label) => {
          const k = adjust?.kind;
          const place: Place = { id: 'adj', label, sub: 'Ajusté sur la carte', point: pt, icon: 'location' };
          if (k === 'pickup') setPickup(place);
          else if (k === 'dest') setDest({ ...(dest as Place), point: pt, label, sub: 'Ajusté sur la carte' });
          else if (k === 'stop0' || k === 'stop1') {
            const idx = k === 'stop0' ? 0 : 1;
            setStops((arr) => { const n = arr.slice(); n[idx] = place; return n; });
          }
          setAdjust(null);
        }}
      />
    </View>
  );
}

// Ajuste un point EXACT en déplaçant la carte sous un repère central fixe.
// (Indispensable à Bamako où les adresses de rue sont approximatives.)
export function AdjustOnMap({ open, initial, title, onClose, onConfirm }: {
  open: boolean; initial: Pt; title: string; onClose: () => void; onConfirm: (pt: Pt, label: string) => void;
}) {
  const centerRef = useRef<Pt>(initial);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets(); // valeurs correctes même dans un Modal (via le contexte)
  useEffect(() => { if (open) centerRef.current = initial; }, [open, initial.latitude, initial.longitude]);
  const region: Region = { latitude: initial.latitude, longitude: initial.longitude, latitudeDelta: 0.006, longitudeDelta: 0.006 };

  const confirmer = async () => {
    setBusy(true);
    const c = centerRef.current;
    let label = '';
    // 1) Photon/OSM (bonne couverture Bamako) → 2) géocodeur natif → 3) coordonnées.
    try { const l = await reverseGeocode({ latitude: c.latitude, longitude: c.longitude }); if (l) label = l; } catch { /* repli */ }
    if (!label) {
      try {
        const g = (await Location.reverseGeocodeAsync(c))[0];
        if (g) { const l = [g.name || g.street, g.district || g.city].filter(Boolean).join(', '); if (l) label = l; }
      } catch { /* repli */ }
    }
    if (!label) label = `Point sur la carte (${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)})`;
    setBusy(false);
    onConfirm(c, label);
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <MapView
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton={false}
          onRegionChangeComplete={(r) => { centerRef.current = { latitude: r.latitude, longitude: r.longitude }; }}
        />
        {/* Repère central fixe = le point choisi (au centre exact de la carte). */}
        <View pointerEvents="none" style={st.centerPin}>
          <View style={st.centerRing}><View style={st.centerDot} /></View>
          <View style={st.centerStem} />
        </View>

        <View style={[st.adjTop, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={10} style={st.adjClose}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <View style={st.adjTitleWrap}><Text style={st.adjTitle} numberOfLines={1}>{title}</Text></View>
        </View>

        <View style={[st.adjBottom, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <Text style={st.adjHint}>Déplace la carte pour placer le repère sur le point exact, puis confirme.</Text>
          <Btn label="Confirmer ce point" loading={busy} onPress={confirmer} />
        </View>
      </View>
    </Modal>
  );
}

export function DestinationPicker({ open, onClose, onSelect, onPickOnMap, title = 'Où vas-tu ?', recents = [] }: { open: boolean; onClose: () => void; onSelect: (p: Place) => void; onPickOnMap?: () => void; title?: string; recents?: Place[] }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [saved, setSaved] = useState<Address[]>([]);
  const insets = useSafeAreaInsets();

  // Réinitialise à l'ouverture + charge les adresses enregistrées du client.
  useEffect(() => {
    if (!open) return;
    let actif = true;
    setQ('');
    setResults([]);

    (async () => {
      try {
        const list = await getAddresses();
        // On ne garde que celles qui ont de vraies coordonnées : sinon on ne peut pas
        // sauter le géocodage, ce qui est tout l'intérêt.
        const avecGps = list.filter((a) => a.lat != null && a.lng != null);
        if (actif) setSaved(avecGps);

        // Adresses anciennes sans coordonnées : on les géocode une fois, puis on les
        // réintègre à la liste (sinon la « Maison » du client n'apparaîtrait jamais).
        if (list.length !== avecGps.length) {
          const repares = await repairAddressCoords(list);
          if (repares > 0 && actif) {
            const maj = await getAddresses();
            if (actif) setSaved(maj.filter((a) => a.lat != null && a.lng != null));
          }
        }
      } catch {
        if (actif) setSaved([]);
      }
    })();

    return () => { actif = false; };
  }, [open]);

  // Adresses enregistrées correspondant à la saisie -> TOUJOURS en tête de liste.
  const savedMatches = React.useMemo(
    () => (q.trim() ? saved.filter((a) => correspond(a, q)).map(versPlace) : []),
    [q, saved],
  );

  // Recherche d'adresse réelle (OpenStreetMap / Photon), avec anti-rebond.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchPlaces(query);
      setResults(r);
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  // Dès 1 caractère on peut déjà proposer une adresse enregistrée ("m" -> Maison),
  // alors que le géocodeur, lui, n'est interrogé qu'à partir de 3 caractères.
  const showSuggestions = q.trim().length === 0;

  const renderPlace = (p: Place) => {
    const isRecent = p.icon === 'time';
    const isSaved = p.id.startsWith('saved:');
    return (
      <Pressable key={p.id} style={st.place} onPress={() => onSelect(p)}>
        <View style={[st.placeIcon, isRecent && st.placeIconRecent, isSaved && st.placeIconSaved]}>
          <Ionicons name={p.icon as any} size={19} color={isRecent || isSaved ? colors.brand : colors.ink2} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={st.placeLabelRow}>
            <Text style={st.placeLabel} numberOfLines={1}>{p.label}</Text>
            {isSaved ? (
              <View style={st.savedBadge}><Text style={st.savedBadgeText}>Enregistré</Text></View>
            ) : null}
          </View>
          {p.sub ? <Text style={st.placeSub} numberOfLines={1}>{p.sub}</Text> : null}
        </View>
        <Ionicons name="arrow-up-outline" size={16} color={colors.inkMute} style={{ transform: [{ rotate: '45deg' }] }} />
      </Pressable>
    );
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={[st.pickerScreen, { paddingTop: insets.top }]}>
        <View style={st.pickerHead}>
          <Pressable onPress={onClose} hitSlop={10} style={st.pickerBack}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <Text style={st.pickerTitle} numberOfLines={1}>{title}</Text>
        </View>

        <View style={st.searchWrap}>
          <View style={st.search}>
            <Ionicons name="search" size={18} color={colors.inkMute} />
            <TextInput
              placeholder="Chercher une adresse à Bamako…"
              placeholderTextColor={colors.inkMute}
              value={q}
              onChangeText={setQ}
              autoFocus
              returnKeyType="search"
              style={st.searchInput}
            />
            {searching ? <ActivityIndicator size="small" color={colors.inkMute} />
              : q.length > 0 ? <Pressable hitSlop={8} onPress={() => setQ('')}><Ionicons name="close-circle" size={18} color={colors.inkMute} /></Pressable>
              : null}
          </View>
        </View>

        {onPickOnMap ? (
          <Pressable style={st.mapPick} onPress={onPickOnMap}>
            <View style={st.mapPickIcon}><Ionicons name="location" size={19} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.mapPickText}>Choisir le point sur la carte</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
          </Pressable>
        ) : null}

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 24 }}>
          {showSuggestions ? (
            <>
              {/* Champ vide : on montre d'emblée les adresses enregistrées (Maison, Travail…). */}
              {saved.length > 0 ? (
                <>
                  <Text style={st.hint}>Mes adresses</Text>
                  {saved.map((a) => renderPlace(versPlace(a)))}
                </>
              ) : null}
              {recents.length > 0 ? (
                <>
                  <Text style={st.hint}>Récents</Text>
                  {recents.map(renderPlace)}
                </>
              ) : null}
              <Text style={st.hint}>Lieux populaires</Text>
              {(placesBamako as unknown as Place[]).map(renderPlace)}
            </>
          ) : (
            <>
              {/* Adresses enregistrées d'abord : « maison » doit tomber sur SA maison. */}
              {savedMatches.length > 0 ? (
                <>
                  <Text style={st.hint}>Mes adresses</Text>
                  {savedMatches.map(renderPlace)}
                </>
              ) : null}

              {results.length > 0 ? (
                <>
                  {savedMatches.length > 0 ? <Text style={st.hint}>Autres résultats</Text> : null}
                  {results.map(renderPlace)}
                </>
              ) : null}

              {!searching && results.length === 0 && savedMatches.length === 0 && q.trim().length >= 3 && (
                <Text style={st.noResult}>Aucune adresse trouvée. Essaie un autre nom.</Text>
              )}

              <Pressable style={st.addFav} onPress={() => { onClose(); router.push('/address-form'); }}>
                <Ionicons name="add-circle-outline" size={18} color={colors.brand} />
                <Text style={st.addFavText}>Ajouter cette adresse à mes favoris</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  card: { marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 2, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 5 },
  rowText: { fontSize: 14, fontWeight: '700', color: colors.ink },
  caption: { fontSize: 10.5, fontWeight: '800', color: colors.inkMute, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  recenter: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(19,122,75,0.12)', alignItems: 'center', justifyContent: 'center' },
  adjBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  centerPin: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  centerRing: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#1A73E8', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#fff', ...shadow.pop },
  centerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  centerStem: { width: 2, height: 16, backgroundColor: '#1A73E8', marginTop: -1 },
  adjTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: 8, gap: 12 },
  adjClose: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  adjTitleWrap: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 42, justifyContent: 'center', ...shadow.card },
  adjTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  adjBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 16, paddingBottom: 8, ...shadow.pop },
  adjHint: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', marginBottom: 12, lineHeight: 19 },
  swapBtn: { position: 'absolute', right: 12, top: '50%', marginTop: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  departDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(26,115,232,0.16)', alignItems: 'center', justifyContent: 'center' },
  departInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#1A73E8', borderWidth: 2, borderColor: '#fff' },
  destWrap: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  destSquare: { width: 15, height: 15, borderRadius: 4, backgroundColor: '#1A73E8', borderWidth: 2, borderColor: '#fff' },
  stopDot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  stopInner: { width: 11, height: 11, borderRadius: 3, backgroundColor: '#1A73E8' },
  addDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  destPin: { width: 22, height: 30, marginLeft: -1 },
  connector: { width: 2, height: 7, backgroundColor: colors.line2, marginLeft: 26 },
  backdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 10 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.ink },
  pickerScreen: { flex: 1, backgroundColor: colors.bg },
  pickerHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.lg, paddingTop: 4, paddingBottom: 10 },
  pickerBack: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  pickerTitle: { fontSize: 18, fontWeight: '800', color: colors.ink, flex: 1 },
  searchWrap: { paddingHorizontal: space.lg, paddingBottom: 4 },
  mapPick: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: space.lg, marginTop: 10, marginBottom: 4, paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brandSoft },
  mapPickIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  mapPickText: { fontSize: 15, fontWeight: '800', color: colors.brandDeep },
  mapPickSub: { fontSize: 12, fontWeight: '600', color: colors.brand, marginTop: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, height: 50, borderWidth: 1, borderColor: colors.line },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '600' },
  hint: { fontSize: 11.5, fontWeight: '800', color: colors.inkMute, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2, marginTop: 14 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line },
  placeIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  placeIconRecent: { backgroundColor: colors.brandTint },
  placeIconSaved: { backgroundColor: colors.brandTint },
  placeLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  savedBadge: { backgroundColor: colors.brandTint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  savedBadgeText: { fontSize: 10, fontWeight: '800', color: colors.brand },
  addFav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingVertical: 14, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  addFavText: { fontSize: 14, fontWeight: '800', color: colors.brand },
  placeLabel: { fontSize: 14.5, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  placeSub: { fontSize: 12.5, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  noResult: { textAlign: 'center', color: colors.inkSoft, fontWeight: '600', paddingVertical: 30 },
});
