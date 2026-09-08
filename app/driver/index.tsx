import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Alert, Linking, Share, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { colors, radius, shadow, space } from '../../theme';
import { Btn, Avatar, useToast } from '../../components/ui';
import { TripMap, BAMAKO, bamakoZones, distanceKm, type Zone } from '../../components/TripMap';
import { fcfa } from '../../data/mock';
import { useAuth } from '../../components/auth';
import { useLiveRefresh, srcKyc, srcAbonnement, srcVehicule } from '../../lib/live';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { playDriver, playCue, startRequestRing, stopRequestRing } from '../../lib/sound';
import { notify } from '../../lib/notify';
import { startBackgroundPresence, stopBackgroundPresence } from '../../lib/backgroundPresence';
import { routeBetween, searchPlaces, moveHeading, type GeoRoute } from '../../lib/geo';
import { realisticEta, fallbackEstimate } from '../../lib/estimate';
import {
  getDriverRides,
  getRide,
  subscribeAssignedRides,
  subscribeAssignedMovings,
  getMovingRequest,
  getMyPendingOffer,
  subscribeMyOffers,
  acceptOffer,
  respondOffer,
  getDemandZones,
  getActiveSubscription,
  getKyc,
  getDriverProfile,
  applyActiveVehicle,
  getDriverStats,
  setDriverPresence,
  setDriverOffline,
  getNearbyDrivers,
  getMatchingCounts,
  getMyDeliveryOffer,
  getMyActiveDelivery,
  getMyActiveRide,
  getPoolLegs,
  refuseLocation,
  subscribeMyDeliveryOffers,
  subscribeMyDeliveries,
  getUnreadNotifCount,
  getDriverServices,
  getRidePassengerRating,
  getOrderClientRating,
  getDeliveryOrderById,
  getDeliveryDriverPct,
  gainLivraison,
  servicesCompatibles,
  type DriverRide,
  type DriverSubscription,
  type KycStatut,
  type DriverProfile,
  iconeCarte,
} from '../../lib/db';

type Pt = { latitude: number; longitude: number };

type CourseType = 'voiture' | 'moto' | 'colis';

// Demande affichée à l'écran (réelle = avec rideId, ou simulée).
type Demande = {
  rideId?: string;
  offerId?: string;
  ttl?: number;
  passager: string;
  depart: string;
  destination: string;
  distance: number | null;   // km — null si la course réelle n'a pas de distance (on n'invente rien)
  prix: number;
  type: CourseType;
  service: string;           // libellé clair (Taxi, Moto, Colis, Tricycle, Location · 3h)
  sim: boolean;
  lat?: number | null;       // pickup
  lng?: number | null;
  destLat?: number | null;   // dropoff (rempli au géocodage / démo)
  destLng?: number | null;
  // Note du passager : MOYENNE agrégée uniquement (jamais le détail des courses, jamais qui a noté).
  //   undefined -> pas encore chargée (on n'affiche rien)
  //   null      -> moins de 3 notes -> badge neutre « Nouveau » (jamais « 0 », jamais de note inventée)
  notePassager?: number | null;
  poolId?: string | null;    // offre de covoiturage (2 passagers, 1 chauffeur)
  stops?: { latitude: number; longitude: number; label?: string }[]; // arrêts intermédiaires (C, D…)
  location?: boolean;        // location (louer un chauffeur) : pas de destination → pas de A→B
};

const DEMO_SIM: Demande = {
  passager: 'Fatoumata Keita',
  depart: 'Hippodrome, Bamako',
  destination: 'Grand Marché de Bamako',
  distance: 5.8,
  prix: 3200,
  type: 'voiture',
  service: 'Taxi',
  sim: true,
  lat: BAMAKO.driver.latitude,
  lng: BAMAKO.driver.longitude,
  destLat: BAMAKO.aeroport.latitude,
  destLng: BAMAKO.aeroport.longitude,
};

// Libellé clair du service à partir de la course (location, tricycle, colis, taxi, moto).
function serviceLabel(ride: DriverRide): string {
  const h = ride.location_hours ? Number(ride.location_hours) : 0;
  if (h > 0) { const wh = Math.floor(h); return `Location · ${wh}h${h - wh >= 0.5 ? '30' : ''}`; }
  if (ride.type === 'colis') return ride.tier === 'tricycle' ? 'Tricycle · colis lourd' : 'Colis';
  if (ride.type === 'moto') return 'Moto';
  // Voiture : on précise la GAMME pour que le chauffeur voie exactement le service demandé.
  const gamme = ride.shared ? 'Partagé' : ride.tier === 'confort' ? 'Fresh' : ride.tier === 'xl' ? 'SUV' : 'Eco';
  return `Taxi · ${gamme}`;
}

function toDemande(ride: DriverRide): Demande {
  return {
    rideId: ride.id,
    passager: ride.passager_nom ?? 'Passager',
    depart: ride.depart ?? 'Bamako',
    destination: ride.destination ?? 'Bamako',
    distance: ride.distance_km ?? null, // pas de distance inventée : null → on masque le km

    prix: ride.prix,
    type: ride.type ?? 'voiture',
    service: serviceLabel(ride),
    sim: false,
    lat: ride.depart_lat ?? null,
    lng: ride.depart_lng ?? null,
    destLat: ride.dest_lat ?? null,
    destLng: ride.dest_lng ?? null,
    stops: [
      { lat: (ride as any).stop1_lat, lng: (ride as any).stop1_lng, label: (ride as any).stop1_label },
      { lat: (ride as any).stop2_lat, lng: (ride as any).stop2_lng, label: (ride as any).stop2_label },
    ].filter((s) => s.lat != null && s.lng != null).map((s) => ({ latitude: s.lat as number, longitude: s.lng as number, label: s.label ?? undefined })),
    location: (ride.location_hours ?? 0) > 0,
  };
}

const RAYON_KM = 8; // un chauffeur ne voit que les demandes dans ce rayon

// Cap GPS exploitable ? expo-location renvoie -1 (ou null) quand le cap est indisponible
// (véhicule à l'arrêt, appareil sans magnétomètre) : on ne garde QUE 0–360.
function capGps(h?: number | null): number | null {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 360 ? h : null;
}

// Note à la française : une décimale, virgule décimale (4,8 — jamais 4.8).
function fmtNote(n: number): string {
  return n.toFixed(1).replace('.', ',');
}

