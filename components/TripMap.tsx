import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, MarkerAnimated, AnimatedRegion, Polyline, Circle, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import { colors, radius } from '../theme';
import { serviceImages } from './ui';

type MPt = { latitude: number; longitude: number };

// Couleur UNIQUE de tous les points de localisation (départ, arrivée, ma position, attente).
const LOC_BLUE = '#1A73E8';


// Ordre de superposition EXPLICITE des marqueurs (plus grand = plus haut).
// Règle du fondateur : un véhicule n'est JAMAIS coupé et RIEN n'est dessiné dessus.
// - les cercles/pastilles de zone restent tout en bas (décor),
// - les repères A/B, départ, arrivée sont au-dessus du tracé mais SOUS les véhicules,
// - le véhicule de la course (MA voiture / le chauffeur qui vient) est au sommet.
const Z = { zone: 1, pin: 3, veh: 5, self: 7, driver: 9 } as const;

// Véhicules VUS DU DESSUS, réservés à la CARTE (façon Uber/Yango).
// Les rendus 3/4 de `serviceImages` (car.png, moto.png) restent utilisés dans les listes et les
// écrans de choix de véhicule : en perspective, ils sont parfaits en vignette, mais sur une carte
// ils ne peuvent pas être orientés selon le cap sans paraître faux. Ces icônes-ci sont dessinées
// nez vers le HAUT (0° = nord), donc la prop native `rotation` du Marker les oriente correctement.
// PETITE taille (34 dp) : chauffeurs proches. GRANDE (54 dp) : véhicule de la course en cours.
// Chaque PNG existe en 3 densités (@1x/@2x/@3x) : la prop `image` du Marker pose le bitmap
// NATIVEMENT à sa taille en points, donc il faut fournir la bonne résolution par écran.
const MAP_VEH: Record<'car' | 'moto', any> = {
  car: require('../assets/services/car-top.png'),
  moto: require('../assets/services/moto-top.png'),
};
const MAP_VEH_LG: Record<'car' | 'moto', any> = {
  car: require('../assets/services/car-top-lg.png'),
  moto: require('../assets/services/moto-top-lg.png'),
};

// Épingles et point « ma position », eux aussi en BITMAP NATIF (voir l'avertissement ci-dessous) :
// leur ombre, leur bordure et leur pointe se faisaient rogner à la capture bitmap Android.
const PIN = {
  wait: require('../assets/services/pin-wait.png'),        // personne qui attend (ancrée par la pointe)
  a: require('../assets/services/pin-a.png'),              // repère A (départ, en réservation)
  b: require('../assets/services/pin-b.png'),              // repère B (arrivée, en réservation)
  depart: require('../assets/services/pin-depart.png'),    // point de départ
  arrivee: require('../assets/services/pin-arrivee.png'),  // point d'arrivée
};
const SELF = {
  dot: require('../assets/services/self-dot.png'),         // à l'arrêt
  arrow: require('../assets/services/self-arrow.png'),     // en mouvement (orientée par `rotation`)
};

/* ⚠️⚠️ VOITURES COUPÉES SUR ANDROID — LIRE AVANT DE MODIFIER ⚠️⚠️
 *
 * Ne JAMAIS remettre une View/Image en ENFANT de ces marqueurs de véhicule.
 *
 * Sur Android, react-native-maps rend les enfants d'un Marker en les CAPTURANT dans un bitmap,
 * aux bornes MESURÉES de la vue. Tout ce qui déborde de ces bornes est rogné : une image tournée
 * (transform CSS), une ombre, une pointe en position absolue... Résultat : voiture coupée en deux,
 * ou carrément invisible si la capture a lieu avant le chargement de l'image. iOS ne rogne pas,
 * d'où un rendu correct sur iPhone et cassé sur Android — exactement ce qu'on observait.
 *
 * La prop `image` ne capture RIEN : elle passe le PNG directement au moteur de carte, qui le pose
 * comme bitmap natif et l'oriente lui-même via `rotation`. Le rognage devient structurellement
 * impossible, et la carte est bien plus fluide (plus aucune capture de vue à chaque déplacement).
 *
 * Contrepartie : la taille vient du PNG (points = pixels / densité), d'où les 3 densités fournies.
 */
function VehMarker({ coord, source, heading }: { coord: MPt; source: any; heading?: number }) {
  void heading; // icône TOUJOURS droite (demande fondateur) : on n'oriente plus selon le cap.
  return (
    <Marker
      coordinate={coord}
      image={source}
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      flat={false}
      rotation={0}
      zIndex={Z.veh}
      tracksViewChanges={false}
    />
  );
}

