import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Share, Modal, Linking } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { colors, radius, shadow, space } from '../../theme';
import { Avatar, useToast, Btn } from '../../components/ui';
import { TripMap, BAMAKO, distanceKm } from '../../components/TripMap';
import { fcfa } from '../../data/mock';
import { setRideStatut, updateDriverPosition, markRidePaid, closeRide, getRide, subscribeRide, subscribeMessages, locationStart, locationStop, refuseLocation, deliverColisWithCode, getGeoRadii, getRideContactPhone, driverCancelRide, getWaitingConfig, getStopWaitConfig, setStopArrive, iconeCarte, subscribeMyOffers, getPendingPartageAddon, acceptPartageAddon, declinePartageAddon, type PartageAddon } from '../../lib/db';
import { supabase } from '../../lib/supabase';
import { contactParty } from '../../lib/contact';
import { notify } from '../../lib/notify';
import { routeBetween, routeVia, moveHeading, type GeoRoute } from '../../lib/geo';
import { openNavigation } from '../../lib/navigation';
import { playDriver } from '../../lib/sound';
import { SlideButton } from '../../components/SlideButton';
import { CodeConfirm } from '../../components/CodeConfirm';

type Pt = { latitude: number; longitude: number };

// Repli si les réglages admin sont indisponibles (source réelle : table app_numbers,
// clés « wait_grace_min » et « wait_fee », lues par getWaitingConfig()).
// Règle : les 7 premières minutes d'attente sont offertes, puis un FORFAIT UNIQUE s'ajoute
// au trajet (2 000 F -> 2 200 F). Ce n'est pas un tarif à la minute.
const WAIT_FREE_MIN = 7;  // minutes d'attente offertes au point de prise en charge
const WAIT_FEE = 200;     // F CFA ajoutés au trajet une fois la franchise dépassée (forfait)

// Cap GPS exploitable ? expo-location renvoie -1 (ou null) quand le cap est indisponible.
function capGps(h?: number | null): number | null {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 360 ? h : null;
}