// Vrai « aujourd'hui » : même année/mois/jour que maintenant.
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function DriverHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const { user } = useAuth();
  const toast = useToast();

  const [abo, setAbo] = useState<DriverSubscription | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false); // évite le flash « Termine ton inscription » au chargement
  const [kycStatut, setKycStatut] = useState<KycStatut | null>(null);
  const [vehProfile, setVehProfile] = useState<DriverProfile | null>(null);
  // Véhicule ACTIF de la session (le chauffeur peut basculer voiture/moto/tricycle s'il en a plusieurs).
  const [activeVeh, setActiveVeh] = useState<string>('voiture');
  const vehChosenRef = useRef(false); // true dès que le chauffeur a choisi manuellement
  // Services acceptés par le chauffeur (courses / colis / livraison / demenagement) → filtrage du dispatch.
  const [services, setServices] = useState<string[]>([]);
  const [driverNote, setDriverNote] = useState(4.9);
  const [enLigne, setEnLigne] = useState(false);
  // Intention « passer en ligne » mise en attente quand le profil n'est pas encore chargé au moment du tap.
  const [pendingOnline, setPendingOnline] = useState(false);
  const [demande, setDemande] = useState<Demande | null>(null);
  // Temps minimum pour qu'une offre vaille la peine d'être affichée : en dessous, le chauffeur
  // n'a pas matériellement le temps de lire et d'accepter (surtout au réveil depuis une notif).
  // Mieux vaut ne rien montrer que de le faire courir vers une offre déjà perdue.
  const MIN_ACTION_SEC = 6;
  const [countdown, setCountdown] = useState(0);
  const [accepting, setAccepting] = useState(false);

  // Gains du jour (façon Uber Driver).
  const [gains, setGains] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const [nbCourses, setNbCourses] = useState(0);
  // Recentrage de la carte sur ma position (bouton maison/locate).
  const [recenter, setRecenter] = useState(0);
  // Vue « occupé » (heatmap des zones de forte demande, façon Uber).
  const [demandView, setDemandView] = useState(false);
  // Nombre de locations programmées pré-assignées (courses à venir).
  const [upcoming, setUpcoming] = useState(0);

  // Zones de demande calculées en direct depuis les courses en attente.
  // Zones affichées : UNIQUEMENT les quartiers à forte demande réelle (rien à la connexion).
  const [zones, setZones] = useState<Zone[]>([]);

  // Matching réel : vrais chauffeurs proches + compteurs + ma position.
  const [nearby, setNearby] = useState<Pt[]>([]);
  const [counts, setCounts] = useState<{ chauffeurs: number; demandes: number }>({ chauffeurs: 0, demandes: 0 });
  const [livCount, setLivCount] = useState(0);
  const [livOfferExp, setLivOfferExp] = useState<string | null>(null); // expiration de l'offre de livraison en attente
  const [livOrderId, setLivOrderId] = useState<string | null>(null); // commande de l'offre de livraison en attente
  // Note du client de cette commande : MOYENNE agrégée uniquement (jamais le détail, jamais qui a noté).
  // Portée par un état SÉPARÉ (avec l'id de la commande) : son arrivée différée ne touche ni
  // `livOfferExp` ni le compte à rebours de l'offre.
  const [livNote, setLivNote] = useState<{ orderId: string; moyenne: number | null } | null>(null);
  // Gain du livreur sur l'offre en attente. État SÉPARÉ lui aussi (avec l'id de la commande) :
  // son chargement différé ne touche ni `livOfferExp` ni le compte à rebours de l'offre.
  const [livGain, setLivGain] = useState<{ orderId: string; gain: number | null } | null>(null);
  // Part des frais de livraison qui revient au livreur (réglée côté admin) : lue une fois au montage.
  const [delivPct, setDelivPct] = useState<number | null>(null);
  const [, setLivTick] = useState(0); // ticker 1s pour rafraîchir le compte à rebours livraison
  const myLoc = useRef<Pt | null>(null);
  // Dernier cap RÉEL connu (degrés, 0 = nord) : GPS s'il le fournit, sinon relèvement entre deux
  // positions successives. Sert au battement de cœur (qui n'a pas de nouvelle position) et évite
  // de renvoyer un cap nul (= plein nord) quand le véhicule est à l'arrêt.
  const myCap = useRef<number | null>(null);
  const [myPos, setMyPos] = useState<Pt | null>(null); // centre la carte sur la vraie position

  // Reprise : une course/livraison en cours ne se perd JAMAIS. On la garde en état pour afficher
  // une bannière « Reprendre » (comme l'app client : on peut sortir et revenir quand on veut),
  // et au tout premier démarrage on y retourne directement (reprise après redémarrage).
  type Resume =
    | { kind: 'ride'; pathname: '/driver/active-trip'; label: string; params: Record<string, string> }
    | { kind: 'pool'; pathname: '/driver/pool-trip'; label: string; params: Record<string, string> }
    | { kind: 'delivery'; pathname: '/driver/delivery'; label: string; params: Record<string, string> };
  const [resume, setResume] = useState<Resume | null>(null);
  const coldResumed = useRef(false);

  const buildResume = async (): Promise<Resume | null> => {
    const r = await getMyActiveRide();
    if (r && r.pool_id) {
      // Course partagée en cours : on reprend sur l'écran covoiturage dédié.
      return {
        kind: 'pool',
        pathname: '/driver/pool-trip',
        label: 'Course partagée en cours',
        params: { poolId: r.pool_id },
      };
    }
    if (r) {
      return {
        kind: 'ride',
        pathname: '/driver/active-trip',
        label: `${r.depart ?? ''} → ${r.destination ?? ''}`.trim() || 'Course en cours',
        params: {
          rideId: r.id,
          passager: r.passager_nom ?? 'Passager',
          depart: r.depart ?? 'Bamako',
          destination: r.destination ?? 'Bamako',
          distance: String(r.distance_km ?? 0),
          prix: String(r.prix),
          type: r.type ?? 'voiture',
          ...(r.depart_lat != null && r.depart_lng != null ? { pickupLat: String(r.depart_lat), pickupLng: String(r.depart_lng) } : {}),
          ...(r.dest_lat != null && r.dest_lng != null ? { dropLat: String(r.dest_lat), dropLng: String(r.dest_lng) } : {}),
        },
      };
    }
    const d = await getMyActiveDelivery();
    if (d) {
      return {
        kind: 'delivery',
        pathname: '/driver/delivery',
        label: d.restaurant_nom ? `${d.restaurant_nom} → ${d.adresse ?? 'client'}` : 'Livraison en cours',
        params: { orderId: d.id, resto: d.restaurant_nom ?? 'Restaurant', adresse: d.adresse ?? '', client: d.client_nom ?? 'Client', clientPhoto: d.client_photo ?? '', total: String(d.total ?? 0) },
      };
    }
    return null;
  };

  // À chaque fois que l'accueil reprend le focus (donc après avoir fermé une course), on rafraîchit
  // l'état de reprise → la bannière reste toujours accessible. Au 1er démarrage, on rouvre direct.
  useFocusEffect(
    useCallback(() => {
      if (!user?.id) return;
      let active = true;
      (async () => {
        try {
          const res = await buildResume();
          if (!active) return;
          setResume(res);
          if (res && !coldResumed.current) {
            coldResumed.current = true;
            router.replace({ pathname: res.pathname, params: res.params });
          }
        } catch { /* ignore */ }
      })();
      return () => { active = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]),
  );

  // Cap (direction) affiché par la flèche. Alimenté par DEUX sources : le mouvement réel (GPS/
  // relèvement, dans le suivi de position ci-dessous) ET la boussole (effet plus bas). Avant, seule
  // la boussole l'alimentait : sans magnétomètre / sans permission mouvement, la flèche restait
  // bloquée au nord et ne suivait pas le déplacement.
  const [myHeading, setMyHeading] = useState(0);

  // Suivi de position dès l'ouverture (MÊME HORS LIGNE) → la flèche est vivante et suit le chauffeur
  // en continu, sans attendre le passage en ligne. (La diffusion de présence au serveur reste, elle,
  // conditionnée au fait d'être en ligne, dans l'effet dédié plus bas.)
  useEffect(() => {
    let active = true;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !active) return;
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        const pt = { latitude: first.coords.latitude, longitude: first.coords.longitude };
        myLoc.current = pt;
        const cap0 = capGps(first.coords.heading);
        if (cap0 != null) myCap.current = cap0;
        setMyPos(pt);
        // Point précédent PROPRE à ce suivi : sert à dériver le cap du mouvement réel quand le GPS
        // ne donne pas de cap (véhicule lent, appareil sans magnétomètre).
        let prev: Pt = pt;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 },
          (loc) => {
            const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            // Cap réel : GPS d'abord, sinon relèvement du déplacement. Si rien n'est exploitable
            // (véhicule à l'arrêt), on CONSERVE le dernier cap connu — jamais de remise à 0.
            // Direction de TRAJET : relèvement point-à-point d'abord (fiable), GPS heading en repli.
            // (Sur iPhone, coords.heading peut renvoyer l'orientation de l'appareil, pas la trajectoire.)
            const cap = moveHeading(prev, p) ?? capGps(loc.coords.heading);
            if (cap != null) { myCap.current = cap; setMyHeading(cap); } // oriente la flèche par le déplacement réel
            prev = p;
            myLoc.current = p;
            setMyPos(p); // flèche live en permanence (en ligne comme hors ligne)
          },
        );
      } catch { /* ignore */ }
    })();
    return () => { active = false; sub?.remove(); };
  }, []);

  // Volontairement PAS de boussole (watchHeadingAsync) pour orienter la flèche : posé sur un support
  // voiture, le magnétomètre est parasité et renvoie un cap erratique → la flèche paraît « de travers »
  // à l'arrêt. Le cap vient donc UNIQUEMENT du déplacement GPS (suivi de position ci-dessus). À l'arrêt,
  // `myHeading` reste à sa dernière valeur (0 au départ = pointe droit vers le haut / nord).

  // Aperçu d'itinéraire de la demande entrante (pickup → dropoff).
  const [reqDest, setReqDest] = useState<Pt | null>(null);
  const [reqRoute, setReqRoute] = useState<GeoRoute | null>(null);
  const pickupPt: Pt | null = demande && demande.lat != null && demande.lng != null
    ? { latitude: demande.lat, longitude: demande.lng } : null;

  // Évite de remontrer une demande refusée jusqu'à la prochaine.
  const dismissed = useRef(false);
  // Course que J'AI acceptée moi-même (pour ne pas la re-traiter via le dispatch).
  const acceptedRide = useRef<string | null>(null);

  // Pulse de la pastille « En ligne ».
  const pulse = useRef(new Animated.Value(1)).current;
  // Barre de compte à rebours de la demande (animée, façon Uber).
  const timer = useRef(new Animated.Value(1)).current;

  // Détails du véhicule ACTIF (celui choisi au passage en ligne), avec repli sur les colonnes plates.
  const activeDet = vehProfile?.vehicles?.[activeVeh];
  const actVehicule = activeDet?.vehicule ?? vehProfile?.vehicule;
  const actCouleur = activeDet?.couleur ?? vehProfile?.couleur;
  const actPlaque = activeDet?.plaque ?? vehProfile?.plaque;
  // Gamme de la voiture active (Standard/VIP/SUV) → sert au matching des courses.
  const actGamme = activeVeh === 'voiture' ? (activeDet?.gamme ?? vehProfile?.gamme ?? 'standard') : null;
  // Services émis dans la présence : ceux cochés par le chauffeur, limités à ce que le véhicule ACTIF sait faire.
  // JAMAIS null : envoyer null EFFAÇAIT la colonne `services` en base, et le dispatch retombait alors
  // sur le défaut du véhicule — un moto-livreur pouvait ainsi perdre le food. À défaut de sélection,
  // on émet tout ce que le véhicule sait faire.
  const compat = servicesCompatibles(activeVeh);
  const actServicesList = services.filter((s) => compat.includes(s));
  const actServices = actServicesList.length ? actServicesList : compat;
  const actServicesKey = actServicesList.join(','); // dépendance stable pour l'effet de présence
  // Vrai chauffeur : nom + véhicule actif (profil) + note moyenne réelle.
  const driver = {
    nom: `${user?.prenom ?? ''} ${user?.nom ?? ''}`.trim() || 'Chauffeur',
    note: driverNote,
    plaque: actPlaque || '—',
    vehicule: [actVehicule, actCouleur].filter(Boolean).join(' · ') || 'Véhicule Taga',
  };

  // Recharge les gains du jour À CHAQUE retour sur l'accueil (donc juste après avoir fini une course/livraison).
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        try {
          const rides = await getDriverRides();
          if (!mounted) return;
          const dujour = rides.filter(
            (r) => r.statut === 'termine' && isToday(r.created_at),
          );
          // Frais d'annulation encaissés (compensation) du jour : courses annulées par le client alors que j'étais en route.
          const fraisAnnul = rides
            .filter((r) => r.statut === 'annule' && (r.cancel_fee ?? 0) > 0 && isToday(r.created_at))
            .reduce((s, r) => s + (r.cancel_fee ?? 0), 0);
          setGains(dujour.reduce((sum, r) => sum + (r.prix ?? 0), 0) + fraisAnnul);
          setNbCourses(dujour.length);
          setUpcoming(rides.filter((r) => (r.statut as string) === 'programme').length);
        } catch {
          /* ignore */
        }
      })();
      return () => { mounted = false; };
    }, []),
  );

  // Persiste l'état « en ligne » : si l'appli est fermée/relancée sans se déconnecter,
  // on reprend en ligne (le contrôle KYC/abonnement au focus corrige si besoin).
  // ⚠️ `hydrate` : tant que le flag persisté n'est pas relu, on ne touche À RIEN.
  // Avant, `enLigne` valait `false` au montage → l'effet de présence appelait
  // setDriverOffline() + stopBackgroundPresence() dès l'ouverture, donc le chauffeur
  // sortait du dispatch à chaque relancement (« je quitte l'appli et je suis déconnecté »).
  const [hydrate, setHydrate] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('taga.driver.online')
      .then((v) => { if (v === '1') setEnLigne(true); })
      .catch(() => {})
      .finally(() => setHydrate(true));
  }, []);
  // Statut KYC mémorisé : affiché IMMÉDIATEMENT à l'ouverture pour ne plus montrer « Dossier en
  // attente » à un chauffeur déjà validé (le temps que le serveur réponde). Ne remplace que tant
  // que le statut réel n'est pas encore chargé (ne pas écraser une réponse serveur plus fraîche).
  useEffect(() => {
    AsyncStorage.getItem('taga.driver.kyc')
      .then((v) => { if (v) setKycStatut((cur) => cur ?? (v as KycStatut)); })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!hydrate) return; // n'écrase pas le flag persisté avant de l'avoir lu
    AsyncStorage.setItem('taga.driver.online', enLigne ? '1' : '0').catch(() => {});
  }, [enLigne, hydrate]);

  // Diffuse ma présence + position GPS tant que je suis en ligne (matching réel).
  // + présence en ARRIÈRE-PLAN (build natif/TestFlight) : on reste dispatchable appli fermée.
  useEffect(() => {
    if (!hydrate) return; // attend de savoir si le chauffeur était en ligne avant de couper quoi que ce soit
    if (!enLigne) { setDriverOffline().catch(() => {}); stopBackgroundPresence().catch(() => {}); return; }
    // On n'émet AUCUNE présence tant que le profil n'est pas chargé : `activeVeh` vaut « voiture » par
    // défaut au montage, et on publiait donc « voiture » pour un chauffeur moto → il recevait les courses
    // taxi et perdait le food. On attend de savoir sur quoi il roule vraiment.
    if (!profileLoaded) return;
    let active = true;
    let sub: Location.LocationSubscription | null = null;
    let hb: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !active) return;
        const vt = activeVeh; // véhicule actif choisi par le chauffeur
        const g = vt === 'voiture' ? (actGamme ?? 'standard') : null; // gamme pour le matching
        const sv = actServices; // services acceptés → le dispatch ne m'envoie QUE ceux-là
        // Reflète les infos du véhicule actif (marque/couleur/plaque/gamme) pour le passager + dispatch.
        applyActiveVehicle(vt).catch(() => {});
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        myLoc.current = { latitude: first.coords.latitude, longitude: first.coords.longitude };
        const capInit = capGps(first.coords.heading);
        if (capInit != null) myCap.current = capInit;
        setMyPos(myLoc.current);
        // Le cap voyage avec la position : les clients voient la voiture/moto ORIENTÉE, pas plein nord.
        setDriverPresence(first.coords.latitude, first.coords.longitude, vt, true, g, sv, myCap.current).catch(() => {});
        // Continue d'émettre la présence même écran verrouillé / appli en arrière-plan.
        startBackgroundPresence(vt, g, sv).catch(() => {});
        let prevP: Pt = myLoc.current;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 20 },
          (loc) => {
            const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            // Cap GPS si disponible, sinon relèvement du déplacement réel ; sinon dernier cap connu.
            const cap = capGps(loc.coords.heading) ?? moveHeading(prevP, p);
            if (cap != null) myCap.current = cap;
            prevP = p;
            myLoc.current = p;
            // (myPos est déjà mis à jour par le suivi permanent) — ici on diffuse la présence au serveur.
            setDriverPresence(p.latitude, p.longitude, vt, true, g, sv, myCap.current).catch(() => {});
          },
        );
        // Battement de cœur : réémet la présence toutes les 45 s même à l'arrêt,
        // sinon updated_at se périme (>120 s) et le chauffeur immobile sort du dispatch.
        // Pas de nouvelle position ⇒ pas de nouveau cap : on réémet le DERNIER cap connu.
        hb = setInterval(() => {
          const l = myLoc.current;
          if (l) setDriverPresence(l.latitude, l.longitude, vt, true, g, sv, myCap.current).catch(() => {});
        }, 45000);
      } catch { /* ignore */ }
    })();
    return () => { active = false; sub?.remove(); if (hb) clearInterval(hb); };
  }, [enLigne, activeVeh, actServicesKey, hydrate, profileLoaded]);

  // Vrais chauffeurs proches + compteurs réels (toutes les 8 s).
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      const center = myLoc.current ?? BAMAKO.aci2000;
      getNearbyDrivers(center, 6).then((d) => { if (mounted) setNearby(d); }).catch(() => {});
      getMatchingCounts(activeVeh).then((c) => { if (mounted) setCounts(c); }).catch(() => {});
    };
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => { mounted = false; clearInterval(iv); };
  }, [activeVeh]);

  // Livraisons : offre (pool) OU assignation directe par l'admin → compteur live.
  useEffect(() => {
    let mounted = true;
    const uid = user?.id;
    if (!uid) return;
    const refresh = async () => {
      try {
        const [offer, active] = await Promise.all([getMyDeliveryOffer(uid), getMyActiveDelivery()]);
        if (mounted) {
          setLivCount(offer || active ? 1 : 0);
          setLivOfferExp(offer?.expires_at ?? null);
          setLivOrderId(offer?.order_id ?? null);
        }
      } catch { /* ignore */ }
    };
    refresh();
    const offOffer = subscribeMyDeliveryOffers(uid, () => { if (mounted) { refresh(); startRequestRing(30000); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); notify('Nouvelle livraison', 'Une livraison t\'est proposée.'); } });
    const offAssign = subscribeMyDeliveries(uid, () => { if (mounted) { refresh(); playDriver('accept'); notify('Livraison assignée', 'Une livraison t\'a été attribuée.'); } });
    const iv = setInterval(refresh, 12000);
    return () => { mounted = false; offOffer(); offAssign(); clearInterval(iv); };
  }, [user?.id]);

  // Note du client de l'offre de livraison : chargée à part, JAMAIS bloquante (l'offre ne dure que 30 s).
  // Si la RPC échoue ou tarde, la bannière reste affichée simplement sans note — aucune note fabriquée.
  useEffect(() => {
    if (!livOrderId) { setLivNote(null); return; }
    let mounted = true;
    getOrderClientRating(livOrderId)
      .then((r) => { if (mounted) setLivNote({ orderId: livOrderId, moyenne: r.moyenne }); })
      .catch(() => { /* bannière affichée sans note */ });
    return () => { mounted = false; };
  }, [livOrderId]);

  // Réglage du partage des frais de livraison : lu une fois, jamais bloquant.
  useEffect(() => {
    let mounted = true;
    getDeliveryDriverPct().then((p) => { if (mounted) setDelivPct(p); }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Gain du livreur sur l'offre en attente : chargé à part, JAMAIS bloquant (l'offre ne dure que 30 s).
  // Frais de livraison inconnus ou réglage non lu -> gain null -> AUCUN montant affiché (jamais inventé).
  useEffect(() => {
    if (!livOrderId || delivPct == null) { setLivGain(null); return; }
    let mounted = true;
    const oid = livOrderId;
    getDeliveryOrderById(oid)
      .then((o) => {
        if (!mounted) return;
        const g = o && o.frais_livraison != null
          ? gainLivraison(Number(o.frais_livraison), Number(o.pourboire ?? 0), delivPct)
          : null;
        setLivGain({ orderId: oid, gain: g });
      })
      .catch(() => { /* bannière affichée sans montant */ });
    return () => { mounted = false; };
  }, [livOrderId, delivPct]);

  // Ticker 1s : anime le compte à rebours de l'offre de livraison tant qu'elle est en attente.
  useEffect(() => {
    if (!(livCount > 0 && livOfferExp)) return;
    const iv = setInterval(() => setLivTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [livCount, livOfferExp]);
  const livSecs = livOfferExp ? Math.max(0, Math.round((new Date(livOfferExp).getTime() - Date.now()) / 1000)) : null;
  // Note à afficher : seulement si elle correspond bien à la commande actuellement proposée.
  const livNoteVal = livNote && livOrderId && livNote.orderId === livOrderId ? livNote.moyenne : undefined;
  // Gain à afficher : seulement s'il correspond bien à la commande actuellement proposée.
  const livGainVal = livGain && livOrderId && livGain.orderId === livOrderId ? livGain.gain : null;

  // Demande entrante → calcule le point de dépôt + l'itinéraire (pickup → dropoff) à afficher.
  useEffect(() => {
    let actif = true;
    if (!demande || demande.lat == null || demande.lng == null) { setReqDest(null); setReqRoute(null); return; }
    const pickup = { latitude: demande.lat, longitude: demande.lng };
    (async () => {
      // Dropoff : coords fournies (démo) sinon géocodage de l'adresse de destination.
      let dest: Pt | null = demande.destLat != null && demande.destLng != null
        ? { latitude: demande.destLat, longitude: demande.destLng }
        : null;
      if (!dest && demande.destination) {
        const res = await searchPlaces(demande.destination);
        if (res.length) dest = res[0].point;
      }
      if (!actif) return;
      setReqDest(dest);
      if (dest) { const r = await routeBetween(pickup, dest); if (actif) setReqRoute(r); }
      else setReqRoute(null);
    })();
    return () => { actif = false; };
  }, [demande?.rideId, demande?.sim, demande?.lat, demande?.lng]);

  // Contrôle d'accès (KYC + abonnement + véhicule + services). Appelé au focus ET en TEMPS RÉEL :
  // dès que l'admin valide le dossier ou active l'abonnement, le tableau de bord se débloque tout
  // seul (le bouton GO devient utilisable) sans que le chauffeur ait à quitter l'écran ou redémarrer.
  const verifierAcces = useCallback(async () => {
    try {
      const [a, k, prof, stats, svc] = await Promise.all([
        getActiveSubscription(), getKyc(), getDriverProfile(), getDriverStats(), getDriverServices(),
      ]);
      setAbo(a);
      const st = k?.statut ?? 'en_attente';
      setKycStatut(st);
      AsyncStorage.setItem('taga.driver.kyc', st).catch(() => {}); // mémorise le dernier statut CONNU
      setVehProfile(prof);
      setServices(svc ?? []); // services cochés dans « Mon véhicule » → transmis au dispatch
      // Véhicule actif : on le cale sur le profil. Le chauffeur peut avoir changé de véhicule
      // (voiture → moto) ; `activeVeh` choisi avant peut pointer vers un véhicule qu'il n'a PLUS,
      // ce qui bloquait le passage en ligne. On resynchronise dès qu'il n'est plus déclaré.
      const declares = (prof?.vehicle_types && prof.vehicle_types.length ? prof.vehicle_types : (prof?.type ? [prof.type] : []));
      setActiveVeh((cur) => {
        if (prof?.type && (!vehChosenRef.current || !declares.includes(cur))) {
          vehChosenRef.current = false;
          return prof.type;
        }
        return cur;
      });
      if (stats?.note) setDriverNote(stats.note);
      // Camion : modèle commission → pas d'abonnement exigé pour rouler.
      const camion = (prof?.type || prof?.vehicle_types?.[0]) === 'camion';
      // Repasse hors-ligne SEULEMENT si l'accès n'est plus valable (dossier non validé / abonnement manquant).
      if ((!a && !camion) || (k?.statut ?? 'en_attente') !== 'valide') setEnLigne(false);
    } catch { /* ignore */ } finally { setProfileLoaded(true); }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      verifierAcces();
      getUnreadNotifCount().then((n) => { if (mounted) setNotifUnread(n); }).catch(() => {});
      return () => { mounted = false; };
    }, [verifierAcces]),
  );

  // Temps réel : validation du dossier, activation de l'abonnement, changement de véhicule approuvé
  // → le tableau de bord se met à jour immédiatement (débloque le passage en ligne dès l'action admin).
  useLiveRefresh(verifierAcces, (uid) => [...srcKyc(uid), ...srcAbonnement(uid), ...srcVehicule(uid)]);

  // Tente de passer en ligne. Conditions OBLIGATOIRES (inscription complète avant toute course) :
  //   1) véhicule déclaré et complet (marque, couleur, plaque),
  //   2) dossier (KYC) validé par l'admin Taga,
  //   3) abonnement actif.
  const passerEnLigne = () => {
    // 0) Profil pas encore chargé : on ne rejette PAS (ça donnait un faux « complète ton véhicule »
    //    et obligeait à re-taper GO). On MÉMORISE l'intention de passer en ligne : dès que le profil
    //    arrive du serveur, la connexion se fait toute seule (un seul tap suffit).
    if (!profileLoaded || !vehProfile) {
      setPendingOnline(true);
      toast('Connexion en cours…');
      return;
    }
    // 1) Véhicule complet : pas de course tant que marque / couleur / plaque ne sont pas renseignées.
    if (!actVehicule || !actCouleur || !actPlaque) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      toast('Complète ton véhicule (marque, couleur, plaque) avant de rouler', { tone: 'error' });
      router.push('/driver/vehicule');
      return;
    }
    if (kycStatut !== 'valide') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      toast(
        kycStatut === 'refuse'
          ? 'Dossier refusé · corrige tes documents'
          : 'Dossier en attente de validation par Taga · ajoute/complète tes documents',
        { tone: 'error' },
      );
      router.push('/driver/documents');
      return;
    }
    // Camion : commission par course → aucun abonnement requis (on saute cette condition).
    if (!abo && activeVeh !== 'camion') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      toast('Abonnement requis pour passer en ligne', { tone: 'error' });
      router.push('/driver/abonnement');
      return;
    }
    setEnLigne(true);
    // Passage EN LIGNE (façon Uber Driver) : double vibration marquée + son FORT.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 90);
    playCue('accept');
  };

  // Reprend l'intention « GO » mise en attente : dès que le profil est chargé, on connecte
  // automatiquement (le chauffeur n'a pas à re-taper GO). La ref pointe toujours vers la dernière
  // version de passerEnLigne pour lire des données à jour.
  const passerEnLigneRef = useRef(passerEnLigne);
  passerEnLigneRef.current = passerEnLigne;
  useEffect(() => {
    if (pendingOnline && profileLoaded && vehProfile && !enLigne) {
      setPendingOnline(false);
      passerEnLigneRef.current();
    }
  }, [pendingOnline, profileLoaded, vehProfile, enLigne]);

  // Passage HORS LIGNE effectif : vibration + son FORT.
  const passerHorsLigne = () => {
    setEnLigne(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}), 90);
    playCue('complete');
  };

  // Confirmation avant de passer hors ligne (évite les taps accidentels = perte de revenus).
  const demanderHorsLigne = () => {
    Alert.alert(
      'Passer hors ligne ?',
      'Tu ne recevras plus de courses tant que tu ne repasses pas en ligne.',
      [
        { text: 'Rester en ligne', style: 'cancel' },
        { text: 'Passer hors ligne', style: 'destructive', onPress: passerHorsLigne },
      ],
    );
  };

  // Bouton d'urgence SOS (sécurité chauffeur) — ouvre une modale avec sortie claire.
  // (Pas de son ni vibration à l'ouverture : l'ouverture peut être accidentelle.)
  const [sosOpen, setSosOpen] = useState(false);
  const sosUrgence = () => setSosOpen(true);
  const sosPartager = () => {
    const loc = myLoc.current;
    if (!loc) { Alert.alert('Position indisponible', 'Active ta localisation pour partager ta position.'); return; }
    Share.share({ message: `URGENCE Taga — ma position : https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` }).catch(() => {});
  };

  const joursAbo = abo ? Math.max(0, Math.ceil((new Date(abo.expires_at).getTime() - Date.now()) / 86400000)) : 0;
  // Véhicules réellement déclarés par le chauffeur (sinon repli sur son type principal).
  const declaredVehs = (vehProfile?.vehicle_types && vehProfile.vehicle_types.length ? vehProfile.vehicle_types : [vehProfile?.type || 'voiture']);
  // Inscription terminée ? (véhicule déclaré + KYC validé + abonnement actif)
  const vehDeclared = !!(vehProfile && ((vehProfile.vehicle_types && vehProfile.vehicle_types.length) || vehProfile.vehicule));
  // Camion : pas d'abonnement requis (modèle commission).
  const isCamion = activeVeh === 'camion' || (declaredVehs.length === 1 && declaredVehs[0] === 'camion');
  const onboardingReady = vehDeclared && kycStatut === 'valide' && (!!abo || isCamion);

  // Zones de demande : recalcul au montage + toutes les 8 s (temps quasi réel).
  useEffect(() => {
    let mounted = true;
    const refresh = () => getDemandZones(activeVeh).then((z) => { if (mounted) setZones(z.filter((x) => x.level === 'forte')); }).catch(() => {});
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => { mounted = false; clearInterval(iv); };
  }, [activeVeh]);

  // Dispatch admin : si une course m'est assignée, j'y suis envoyé directement.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    let lastHandled: string | null = null;
    const off = subscribeAssignedRides(uid, async (rideId) => {
      if (rideId === acceptedRide.current) return; // je l'ai acceptée moi-même
      if (rideId === lastHandled) return;
      lastHandled = rideId;
      const r = await getRide(rideId);
      if (!r || r.statut !== 'en_route') return;

      const params = {
        rideId: r.id,
        passager: r.passager_nom ?? 'Passager',
        depart: r.depart ?? 'Bamako',
        destination: r.destination ?? 'Bamako',
        distance: String(r.distance_km ?? 0),
        prix: String(r.prix),
        type: r.type ?? 'voiture',
      };

      // LOCATION assignée par l'admin (voiture ET moto) : ça doit SONNER, puis le chauffeur
      // ACCEPTE ou REFUSE — au lieu d'atterrir silencieusement sur la course.
      if (r.location_hours && r.location_hours > 0) {
        startRequestRing(30000);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        notify('Nouvelle location', `${r.depart ?? 'Prise en charge'} · ${r.location_hours} h · ${fcfa(r.prix)}`);
        Alert.alert(
          'Nouvelle location',
          `${r.depart ?? 'Prise en charge'}\n${r.location_hours} h · ${fcfa(r.prix)}`,
          [
            { text: 'Refuser', style: 'destructive', onPress: async () => { stopRequestRing(); try { await refuseLocation(rideId); } catch { toast('Action impossible — réessaie.'); } } },
            { text: 'Accepter', onPress: () => { stopRequestRing(); playDriver('accept'); router.push({ pathname: '/driver/active-trip', params }); } },
          ],
          { cancelable: false },
        );
        return;
      }

      stopRequestRing();
      playDriver('accept');
      notify('Course assignée', `${r.depart ?? ''} → ${r.destination ?? ''}`);
      router.push({ pathname: '/driver/active-trip', params });
    });
    return () => off();
  }, [user?.id]);

  // Déménagement assigné par l'admin (camion) : ça doit SONNER et s'afficher (retour testeur R4).
  // Le déménagement est un devis traité par l'admin, puis attribué à un chauffeur camion : à
  // l'attribution, on sonne + on propose d'ouvrir la course, comme une location assignée.
  useEffect(() => {
    const uid = user?.id;
    if (!uid) return;
    let lastHandled: string | null = null;
    const off = subscribeAssignedMovings(uid, async (movingId) => {
      if (movingId === lastHandled) return;
      lastHandled = movingId;
      const m = await getMovingRequest(movingId).catch(() => null);
      if (!m) return;
      startRequestRing(30000);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      notify('Nouveau déménagement', `${m.depart ?? 'Départ'} → ${m.arrivee ?? 'Arrivée'}${m.prix ? ` · ${fcfa(m.prix)}` : ''}`);
      Alert.alert(
        'Nouveau déménagement',
        `${m.depart ?? 'Départ'} → ${m.arrivee ?? 'Arrivée'}${m.prix ? `\n${fcfa(m.prix)}` : ''}${m.date_souhaitee ? `\n${m.date_souhaitee}${m.creneau ? ` · ${m.creneau}` : ''}` : ''}`,
        [
          { text: 'Plus tard', style: 'cancel', onPress: () => stopRequestRing() },
          { text: 'Voir', onPress: () => { stopRequestRing(); playDriver('accept'); router.push('/driver/demenagements'); } },
        ],
        { cancelable: false },
      );
    });
    return () => off();
  }, [user?.id]);

  // Animation de pulsation de la pastille « En ligne ».
  useEffect(() => {
    if (!enLigne) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enLigne, pulse]);

  // Dispatch serveur : on reçoit des OFFRES séquentielles (une à la fois) + démo solo.
  useEffect(() => {
    if (!enLigne) {
      stopRequestRing();
      setDemande(null);
      return;
    }
    let mounted = true;
    dismissed.current = false;
    const uid = user?.id;

    const showOffer = async (offer: { id: string; ride_id: string; expires_at: string; pool_id?: string | null }) => {
      if (!mounted || dismissed.current) return;
      // Une seule demande à la fois.
      let busy = false;
      setDemande((prev) => { busy = !!prev; return prev; });
      if (busy) return;
      const ride = await getRide(offer.ride_id);
      if (!ride || !mounted || dismissed.current || ride.statut !== 'recherche') return;

      // Offre de COVOITURAGE : on charge les 2 legs pour afficher le gain combiné (~140 %).
      let poolInfo: { poolId: string; gain: number } | null = null;
      if (offer.pool_id) {
        const legs = await getPoolLegs(offer.pool_id);
        if (legs.length < 2 || legs.some((l) => l.statut !== 'recherche' || l.driver_id)) return; // pool plus dispo
        poolInfo = { poolId: offer.pool_id, gain: legs.reduce((s, l) => s + (l.prix ?? 0), 0) };
      }

      // Temps RÉELLEMENT restant sur l'offre.
      // Avant : `Math.max(5, ...)` fabriquait un compte à rebours de 5 s même sur une offre DÉJÀ
      // EXPIRÉE — le chauffeur était réveillé par la sonnerie, se précipitait, acceptait, et le
      // serveur rejetait. On ne montre plus jamais une offre qu'il n'a pas le temps de prendre :
      // en dessous de MIN_ACTION_SEC, on l'ignore silencieusement (le dispatch passe au suivant).
      const restant = Math.round((new Date(offer.expires_at).getTime() - Date.now()) / 1000);
      if (restant < MIN_ACTION_SEC) return;
      const ttl = restant;
      const base = toDemande(ride);
      const d: Demande = poolInfo
        ? { ...base, offerId: offer.id, ttl, poolId: poolInfo.poolId, prix: poolInfo.gain, service: 'Course partagée · 2 passagers' }
        : { ...base, offerId: offer.id, ttl };
      let affichee = false;
      setDemande((prev) => {
        if (prev) return prev;
        affichee = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        startRequestRing(ttl * 1000);
        notify(poolInfo ? `Course partagée · ${fcfa(d.prix)}` : `Nouvelle course · ${fcfa(d.prix)}`, `${d.depart} → ${d.destination}`);
        return d;
      });
      if (!affichee) return;

      // Note du passager : chargée APRÈS coup, sans jamais bloquer l'offre (elle ne dure que 30 s).
      // Si la RPC échoue ou tarde, la carte reste affichée simplement sans note.
      getRidePassengerRating(ride.id)
        .then((r) => {
          if (!mounted) return;
          setDemande((prev) => (prev && prev.rideId === ride.id ? { ...prev, notePassager: r.moyenne } : prev));
        })
        .catch(() => { /* offre affichée sans note : jamais de note fabriquée */ });
    };

    if (uid) {
      getMyPendingOffer(uid).then((o) => { if (o) showOffer(o); }).catch(() => {});
    }
    const unsub = uid ? subscribeMyOffers(uid, (o) => showOffer(o)) : () => {};

    // Démo solo (DEV uniquement) : si aucune offre réelle après ~3 s, injecte une simulée.
    const demoTimer = __DEV__ ? setTimeout(() => {
      if (mounted && !dismissed.current) {
        setDemande((prev) => {
          if (!prev) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            startRequestRing(20000);
            notify(`Nouvelle course · ${fcfa(DEMO_SIM.prix)}`, `${DEMO_SIM.depart} → ${DEMO_SIM.destination}`);
          }
          return prev ?? DEMO_SIM;
        });
      }
    }, 3000) : null;

    return () => {
      mounted = false;
      if (demoTimer) clearTimeout(demoTimer);
      unsub();
    };
  }, [enLigne, user?.id]);

  // Identité STABLE de l'offre affichée. Le compte à rebours et la barre animée se calent dessus,
  // et non sur l'objet `demande` : quand la note du passager arrive (en différé), on remplace l'objet
  // — sans ce garde-fou, le décompte repartirait de zéro et l'offre paraîtrait plus longue qu'elle
  // ne l'est réellement.
  const demandeKey = demande ? (demande.offerId ?? demande.rideId ?? 'sim') : null;

  // Barre de progression animée du compte à rebours.
  useEffect(() => {
    if (!demande) return;
    timer.setValue(1);
    Animated.timing(timer, { toValue: 0, duration: (demande.ttl ?? 20) * 1000, useNativeDriver: false }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeKey, timer]);

  // Compte à rebours de la demande ; à l'expiration on relâche l'offre (réassignation au suivant).
  useEffect(() => {
    if (!demande) return;
    const offerId = demande.offerId;
    setCountdown(demande.ttl ?? 20);
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(id);
          dismissed.current = false; // on pourra recevoir une nouvelle offre
          stopRequestRing();
          if (offerId) respondOffer(offerId, 'expire').catch(() => {});
          setDemande(null);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demandeKey]);

  // Arrête la sonnerie si on quitte l'écran ou qu'on repasse hors ligne.
  useEffect(() => stopRequestRing, []);

  const refuser = () => {
    dismissed.current = false; // prêt à recevoir la prochaine offre
    stopRequestRing();
    if (demande?.offerId) respondOffer(demande.offerId, 'decline').catch(() => {}); // réassignation au suivant
    setDemande(null);
  };

  const accepter = async () => {
    if (!demande) return;
    stopRequestRing();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    playDriver('accept');
    setAccepting(true);
    try {
      if (!demande.sim && demande.offerId) {
        acceptedRide.current = demande.rideId ?? null; // évite le double-traitement via le dispatch
        const res = await acceptOffer(demande.offerId);
        if (!res.ok) {
          acceptedRide.current = null; // l'acceptation a échoué : le dispatch peut reprendre la main
          dismissed.current = false;
          setDemande(null);
          toast(res.reason === 'expired' ? 'Offre expirée' : 'Course déjà prise par un autre chauffeur');
          return;
        }
      }
      const d = demande;
      const dest = reqDest;
      // Covoiturage : on ouvre l'écran dédié (séquence 2 passagers) au lieu de la course simple.
      if (d.poolId) {
        router.push({ pathname: '/driver/pool-trip', params: { poolId: d.poolId } });
        setDemande(null);
        return;
      }
      // On ne vide PAS `demande` avant que la navigation ait réussi : si le push échoue,
      // le chauffeur garde la carte d'offre au lieu de se retrouver sur une carte vide.
      router.push({
        pathname: '/driver/active-trip',
        params: {
          ...(d.rideId ? { rideId: d.rideId } : {}),
          ...(d.sim ? { sim: '1' } : {}),
          passager: d.passager,
          depart: d.depart,
          destination: d.destination,
          ...(d.distance != null ? { distance: String(d.distance) } : {}),
          prix: String(d.prix),
          type: d.type,
          service: d.service,
          ...(d.lat != null && d.lng != null ? { pickupLat: String(d.lat), pickupLng: String(d.lng) } : {}),
          ...(dest ? { dropLat: String(dest.latitude), dropLng: String(dest.longitude) } : {}),
        },
      });
      setDemande(null);
    } catch {
      // Échec (connexion instable) : on restaure l'offre plutôt que de laisser une carte vide.
      acceptedRide.current = null;
      dismissed.current = false;
      toast('Connexion instable — réessaie');
    } finally {
      setAccepting(false);
    }
  };

  // Zone la plus chaude (forte demande) pour la bannière dynamique.
  const hotZone = zones
    .filter((z) => z.level === 'forte')
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0] || null;

  const initiales = demande
    ? demande.passager.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
    : '';

  // Distance d'approche (moi → récupération) et libellés lisibles.
  const fmtDist = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`);
  const pickupKm = myLoc.current && pickupPt ? distanceKm(myLoc.current, pickupPt) : null;
  const pickupLabel = pickupKm != null ? fmtDist(pickupKm) : 'Calcul…';
  // ETA d'approche (moi → passager) : repli + trafic Bamako.
  const pickupEta = (myLoc.current && pickupPt) ? realisticEta(fallbackEstimate(myLoc.current, pickupPt).durationMin) : null;
  // Durée de la course (récup → destination) réaliste, avec repli si OSRM absent.
  const tripFb = (pickupPt && reqDest) ? fallbackEstimate(pickupPt, reqDest) : null;
  const tripEta = realisticEta(reqRoute?.durationMin ?? tripFb?.durationMin ?? null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface2 }}>
      {/* Carte plein écran avec les zones de demande de Bamako */}
      <TripMap fill rounded={false} self={myPos ?? undefined} selfHeading={myHeading} zones={zones} frameZones={demandView} recenterKey={recenter} />

      {/* En-tête épuré façon Uber : profil · gains du jour · stats */}
      <SafeAreaView edges={['top']} pointerEvents="box-none" style={st.topOverlay}>
        <View style={st.topRow}>
          {/* Espace réservé (garde la pastille de gains centrée) */}
          <View style={{ width: 46 }} />

          <Pressable style={st.earnPill} onPress={() => router.push('/driver/gains')}>
            <Text style={st.earnPillText}>{fcfa(gains)}</Text>
          </Pressable>

          {/* Notifications & messages */}
          <Pressable style={st.roundDark} onPress={() => router.push('/driver/notifications')}>
            <Ionicons name="notifications" size={20} color={colors.white} />
            {notifUnread > 0 ? <View style={st.bellDot} /> : null}
          </Pressable>
        </View>

        {/* Forte demande (petite pastille, seulement en ligne) */}
        {enLigne && hotZone && !demandView && (
          <View style={st.hotPill}>
            <Ionicons name="flame" size={14} color={colors.white} />
            <Text style={st.hotPillText} numberOfLines={1}>Forte demande · {hotZone.nom}</Text>
          </View>
        )}

        {/* Courses à venir (locations programmées pré-assignées) */}
        {upcoming > 0 && !demandView && (
          <Pressable style={st.upcomingPill} onPress={() => router.push('/driver/upcoming')}>
            <Ionicons name="calendar" size={14} color={colors.ink} />
            <Text style={st.upcomingText}>{upcoming} course{upcoming > 1 ? 's' : ''} à venir</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.inkSoft} />
          </Pressable>
        )}

        {/* Légende des zones de demande (vue « occupé ») */}
        {demandView && (
          <View style={st.dzLegend}>
            <Text style={st.dzLegendTitle}>Zones de demande</Text>
            <View style={st.dzLegendRow}>
              <View style={[st.dzLegendDot, { backgroundColor: '#E84B1F' }]} /><Text style={st.dzLegendTxt}>Forte</Text>
              <View style={[st.dzLegendDot, { backgroundColor: '#E0A82E', marginLeft: 12 }]} /><Text style={st.dzLegendTxt}>Moyenne</Text>
              <View style={[st.dzLegendDot, { backgroundColor: '#137A4B', marginLeft: 12 }]} /><Text style={st.dzLegendTxt}>Faible</Text>
            </View>
          </View>
        )}
      </SafeAreaView>

      {/* Zone basse façon Uber : actions flottantes + GO + bandeau d'accueil */}
      {!demande && (
        <View style={[st.bottomArea, { paddingBottom: insets.bottom + 14 }]} pointerEvents="box-none">
          {/* Reprise : course/livraison en cours toujours récupérable (jamais perdue) */}
          {resume && (
            <Pressable style={st.resumeCard} onPress={() => router.push({ pathname: resume.pathname, params: resume.params })}>
              <View style={st.resumeIcon}>
                <Ionicons name={resume.kind === 'delivery' ? 'fast-food' : 'car-sport'} size={20} color={colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.resumeTitle}>{resume.kind === 'delivery' ? 'Livraison en cours' : 'Course en cours'}</Text>
              </View>
              <View style={st.resumeCta}><Text style={st.resumeCtaTxt}>Reprendre</Text></View>
            </Pressable>
          )}
          {/* Offre de livraison en attente : bandeau visible et tappable (sinon le coursier ne voit rien). */}
          {livCount > 0 && (
            <Pressable style={st.livOfferCard} onPress={() => { stopRequestRing(); router.push('/driver/livraisons'); }}>
              <View style={st.livOfferIcon}><Ionicons name="fast-food" size={20} color={colors.white} /></View>
              <View style={{ flex: 1 }}>
                {/* Titre + note du client (moyenne agrégée) : le livreur sait à qui il a affaire
                    AVANT d'accepter, comme sur une offre de course. « Nouveau » si moins de 3 notes. */}
                <View style={st.livOfferTitleRow}>
                  <Text style={st.livOfferTitle} numberOfLines={1}>Nouvelle livraison proposée</Text>
                  {livNoteVal != null ? (
                    <View style={st.livNote}>
                      <Ionicons name="star" size={12} color={colors.gold} />
                      <Text style={st.livNoteTxt}>{fmtNote(livNoteVal)}</Text>
                    </View>
                  ) : livNoteVal === null ? (
                    <View style={st.livNew}><Text style={st.livNewTxt}>Nouveau</Text></View>
                  ) : null}
                </View>
                <Text style={st.livOfferSub} numberOfLines={1}>
                  {livSecs != null ? (livSecs > 0 ? `Accepte avant ${livSecs}s` : 'Offre expirée') : 'Accepte-la avant qu\'elle expire'}
                </Text>
              </View>
              {/* Ce que le livreur TOUCHE : aussi lisible que le prix d'une offre de course.
                  Rien n'est affiché tant que le gain n'est pas connu — jamais de montant inventé. */}
              <View style={st.livOfferRight}>
                {livGainVal != null ? (
                  <>
                    <Text style={st.livGainLabel}>Tu gagnes</Text>
                    <Text style={st.livGain} numberOfLines={1}>{fcfa(livGainVal)}</Text>
                  </>
                ) : null}
                <View style={st.livOfferCta}><Text style={st.livOfferCtaTxt}>Voir</Text></View>
              </View>
            </Pressable>
          )}
          {/* Inscription incomplète : bandeau vers le parcours guidé (masqué tant que le profil charge) */}
          {profileLoaded && !onboardingReady && (
            <Pressable style={st.onbCard} onPress={() => router.push('/driver/onboarding')}>
              <View style={st.onbTop}>
                <View style={st.onbIcon}><Ionicons name="rocket" size={14} color="#fff" /></View>
                {/* N'affiche QUE les étapes réellement manquantes : un chauffeur déjà validé
                    ne doit pas voir « Véhicule · Documents » comme s'il devait les refaire. */}
                {(() => {
                  const manque = [
                    !vehDeclared && 'Véhicule',
                    kycStatut !== 'valide' && 'Documents',
                    !abo && !isCamion && 'Abonnement',
                  ].filter(Boolean) as string[];
                  const titre = manque.length !== 1 ? 'Termine ton inscription'
                    : manque[0] === 'Abonnement' ? 'Abonnement requis pour passer en ligne'
                    : `Il reste : ${manque[0]}`;
                  return <Text style={st.onbTitle}>{titre}</Text>;
                })()}
              </View>
              <View style={st.onbSteps}>
                {!vehDeclared && <Text style={st.onbSub}>Véhicule</Text>}
                {kycStatut !== 'valide' && <Text style={st.onbSub}>Documents</Text>}
                {!abo && !isCamion && <Text style={st.onbSub}>Abonnement</Text>}
              </View>
            </Pressable>
          )}
          {/* Sélecteur de véhicule (avant de passer en ligne) : seulement parmi les véhicules DÉCLARÉS, et s'il y en a plusieurs */}
          {!enLigne && declaredVehs.length > 1 && (
            <View style={st.vehRow}>
              {([['voiture', 'car', 'Voiture'], ['moto', 'bicycle', 'Moto'], ['tricycle', 'cube', 'Tricycle'], ['camion', 'bus', 'Camion']] as const)
                .filter(([v]) => declaredVehs.includes(v))
                .map(([v, ic, lab]) => {
                  const on = activeVeh === v;
                  return (
                    <Pressable key={v} onPress={() => { vehChosenRef.current = true; setActiveVeh(v); }} style={[st.vehChip, on && st.vehChipOn]}>
                      <Ionicons name={ic as any} size={15} color={on ? colors.white : colors.ink} />
                      <Text style={[st.vehChipTxt, on && { color: colors.white }]}>{lab}</Text>
                    </Pressable>
                  );
                })}
            </View>
          )}
          <View style={st.floatRow} pointerEvents="box-none">
            {/* Assistance + Urgence SOS */}
            <View style={{ gap: 12, alignItems: 'center' }}>
              <Pressable style={st.fab} onPress={() => router.push('/driver/help')}>
                <Ionicons name="headset" size={20} color={colors.ink} />
              </Pressable>
              <Pressable style={st.sosFab} onPress={sosUrgence}>
                <Ionicons name="warning" size={22} color={colors.white} />
                <Text style={st.sosText}>SOS</Text>
              </Pressable>
            </View>

            {/* Modale Urgence SOS — fermable : croix, backdrop, bouton Annuler, retour Android. */}
            <Modal visible={sosOpen} animationType="slide" transparent onRequestClose={() => setSosOpen(false)}>
              <Pressable style={st.sosBackdrop} onPress={() => setSosOpen(false)}>
                <Pressable style={st.sosSheet} onPress={(e) => e.stopPropagation()}>
                  <SafeAreaView edges={['bottom']}>
                    <View style={st.sosHandle} />
                    <View style={st.sosHead}>
                      <View style={st.sosHeadIcon}><Ionicons name="warning" size={20} color={colors.white} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.sosTitle}>Urgence SOS</Text>
                        <Text style={st.sosSub}>Tu es en danger ou en difficulté ?</Text>
                      </View>
                      <Pressable onPress={() => setSosOpen(false)} hitSlop={12} style={st.sosClose}>
                        <Ionicons name="close" size={24} color={colors.ink} />
                      </Pressable>
                    </View>

                    <Pressable style={st.sosRow} onPress={() => { setSosOpen(false); sosPartager(); }}>
                      <View style={[st.sosRowIcon, { backgroundColor: colors.brand + '22' }]}><Ionicons name="share-social" size={20} color={colors.brand} /></View>
                      <View style={{ flex: 1 }}><Text style={st.sosRowTitle}>Partager ma position</Text><Text style={st.sosRowSub}>Envoie ta localisation à un proche</Text></View>
                    </Pressable>
                    <Pressable style={st.sosRow} onPress={() => { setSosOpen(false); Linking.openURL('tel:17').catch(() => {}); }}>
                      <View style={[st.sosRowIcon, { backgroundColor: '#137A4B22' }]}><Ionicons name="call" size={20} color="#137A4B" /></View>
                      <View style={{ flex: 1 }}><Text style={st.sosRowTitle}>Appeler la police · 17</Text><Text style={st.sosRowSub}>Police secours</Text></View>
                    </Pressable>
                    <Pressable style={st.sosRow} onPress={() => { setSosOpen(false); Linking.openURL('tel:18').catch(() => {}); }}>
                      <View style={[st.sosRowIcon, { backgroundColor: '#E0A82E22' }]}><Ionicons name="flame" size={20} color="#E0A82E" /></View>
                      <View style={{ flex: 1 }}><Text style={st.sosRowTitle}>Appeler les pompiers · 18</Text><Text style={st.sosRowSub}>Incendie & secours</Text></View>
                    </Pressable>

                    <Pressable style={st.sosCancel} onPress={() => setSosOpen(false)}>
                      <Text style={st.sosCancelText}>Annuler</Text>
                    </Pressable>
                  </SafeAreaView>
                </Pressable>
              </Pressable>
            </Modal>

            {/* GO / En ligne */}
            <Pressable
              onPress={enLigne ? demanderHorsLigne : passerEnLigne}
              style={({ pressed }) => [st.goRound, { backgroundColor: enLigne ? colors.green : colors.brand, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
            >
              {enLigne ? (
                <Animated.View style={[st.goPulse, { opacity: pulse }]} />
              ) : null}
              <Text style={enLigne ? st.goRoundTextOn : st.goRoundText} numberOfLines={1}>{enLigne ? 'EN LIGNE' : 'GO'}</Text>
            </Pressable>

            {/* Filtre « zones occupées » (demande) + recentrer sur ma position */}
            <View style={{ gap: 12, alignItems: 'center' }}>
              <Pressable style={[st.fab, demandView && st.fabActive]} onPress={() => setDemandView((v) => !v)} accessibilityLabel="Voir les zones de demande">
                <Ionicons name="flame" size={20} color={demandView ? colors.white : colors.brand} />
              </Pressable>
              <Pressable style={st.fab} onPress={() => { setDemandView(false); setRecenter((n) => n + 1); }}>
                <Ionicons name="locate" size={20} color={colors.ink} />
              </Pressable>
            </View>
          </View>

          {/* Bandeau d'accueil : EN LIGNE → on met en avant l'attente de demandes (pas de « Bonjour »).
              HORS LIGNE → salutation adaptée à l'heure (Bonjour / Bonsoir). */}
          <View style={st.greet}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={st.greetName} numberOfLines={1}>
                {enLigne
                  ? 'En attente de demandes…'
                  : `${(new Date().getHours() >= 17 || new Date().getHours() < 5) ? 'Bonsoir' : 'Bonjour'}, ${driver.nom.split(' ')[0].toUpperCase()}`}
              </Text>
              {/* En ligne : on garde SEULEMENT « En attente de demandes… » (pas de sous-ligne). */}
              {!enLigne && (
                <Text style={st.greetSub} numberOfLines={1}>
                  {kycStatut !== 'valide' ? (kycStatut === 'refuse' ? 'Dossier refusé · corrige tes documents' : 'Dossier en attente de validation Taga') : !abo ? "Tu n'es pas en ligne" : 'Prêt à rouler ?'}
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* Demande entrante (overlay bas) */}
      {demande && (
        <View style={[st.demandeWrap, { paddingBottom: insets.bottom + 14 }]}>
          {/* La carte ne dépasse jamais le haut (safe-area) : le corps défile, les boutons restent épinglés. */}
          <View style={[st.demande, { maxHeight: winH - insets.top - 16 }]}>
            <View style={st.grabber} />

            {/* Corps défilant : sur petit écran, la carte d'aperçu se réduit/disparaît et le contenu scrolle
                au lieu de pousser prix/passager sous l'encoche. */}
            <ScrollView
              style={{ maxHeight: winH * 0.7 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 4 }}
              keyboardShouldPersistTaps="handled"
            >
            <View style={st.demandeHead}>
              <Avatar text={initiales} size={48} tone="brand" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                {/* Nom + note du passager (moyenne agrégée). Reste discret : le prix garde la vedette. */}
                <View style={st.passNameRow}>
                  <Text style={st.passager} numberOfLines={1}>{demande.passager}</Text>
                  {demande.notePassager != null ? (
                    <View style={st.passNote}>
                      <Ionicons name="star" size={12} color={colors.gold} />
                      <Text style={st.passNoteTxt}>{fmtNote(demande.notePassager)}</Text>
                    </View>
                  ) : demande.notePassager === null ? (
                    // Moins de 3 notes : badge neutre. Un client sans historique ne doit pas paraître mauvais.
                    <View style={st.passNew}><Text style={st.passNewTxt}>Nouveau</Text></View>
                  ) : null}
                </View>
                <View style={st.passSubRow}>
                  <View style={st.typeBadge}>
                    <Ionicons
                      name={demande.type === 'moto' ? 'bicycle' : demande.type === 'colis' ? 'cube' : 'car'}
                      size={12}
                      color={colors.brandDeep}
                    />
                    <Text style={st.typeBadgeText} numberOfLines={1}>{demande.service}</Text>
                  </View>
                  {demande.stops && demande.stops.length ? (
                    <View style={st.stopChip}>
                      <Ionicons name="flag" size={11} color={colors.white} />
                      <Text style={st.stopChipText}>{demande.stops.length} stop{demande.stops.length > 1 ? 's' : ''}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {/* Prix de la course : l'info dont le chauffeur a besoin pour décider, sans détail
                  de répartition ni de commission (le suivi des revenus se fait sur l'écran Gains). */}
              {/* À la sonnerie : PRIX uniquement (pas de km ni d'adresses écrites). Le chauffeur
                  peut voir le trajet sur la carte ; la destination, le km et l'encaissement
                  n'apparaissent qu'au démarrage de la course. */}
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={st.prix}>{fcfa(demande.prix)}</Text>
              </View>
            </View>

            {/* Aperçu carte de la course (façon Uber) : récupération → destination.
                Sur petit écran on la réduit (110), sur très petit on la masque pour garder prix + boutons visibles. */}
            {pickupPt && winH >= 640 && (
              <View style={st.demandeMap}>
                <TripMap
                  height={winH < 760 ? 110 : 150}
                  rounded
                  origin={pickupPt}
                  destination={demande.location ? undefined : (reqDest ?? undefined)}
                  routeCoords={demande.location ? undefined : reqRoute?.coords}
                  stops={!demande.location && demande.stops && demande.stops.length ? demande.stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })) : undefined}
                  vehicle={iconeCarte(demande.type)}
                  abMarkers
                  fitRoute
                />
              </View>
            )}


            {/* Compte à rebours animé */}
            <View style={st.timerRow}>
              <Text style={st.timerLabel}>Accepte avant</Text>
              <Text style={st.timerSec}>{countdown}s</Text>
            </View>
            <View style={st.timerTrack}>
              <Animated.View
                style={[st.timerFill, { width: timer.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
              />
            </View>
            </ScrollView>

            {/* Accepter DOMINANT (pleine largeur) au-dessus, Refuser en pastille contrastée en-dessous.
                Ce bloc reste ÉPINGLÉ hors du ScrollView : le chauffeur voit toujours les deux actions. */}
            <View style={st.demandeBtns}>
              <Btn label="Accepter" onPress={accepter} loading={accepting} style={{ width: '100%' }} />
              <Pressable onPress={refuser} hitSlop={8} style={st.refuseLink}>
                <Text style={st.refuseLinkTxt}>Refuser</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function Pill({ color, label }: { color: string; label: string }) {
  return (
    <View style={st.pill}>
      <View style={[st.pillDot, { backgroundColor: color }]} />
      <Text style={st.pillText}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  heat: { position: 'absolute', borderRadius: 100 },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.lg },

  // En-tête épuré (Uber-style)
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  roundBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  roundDark: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', ...shadow.pop },
  bellDot: { position: 'absolute', top: 9, right: 10, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.brand, borderWidth: 2, borderColor: colors.ink },
  onbCard: { alignSelf: 'center', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 20, marginBottom: 10, ...shadow.pop },
  onbTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  onbIcon: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  onbTitle: { fontSize: 14.5, fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  onbSteps: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  onbSub: { fontSize: 11.5, fontWeight: '700', color: 'rgba(255,255,255,0.9)' },
  onbDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.55)' },
  vehRow: { flexDirection: 'row', gap: 8, alignSelf: 'center', marginBottom: 12 },
  vehChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: 19, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line2, ...shadow.card },
  vehChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  vehChipTxt: { fontSize: 13, fontWeight: '800', color: colors.ink },
  earnPill: { backgroundColor: colors.ink, borderRadius: 24, paddingHorizontal: 22, paddingVertical: 11, minWidth: 110, alignItems: 'center', ...shadow.pop },
  earnPillText: { color: colors.white, fontSize: 17, fontWeight: '800', letterSpacing: 0.2 },
  hotPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', maxWidth: '90%', backgroundColor: colors.brand, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginTop: 12, shadowColor: '#15110E', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  upcomingPill: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginTop: 10, borderWidth: 1, borderColor: colors.line2, ...shadow.card },
  upcomingText: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  hotPillText: { flexShrink: 1, fontSize: 12.5, fontWeight: '800', color: colors.white },

  // Zone basse (Uber-style)
  bottomArea: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  resumeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.ink, marginHorizontal: space.lg, marginBottom: 12, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 13, ...shadow.pop },
  resumeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  resumeTitle: { color: colors.white, fontSize: 15, fontWeight: '800' },
  resumeSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  resumeCta: { backgroundColor: colors.brand, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  resumeCtaTxt: { color: colors.white, fontSize: 13, fontWeight: '800' },
  livOfferCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.green, marginHorizontal: space.lg, marginBottom: 12, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 13, ...shadow.pop },
  livOfferIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  livOfferTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  livOfferTitle: { flexShrink: 1, color: colors.white, fontSize: 15, fontWeight: '800' },
  livNote: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  livNoteTxt: { color: colors.white, fontSize: 13.5, fontWeight: '800' },
  livNew: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)' },
  livNewTxt: { color: colors.white, fontSize: 11, fontWeight: '800' },
  livOfferSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  // Gain du livreur : gros et contrasté sur le bandeau vert (même poids que le prix d'une offre de course).
  livOfferRight: { alignItems: 'flex-end', gap: 6 },
  livGainLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  livGain: { color: colors.white, fontSize: 22, fontWeight: '800', marginTop: -2 },
  livOfferCta: { backgroundColor: colors.white, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  livOfferCtaTxt: { color: colors.green, fontSize: 13, fontWeight: '800' },
  floatRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: space.lg, marginBottom: 16 },
  // Ombre ronde sûre : PAS d'`elevation` (sur Android l'elevation rend un carré derrière le rond).
  // On garde une ombre douce iOS + une fine bordure pour le relief.
  fab: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, shadowColor: '#15110E', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  fabActive: { backgroundColor: colors.brand, borderWidth: 0 },
  dzLegend: { alignSelf: 'center', backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9, marginTop: 12, borderWidth: 1, borderColor: colors.line, shadowColor: '#15110E', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  dzLegendTitle: { fontSize: 12, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 5 },
  dzLegendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dzLegendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  dzLegendTxt: { fontSize: 12, fontWeight: '700', color: colors.ink2 },
  sosFab: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#D8261C', alignItems: 'center', justifyContent: 'center', shadowColor: '#15110E', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  sosText: { color: colors.white, fontSize: 9.5, fontWeight: '800', marginTop: 1, letterSpacing: 0.5 },
  sosBackdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.45)', justifyContent: 'flex-end' },
  sosSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 8, paddingBottom: 6 },
  sosHandle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 14 },
  sosHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  sosHeadIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#D8261C', alignItems: 'center', justifyContent: 'center' },
  sosTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sosSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  sosClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sosRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
  sosRowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sosRowTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  sosRowSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  sosCancel: { height: 52, borderRadius: radius.lg, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 6 },
  sosCancelText: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  fabDot: { position: 'absolute', top: 8, right: 9, width: 11, height: 11, borderRadius: 6, backgroundColor: colors.green, borderWidth: 2, borderColor: colors.surface },
  goRound: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', ...shadow.pop },
  goPulse: { position: 'absolute', width: 92, height: 92, borderRadius: 46, backgroundColor: 'rgba(255,255,255,0.25)' },
  goRoundText: { color: colors.white, fontSize: 26, fontWeight: '800', letterSpacing: 0.5 },
  goRoundTextOn: { color: colors.white, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  greet: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.ink, marginHorizontal: space.lg, borderRadius: radius.xl, paddingHorizontal: 18, paddingVertical: 14, ...shadow.pop },
  greetName: { color: colors.white, fontSize: 17, fontWeight: '800' },
  greetSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, fontWeight: '600', marginTop: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 6, gap: 12 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 3 },
  bigTitle: { fontSize: 26, fontWeight: '800', color: colors.ink, lineHeight: 30 },
  bigSub: { fontSize: 15, fontWeight: '600', color: colors.inkSoft },
  iconBtns: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  statCard: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 16, paddingVertical: 11, marginTop: 14, ...shadow.card },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statNum: { fontSize: 17, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 11, fontWeight: '700', color: colors.inkMute, textTransform: 'uppercase', letterSpacing: 0.3 },
  statSep: { width: 1, height: 24, backgroundColor: colors.line, marginHorizontal: 14 },
  hotBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: colors.brand, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, marginTop: 12, ...shadow.pop },
  hotText: { flex: 1, fontSize: 13, fontWeight: '800', color: colors.white },
  legendCard: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 13, paddingVertical: 11, marginTop: 12, gap: 8, ...shadow.card },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { fontSize: 12.5, fontWeight: '700', color: colors.ink2 },
  earnChip: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12, ...shadow.card },
  earnChipText: { fontSize: 12.5, fontWeight: '800', color: colors.ink },
  aboChip: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10, ...shadow.card },
  aboChipText: { fontSize: 12.5, fontWeight: '800', color: colors.ink },

  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: 10 },
  hello: { fontSize: 20, fontWeight: '800', color: colors.ink },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  role: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  onlineTag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.greenSoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  onlineText: { fontSize: 12, fontWeight: '800', color: colors.green },

  earnWrap: { paddingHorizontal: space.lg, paddingBottom: 6 },
  earnCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.lg, paddingHorizontal: 18, paddingVertical: 16, ...shadow.card },
  earnLabel: { fontSize: 13, fontWeight: '700', color: colors.inkMute },
  earnAmount: { fontSize: 26, fontWeight: '800', color: colors.white, marginTop: 4 },
  earnIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },

  mapWrap: { paddingHorizontal: space.lg, marginTop: 6 },
  map: { height: 260, borderRadius: radius.lg, backgroundColor: colors.surface2, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, position: 'relative' },
  zone: { position: 'absolute', borderRadius: 100 },
  zoneLabel: { position: 'absolute', fontSize: 11.5, fontWeight: '800', color: colors.ink2 },
  mapRoad: { position: 'absolute', left: 0, right: 0, top: '52%', height: 8, backgroundColor: colors.white, opacity: 0.7 },
  mapRoadV: { position: 'absolute', top: 0, bottom: 0, left: '42%', width: 8, backgroundColor: colors.white, opacity: 0.7 },

  center: { alignItems: 'center', marginTop: 26, paddingHorizontal: space.lg },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink },
  subtitle: { fontSize: 15, fontWeight: '600', color: colors.inkSoft, marginTop: 6 },
  statsRow: { marginTop: 16, backgroundColor: colors.surface2, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  statsText: { fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  pills: { flexDirection: 'row', gap: 10, marginTop: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  pillDot: { width: 10, height: 10, borderRadius: 5 },
  pillText: { fontSize: 13, fontWeight: '800', color: colors.ink2 },

  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: 12 },
  goBtn: { height: 62, borderRadius: radius.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, ...shadow.pop },
  goText: { fontSize: 17, fontWeight: '800', color: colors.white, letterSpacing: 0.3 },

  demandeWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingTop: 12 },
  demande: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderWidth: 1, borderColor: colors.line, ...shadow.pop },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 10 },
  demandeHead: { flexDirection: 'row', alignItems: 'center' },
  demandeMap: { marginTop: 10, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  // Le nom se rétrécit (flexShrink) pour que la note reste TOUJOURS visible d'un coup d'œil.
  passNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passager: { flexShrink: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  passNote: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  passNoteTxt: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  passNew: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.line },
  passNewTxt: { fontSize: 11, fontWeight: '800', color: colors.inkSoft },
  passSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  typeBadgeText: { fontSize: 12, fontWeight: '800', color: colors.brandDeep },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  passSub: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  // Prix = l'info n°1 de décision : gros et contrasté (lisible en une seconde, au volant).
  prix: { fontSize: 24, fontWeight: '800', color: colors.brand },
  prixSub: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft, marginTop: 2 },

  // Timeline récupération → destination
  timeline: { flexDirection: 'row', marginTop: 10, gap: 12 },
  tlRail: { width: 12, alignItems: 'center', paddingTop: 4 },
  tlDot: { width: 11, height: 11, borderRadius: 6, borderWidth: 2.5, borderColor: '#fff' },
  tlLine: { flex: 1, width: 2, backgroundColor: colors.line2, marginVertical: 3 },
  tlSquare: { width: 11, height: 11, borderRadius: 3, borderWidth: 2.5, borderColor: '#fff' },
  tlItem: {},
  tlLabel: { fontSize: 12, fontWeight: '800', color: colors.inkSoft, letterSpacing: 0.4 },
  tlPlace: { fontSize: 13.5, fontWeight: '700', color: colors.ink, marginTop: 1 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  tlPointDot: { width: 11, height: 11, borderRadius: 6, marginTop: 4 },
  tlCap: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft },
  stopChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.ink, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  stopChipText: { fontSize: 12, fontWeight: '800', color: colors.white },

  // Compte à rebours animé
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  timerLabel: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  timerSec: { fontSize: 14, fontWeight: '800', color: colors.brandDeep },
  timerTrack: { height: 6, borderRadius: 3, backgroundColor: colors.brandSoft, overflow: 'hidden', marginTop: 8 },
  timerFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },

  demandeBtns: { marginTop: 14, gap: 16 },
  refuseLink: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 50, paddingVertical: 13, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line2, backgroundColor: colors.surface },
  refuseLinkTxt: { fontSize: 15, fontWeight: '800', color: colors.ink2 },
});