// MA position : point bleu, en flèche quand le cap est connu.
// BITMAP NATIF comme tout le reste : une vue enfant se faisait rogner par la capture Android
// (halo + bordure + icône tournée). La flèche est orientée par la prop native `rotation`.
function SelfMarker({ coord, heading }: { coord: MPt; heading?: number }) {
  // Rotation DÉTERMINISTE via transform CSS (sens horaire, identique iOS/Android), et non plus via
  // la prop native `rotation` dont le rendu pouvait pointer « du mauvais sens » selon la plateforme.
  // `tracksViewChanges` n'est vrai qu'un court instant après chaque changement de cap (recapture
  // bitmap Android) puis repasse à false → aucune perte de perf.
  const directional = heading != null;
  const deg = directional ? Math.round(heading as number) : 0;
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const id = setTimeout(() => setTrack(false), 350);
    return () => clearTimeout(id);
  }, [deg, directional]);
  return (
    // zIndex élevé : ma position passe au-dessus des repères décoratifs, mais reste SOUS le véhicule
    // de la course.
    <Marker coordinate={coord} anchor={{ x: 0.5, y: 0.5 }} flat zIndex={Z.self} tracksViewChanges={track}>
      <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
        <Image
          source={directional ? SELF.arrow : SELF.dot}
          style={[{ width: 30, height: 30 }, directional ? { transform: [{ rotate: `${deg}deg` }] } : null]}
          resizeMode="contain"
        />
      </View>
    </Marker>
  );
}


/* Le véhicule de la course : bitmap NATIF, aucune vue enfant → rien à capturer, rien à rogner.
 * Le badge d'ETA n'est PLUS un marqueur : il est rendu en OVERLAY au-dessus de la carte
 * (voir EtaOverlay plus bas). C'est la seule façon d'échapper définitivement à la capture bitmap
 * Android, qui rognait et écrasait le badge quelle que soit la taille, la marge ou l'ancrage. */
function Driver3DMarker({ region, source, heading }: { region: any; source: any; heading?: number }) {
  // Icône TOUJOURS droite (comme les autres marqueurs véhicule) : la prop native `rotation` rendait
  // mal sur iOS (orientation incohérente / « saccadée »). On ne fait plus tourner l'icône ; le
  // déplacement fluide reste géré par l'animation de position (MarkerAnimated).
  void heading;
  return (
    <MarkerAnimated
      coordinate={region}
      image={source}
      anchor={{ x: 0.5, y: 0.5 }}
      flat={false}
      rotation={0}
      zIndex={Z.driver}
      tracksViewChanges={false}
    />
  );
}

/* Pastille de zone : SEUL marqueur qui garde une vue enfant, parce que son contenu est un nombre
 * qui change (impossible de pré-générer une image). On neutralise donc les deux pièges Android :
 *  - `tracksViewChanges` reste vrai le temps d'UNE capture, puis passe à faux : sinon le marqueur
 *    se re-capture à chaque rendu (c'est ce qui rendait la carte lente).
 *  - le compteur est plafonné à « 99+ » et la boîte a une taille fixe : le texte ne peut pas
 *    déborder de la zone capturée, donc jamais de pastille rognée. */