export default function ActiveTrip() {
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    rideId?: string;
    sim?: string;
    passager?: string;
    depart?: string;
    destination?: string;
    distance?: string;
    prix?: string;
    type?: string;
    service?: string;
    pickupLat?: string;
    pickupLng?: string;
    dropLat?: string;
    dropLng?: string;
  }>();

  const rideId = typeof params.rideId === 'string' ? params.rideId : undefined;
  const isSim = params.sim === '1';
  const passager = (params.passager as string) ?? 'Fatoumata Keita';
  // Adresses / prix / points : en ÉTAT car le client peut les modifier en cours de course.
  const [depart, setDepart] = useState((params.depart as string) ?? 'Hippodrome, Bamako');
  const [destination, setDestination] = useState((params.destination as string) ?? 'Grand Marché de Bamako');
  const [distance, setDistance] = useState(Number(params.distance ?? '0'));
  const [prix, setPrix] = useState(Number(params.prix ?? '0'));
  const [fraisService, setFraisService] = useState(Number((params as any).frais_service ?? '0')); // frais Taga inclus dans prix
  const [pickup, setPickup] = useState<Pt>(params.pickupLat && params.pickupLng
    ? { latitude: Number(params.pickupLat), longitude: Number(params.pickupLng) }
    : BAMAKO.driver);
  const [dropoff, setDropoff] = useState<Pt | undefined>(params.dropLat && params.dropLng
    ? { latitude: Number(params.dropLat), longitude: Number(params.dropLng) }
    : BAMAKO.aeroport);
  const [addrBanner, setAddrBanner] = useState<string | null>(null); // bandeau « client a modifié … »
  // PARTAGE (modèle A) : si cette course est une course partagée en cours, le chauffeur peut recevoir
  // une 2e course partagée EMPILÉE (offre « +1 ») assignée par l'admin. À l'acceptation, on bascule sur
  // l'écran course partagée (pool-trip) qui gère les 2 récupérations / dépôts ordonnés du + proche au + loin.
  const [isPartage, setIsPartage] = useState(false);
  const [myUid, setMyUid] = useState<string | null>(null);
  const [addon, setAddon] = useState<PartageAddon | null>(null);
  // Le client a-t-il RÉELLEMENT modifié la destination ? (drapeau serveur). Le bouton « client a changé
  // de destination » n'apparaît que si oui — sinon le chauffeur pourrait annuler « sans faute » à tort.
  const [destModified, setDestModified] = useState(false);

  const isColis = (params.type as string) === 'colis'; // course colis (coursier) : aucun passager
  const [phase, setPhase] = useState<1 | 2 | 3>(1);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [pos, setPos] = useState<Pt>(pickup);
  const [cap, setCap] = useState<number | undefined>(undefined); // cap réel du véhicule (0 = nord)
  const [locFixed, setLocFixed] = useState(false); // vraie position GPS obtenue (sinon on ne bloque pas)
  const [radii, setRadii] = useState({ arriveeM: 150, depotM: 180 }); // rayons réglés côté admin
  useEffect(() => { getGeoRadii().then(setRadii).catch(() => {}); }, []);
  // Attente au point de prise en charge : minutes offertes puis forfait unique (réglés côté admin).
  const [waitCfg, setWaitCfg] = useState({ graceMin: WAIT_FREE_MIN, fee: WAIT_FEE });
  useEffect(() => { getWaitingConfig().then(setWaitCfg).catch(() => {}); }, []);
  const [arrivedAt, setArrivedAt] = useState<number | null>(null); // horodatage « je suis arrivé »
  const [waitNow, setWaitNow] = useState(() => Date.now()); // instant courant, rafraîchi chaque seconde
  const [paiement, setPaiement] = useState('Espèces');
  const [creditApplied, setCreditApplied] = useState(0);
  const [passPhoto, setPassPhoto] = useState<string | null>(null);
  const [stopPts, setStopPts] = useState<{ label?: string; lat?: number; lng?: number }[]>([]);
  const [colisNote, setColisNote] = useState<string | null>(null); // contenu du colis (si renseigné)
  const [legIdx, setLegIdx] = useState(0); // étape courante en phase 3 : 0..stops puis destination
  // Attente au POINT INTERMÉDIAIRE (arrêt) : franchise offerte puis majoration par paliers.
  const [stopArrivedAt, setStopArrivedAt] = useState<number | null>(null); // arrivé à l'arrêt courant (ms)
  const [stopFee, setStopFee] = useState(0); // supplément d'arrêt déjà verrouillé (arrêts précédents)
  const [stopNow, setStopNow] = useState(() => Date.now());
  const [stopCfg, setStopCfg] = useState({ graceMin: 4, palierMin: 4, palierFee: 200 });
  useEffect(() => { getStopWaitConfig().then(setStopCfg).catch(() => {}); }, []);
  const destRef = useRef(destination); const departRef = useRef(depart);
  // `synced` = vrai seulement après la 1re synchro depuis la BASE. Avant ça, `destRef`/`departRef`
  // contiennent les paramètres de navigation (souvent différents de la vraie valeur en base), donc
  // toute comparaison déclencherait un FAUX bandeau « client a modifié… ». On ne compare qu'après synchro.
  const syncedRef = useRef(false);
  useEffect(() => { destRef.current = destination; }, [destination]);
  useEffect(() => { departRef.current = depart; }, [depart]);

  // Applique une ligne de course (init ou temps réel) : adresses, prix, points. Détecte les modifs client.
  const applyRideRow = (r: any, initial = false) => {
    if (!r) return;
    if (r.prix != null) setPrix(Number(r.prix));
    if (r.frais_service != null) setFraisService(Number(r.frais_service));
    if (r.distance_km != null) setDistance(Number(r.distance_km));
    if (r.dest_lat != null && r.dest_lng != null) setDropoff({ latitude: Number(r.dest_lat), longitude: Number(r.dest_lng) });
    if (r.depart_lat != null && r.depart_lng != null) setPickup({ latitude: Number(r.depart_lat), longitude: Number(r.depart_lng) });
    // Détection d'une modif client : UNIQUEMENT après la synchro DB initiale, et par rapport à la
    // dernière valeur RÉELLE connue (mise à jour synchrone ci-dessous) — pas au paramètre de navigation.
    if (!initial && syncedRef.current) {
      if (r.destination != null && r.destination !== destRef.current) {
        setAddrBanner('Le client a modifié la destination');
        playDriver('request'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        notify('Destination modifiée', String(r.destination));
      } else if (r.depart != null && r.depart !== departRef.current) {
        setAddrBanner('Le client a modifié le point de prise en charge');
        playDriver('request'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        notify('Départ modifié', String(r.depart));
      }
    }
    // Met à jour l'état ET la référence (SYNCHRONE) : la prochaine comparaison se fait sur la vraie
    // dernière valeur, ce qui évite les re-déclenchements à chaque ping GPS (driver_lat/lng).
    if (r.destination != null) { setDestination(r.destination); destRef.current = r.destination; }
    if (r.depart != null) { setDepart(r.depart); departRef.current = r.depart; }
    if (r.dest_modified != null) setDestModified(!!r.dest_modified);
    // Fin de la synchro initiale : on autorise désormais la détection et on efface tout bandeau résiduel.
    if (initial) { syncedRef.current = true; setAddrBanner(null); }
  };

  useEffect(() => {
    if (!rideId) return;
    getRide(rideId).then((r: any) => {
      if (!r) return;
      applyRideRow(r, true);
      setIsPartage(!!r.shared);
      // Phase = VÉRITÉ SERVEUR : après acceptation (en_route) on démarre TOUJOURS en phase 1
      // (« Je suis arrivé ») — jamais de prise en charge automatique. Une reprise reprend au bon état.
      if (r.statut === 'en_cours') setPhase(3);
      else if (r.statut === 'arrive') {
        setPhase(2);
        // Le compteur d'attente repart de l'HEURE D'ARRIVÉE ENREGISTRÉE EN BASE (posée par le serveur).
        // Avant, il n'existait pas : on comptait depuis le montage de l'écran, donc fermer la page
        // remettait l'attente à zéro — le chauffeur pouvait attendre 10 min sans jamais atteindre les 7.
        const t = r.arrive_at ? new Date(r.arrive_at).getTime() : null;
        setArrivedAt((prev) => (t && !isNaN(t) ? t : prev ?? Date.now()));
      } else setPhase(1);
      if (r.colis_note) setColisNote(String(r.colis_note));
      const sp: { label?: string; lat?: number; lng?: number }[] = [];
      if (r.stop1_label || r.stop1_lat != null) sp.push({ label: r.stop1_label, lat: r.stop1_lat, lng: r.stop1_lng });
      if (r.stop2_label || r.stop2_lat != null) sp.push({ label: r.stop2_label, lat: r.stop2_lat, lng: r.stop2_lng });
      setStopPts(sp);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rideId]);

  // Compteur location : durée déclarée, horodatage de démarrage, total recalculé.
  const [locHours, setLocHours] = useState<number | null>(null);
  const [serviceStartedAt, setServiceStartedAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // force le rafraîchissement du chrono
  const isLocation = locHours != null && locHours > 0;
  const tarifHoraire = isLocation && locHours ? Math.round(prix / locHours) : 0;

  // Récupère le mode de paiement réel + crédit + infos location (pour l'encaissement / compteur).
  useEffect(() => {
    if (isSim || !rideId) return;
    getRide(rideId).then((r) => {
      if (!r) return;
      setPaiement((r as any).paiement || 'Espèces');
      setCreditApplied((r as any).credit_applied || 0);
      setPassPhoto(r.passager_photo ?? null);
      setLocHours(r.location_hours ?? null);
      setServiceStartedAt(r.service_started_at ?? null);
      // Si le service est déjà démarré (reprise d'app), reprendre en phase 3.
      if (r.location_hours && r.service_started_at && r.statut === 'en_cours') setPhase(3);
    }).catch(() => {});
  }, [rideId, isSim]);

  // Chrono du compteur location (1 tick/s pendant que le service tourne).
  useEffect(() => {
    if (!isLocation || !serviceStartedAt || phase !== 3) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [isLocation, serviceStartedAt, phase]);

  // Compteur d'ATTENTE du client : tourne en phase 2 (chauffeur arrivé, attend le passager).
  // On stocke l'instant courant EN ÉTAT (et non un simple compteur de ticks) : l'affichage est donc
  // vraiment recalculé à chaque seconde, et il se recale tout seul après une mise en arrière-plan.
  useEffect(() => {
    if (phase !== 2 || !arrivedAt) return;
    setWaitNow(Date.now()); // recalage immédiat dès l'entrée en attente
    const iv = setInterval(() => setWaitNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [phase, arrivedAt]);

  // Compteur d'attente à l'ARRÊT intermédiaire : tourne tant que le chauffeur y est arrêté.
  useEffect(() => {
    if (!stopArrivedAt) return;
    setStopNow(Date.now());
    const iv = setInterval(() => setStopNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [stopArrivedAt]);

  // Supplément d'attente à l'arrêt courant : franchise offerte, puis paliers entamés (réglés admin).
  const stopWaitSec = stopArrivedAt ? Math.max(0, Math.floor((stopNow - stopArrivedAt) / 1000)) : 0;
  const stopGraceSec = stopCfg.graceMin * 60;
  const stopOverSec = Math.max(0, stopWaitSec - stopGraceSec);
  const stopBlocks = stopOverSec > 0 ? Math.ceil(stopOverSec / (stopCfg.palierMin * 60)) : 0;
  const stopFeeLive = stopBlocks * stopCfg.palierFee; // supplément de l'arrêt EN COURS
  const stopClock = `${String(Math.floor(stopWaitSec / 60)).padStart(2, '0')}:${String(stopWaitSec % 60).padStart(2, '0')}`;

  // Attente écoulée / franchise / supplément — recalculés à chaque seconde.
  // Les `graceMin` premières minutes sont OFFERTES. Au-delà, un FORFAIT UNIQUE s'ajoute au trajet
  // (ex : 2 000 F -> 2 200 F). Ce n'est plus un tarif à la minute : un client en retard de 20 min
  // se voyait facturer 1 300 F, disproportionné et impossible à vérifier pour lui.
  const waitSec = arrivedAt ? Math.max(0, Math.floor((waitNow - arrivedAt) / 1000)) : 0;
  const waitedMin = Math.floor(waitSec / 60);
  // COLIS : aucun supplément d'attente. Le coursier vient chercher un paquet, il n'attend pas un
  // passager qui doit descendre. Le client ne voit d'ailleurs plus l'avertissement de son côté :
  // facturer un supplément qu'on n'annonce plus serait pire que de l'afficher.
  const waitFeeRunning = !isColis && !isLocation && arrivedAt != null && waitedMin >= waitCfg.graceMin; // franchise épuisée (jamais sur une location : temps déjà facturé à l'heure)
  const waitFee = waitFeeRunning ? waitCfg.fee : 0;                          // forfait, pas un prix/min
  // L'annulation sans faute après le délai reste possible, colis compris : un expéditeur qui ne
  // vient jamais bloquerait sinon le coursier indéfiniment.
  const canDriverCancel = phase <= 2 && waitedMin >= waitCfg.graceMin;
  // Compteur mm:ss (ex : « 03:12 ») — gros et lisible, il tourne en direct.
  const waitClock = `${String(Math.floor(waitSec / 60)).padStart(2, '0')}:${String(waitSec % 60).padStart(2, '0')}`;

  // Estimation en temps réel : durée écoulée -> heures facturables (½ h sup., min la réservation) -> montant.
  const elapsedMin = serviceStartedAt ? Math.max(0, (Date.now() - new Date(serviceStartedAt).getTime()) / 60000) : 0;
  // La LOCATION est un temps réservé : on facture au MINIMUM les heures réservées, jamais moins.
  const billedHours = Math.max(locHours ?? 0.5, Math.ceil(elapsedMin / 30) / 2);
  const estCost = Math.round(tarifHoraire * billedHours);
  // Fin de la durée réservée : le chauffeur ne peut PAS terminer avant (règle Taga, imposée aussi
  // côté serveur). On affiche le temps restant, et le bouton « Terminer » reste inactif jusque-là.
  const locEndMs = serviceStartedAt && isLocation ? new Date(serviceStartedAt).getTime() + (locHours ?? 0) * 3600000 : 0;
  const locRemainingSec = locEndMs ? Math.max(0, Math.ceil((locEndMs - Date.now()) / 1000)) : 0;
  const locPeutTerminer = !isLocation || locRemainingSec <= 0;
  const locRestant = (() => {
    const h = Math.floor(locRemainingSec / 3600), m = Math.floor((locRemainingSec % 3600) / 60), s = locRemainingSec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  })();
  const chrono = (() => {
    const s = Math.floor(elapsedMin * 60);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  })();
  void tick; // dépendance implicite du chrono

  // Total à encaisser = prix (ou estimation location) + attente départ + attente arrêt(s) − crédit.
  const net = Math.max(0, (isLocation && phase === 3 ? estCost : prix) + waitFee + stopFee - creditApplied);
  const posRef = useRef<Pt>(pickup);
  const [route, setRoute] = useState<GeoRoute | null>(null);          // récupération → dépôt
  const [pickupRoute, setPickupRoute] = useState<GeoRoute | null>(null); // chauffeur → récupération

  // Itinéraire réel de la course : récupération → arrêt(s) → dépôt.
  const stopsKey = stopPts.map((s) => `${s.lat},${s.lng}`).join('|');
  useEffect(() => {
    let actif = true;
    if (!dropoff) return;
    const via = stopPts.filter((s) => s.lat != null && s.lng != null).map((s) => ({ latitude: s.lat as number, longitude: s.lng as number }));
    const pts = [pickup, ...via, dropoff];
    (pts.length > 2 ? routeVia(pts) : routeBetween(pickup, dropoff)).then((r) => { if (actif) setRoute(r); }).catch(() => {});
    return () => { actif = false; };
  }, [pickup.latitude, pickup.longitude, dropoff?.latitude, dropoff?.longitude, stopsKey]);

  // Pendant l'approche (phases 1–2) : itinéraire chauffeur → point de récupération, rafraîchi.
  useEffect(() => {
    if (phase >= 3) return;
    let actif = true;
    const calc = () => { routeBetween(posRef.current, pickup).then((r) => { if (actif) setPickupRoute(r); }).catch(() => {}); };
    calc();
    const iv = setInterval(calc, 15000);
    return () => { actif = false; clearInterval(iv); };
  }, [phase, pickup.latitude, pickup.longitude]);

  // Diffuse la position GPS réelle du chauffeur au client (courses réelles uniquement).
  useEffect(() => {
    if (isSim || !rideId) return;
    let active = true;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !active) return;
        // Envoi immédiat d'un premier point.
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const fp = { latitude: first.coords.latitude, longitude: first.coords.longitude };
        const cap0 = capGps(first.coords.heading);
        if (active) { posRef.current = fp; setPos(fp); setLocFixed(true); if (cap0 != null) setCap(cap0); updateDriverPosition(rideId, fp.latitude, fp.longitude).catch(() => {}); }
        let prev = fp; // point précédent → repli de cap quand le GPS n'en fournit pas
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 15 },
          (loc) => {
            const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            // Cap réel : GPS si dispo, sinon relèvement du déplacement (donnée mesurée). À l'arrêt
            // (< 5 m), on conserve le dernier cap connu : le véhicule ne saute pas plein nord.
            // Direction de TRAJET : relèvement point-à-point d'abord (fiable), GPS heading en repli
            // (coords.heading peut renvoyer l'orientation du téléphone, pas la trajectoire).
            const cap = moveHeading(prev, p) ?? capGps(loc.coords.heading);
            if (cap != null) setCap(cap);
            prev = p;
            posRef.current = p; setPos(p); setLocFixed(true);
            updateDriverPosition(rideId, p.latitude, p.longitude).catch(() => {});
          },
        );
      } catch {
        /* permission refusée ou GPS indisponible : on n'affiche simplement pas la position */
      }
    })();
    return () => { active = false; sub?.remove(); };
  }, [isSim, rideId]);

  // Annulation par le client : le chauffeur est prévenu immédiatement et renvoyé à l'accueil.
  const annulRef = useRef(false);
  const onCancelled = () => {
    if (annulRef.current) return;
    annulRef.current = true;
    playDriver('request');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    notify('Course annulée', 'La course a été annulée.');
    Alert.alert('Course annulée', 'La course a été annulée.', [
      { text: 'OK', onPress: () => router.replace('/driver') },
    ]);
  };
  useEffect(() => {
    if (isSim || !rideId) return;
    // 1) Temps réel (instantané).
    const off = subscribeRide(rideId, (statut) => { if (statut === 'annule') onCancelled(); }, (row) => { applyRideRow(row, false); });
    // 2) Filet de sécurité : si l'événement temps réel est manqué, on vérifie l'état réel toutes les 5 s
    //    → l'annulation client remonte TOUJOURS au chauffeur (même hors réseau instable).
    const iv = setInterval(() => {
      getRide(rideId).then((r: any) => { if (r && r.statut === 'annule') onCancelled(); }).catch(() => {});
    }, 5000);
    return () => { off(); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSim, rideId, passager]);

  // Messages entrants du client pendant la course : son + notif + pastille « non lu ».
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (isSim || !rideId) return;
    const off = subscribeMessages(rideId, (m) => {
      if (m.sender_role === 'client') {
        playDriver('accept');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        notify(`Message de ${passager}`, m.texte);
        setUnread((n) => n + 1);
      }
    });
    return () => off();
  }, [isSim, rideId, passager]);

  const initiales = passager.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  const titres: Record<1 | 2 | 3, { big: string; sub: string }> = {
    1: { big: 'Calcul…', sub: isColis ? "jusqu'à l'expéditeur" : 'jusqu\'au client' },
    2: { big: isColis ? '' : 'Passager à bord ?', sub: 'Confirme le départ' },
    3: { big: isColis ? '' : 'En route', sub: isColis ? 'Livraison du colis en cours' : 'Course en cours' },
  };

  const labels: Record<1 | 2 | 3, string> = {
    1: isColis ? 'Glissez : colis récupéré' : 'Glissez : je suis arrivé',
    2: isColis ? 'Glissez : démarrer la livraison' : isLocation ? 'Glissez : démarrer la location' : 'Glissez : démarrer la course',
    3: isColis ? 'Glissez : colis livré' : isLocation ? 'Glissez : terminer la location' : 'Glissez : terminer la course',
  };
  // Actions à faible risque (Arrivé / Démarrer) = simple TAP (gros bouton, facile au feu rouge).
  // L'action irréversible (Terminer / Livrer) reste un GLISSEMENT (garde-fou anti-erreur).
  const tapLabels: Record<1 | 2, string> = {
    1: isColis ? 'Colis récupéré' : 'Je suis arrivé',
    2: isColis ? 'Démarrer la livraison' : isLocation ? 'Démarrer la location' : 'Démarrer la course',
  };

  // Garde-fou : la clôture serveur d'une location (locationStop) ne doit jamais être appelée deux fois
  // (ex : « Pas encore » puis re-glissement, ou retry après échec de paiement).
  const closingRef = useRef(false);

  const onComplete = async () => {
    if (busy) return;
    setBusy(true);
    // Haptique à chaque fin de glissement (changement de phase).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      if (phase === 1) {
        let debut = Date.now();
        if (!isSim && rideId) {
          await setRideStatut(rideId, 'arrive');
          // L'heure d'arrivée fait foi côté SERVEUR (elle déclenche le forfait d'attente et
          // l'annulation sans faute). On la relit plutôt que de se fier à l'horloge du téléphone,
          // qui peut être déréglée — et elle survivra à la fermeture de la page.
          const r: any = await getRide(rideId).catch(() => null);
          const t = r?.arrive_at ? new Date(r.arrive_at).getTime() : NaN;
          if (!isNaN(t)) debut = t;
        }
        setArrivedAt(debut); // démarre le compteur d'attente du client
        setPhase(2);
      } else if (phase === 2) {
        // Location : démarre le compteur (RPC) ; sinon démarrage de course normal.
        if (!isSim && rideId) {
          if (isLocation) { await locationStart(rideId); setServiceStartedAt(new Date().toISOString()); }
          else await setRideStatut(rideId, 'en_cours');
        } else if (isLocation) {
          setServiceStartedAt(new Date().toISOString());
        }
        setPhase(3);
      } else {
        // Colis : exiger le code de remise du client AVANT de clôturer.
        if (isColis && !isSim && rideId) {
          setBusy(false);
          setCodeOpen(true);
          return;
        }
        // Clôture + paiement + résumé. Pour une location, la clôture serveur (locationStop) recalcule
        // le montant ; on ne l'appelle qu'AU MOMENT réel de la finalisation (jamais avant la confirmation
        // d'encaissement espèces — sinon « Pas encore » laisserait la course déjà fermée côté serveur).
        // Toute la logique est enveloppée dans un try/catch (elle est déclenchée depuis un bouton d'Alert,
        // hors du try/catch d'onComplete) : un échec réseau ne doit pas laisser le chauffeur bloqué.
        const finaliser = async () => {
          try {
            let montantFinal = prix;
            if (!isSim && rideId && isLocation) {
              if (!closingRef.current) {
                closingRef.current = true;
                const res = await locationStop(rideId); // clôture (statut termine + prix recalculé)
                montantFinal = res.montant || estCost;
              } else {
                montantFinal = estCost; // déjà clôturée lors d'une tentative précédente
              }
            } else if (isLocation) {
              montantFinal = estCost;
            }
            montantFinal += waitFee; // surcharge d'attente (client absent au-delà du délai offert)
            montantFinal += stopFee; // supplément d'attente aux points intermédiaires
            if (!isSim && rideId) {
              if (!isLocation) {
                // Clôture serveur : PERSISTE le supplément d'attente/arrêt dans le prix + termine +
                // encaisse (sinon ces suppléments n'étaient jamais comptés dans les gains/l'historique).
                const finalPrix = await closeRide(rideId, waitFee + stopFee);
                if (typeof finalPrix === 'number') montantFinal = finalPrix;
              } else {
                await markRidePaid(rideId); // location déjà clôturée par locationStop
              }
            }
            playDriver('complete');
            router.replace({
              pathname: '/driver/trip-summary',
              params: { prix: String(montantFinal), destination, passager, ...(rideId ? { rideId } : {}) },
            });
          } catch {
            // Échec réseau : on NE navigue PAS — le chauffeur peut re-glisser pour réessayer.
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            toast('Connexion instable — réessaie.', { tone: 'error' });
          }
        };
        // Montant estimé pour l'affichage de la confirmation (le serveur fait foi pour une location).
        const montantEstime = (isLocation ? estCost : prix) + waitFee + stopFee;
        const netFinal = Math.max(0, montantEstime - creditApplied);
        // Paiement espèces : confirmer l'encaissement AVANT toute clôture serveur.
        if (!isSim && paiement === 'Espèces') {
          setBusy(false);
          Alert.alert('Encaissement', `As-tu bien reçu ${fcfa(netFinal)} en espèces de ${passager} ?`, [
            { text: 'Pas encore', style: 'cancel' },
            { text: 'Oui, encaissé', onPress: () => finaliser() },
          ]);
          return;
        }
        await finaliser();
        return;
      }
    } catch {
      // Échec réseau : on NE change PAS de phase et on prévient le chauffeur (sinon il glisse dans le vide).
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast('Connexion instable — réessaie dans un instant.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Colis : validation du code de remise → (encaissement espèces si besoin) → clôture + résumé.
  const confirmerColis = async (code: string): Promise<boolean> => {
    if (!rideId) return false;
    const ok = await deliverColisWithCode(rideId, code); // met la course en « termine » si le code est bon
    if (!ok) return false;
    setCodeOpen(false);
    const netFinal = net; // inclut d'éventuels suppléments d'arrêt, cohérent avec « Encaisser X »
    const cloturer = async () => {
      try { await markRidePaid(rideId); } catch { toast('Paiement non enregistré — vérifie ta connexion.', { tone: 'error' }); }
      playDriver('complete');
      router.replace({
        pathname: '/driver/trip-summary',
        params: { prix: String(prix), destination, passager, ...(rideId ? { rideId } : {}) },
      });
    };
    // Paiement espèces : confirmer l'encaissement avant de clôturer (comme pour une course).
    if (paiement === 'Espèces') {
      Alert.alert('Encaissement', `As-tu bien reçu ${fcfa(netFinal)} en espèces ?`, [
        { text: 'Pas encore', style: 'cancel' },
        { text: 'Oui, encaissé', onPress: cloturer },
      ]);
    } else {
      await cloturer();
    }
    return true;
  };

  // Uid du chauffeur (pour écouter ses offres d'empilement Partage).
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMyUid(data.user?.id ?? null)).catch(() => {}); }, []);

  // Offre d'empilement « +1 » : détectée en temps réel + relecture 8 s, seulement sur une course partagée.
  useEffect(() => {
    if (isSim || !rideId || !myUid || !isPartage) return;
    const check = () => getPendingPartageAddon(myUid).then((a) => {
      setAddon((prev) => {
        // Nouvelle offre d'empilement → SONNE (son + vibration + notif), comme une nouvelle course.
        if (a && (!prev || prev.offerId !== a.offerId)) {
          playDriver('request');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          notify('Course partagée · +1 passager', `+ ${fcfa(a.gain)}`);
        }
        return a;
      });
    }).catch(() => {});
    check();
    const off = subscribeMyOffers(myUid, () => check());
    const iv = setInterval(check, 8000);
    return () => { off?.(); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSim, rideId, myUid, isPartage]);

  const accepterAddon = async () => {
    if (!addon) return;
    try {
      const poolId = await acceptPartageAddon(addon.offerId);
      setAddon(null);
      if (poolId) { annulRef.current = true; router.replace({ pathname: '/driver/pool-trip', params: { poolId } }); }
    } catch { toast('Impossible d\'accepter — réessaie.', { tone: 'error' }); }
  };
  const refuserAddon = async () => {
    if (!addon) return;
    const a = addon; setAddon(null);
    try { await declinePartageAddon(a.offerId); } catch { /* ignore */ }
  };

  // Le client a changé de destination : annulation SANS FAUTE, recevable À TOUTES LES PHASES
  // (y compris course démarrée). Le serveur enregistre « annule_client_destination » : le chauffeur
  // n'est pas accusé. On ne navigue QUE si l'appel serveur réussit.
  const annulerDestinationChangee = () => {
    if (!rideId) return;
    Alert.alert(
      'Le client a changé de destination ?',
      'Cette course sera annulée sans conséquence pour toi. Demande au client de relancer une course avec la bonne adresse.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            try {
              await driverCancelRide(rideId, 'client_destination');
              annulRef.current = true; // évite l'alerte « le client a annulé » déclenchée par le temps réel
              router.replace('/driver');
            } catch {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
              toast('Annulation impossible — réessaie.', { tone: 'error' });
            }
          },
        },
      ],
    );
  };

  // Distance/ETA réels pour l'approche (phase 1) ou la course (phase 3).
  const fmtKm = (km: number) => (km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km');
  // LOCATION phase 3 : on met le TEMPS en avant. Tant que la durée réservée n'est pas écoulée, on
  // affiche le décompte AVANT la fin (le chauffeur ne peut pas terminer). Une fois écoulée, on
  // bascule sur le temps total et on autorise la fin.
  // Étapes de la course en phase 3 : arrêt(s) puis destination.
  const legPoints = [...stopPts, { label: destination, lat: dropoff?.latitude, lng: dropoff?.longitude }];
  const curLeg = legPoints[Math.min(legIdx, legPoints.length - 1)];
  const atStop = phase >= 3 && legIdx < stopPts.length;
  const stopLetter = String(legIdx + 1); // « Stop 1 », « Stop 2 »…

  // Proximité (arrivée) — calculée tôt pour piloter l'en-tête « Vous êtes arrivé ».
  const ARRIVE_M = radii.arriveeM;
  const DROP_M = radii.depotM;
  const gpsGate = !isSim && locFixed;
  const distPickupM = Math.round(distanceKm(pos, pickup) * 1000);
  const distDropM = dropoff ? Math.round(distanceKm(pos, dropoff) * 1000) : 0;
  const atPickup = !gpsGate || distPickupM <= ARRIVE_M;
  const atDrop = !gpsGate || !dropoff || distDropM <= DROP_M;
  // Proximité au STOP courant : le chauffeur ne peut confirmer « arrivé au stop » que sur place
  // (sinon il pourrait sauter le trajet et terminer directement). Verrou GPS comme la prise en charge.
  const curLegPt = curLeg && curLeg.lat != null && curLeg.lng != null ? { latitude: Number(curLeg.lat), longitude: Number(curLeg.lng) } : null;
  const distToStopM = curLegPt ? Math.round(distanceKm(pos, curLegPt) * 1000) : 0;
  const atCurStop = !gpsGate || !curLegPt || distToStopM <= ARRIVE_M;

  const bigText = isLocation && phase === 3 ? (locPeutTerminer ? chrono : locRestant)
    : atStop ? `Stop ${stopLetter}`
    : phase === 1 && atPickup ? 'Arrivé'
    : phase === 1 && pickupRoute ? fmtKm(pickupRoute.distanceKm) : titres[phase].big;
  const subText = isLocation && phase === 3
    ? (locPeutTerminer ? `Durée réservée atteinte · tu peux terminer · ${fcfa(tarifHoraire)}/h` : `Temps restant avant la fin · ${fcfa(tarifHoraire)}/h`)
    : atStop ? (stopArrivedAt ? 'Passager en course · dépose intermédiaire' : 'Point intermédiaire sur le trajet')
    : phase === 1 && atPickup ? (isColis ? "Vous êtes chez l'expéditeur" : 'Vous êtes arrivé chez le client')
    : phase === 1 && pickupRoute ? `${pickupRoute.durationMin} min jusqu'au client` : titres[phase].sub;
  const etaText = atStop ? `Stop ${stopLetter}`
    : phase < 3 && pickupRoute ? `Vers ${passager} · ${pickupRoute.durationMin} min`
    : phase === 3 && route ? `Destination · ${route.durationMin} min`
    : `En route vers ${passager}`;
  // Course vers la destination (phase 3, hors location/colis/stop) : en-tête épuré.
  const drivingToDest = phase === 3 && !isLocation && !isColis && !atStop;

  // (Verrou de proximité calculé plus haut pour piloter l'en-tête d'arrivée.)
  // Phase 3 : pour une LOCATION, c'est le TEMPS qui compte, pas la position — le chauffeur ne peut
  // terminer qu'une fois la durée réservée écoulée (jamais bloqué par la distance). Pour les autres
  // courses, on garde le garde-fou de proximité destination.
  // Fin de course (phase 3) : pour un trajet normal, on EXIGE d'avoir fait tous les stops (atStop faux)
  // ET d'être arrivé à la destination finale. Impossible de terminer en sautant le trajet (ex. aller-retour
  // où départ = destination : sans ce garde-fou, le chauffeur pourrait terminer immédiatement).
  const slideLocked = phase === 1 ? !atPickup : phase === 3 ? (isLocation ? !locPeutTerminer : (atStop || !atDrop)) : false;
  const slideLockedLabel = phase === 1
    ? `Rapproche-toi ${isColis ? "de l'expéditeur" : 'du point de prise en charge'} · ${distPickupM} m`
    : isLocation
      ? 'Terminer se débloque à la fin de la réservation'
      : atStop
        ? `Termine d'abord le stop ${stopLetter}`
        : `Rapproche-toi de la destination · ${distDropM} m`;

  const partagerTrajet = async () => {
    const lignes = [
      '🚖 Je suis en course avec Taga.',
      `Passager : ${passager}`,
      isLocation ? `Location · ${String(billedHours).replace('.', ',')} h` : (destination ? `Destination : ${destination}` : null),
      pos?.latitude != null && pos?.longitude != null ? `Position : https://maps.google.com/?q=${pos.latitude},${pos.longitude}` : null,
      'Garde un œil sur mon trajet. 🙏',
    ].filter(Boolean).join('\n');
    try { await Share.share({ message: lignes }); } catch { /* ignore */ }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.top}>
        <Pressable onPress={() => router.replace('/driver')} hitSlop={10} style={st.close}>
          <Ionicons name="close" size={24} color={colors.ink} />
        </Pressable>
        {/* Le partage de trajet côté chauffeur reste accessible dans la fiche Sécurité (SOS) —
            on l'a retiré de la barre du haut où il était collé au bouton « Naviguer ». */}
      </View>

      <View style={{ paddingHorizontal: space.lg }}>
        {/* Bandeau navigation — masqué pendant une LOCATION en cours (pas de destination à suivre). */}
        {!(isLocation && phase === 3) ? (
        <Pressable
          style={st.navBanner}
          onPress={() => openNavigation(phase < 3
            ? { lat: pickup.latitude, lng: pickup.longitude, address: depart, label: `Vers ${passager} · ${depart}` }
            : { lat: curLeg?.lat, lng: curLeg?.lng, address: curLeg?.label || destination, label: `${atStop ? `Stop ${legIdx + 1}` : 'Destination'} · ${curLeg?.label || destination}` })}
        >
          <Ionicons name="navigate" size={20} color="#fff" />
          <Text style={st.navText}>{phase < 3 ? (isColis ? "Naviguer vers l'expéditeur" : 'Naviguer vers le client') : atStop ? `Naviguer vers le stop ${legIdx + 1}` : (isColis ? 'Naviguer vers le destinataire' : 'Naviguer vers la destination')}</Text>
          <Ionicons name="open-outline" size={17} color="#fff" />
        </Pressable>
        ) : null}
        {atStop ? (
          !stopArrivedAt ? (
            // 1) Arrivée à l'arrêt : VERROUILLÉE tant que le chauffeur n'est pas physiquement au stop
            //    (sinon il pourrait sauter le trajet). Le bouton ne s'active qu'à proximité GPS.
            <Pressable style={[st.stopArriveBtn, !atCurStop && st.stopArriveBtnOff]} disabled={!atCurStop} onPress={async () => {
              const now = Date.now();
              setStopArrivedAt(now);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              if (!isSim && rideId) { const iso = await setStopArrive(rideId).catch(() => null); if (iso) { const t = new Date(iso).getTime(); if (!isNaN(t)) setStopArrivedAt(t); } }
            }}>
              <View style={st.stopArriveIcon}><Ionicons name={atCurStop ? 'flag' : 'lock-closed'} size={19} color={colors.white} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.stopArriveTitle}>{atCurStop ? `Je suis arrivé au stop ${stopLetter}` : `Rapproche-toi du stop ${stopLetter}`}</Text>
                <Text style={st.stopArriveSub}>{atCurStop ? `${stopCfg.graceMin} min offertes, puis +${fcfa(stopCfg.palierFee)} / ${stopCfg.palierMin} min` : `Encore ${distToStopM} m avant de pouvoir confirmer`}</Text>
              </View>
              <Ionicons name={atCurStop ? 'chevron-forward' : 'navigate'} size={20} color="rgba(255,255,255,0.9)" />
            </Pressable>
          ) : (
            // 2) Attente à l'arrêt : compteur premium + supplément par paliers, puis « Repartir ».
            <View style={[st.stopCard, stopFeeLive > 0 && st.stopCardAlert]}>
              <View style={st.stopCardHead}>
                <View style={[st.stopCardIcon, stopFeeLive > 0 && { backgroundColor: colors.brand }]}>
                  <Ionicons name={stopFeeLive > 0 ? 'alert' : 'flag'} size={16} color={colors.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.stopCardTitle}>Stop {stopLetter}</Text>
                  <Text style={st.stopCardSub}>
                    {stopFeeLive > 0
                      ? 'Temps offert dépassé'
                      : `${Math.max(0, stopCfg.graceMin - Math.floor(stopWaitSec / 60))} min offertes restantes`}
                  </Text>
                </View>
                <Text style={[st.stopBigClock, stopFeeLive > 0 && { color: colors.brand }]}>{stopClock}</Text>
              </View>
              {stopFeeLive > 0 ? (
                <View style={st.stopFeeBadge}>
                  <Ionicons name="add-circle" size={15} color={colors.brand} />
                  <Text style={st.stopFeeBadgeText}>Supplément stop · +{fcfa(stopFeeLive)}</Text>
                </View>
              ) : null}
              <Pressable style={st.stopGo} onPress={() => {
                setStopFee((f) => f + stopFeeLive); // verrouille le supplément de cet arrêt
                setStopArrivedAt(null);
                setLegIdx((i) => i + 1);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              }}>
                <Text style={st.stopGoText}>{legIdx + 1 < stopPts.length ? `Repartir vers le stop ${legIdx + 2}` : 'Repartir vers la destination'}</Text>
                <Ionicons name="arrow-forward" size={18} color={colors.white} />
              </Pressable>
            </View>
          )
        ) : null}
        {addrBanner ? (
          <Pressable style={st.addrBanner} onPress={() => setAddrBanner(null)}>
            <Ionicons name="alert-circle" size={18} color="#fff" />
            <Text style={st.addrBannerText} numberOfLines={2}>{addrBanner} : {destination}</Text>
            <Ionicons name="close" size={16} color="#fff" />
          </Pressable>
        ) : null}
        {isLocation && phase === 3 ? (
          // LOCATION en cours : plus de carte (aucune destination) — grand compte à rebours, comme le client.
          <View style={st.locHero}>
            <Text style={st.locHeroLabel}>{locPeutTerminer ? 'Durée réservée atteinte' : 'Fin de la réservation dans'}</Text>
            <Text style={st.locHeroTime}>{locPeutTerminer ? chrono : locRestant}</Text>
            <Text style={st.locHeroSub}>{locPeutTerminer ? 'Tu peux terminer la location' : `${fcfa(tarifHoraire)}/h`}</Text>
          </View>
        ) : (
          // LOCATION en approche : la carte montre le trajet CHAUFFEUR → CLIENT (pas de destination).
          <TripMap origin={pickup} destination={isLocation ? undefined : dropoff} driver={pos} driverHeading={cap} stops={isLocation ? undefined : stopPts.filter((s) => s.lat != null && s.lng != null).map((s) => ({ latitude: s.lat as number, longitude: s.lng as number }))} routeCoords={(phase < 3 ? (pickupRoute ?? route) : route)?.coords} height={160} vehicle={iconeCarte(params.type as string)} />
        )}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {isLocation && phase === 3 ? null : (
          <View style={st.header}>
            {bigText ? <Text style={st.big}>{bigText}</Text> : null}
            {drivingToDest || !subText ? null : <Text style={[st.bigSub, !bigText && st.bigSubSolo]}>{subText}</Text>}
            {/* Adresse affichée SEULEMENT pendant l'approche (où aller). Une fois arrivé / à bord,
                l'itinéraire de la carte prend le relais. L'ETA reste visible en course. */}
            {isLocation ? null : (
              <>
                {phase === 1 && !atPickup ? <Text style={st.dest} numberOfLines={1}>{depart}</Text> : null}
                {(phase === 1 && !atPickup) || phase === 3 ? <Text style={st.eta}>{etaText}</Text> : null}
              </>
            )}
          </View>
        )}

        {/* Attente (phase 2) : le COMPTEUR mm:ss reste l'affichage principal. Une fois la franchise
            épuisée, la carte passe en alerte et une ligne courte annonce le FORFAIT ajouté au trajet
            (jamais de prix à la minute). Possibilité d'annuler si l'autre partie reste injoignable
            après le délai. Taxi/moto = client ; colis = expéditeur. */}
        {phase === 2 && !isLocation && arrivedAt ? (
          <View style={[st.waitCard, waitFeeRunning && st.waitCardAlert]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Ionicons name={waitFeeRunning ? 'alert-circle' : 'time-outline'} size={22} color={waitFeeRunning ? colors.brand : colors.brandDeep} />
              <Text style={[st.waitClock, waitFeeRunning && st.waitClockAlert]}>Attente {waitClock}</Text>
            </View>
            {waitFeeRunning ? (
              <Text style={st.waitNote}>Supplément d'attente de {fcfa(waitCfg.fee)} ajouté au trajet.</Text>
            ) : null}
            {canDriverCancel ? (
              <Pressable
                style={st.waitCancel}
                onPress={() => Alert.alert(
                  'Annuler la course',
                  `${isColis ? "L'expéditeur" : 'Le client'} ne s'est pas présenté après ${waitedMin} min. Confirmer l'annulation ?`,
                  [
                    { text: 'Continuer d\'attendre', style: 'cancel' },
                    // Motif SANS FAUTE : le client absent n'est pas de la faute du chauffeur.
                    { text: 'Annuler la course', style: 'destructive', onPress: async () => { try { if (rideId) { await driverCancelRide(rideId, 'client_absent'); annulRef.current = true; router.replace('/driver'); } } catch { toast('Annulation impossible — réessaie.', { tone: 'error' }); } } },
                  ],
                )}
              >
                <Ionicons name="close-circle-outline" size={18} color={colors.brandDeep} />
                <Text style={st.waitCancelText}>{isColis ? 'Expéditeur absent' : 'Client absent'} — annuler la course</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Location assignée par Taga : le chauffeur peut refuser AVANT de démarrer (repart en file admin) */}
        {isLocation && phase === 1 ? (
          <Pressable
            style={st.refuseLoc}
            onPress={() => Alert.alert(
              'Refuser la location',
              'Cette location repartira vers Taga pour être réassignée à un autre chauffeur. Confirmer ?',
              [
                { text: 'Non', style: 'cancel' },
                { text: 'Oui, refuser', style: 'destructive', onPress: async () => { try { if (rideId) await refuseLocation(rideId); router.replace('/driver'); } catch { toast('Action impossible — réessaie.', { tone: 'error' }); } } },
              ],
            )}
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.brandDeep} />
            <Text style={st.refuseLocText}>Refuser cette location</Text>
          </Pressable>
        ) : null}

        <View style={st.card}>
          <View style={st.passRow}>
            <Avatar text={initiales} size={50} tone="ink" uri={passPhoto ?? undefined} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={st.passName}>{passager}</Text>
              <Text style={st.passSub}>{(params.service as string) || (isColis ? 'Colis à livrer' : 'Passager Taga')}</Text>
              {/* Location démarrée : adresse de prise en charge sous le nom (pas de destination à suivre). */}
              {isLocation && phase === 3 && depart ? <Text style={st.passSub} numberOfLines={1}>{depart}</Text> : null}
            </View>
          </View>

          {/* Itinéraire (départ · arrêts · destination) — PAS pour une location : elle n'a pas de
              destination. On retire les deux points (départ/arrivée) — il ne reste que le passager,
              le compte à rebours et le bouton d'action. */}
          {/* Itinéraire progressif : avant la prise en charge on ne montre QUE le point de collecte
              (où aller). Une fois le client / colis récupéré, on ne montre QUE la destination (+ stops
              restants). Le chauffeur ne voit jamais tout d'un coup. */}
          {isLocation ? null : phase < 3 ? (
            <>
              <View style={st.divider} />
              <View style={st.routeLine}>
                <View style={[st.routeDot, { backgroundColor: colors.green }]} />
                <Text style={st.routeText}>
                  {depart} <Text style={st.routeTag}>— {isColis ? 'Expéditeur' : 'Récupération'}</Text>
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={st.divider} />
              {stopPts.slice(Math.min(legIdx, stopPts.length)).map((s, i) => (
                <View key={i}>
                  {i > 0 ? <View style={st.routeBar} /> : null}
                  <View style={st.routeLine}>
                    <View style={[st.routeDot, { backgroundColor: colors.ink }]} />
                    <Text style={st.routeText}>{s.label || `Arrêt ${legIdx + i + 1}`} <Text style={st.routeTag}>— Stop {legIdx + i + 1}</Text></Text>
                  </View>
                </View>
              ))}
              {stopPts.slice(Math.min(legIdx, stopPts.length)).length ? <View style={st.routeBar} /> : null}
              <View style={st.routeLine}>
                <View style={[st.routeDot, { backgroundColor: colors.brand }]} />
                <Text style={st.routeText}>
                  {destination} <Text style={st.routeTag}>— {isColis ? 'Destinataire' : 'Destination'}</Text>
                </Text>
              </View>
            </>
          )}

          {/* Contenu du colis renseigné par le client */}
          {isColis && colisNote ? (
            <View style={st.colisNote}>
              <Ionicons name="cube-outline" size={16} color={colors.brandDeep} />
              <Text style={st.colisNoteText}>{colisNote}</Text>
            </View>
          ) : null}

          {/* Montant : la LOCATION affiche son compteur en direct (le montant grimpe). Les courses et
              colis (prix fixe) ne réaffichent RIEN ici — le prix a été vu à l'offre et réapparaît juste
              au moment de la clôture (bas de l'écran). */}
          {isLocation && phase === 3 ? (
            <View style={st.estimate}>
              <Text style={st.estimateText}>
                {`${String(billedHours).replace('.', ',')} h facturée${billedHours > 1 ? 's' : ''} · ~${fcfa(estCost)} (en cours)`}
                {paiement === 'Espèces' ? ` · Encaisser ${fcfa(net)} en espèces` : ` · ${paiement}`}
              </Text>
              {fraisService > 0 ? (
                <Text style={st.estimateNote}>Dont {fcfa(fraisService)} frais Taga · tu gardes {fcfa(Math.max(0, net - fraisService))}</Text>
              ) : null}
            </View>
          ) : null}

          <View style={st.actions}>
            {!isSim && rideId ? (
              <>
                <Pressable style={st.actBtn} onPress={() => { setUnread(0); router.push({ pathname: '/chat', params: { rideId, name: passager, role: 'driver' } }); }}>
                  <Ionicons name="chatbubble" size={18} color={unread > 0 ? colors.brand : colors.ink} />
                  <Text style={[st.actLabel, unread > 0 && { color: colors.brand }]}>Message</Text>
                  {unread > 0 ? (
                    <View style={st.badge}><Text style={st.badgeTxt}>{unread > 9 ? '9+' : unread}</Text></View>
                  ) : null}
                </Pressable>
                <Pressable style={st.actBtn} onPress={() => setSafetyOpen(true)}>
                  <Ionicons name="shield-checkmark" size={18} color={colors.green} />
                  <Text style={st.actLabel}>Sécurité</Text>
                </Pressable>
                <Pressable style={st.actBtn} onPress={async () => { const tel = await getRideContactPhone(rideId); contactParty(tel, 'le client'); }}>
                  <Ionicons name="call" size={18} color={colors.ink} />
                  <Text style={st.actLabel}>Appeler</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  style={st.actBtn}
                  onPress={() => Alert.alert('Contact', 'Le contact avec le client se fait par message une fois la course réelle démarrée.')}
                >
                  <Ionicons name="chatbubble-outline" size={18} color={colors.inkSoft} />
                  <Text style={[st.actLabel, { color: colors.inkSoft }]}>Contacter</Text>
                </Pressable>
                <Pressable style={st.actBtn} onPress={() => setSafetyOpen(true)}>
                  <Ionicons name="shield-checkmark" size={18} color={colors.green} />
                  <Text style={st.actLabel}>Sécurité</Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Changement de destination par le client : disponible À TOUTES LES PHASES, même une fois
              la course démarrée — sinon le chauffeur est piégé avec le client à bord. Sans faute. */}
          {!isSim && rideId && !isLocation && destModified ? (
            <Pressable style={st.destChange} onPress={annulerDestinationChangee}>
              <Ionicons name="swap-horizontal" size={18} color={colors.brandDeep} />
              <Text style={st.destChangeText}>Le client a changé de destination</Text>
            </Pressable>
          ) : null}

          {/* Annulation « imprévu » côté chauffeur : possible avant la prise en charge (en_route / arrivé),
              en dehors du cas « client absent ». Discrète, et prévient que ça pèse sur la fiabilité. */}
          {!isSim && rideId && !isLocation && phase <= 2 ? (
            <Pressable
              style={st.driverCancel}
              onPress={() => Alert.alert(
                'Annuler la course',
                'À utiliser seulement en cas d\'imprévu. Des annulations fréquentes baissent ton taux de fiabilité et ta priorité sur les prochaines courses.',
                [
                  { text: 'Continuer la course', style: 'cancel' },
                  { text: 'Annuler quand même', style: 'destructive', onPress: async () => { try { if (rideId) await driverCancelRide(rideId, 'imprevu_chauffeur'); router.replace('/driver'); } catch { toast('Annulation impossible — réessaie.', { tone: 'error' }); } } },
                ],
              )}
            >
              <Text style={st.driverCancelText}>Annuler la course (imprévu)</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={[st.bottom, { paddingBottom: insets.bottom + 14 }]}>
        {phase === 3 ? (
          // Action irréversible (clôture / paiement) → glissement anti-erreur.
          // Le montant à encaisser réapparaît ICI (au moment de se faire payer) pour les courses/colis.
          <>
            {!isLocation && prix > 0 && !slideLocked ? (
              <Text style={st.encaisseHint}>{paiement === 'Espèces' ? `Encaisser ${fcfa(net)} en espèces` : `Payé · ${paiement}`}</Text>
            ) : null}
            <SlideButton label={labels[phase]} onComplete={onComplete} disabled={slideLocked} disabledLabel={slideLockedLabel} />
          </>
        ) : (
          // Arrivé / Démarrer → gros bouton tap, facile à toucher au feu rouge.
          <>
            <Btn label={tapLabels[phase as 1 | 2]} onPress={onComplete} loading={busy} disabled={slideLocked} style={{ height: 58 }} />
            {slideLocked ? <Text style={st.gateHint}>{slideLockedLabel}</Text> : null}
          </>
        )}
      </View>

      {/* Offre d'empilement Partage « +1 » : une 2e course partagée s'ajoute à la course en cours. */}
      <Modal visible={!!addon} transparent animationType="slide" onRequestClose={refuserAddon}>
        <View style={st.addonBackdrop}>
          <View style={st.addonCard}>
            <View style={st.addonBadge}><Ionicons name="people" size={22} color={colors.white} /></View>
            <Text style={st.addonTitle}>Course partagée · +1 passager</Text>
            <Text style={st.addonGain}>+ {fcfa(addon?.gain ?? 0)}</Text>
            <Text style={st.addonRoute} numberOfLines={2}>{addon?.depart} → {addon?.destination}</Text>
            <Text style={st.addonHint}>Tu récupères le passager le plus proche d'abord, puis l'autre.</Text>
            <Btn label="Accepter" onPress={accepterAddon} style={{ marginTop: 16 }} />
            <Pressable onPress={refuserAddon} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 14 }}>
              <Text style={st.addonRefuse}>Refuser</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <CodeConfirm
        open={codeOpen}
        title="Code de remise du colis"
        subtitle={`Demande à ${passager || 'ton client'} son code à 4 chiffres pour confirmer la remise du colis.`}
        onConfirm={confirmerColis}
        onClose={() => setCodeOpen(false)}
      />

      <DriverSafetySheet
        open={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        passager={passager}
        onShare={partagerTrajet}
      />
    </SafeAreaView>
  );
}

function DriverSafetySheet({ open, onClose, passager, onShare }: {
  open: boolean; onClose: () => void; passager: string; onShare: () => void;
}) {
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sf.backdrop}>
        <SafeAreaView edges={['bottom']} style={sf.sheet}>
          <View style={sf.handle} />
          <View style={sf.head}>
            <View style={sf.icon}><Ionicons name="shield-checkmark" size={20} color={colors.green} /></View>
            <Text style={sf.title}>Sécurité</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
          </View>
          <View style={sf.verify}>
            <Ionicons name="person" size={18} color={colors.ink2} />
            <Text style={sf.verifyText} numberOfLines={2}>Passager : <Text style={{ fontWeight: '800', color: colors.ink }}>{passager}</Text></Text>
          </View>
          <SafeRow icon="share-social" tone={colors.brand} title="Partager mon trajet" sub="Envoie ta position à un proche" onPress={() => { onShare(); }} />
          <SafeRow icon="shield" tone="#137A4B" title="Police · 17" sub="Police secours" onPress={() => Linking.openURL('tel:17')} />
          <SafeRow icon="flame" tone="#E0A82E" title="Pompiers · 18" sub="Incendie & secours" onPress={() => Linking.openURL('tel:18')} />
          <SafeRow icon="call" tone="#C0392B" title="Urgences · 80 00 11 15" sub="Ligne nationale gratuite" onPress={() => Linking.openURL('tel:80001115')} />
          <Text style={sf.note}>En cas de danger immédiat, appelle les secours.</Text>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SafeRow({ icon, tone, title, sub, onPress }: { icon: any; tone: string; title: string; sub: string; onPress?: () => void }) {
  return (
    <Pressable style={sf.row} onPress={onPress}>
      <View style={[sf.rowIcon, { backgroundColor: tone }]}><Ionicons name={icon} size={18} color={colors.white} /></View>
      <View style={{ flex: 1 }}>
        <Text style={sf.rowTitle}>{title}</Text>
        <Text style={sf.rowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.inkMute} />
    </Pressable>
  );
}

const sf = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.lg, paddingTop: 8, paddingBottom: 8 },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.line2, marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 18, fontWeight: '800', color: colors.ink },
  verify: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 13, marginBottom: 12, borderWidth: 1, borderColor: colors.line },
  verifyText: { flex: 1, fontSize: 13.5, color: colors.ink2, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  rowSub: { fontSize: 12.5, color: colors.inkSoft, fontWeight: '600', marginTop: 1 },
  note: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', textAlign: 'center', marginTop: 10 },
});

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: 6 },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: colors.brand, ...shadow.card },
  shareBtnText: { color: colors.white, fontSize: 13.5, fontWeight: '800' },
  addonBackdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.5)', justifyContent: 'flex-end' },
  addonCard: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: 34, alignItems: 'center' },
  addonBadge: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  addonTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 12 },
  addonGain: { fontSize: 30, fontWeight: '800', color: colors.brand, marginTop: 6 },
  addonRoute: { fontSize: 14, fontWeight: '700', color: colors.ink2, marginTop: 8, textAlign: 'center' },
  addonHint: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 8, textAlign: 'center', lineHeight: 18 },
  addonRefuse: { fontSize: 15, fontWeight: '800', color: colors.inkSoft },
  shieldBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  navBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.brand, paddingVertical: 15, borderRadius: radius.md, marginBottom: 10, ...shadow.card },
  navText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  addrBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.brandDeep, borderRadius: radius.md, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 10, ...shadow.card },
  addrBannerText: { flex: 1, fontSize: 13, fontWeight: '800', color: '#fff' },
  stopDone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.green, paddingVertical: 12, borderRadius: radius.md, marginBottom: 10 },
  stopDoneText: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  stopGo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brand, height: 50, borderRadius: radius.md, marginTop: 14 },
  stopGoText: { fontSize: 15, fontWeight: '800', color: colors.white },
  // Arrivée à l'arrêt : bouton premium plein (vert), lisible d'un coup d'œil.
  stopArriveBtn: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.green, borderRadius: radius.lg, padding: 14, marginBottom: 10, ...shadow.pop },
  stopArriveBtnOff: { backgroundColor: colors.inkMute, ...({ shadowOpacity: 0 } as any) },
  stopArriveIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  stopArriveTitle: { fontSize: 16, fontWeight: '800', color: colors.white },
  stopArriveSub: { fontSize: 12.5, fontWeight: '600', color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  // Carte d'attente à l'arrêt (premium).
  stopCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.line, ...shadow.card },
  stopCardAlert: { borderColor: colors.brand, borderWidth: 1.5, backgroundColor: colors.brandTint },
  stopCardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stopCardIcon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  stopCardTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  stopCardSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  stopBigClock: { fontSize: 26, fontWeight: '800', color: colors.brandDeep, letterSpacing: 0.5, fontVariant: ['tabular-nums'] },
  stopFeeBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.brandSoft, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 12, marginTop: 12 },
  stopFeeBadgeText: { fontSize: 13.5, fontWeight: '800', color: colors.brandDeep },
  waitCard: { backgroundColor: colors.brandTint, borderRadius: radius.md, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: colors.brandSoft },
  // Franchise épuisée : le supplément court → carte mise en alerte (couleur de marque appuyée).
  waitCardAlert: { backgroundColor: colors.brandSoft, borderColor: colors.brand, borderWidth: 1.5 },
  // Compteur d'attente : gros chiffres, lisibles d'un coup d'oeil au volant.
  waitClock: { fontSize: 26, fontWeight: '800', color: colors.brandDeep, letterSpacing: 0.5 },
  waitClockAlert: { color: colors.brand },
  // Forfait d'attente en cours : une ligne factuelle, sous le compteur (qui reste l'info principale).
  waitNote: { fontSize: 13.5, fontWeight: '700', color: colors.brandDeep, marginTop: 8, lineHeight: 19 },
  waitCancel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.brandDeep, paddingVertical: 11, borderRadius: radius.md, marginTop: 12 },
  waitCancelText: { fontSize: 14, fontWeight: '800', color: colors.brandDeep },
  header: { alignItems: 'center', marginTop: 14 },
  big: { fontSize: 40, fontWeight: '800', color: colors.ink },
  bigSub: { fontSize: 16, fontWeight: '700', color: colors.inkSoft, marginTop: 2 },
  // Location en cours : grand compte à rebours (fond sombre), comme côté client.
  locHero: { backgroundColor: colors.ink, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', paddingVertical: 34, paddingHorizontal: 20, ...shadow.pop },
  locHeroLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 14.5, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
  locHeroTime: { color: colors.white, fontSize: 58, fontWeight: '800', marginVertical: 8, fontVariant: ['tabular-nums'] },
  locHeroSub: { color: colors.brand, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  // Quand le gros titre est masqué (ex. colis en livraison), le sous-titre devient la ligne principale.
  bigSubSolo: { fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 2 },
  dest: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 12, textAlign: 'center', maxWidth: '90%' },
  eta: { fontSize: 14, fontWeight: '700', color: colors.brand, marginTop: 6 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, borderWidth: 1, borderColor: colors.line, ...shadow.card, marginTop: 16 },
  refuseLoc: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandSoft, backgroundColor: colors.brandTint },
  refuseLocText: { fontSize: 14.5, fontWeight: '800', color: colors.brandDeep },
  actions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  driverCancel: { alignSelf: 'center', marginTop: 14, paddingVertical: 8, paddingHorizontal: 12 },
  driverCancelText: { fontSize: 13.5, fontWeight: '700', color: colors.inkSoft, textDecorationLine: 'underline' },
  // Annulation sans faute (changement de destination) : action claire, jamais culpabilisante.
  destChange: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandSoft, backgroundColor: colors.brandTint },
  destChangeText: { fontSize: 14.5, fontWeight: '800', color: colors.brandDeep },
  actBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: radius.md, backgroundColor: colors.surface2, paddingHorizontal: 4 },
  actLabel: { fontSize: 13.5, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  passRow: { flexDirection: 'row', alignItems: 'center' },
  passName: { fontSize: 17, fontWeight: '800', color: colors.ink },
  passSub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 16 },
  routeLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeDot: { width: 12, height: 12, borderRadius: 6 },
  routeBar: { width: 2, height: 22, backgroundColor: colors.line2, marginLeft: 5, marginVertical: 2 },
  routeText: { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.ink },
  routeTag: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  colisNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, backgroundColor: colors.brandTint, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.brandSoft },
  colisNoteText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink2, lineHeight: 19 },
  // Montant à encaisser = info décisive en fin de course → texte plus grand et bien contrasté.
  estimate: { marginTop: 16, backgroundColor: colors.surface2, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md },
  estimateText: { fontSize: 15, fontWeight: '800', color: colors.ink, lineHeight: 21 },
  estimateNote: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft, marginTop: 4 },
  encaisseHint: { fontSize: 15, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 10 },
  bottom: { paddingHorizontal: space.lg, paddingTop: 12 },
  gateHint: { fontSize: 12.5, fontWeight: '700', color: colors.brandDeep, textAlign: 'center', marginTop: 8 },
});