function ZoneMarker({ point, count, pin }: { point: Pt; count: number; pin: string }) {
  const [capture, setCapture] = useState(true);
  useEffect(() => {
    setCapture(true); // le nombre a changé → on autorise une nouvelle capture…
    const t = setTimeout(() => setCapture(false), 350); // …puis on la fige.
    return () => clearTimeout(t);
  }, [count]);
  return (
    <Marker
      coordinate={point}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={Z.zone}
      tracksViewChanges={capture}
    >
      <View style={styles.markerPad} collapsable={false}>
        <View style={[styles.zonePin, { backgroundColor: pin }]}>
          <Text style={styles.zonePinText} allowFontScaling={false} numberOfLines={1}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

// Repère d'un POINT INTERMÉDIAIRE (arrêt) : épingle « teardrop » nommée (C, D…) entre A et B.
// Tête ronde + pointe (triangle par bordures) → forme d'épingle, ancrée par la POINTE (y = 1).
// Uniquement des Views + bordures (aucune rotation) : capture Android fiable, aucune dépendance native.
function StopMarker({ point, label }: { point: Pt; label: string }) {
  const [capture, setCapture] = useState(true);
  useEffect(() => { setCapture(true); const t = setTimeout(() => setCapture(false), 350); return () => clearTimeout(t); }, [label]);
  return (
    <Marker coordinate={point} anchor={{ x: 0.5, y: 1 }} zIndex={Z.pin} tracksViewChanges={capture}>
      <View style={styles.markerPad} collapsable={false}>
        <View style={styles.stopPinHead}>
          <Text style={styles.stopPinText} allowFontScaling={false} numberOfLines={1}>{label}</Text>
        </View>
        <View style={styles.stopPinTail} />
      </View>
    </Marker>
  );
}

/* ============================ BADGE D'ETA — OVERLAY ============================
 * ⚠️ NE JAMAIS le remettre dans un <Marker>. Historique : 6 tentatives, 6 échecs.
 *
 * Sur Android, react-native-maps rend TOUTE vue enfant d'un Marker en la capturant dans un bitmap.
 * Cette capture se fait à des bornes mesurées avant la fin de la mise en page : le badge sortait
 * rogné (« 1 min » -> « 1 »), et comme l'ancrage s'applique au bitmap réellement capturé, un bitmap
 * trop court se posait SUR la voiture. Marges, cales, tailles explicites, Marker simple, remontage
 * forcé : rien n'y a fait.
 *
 * Ici, le badge est une VUE REACT NATIVE ORDINAIRE, posée par-dessus la carte. Il n'entre jamais
 * dans le moteur de carte : aucune capture, aucun rognage possible, par construction.
 * Sa position vient de `pointForCoordinate` (projection GPS -> pixels écran), recalculée quand la
 * carte bouge ou que le chauffeur avance.
 * ============================================================================= */
function EtaOverlay({ mapRef, coord, eta, box }: {
  mapRef: React.RefObject<MapView | null>; coord?: MPt; eta?: string;
  box: { w: number; h: number }; // taille réelle de la carte, pour BORNER le badge dans le cadre
}) {
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let vivant = true;
    if (!coord || !eta || !mapRef.current) { setPt(null); return; }
    // Recalcule la position écran du véhicule. La carte bouge en continu (suivi caméra + animation
    // du marqueur) : on rafraîchit à ~10 images/s, largement assez pour que le badge colle au capot.
    const maj = () => {
      mapRef.current?.pointForCoordinate(coord)
        .then((p) => { if (vivant) setPt(p); })
        .catch(() => {});
    };
    maj();
    const iv = setInterval(maj, 100);
    return () => { vivant = false; clearInterval(iv); };
  }, [mapRef, coord?.latitude, coord?.longitude, eta]);

  if (!pt || !eta) return null;
  // BORNAGE : en encart arrondi le conteneur est en `overflow:hidden`. Si le véhicule est près du
  // haut, un badge posé 68 px plus haut sortirait du cadre et serait coupé. On le maintient donc
  // toujours à l'intérieur — quitte à ce qu'il se rapproche du capot dans les cas extrêmes.
  const dispo = (n: number) => Number.isFinite(n) && n > 0;
  const left = dispo(box.w)
    ? Math.max(2, Math.min(pt.x - ETA_W / 2, box.w - ETA_W - 2))
    : pt.x - ETA_W / 2;
  const top = dispo(box.h)
    ? Math.max(2, Math.min(pt.y - ETA_LIFT, box.h - ETA_H - 2))
    : pt.y - ETA_LIFT;
  return (
    // pointerEvents none : le badge ne doit jamais voler un geste à la carte.
    <View
      pointerEvents="none"
      style={[styles.etaOverlay, { left, top }]}
    >
      <View style={styles.etaBadge}>
        <Text style={styles.etaBadgeTxt} numberOfLines={1} allowFontScaling={false}>{eta}</Text>
      </View>
      <View style={styles.etaTip} />
    </View>
  );
}
const ETA_W = 100;   // largeur de l'overlay (centré sur le véhicule)
const ETA_LIFT = 68; // hauteur au-dessus de la coordonnée : demi-véhicule (27) + badge + pointe + marge
const ETA_H = 34;    // hauteur réelle de l'overlay (badge 26 + pointe) — sert au bornage dans le cadre

export type DemandLevel = 'forte' | 'moyenne' | 'faible';
export type Zone = { point: { latitude: number; longitude: number }; level: DemandLevel; nom?: string; count?: number };

/* Points réels de Bamako (Mali) */
export const BAMAKO = {
  aci2000: { latitude: 12.6385, longitude: -8.0224 },   // ACI 2000, Hamdallaye
  aeroport: { latitude: 12.5335, longitude: -7.9499 },  // Aéroport Bamako-Sénou
  medine: { latitude: 12.6562, longitude: -7.9897 },    // Marché de Médine
  badalabougou: { latitude: 12.6157, longitude: -7.9889 },
  driver: { latitude: 12.6342, longitude: -8.0148 },    // chauffeur en approche
};

/* Lieux fréquents de Bamako (pour choisir une destination) */
export const placesBamako = [
  { id: 'maison', label: 'Maison', sub: 'ACI 2000, Hamdallaye · Porte 142', point: { latitude: 12.639, longitude: -8.024 }, icon: 'home' },
  { id: 'travail', label: 'Travail', sub: 'Immeuble Sotuba, ACI 2000', point: { latitude: 12.636, longitude: -8.018 }, icon: 'briefcase' },
  { id: 'aeroport', label: 'Aéroport Bamako-Sénou', sub: 'Senou, Bamako', point: { latitude: 12.5335, longitude: -7.9499 }, icon: 'airplane' },
  { id: 'medine', label: 'Marché de Médine', sub: 'Médine, Bamako', point: { latitude: 12.6562, longitude: -7.9897 }, icon: 'storefront' },
  { id: 'grand-marche', label: 'Grand Marché', sub: 'Centre-ville, Bamako', point: { latitude: 12.65, longitude: -8.0 }, icon: 'cart' },
  { id: 'badala', label: 'Badalabougou', sub: 'Rive droite, Bamako', point: { latitude: 12.6157, longitude: -7.9889 }, icon: 'location' },
  { id: 'hippodrome', label: 'Hippodrome', sub: 'Hippodrome, Bamako', point: { latitude: 12.6469, longitude: -7.9939 }, icon: 'location' },
] as const;

/* Zones de demande réelles (quartiers de Bamako) — pour l'app chauffeur */
export const bamakoZones: Zone[] = [
  { point: { latitude: 12.6385, longitude: -8.0224 }, level: 'forte', nom: 'ACI 2000', count: 5 },
  { point: { latitude: 12.6300, longitude: -7.9990 }, level: 'moyenne', nom: 'Hamdallaye', count: 3 },
  { point: { latitude: 12.6050, longitude: -7.9650 }, level: 'forte', nom: 'Quartier Mali', count: 4 },
  { point: { latitude: 12.6157, longitude: -7.9889 }, level: 'faible', nom: 'Badalabougou' },
  { point: { latitude: 12.6420, longitude: -8.0360 }, level: 'moyenne', nom: 'Lafiabougou' },
  { point: { latitude: 12.6469, longitude: -7.9939 }, level: 'forte', nom: 'Hippodrome', count: 6 },
];

/* Quelques autres chauffeurs (points bleus) */
export const bamakoDrivers = [
  { latitude: 12.6360, longitude: -8.0120 },
  { latitude: 12.6280, longitude: -7.9930 },
  { latitude: 12.6180, longitude: -8.0050 },
  { latitude: 12.6450, longitude: -7.9870 },
  { latitude: 12.6100, longitude: -7.9760 },
];

const ZONE_STYLE: Record<DemandLevel, { fill: string; stroke: string; pin: string; radius: number }> = {
  forte: { fill: 'rgba(232,75,31,0.16)', stroke: 'rgba(232,75,31,0.55)', pin: '#E84B1F', radius: 900 },
  moyenne: { fill: 'rgba(224,168,46,0.18)', stroke: 'rgba(224,168,46,0.6)', pin: '#E0A82E', radius: 650 },
  faible: { fill: 'rgba(19,122,75,0.15)', stroke: 'rgba(19,122,75,0.5)', pin: '#137A4B', radius: 520 },
};

/* Région qui englobe une liste de zones */
function regionForZones(zones: Zone[]): Region {
  const lats = zones.map((z) => z.point.latitude);
  const lons = zones.map((z) => z.point.longitude);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats);
  const minLo = Math.min(...lons), maxLo = Math.max(...lons);
  return {
    latitude: (minLa + maxLa) / 2,
    longitude: (minLo + maxLo) / 2,
    latitudeDelta: Math.max((maxLa - minLa) * 1.6, 0.04),
    longitudeDelta: Math.max((maxLo - minLo) * 1.6, 0.04),
  };
}

/* Distance en km entre deux points (formule de Haversine) */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const la1 = (a.latitude * Math.PI) / 180;
  const la2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function regionFor(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): Region {
  const latitude = (a.latitude + b.latitude) / 2;
  const longitude = (a.longitude + b.longitude) / 2;
  const latitudeDelta = Math.max(Math.abs(a.latitude - b.latitude) * 1.8, 0.02);
  const longitudeDelta = Math.max(Math.abs(a.longitude - b.longitude) * 1.8, 0.02);
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

type Pt = { latitude: number; longitude: number };

// Garantit un minimum de contexte visible : ajoute 2 points d'angle autour du centre pour que
// `fitToCoordinates` ne zoome jamais trop (utile quand le chauffeur est tout proche du point).
function padSpan(pts: Pt[], min: number): Pt[] {
  if (!pts.length) return pts;
  const lats = pts.map((p) => p.latitude), lngs = pts.map((p) => p.longitude);
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  return [...pts, { latitude: cLat + min, longitude: cLng + min }, { latitude: cLat - min, longitude: cLng - min }];
}

export function TripMap({
  origin,
  destination,
  driver,
  height = 220,
  rounded = true,
  vehicle = 'car',
  fill = false,
  showsUser = false,
  zones,
  drivers,
  routeCoords,
  stops,
  recenterKey,
  waitingAtOrigin = false,
  interactive = true,
  fitRoute = false,
  abMarkers = false,
  followDriver = false,
  driverEta,
  driverHeading,
  self,
  selfHeading,
  frameZones = false,
}: {
  origin?: Pt;
  destination?: Pt;
  driver?: Pt;
  height?: number;
  rounded?: boolean;
  vehicle?: 'car' | 'moto';
  fill?: boolean;
  showsUser?: boolean;
  zones?: Zone[];
  drivers?: (Pt & { heading?: number })[]; // chauffeurs proches (+ cap réel s'il est connu)
  routeCoords?: Pt[];
  stops?: Pt[]; // points intermédiaires (arrêts) → repères nommés C, D… entre A et B
  recenterKey?: number;
  waitingAtOrigin?: boolean; // affiche une silhouette « personne qui attend » au point de départ
  interactive?: boolean; // false = carte verrouillée (pas de pan/zoom) → un calque centré reste aligné
  fitRoute?: boolean; // true = encadre tout l'itinéraire départ→arrivée (écran de réservation, façon Uber)
  abMarkers?: boolean; // true = petits repères « A » (départ) / « B » (arrivée), façon Google Maps
  followDriver?: boolean; // true = recadre en continu pour garder le chauffeur + la suite du trajet visibles
  driverEta?: string; // badge d'ETA affiché au-dessus du chauffeur (ex. « 3 min »)
  driverHeading?: number; // cap du véhicule de la course, en degrés (0 = nord) → oriente l'icône
  self?: Pt; // MA position (app chauffeur) → flèche orientée selon le cap
  selfHeading?: number; // cap en degrés (0 = nord)
  frameZones?: boolean; // true = cadre sur les zones de demande (vue « occupé », façon Uber)
}) {
  const a = origin ?? BAMAKO.aci2000;
  const b = destination ?? BAMAKO.aeroport;
  const hasZones = !!zones && zones.length > 0;
  const hasDest = !!destination;

  // ---- UN SEUL repère « moi », et JAMAIS de point bleu posé sur un véhicule ----
  // Le point bleu NATIF (showsUserLocation) n'est pas pilotable : ni ancrage, ni zIndex. Il est
  // toujours dessiné PAR-DESSUS les marqueurs custom, donc par-dessus la voiture / la moto — ce que
  // le fondateur refuse (« rien ne doit être dessus, genre Uber Driver »). On ne l'autorise donc que
  // si l'écran n'affiche AUCUN autre repère au même endroit :
  //   - pas de `self` (repère « ma position » custom),
  //   - pas de `driver` (le véhicule de la course EST ma position côté chauffeur : delivery/active-trip),
  //   - pas de repère de départ (`origin`), qui est déjà le point bleu de prise en charge.
  // Conséquence pratique : plus aucun doublon natif+custom sur aucun écran.
  const showNativeUser = showsUser && !self && !driver && !origin;

  // Points DÉJÀ occupés par un repère (ma position, départ, arrivée). Aucun véhicule de la liste
  // `drivers` ne doit y être posé : sinon la voiture se retrouve exactement sous (ou sur) le point
  // bleu, le repère A ou le repère B, et le rendu paraît faux. ~60 m couvre la taille à l'écran d'un
  // repère aux zooms utilisés (et du radar de recherche, centré sur le départ).
  const RAYON_LIBRE_KM = 0.06;
  const busyPoints = useMemo<Pt[]>(() => {
    const l: Pt[] = [];
    if (self) l.push(self);
    if (origin) l.push(origin);
    if (destination) l.push(destination);
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [self?.latitude, self?.longitude, origin?.latitude, origin?.longitude, destination?.latitude, destination?.longitude]);

  const driversVisibles = useMemo(
    () => (drivers ?? []).filter((d) => busyPoints.every((p) => distanceKm(d, p) > RAYON_LIBRE_KM)),
    [drivers, busyPoints],
  );

  // ---- Marge de recadrage (edgePadding) proportionnelle à la HAUTEUR RÉELLE de la carte ----
  // En encart arrondi, le conteneur est en `overflow:hidden` : un marqueur proche du bord est rogné
  // par le cadre. Une marge fixe de 60 px sur une carte de 118 px (colis) ne laissait quasiment plus
  // de place et `fitToCoordinates` recadrait mal (repères A/B collés au bord, donc coupés).
  // Minimum 26 px, soit plus que la demi-hauteur d'un repère A/B (boîte 44 → 22 px) ; et 34 px dès
  // qu'un véhicule de course est affiché (icône 54 → demi-hauteur 27 px), pour qu'il ne soit jamais
  // coupé par le cadre même quand il se trouve à l'extrémité de l'itinéraire (suivi Food, resto/client).
  // Taille mesurée de la carte (pour borner le badge d'ETA dans le cadre).
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Le véhicule est-il ARRIVÉ sur le point de départ ? Alors l'épingle du passager, ancrée par sa
  // pointe, se dresse pile au-dessus de lui et le RECOUVRE — c'est ce que voyait le testeur : la
  // voiture était bien là, mais cachée sous la goutte bleue. Quand le véhicule est sur place, c'est
  // LUI qui marque le point de rendez-vous : on retire l'épingle. (Uber fait pareil.)
  const vehiculeSurLeDepart = !!(driver && origin && distanceKm(driver, origin) < 0.04); // < 40 m

  const mapH = fill ? 560 : height;
  const minV = driver ? 34 : 26;
  const minH = driver ? 32 : 24;
  const padV = Math.round(Math.min(Math.max(mapH * 0.16, minV), 64));
  const padH = Math.round(Math.min(Math.max(mapH * 0.14, minH), 56));
  // Région STABLE : on n'élargit vers une destination que si elle existe.
  // Sans destination, on se centre simplement sur le départ (plus de saut vers un point lointain).
  // Vue « occupé » : on cadre sur toutes les zones de demande. Sinon on zoome sur MA position (façon Uber).
  const region: Region = frameZones && hasZones
    ? regionForZones(zones!)
    : self
      ? { latitude: self.latitude, longitude: self.longitude, latitudeDelta: 0.013, longitudeDelta: 0.013 }
      : hasZones && !hasDest
        ? regionForZones(zones!)
        : hasDest
          ? regionFor(driver ?? a, b)
          : { latitude: a.latitude, longitude: a.longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 };
  const mapRef = useRef<MapView>(null);

  // Recentre quand le DÉPART / DESTINATION / MA POSITION / la vue « occupé » changent.
  useEffect(() => {
    const id = setTimeout(() => mapRef.current?.animateToRegion(region, 600), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.latitude, a.longitude, hasDest, b.latitude, b.longitude, self?.latitude, self?.longitude, frameZones]);

  // Recentrage + zoom à la demande (bouton cible) sur ma position (ou le départ).
  useEffect(() => {
    if (recenterKey == null) return;
    const c = self ?? a;
    mapRef.current?.animateToRegion({ latitude: c.latitude, longitude: c.longitude, latitudeDelta: 0.013, longitudeDelta: 0.013 }, 550);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  // Cadre tout l'itinéraire départ→arrivée (écran de réservation), façon Uber.
  const routeKey = routeCoords && routeCoords.length ? `${routeCoords.length}|${routeCoords[0].latitude},${routeCoords[routeCoords.length - 1].latitude}` : '';
  useEffect(() => {
    if (!fitRoute || !routeCoords || routeCoords.length < 2) return;
    // min de span plus large (~0,9 km/côté) → même pour un trajet très court, A et B restent
    // tous deux visibles et bien séparés (jamais superposés / rognés).
    const id = setTimeout(() => mapRef.current?.fitToCoordinates(padSpan(routeCoords, 0.008), {
      edgePadding: { top: padV, right: padH, bottom: padV, left: padH },
      animated: true,
    }), 320);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRoute, routeKey, padV, padH]);

  // Marqueur chauffeur ANIMÉ : glisse en douceur d'une position GPS à la suivante (façon Uber).
  const driverRegion = useRef(
    new AnimatedRegion({ latitude: (driver ?? a).latitude, longitude: (driver ?? a).longitude, latitudeDelta: 0, longitudeDelta: 0 }),
  ).current;
  useEffect(() => {
    if (!driver) return;
    (driverRegion as any).timing({ latitude: driver.latitude, longitude: driver.longitude, duration: 900, useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver?.latitude, driver?.longitude]);

  // Suivi caméra : garde le chauffeur + la suite du trajet dans le cadre à chaque déplacement.
  useEffect(() => {
    if (!followDriver || !driver) return;
    // Cadre chauffeur + point de rencontre (+ destination si connue), avec un zoom-out minimum
    // garanti → on voit toujours le contexte, jamais collé sur les deux marqueurs.
    const base = routeCoords && routeCoords.length > 1 ? routeCoords : [driver, destination ?? a];
    const pts = padSpan(base, 0.013);
    // Marge haute >= demi-boîte du véhicule (104/2 = 52) + badge d'ETA : le véhicule n'est jamais
    // coupé par le haut du cadre. Marge basse : la fiche conducteur couvre le bas en plein écran.
    const ep = fill
      ? { top: 130, right: 70, bottom: 300, left: 70 }
      : { top: Math.max(padV, 58), right: padH, bottom: Math.max(padV, 58), left: padH };
    const id = setTimeout(() => mapRef.current?.fitToCoordinates(pts, { edgePadding: ep, animated: true }), 260);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followDriver, driver?.latitude, driver?.longitude, routeKey, fill, padV, padH]);

  return (
    <View
      style={[fill ? { flex: 1 } : { height }, rounded && styles.rounded]}
      // Taille RÉELLE de la carte : sert à borner le badge d'ETA dans le cadre (encart arrondi
      // en `overflow:hidden` → un badge qui dépasse serait coupé).
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
      }}
    >
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={[StyleSheet.absoluteFill, rounded && { borderRadius: radius.lg }]}
        initialRegion={region}
        showsUserLocation={showNativeUser}
        showsMyLocationButton={showNativeUser}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={interactive}
        pitchEnabled={interactive}
        showsCompass={false}
        toolbarEnabled={false}
        loadingEnabled
        loadingBackgroundColor={colors.surface2}
      >
        {/* Zones de demande (cercles + pastilles chiffrées) */}
        {hasZones && zones!.map((z, i) => {
          const s = ZONE_STYLE[z.level];
          return (
            <React.Fragment key={`z${i}`}>
              <Circle center={z.point} radius={s.radius} fillColor={s.fill} strokeColor={s.stroke} strokeWidth={1.5} />
              {z.count != null && <ZoneMarker point={z.point} count={z.count} pin={s.pin} />}
            </React.Fragment>
          );
        })}

        {/* Chauffeurs proches : petite icône du véhicule (voiture pour taxi, moto pour moto/livraison).
            `driversVisibles` exclut ceux collés à un repère (ma position, départ/A, arrivée/B)
            → jamais de véhicule dessiné sous le point bleu ni sous une épingle. */}
        {driversVisibles.map((d, i) => (
          <VehMarker key={`d${i}`} coord={d} source={MAP_VEH[vehicle]} heading={d.heading} />
        ))}

        {/* Itinéraire réel (ORS/OSRM) si fourni : halo + trait plein (façon Uber).
            Sinon (routeur indispo) trait direct départ→arrivée, halo + pointillés, toujours visible. */}
        {routeCoords && routeCoords.length > 1 ? (
          <>
            <Polyline coordinates={routeCoords} strokeColor="rgba(232,75,31,0.22)" strokeWidth={12} lineCap="round" lineJoin="round" />
            <Polyline coordinates={routeCoords} strokeColor={colors.brand} strokeWidth={5} lineCap="round" lineJoin="round" />
          </>
        ) : origin && destination ? (
          <>
            <Polyline coordinates={driver ? [a, driver, b] : [a, b]} strokeColor="rgba(232,75,31,0.20)" strokeWidth={10} lineCap="round" lineJoin="round" />
            <Polyline coordinates={driver ? [a, driver, b] : [a, b]} strokeColor={colors.brand} strokeWidth={4.5} lineDashPattern={[3, 7]} lineCap="round" lineJoin="round" />
          </>
        ) : null}

        {/* En réservation (abMarkers), le repère de départ n'apparaît qu'une fois la destination choisie :
            avant, on ne montre que le point bleu « ma position ». */}
        {/* ⚠️ Épingles en BITMAP NATIF (prop `image`), jamais en vue enfant.
            Elles ont une ombre et une pointe : Android les rognait à la capture bitmap — l'épingle
            « personne qui attend » sortait coupée. En image native, rien n'est capturé, rien n'est
            rogné. Ancrage par la POINTE (y = 1) pour les gouttes, au CENTRE (0.5) pour les pastilles. */}
        {origin && !(abMarkers && !hasDest) && !vehiculeSurLeDepart && (
          <Marker
            coordinate={a}
            image={waitingAtOrigin ? PIN.wait : abMarkers ? PIN.a : PIN.depart}
            anchor={{ x: 0.5, y: waitingAtOrigin ? 1 : 0.5 }}
            zIndex={Z.pin}
            tracksViewChanges={false}
          />
        )}

        {/* Points intermédiaires (arrêts) : repères nommés C, D… entre le départ (A) et l'arrivée (B). */}
        {(stops || []).filter((s) => s && s.latitude != null && s.longitude != null).map((s, i) => (
          <StopMarker key={`stop-${i}`} point={s} label={String(i + 1)} />
        ))}

        {destination && (
          <Marker
            coordinate={b}
            image={abMarkers ? PIN.b : PIN.arrivee}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={Z.pin}
            tracksViewChanges={false}
          />
        )}

        {self && <SelfMarker coord={self} heading={selfHeading} />}

        {driver && <Driver3DMarker region={driverRegion as any} source={MAP_VEH_LG[vehicle]} heading={driverHeading} />}
      </MapView>

      {/* Badge d'ETA : vue React Native ORDINAIRE, POSÉE PAR-DESSUS la carte (et non dedans).
          Il n'entre jamais dans le moteur de carte → aucune capture bitmap → rognage impossible. */}
      <EtaOverlay mapRef={mapRef} coord={driver} eta={driverEta} box={box} />
    </View>
  );
}

// Ombre pour les marqueurs de carte : PAS d'`elevation` (sur Android, l'elevation d'une vue-marqueur
// fait rogner le rendu en carré). On garde une ombre douce iOS + la bordure blanche pour le relief.
const PIN_SHADOW = { shadowColor: '#15110E', shadowOpacity: 0.22, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } };

const styles = StyleSheet.create({
  rounded: { borderRadius: radius.lg, overflow: 'hidden' },
  // Épingle « personne qui attend » : ancrée par la pointe (anchor y = 1). Largeur fixe (l'ombre iOS
  // déborde de 6 px de chaque côté), hauteur laissée au contenu pour que la pointe tombe pile sur le GPS.
  // Épingle d'arrivée : ancrée par la pointe (anchor y = 1) → largeur fixe, hauteur au contenu.
  destInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
  car: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.brand, ...PIN_SHADOW },
  // Boîte FIXE du véhicule de course : icône 54 centrée + marge haute pour le badge d'ETA.
  zonePin: { minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderWidth: 2.5, borderColor: '#fff', ...PIN_SHADOW },
  zonePinText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  // Épingle arrêt : tête ronde (lettre) + pointe triangulaire dessous, façon repère de carte.
  stopPinHead: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: '#fff', ...PIN_SHADOW },
  stopPinTail: { width: 0, height: 0, marginTop: -4, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.brand },
  stopPinText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  otherDriver: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#2F6BFF', borderWidth: 2, borderColor: '#fff' },
  // Boîte FIXE des repères centrés (A/B, départ, pastille de zone) : 44 px pour un contenu de 26 px
  // max → 9 px de marge tout autour, de quoi absorber la bordure blanche et l'ombre iOS sans que la
  // capture Android du marqueur ne rogne quoi que ce soit. Jamais de taille implicite.
  markerPad: { width: 44, height: 44, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  nearVeh: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.line2, ...PIN_SHADOW },
  // Boîte FIXE du marqueur véhicule (chauffeur proche) : largeur/hauteur données à l'usage (1,8x l'icône).
  // Boîte FIXE du point bleu « ma position » (halo 34 + marge pour l'ombre iOS) : pas de taille implicite.
  // Badge d'ETA (façon iOS) : TOUT est à dimensions EXPLICITES. Une vue de marqueur sans width/height
  // se fait mesurer à zéro sur Android et s'effondre sur la coordonnée.
  // Hauteur 84 = badge (26) + pointe (6) + 52 d'espace libre. Avec anchor y = 1, le bas de la boîte
  // Overlay ABSOLU au-dessus de la carte (jamais un enfant de Marker : voir le pavé EtaOverlay).
  etaOverlay: { position: 'absolute', width: 100, alignItems: 'center' },
  etaBadge: { width: 82, height: 26, backgroundColor: colors.ink, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  etaBadgeTxt: { color: '#fff', fontSize: 12.5, fontWeight: '800', textAlign: 'center', includeFontPadding: false },
  // Pointe dans le FLUX (jamais en position absolue : elle sortirait des bornes et serait rognée).
  etaTip: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.ink },
  // Le badge d'ETA est le SEUL marqueur encore rendu depuis une vue (son texte change).
  // Tout est donc DANS LE FLUX et à taille EXPLICITE : rien en position absolue, rien qui déborde
  // des bornes mesurées — sinon Android rogne à la capture (« Calcul… » devenait « Calcu »).
  // Boîte à dimensions EXPLICITES (obligatoire sur Android — voir le commentaire au rendu).
  // 76 de haut = badge (26) + 50 d'espace libre en dessous, qui sert de cale : avec anchor y = 1,
});
