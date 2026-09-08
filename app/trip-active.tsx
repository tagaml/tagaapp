import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Linking, Modal, Share, Animated, PanResponder, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Btn, Avatar } from '../components/ui';
import { fcfa } from '../data/mock';
import { TripMap, BAMAKO, distanceKm } from '../components/TripMap';
import { iconeCarte, getRide, subscribeRide, subscribeMessages, getRideContactPhone, cancelRide, getCancelFee, getWaitingConfig, updateRideAddress, type DriverRide } from '../lib/db';
import { contactParty } from '../lib/contact';
import { DestinationPicker, AdjustOnMap, type Place } from '../components/RideMap';
import { routeBetween, routeVia, moveHeading, type GeoRoute } from '../lib/geo';
import { realisticEta } from '../lib/estimate';
import { notify } from '../lib/notify';
import { shareTrip } from '../lib/share';

const START = BAMAKO.driver;       // position de départ du chauffeur (repli si pas de GPS)
const TOTAL = 240;                 // 4 min en secondes

export default function TripActive() {
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const [ride, setRide] = useState<DriverRide | null>(null);
  const [statut, setStatut] = useState<string>('en_route');
  const [secs, setSecs] = useState(TOTAL);
  const [pos, setPos] = useState(START);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [locTick, setLocTick] = useState(0); // chrono du compteur location
  const [approachRoute, setApproachRoute] = useState<GeoRoute | null>(null); // tracé chauffeur → toi (puis → destination)
  const [cancelFee, setCancelFee] = useState(0); // frais d'annulation (réglés admin ; 0 = gratuit)
  const [cancelOpen, setCancelOpen] = useState(false); // fenêtre « Pourquoi annuler ? » — personnalisée (identique iOS/Android)
  useEffect(() => { getCancelFee().then(setCancelFee).catch(() => {}); }, []);
  // Attente au point de rendez-vous : minutes offertes puis FORFAIT UNIQUE ajouté au trajet
  // (valeurs réglées côté admin — jamais codées en dur ici).
  const [waitCfg, setWaitCfg] = useState({ graceMin: 7, fee: 200 });
  useEffect(() => { getWaitingConfig().then(setWaitCfg).catch(() => {}); }, []);
  // Retour (flèche ou bouton matériel Android) → accueil, SANS annuler : la course continue en arrière-plan.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { router.replace('/(tabs)'); return true; });
    return () => sub.remove();
  }, []);
  // Modification d'adresse en cours de course (destination pendant la course, départ avant l'arrivée).
  const [destPickerOpen, setDestPickerOpen] = useState(false);
  const [adjust, setAdjust] = useState<{ kind: 'dest' | 'pickup'; point: { latitude: number; longitude: number }; title: string } | null>(null);

  // Annulation client — pilotée par une fenêtre PERSONNALISÉE (même rendu iOS et Android).
  // (Avant : Alert.alert natif → Android réordonnait/coupait les options, rendu différent d'iOS.)
  const doCancel = async (reason?: string) => {
    setCancelOpen(false);
    if (rideId) {
      let fee = 0;
      try { fee = await cancelRide(rideId, reason); }
      catch { Alert.alert('Annulation impossible', 'Annulation impossible — vérifie ta connexion.'); return; }
      if (fee > 0) Alert.alert(isColis ? 'Livraison annulée' : 'Course annulée', `Des frais d'annulation de ${fcfa(fee)} ont été appliqués (déduits de ton crédit si disponible).`);
    }
    router.replace('/(tabs)');
  };
  const majAdresse = async (kind: 'dest' | 'pickup', label: string, lat: number, lng: number) => {
    if (!rideId) return;
    try {
      // Colis : la destination porte aussi le destinataire (« · Pour X (code) »). On le RECONDUIT
      // sur la nouvelle adresse pour ne pas perdre l'info du destinataire lors d'un changement.
      let finalLabel = label;
      if (kind === 'dest' && ride?.type === 'colis') {
        const m = (ride?.destination || '').match(/·\s*(Pour|De)\s.+$/i);
        if (m && !/·\s*(Pour|De)\s/i.test(label)) finalLabel = `${label} ${m[0].trim()}`;
      }
      const prix = await updateRideAddress(rideId, kind, finalLabel, lat, lng);
      const r = await getRide(rideId); if (r) setRide(r);
      Alert.alert(kind === 'dest' ? 'Destination modifiée' : 'Départ modifié', prix > 0 ? `Nouveau prix estimé : ${fcfa(prix)}.` : 'Adresse mise à jour.');
    } catch { Alert.alert('Oups', "La modification n'a pas pu être enregistrée."); }
  };
  const lastRouteFrom = useRef<{ lat: number; lng: number; key: string } | null>(null);
  // Miroir « colis » : les abonnements temps réel ne se rejouent pas, ils lisent cette ref à jour.
  const isColisRef = useRef(false);

  // Point de prise en charge : le vrai départ enregistré pour la course, sinon repli.
  // (Les colonnes depart_lat/lng existent en base mais ne sont pas typées sur DriverRide.)
  const departLat = (ride as any)?.depart_lat as number | null | undefined;
  const departLng = (ride as any)?.depart_lng as number | null | undefined;
  const pickup =
    departLat != null && departLng != null
      ? { latitude: departLat, longitude: departLng }
      : BAMAKO.aci2000;

  // Charge la course + écoute le statut en temps réel (piloté par le chauffeur).
  useEffect(() => {
    if (!rideId) return;
    let actif = true;
    const applyPos = (r: DriverRide) => {
      if (r.driver_lat != null && r.driver_lng != null) {
        setPos({ latitude: r.driver_lat, longitude: r.driver_lng });
      }
    };
    (async () => {
      const r = await getRide(rideId);
      if (actif && r) { setRide(r); setStatut(r.statut); applyPos(r); isColisRef.current = r.type === 'colis'; }
    })();
    const off = subscribeRide(rideId, (s) => {
      if (!actif) return;
      const colis = isColisRef.current;
      setStatut((prev) => {
        if (prev !== s) {
          if (s === 'arrive') notify(`Ton ${colis ? 'coursier' : 'chauffeur'} est arrivé`, 'Rejoins-le au point de rendez-vous.');
          if (s === 'en_cours') notify(colis ? 'Colis récupéré' : 'Course démarrée', colis ? 'Ton colis est en route.' : 'Bon trajet avec Taga !');
        }
        return s;
      });
      if (s === 'termine') { router.replace({ pathname: '/rating', params: { rideId } }); return; }
      if (s === 'annule') {
        Alert.alert(colis ? 'Livraison annulée' : 'Course annulée', `Cette ${colis ? 'livraison' : 'course'} a été annulée.`);
        router.replace('/(tabs)'); return;
      }
    }, (row) => {
      // Position GPS en direct reçue dans l'événement temps réel → appliquée instantanément (sans aller-retour réseau).
      if (actif) { setRide(row); applyPos(row); }
    });
    // Filet de sécurité : si le temps réel rate l'événement (réseau mobile / app en arrière-plan),
    // on vérifie l'état réel toutes les 5 s → une annulation par le chauffeur remonte TOUJOURS au client.
    const poll = setInterval(() => {
      getRide(rideId).then((r) => {
        if (!actif || !r) return;
        setStatut(r.statut); applyPos(r);
        if (r.statut === 'termine') { actif = false; router.replace({ pathname: '/rating', params: { rideId } }); }
        else if (r.statut === 'annule') {
          const colis = isColisRef.current;
          actif = false;
          Alert.alert(colis ? 'Livraison annulée' : 'Course annulée', colis ? 'Le coursier a annulé cette livraison.' : 'Le chauffeur a annulé cette course.');
          router.replace('/(tabs)');
        }
      }).catch(() => {});
    }, 5000);
    return () => { actif = false; off(); clearInterval(poll); };
  }, [rideId]);

  // Messages entrants du chauffeur pendant la course : notif + pastille « non lu ».
  useEffect(() => {
    if (!rideId) return;
    const off = subscribeMessages(rideId, (m) => {
      if (m.sender_role === 'driver') {
        notify(`Message de ${ride?.chauffeur_nom || (isColisRef.current ? 'ton coursier' : 'ton chauffeur')}`, m.texte);
        setUnread((n) => n + 1);
      }
    });
    return () => off();
  }, [rideId, ride?.chauffeur_nom]);

  // Anime le chauffeur tant qu'on n'a pas sa position GPS réelle (et qu'il n'est pas arrivé).
  useEffect(() => {
    if (ride?.driver_lat != null) return; // position réelle disponible → pas d'animation
    if (statut === 'arrive' || statut === 'en_cours') return;
    const target = pickup; // cible = vrai point de prise en charge
    const id = setInterval(() => {
      setSecs((s) => {
        const next = Math.max(0, s - 4);
        const t = 1 - next / TOTAL;
        setPos({
          latitude: START.latitude + (target.latitude - START.latitude) * t,
          longitude: START.longitude + (target.longitude - START.longitude) * t,
        });
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [statut, ride?.driver_lat, pickup.latitude, pickup.longitude]);

  // ---- Cap du véhicule sur la carte (orientation façon Uber) ----
  // La table `rides` ne transporte que la POSITION du chauffeur (driver_lat/driver_lng), pas son cap.
  // On le dérive donc du mouvement réel : relèvement entre la position précédente et la nouvelle.
  // C'est une donnée mesurée, pas une invention. Si le chauffeur n'a pas bougé (< 5 m : feu rouge,
  // embouteillage, bruit GPS), `moveHeading` renvoie null et on CONSERVE le dernier cap connu —
  // le véhicule ne saute jamais plein nord.
  const [driverHeading, setDriverHeading] = useState<number | undefined>(undefined);
  const posPrec = useRef<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    const cap = moveHeading(posPrec.current, pos);
    if (cap != null) setDriverHeading(cap);
    posPrec.current = pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.latitude, pos.longitude]);

  const enCours = statut === 'en_cours';
  // « Arrivé » UNIQUEMENT sur le vrai statut serveur — pas sur un minuteur local
  // (sinon on annonce faussement l'arrivée du chauffeur après 4 min en cas de GPS faible).
  const arrived = statut === 'arrive' || enCours;

  // Compteur location en temps réel (côté client) : durée écoulée + total estimé.
  const isLocation = (ride?.location_hours ?? 0) > 0;
  const startedAt = ride?.service_started_at ?? null;
  useEffect(() => {
    if (!enCours || !isLocation || !startedAt) return;
    const iv = setInterval(() => setLocTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [enCours, isLocation, startedAt]);
  const locElapsedMin = startedAt ? Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60000) : 0;
  const locBilled = Math.max(0.5, Math.ceil(locElapsedMin / 30) / 2);
  // Tarif horaire = base (prix HORS frais de service) / heures réservées, sinon l'estimation en direct surévalue.
  const locTarif = isLocation && ride?.location_hours ? Math.round(((ride.prix ?? 0) - ((ride as any).frais_service ?? 0)) / ride.location_hours) : 0;
  const locEst = Math.round(locTarif * locBilled);
  const locChrono = (() => {
    const s = Math.floor(locElapsedMin * 60);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  })();
  // Décompte vers la FIN de la durée réservée : c'est le temps qui compte pour une location, pas la
  // destination. Le chauffeur ne peut clôturer qu'une fois ce décompte à zéro.
  const locReservedH = ride?.location_hours ?? 0;
  const locEndMs = startedAt && isLocation ? new Date(startedAt).getTime() + locReservedH * 3600000 : 0;
  const locRemainingSec = locEndMs ? Math.max(0, Math.ceil((locEndMs - Date.now()) / 1000)) : 0;
  const locRestant = (() => {
    const h = Math.floor(locRemainingSec / 3600), m = Math.floor((locRemainingSec % 3600) / 60), s = locRemainingSec % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  })();
  // Une fois le client pris en charge (location démarrée), le plan n'a plus d'utilité : on bascule sur
  // un écran centré sur le TEMPS restant.
  const locEnCours = enCours && isLocation;
  void locTick;
  const aChauffeur = !!ride?.chauffeur_nom;
  // Points intermédiaires (arrêts) de la course, pour les afficher sur la carte (repères C, D…).
  const stopPtsClient = [
    { lat: (ride as any)?.stop1_lat, lng: (ride as any)?.stop1_lng },
    { lat: (ride as any)?.stop2_lat, lng: (ride as any)?.stop2_lng },
  ].filter((s) => s.lat != null && s.lng != null).map((s) => ({ latitude: s.lat as number, longitude: s.lng as number }));
  // Étapes de l'itinéraire avec libellé (départ · arrêt C · destination) pour la fiche.
  const clientStopLabels = [
    { lat: (ride as any)?.stop1_lat, label: (ride as any)?.stop1_label },
    { lat: (ride as any)?.stop2_lat, label: (ride as any)?.stop2_label },
  ].filter((s) => s.lat != null);
  // ETA d'approche dérivée du VRAI itinéraire (OSRM) ajusté au trafic — plus de compte à rebours factice.
  const approachEta = approachRoute?.durationMin != null ? realisticEta(approachRoute.durationMin) : null;
  const etaText = enCours ? 'En course' : arrived ? 'Arrivé' : !aChauffeur ? '…' : approachEta != null ? `${approachEta} min` : 'Calcul…';

  // Tracé d'itinéraire (OSRM) : chauffeur → toi pendant l'approche, puis → destination en course.
  // On recalcule seulement si le chauffeur s'est déplacé d'au moins ~150 m (évite de spammer le routeur).
  const destLatN = (ride as any)?.dest_lat as number | null | undefined;
  const destLngN = (ride as any)?.dest_lng as number | null | undefined;
  useEffect(() => {
    if (!aChauffeur) { setApproachRoute(null); return; }
    const target = enCours
      ? (destLatN != null && destLngN != null ? { latitude: destLatN, longitude: destLngN } : null)
      : pickup;
    if (!target) { setApproachRoute(null); return; }
    const key = enCours ? 'dest' : 'pickup';
    const last = lastRouteFrom.current;
    const moved = !last || last.key !== key || distanceKm({ latitude: last.lat, longitude: last.lng }, pos) > 0.15;
    if (!moved) return;
    lastRouteFrom.current = { lat: pos.latitude, lng: pos.longitude, key };
    let actif = true;
    // En course : tracer À TRAVERS les arrêts (chauffeur → stop1 → stop2 → destination), comme côté
    // chauffeur — sinon le tracé « saute » les stops et va tout droit à la destination.
    const via = enCours && stopPtsClient.length ? [pos, ...stopPtsClient, target] : null;
    (via && via.length > 2 ? routeVia(via) : routeBetween(pos, target)).then((r) => { if (actif) setApproachRoute(r); }).catch(() => {});
    return () => { actif = false; };
  }, [pos.latitude, pos.longitude, enCours, aChauffeur, pickup.latitude, pickup.longitude, destLatN, destLngN]);

  // Vocabulaire aligné sur le service : un colis est pris en charge par un COURSIER (pas un chauffeur).
  const isColis = ride?.type === 'colis';
  const terme = isColis ? 'coursier' : 'chauffeur';
  const objet = isColis ? 'livraison' : 'course';

  const chauffeurNom = ride?.chauffeur_nom || (isColis ? 'Ton coursier' : 'Ton chauffeur');
  const chauffeurNote = ride?.chauffeur_note ?? null;
  const vehicule = ride?.vehicule || 'Véhicule en route';
  const plaque = ride?.plaque || '—';
  const ini = (ride?.chauffeur_nom ? chauffeurNom.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '🚕');
  const titre = enCours && isLocation ? locChrono
    : enCours ? (isColis ? 'Colis récupéré · en livraison' : 'Course en cours')
    : arrived ? (isColis ? 'Coursier au point de collecte' : 'Prêt à partir')
    : aChauffeur ? (isColis ? 'Coursier en route' : 'En route vers toi')
    : `Recherche d'un ${terme}…`;
  // Étape de progression du colis (pour l'indicateur) : 0 = en route, 1 = récupéré/livraison, 2 = livré.
  const colisStep = statut === 'termine' ? 2 : enCours ? 1 : aChauffeur ? 0 : -1;
  const sousTitre = enCours && isLocation ? `Location en cours · ~${fcfa(locEst)} (${String(locBilled).replace('.', ',')} h)`
    : enCours ? (isColis ? '' : 'Direction ta destination')
    : arrived ? 'Rejoins-le au point de rendez-vous'
    : aChauffeur ? 'Arrivée estimée'
    : `On te trouve un ${terme} proche`;

  const appelerChauffeur = async () => {
    if (!rideId) return;
    const tel = await getRideContactPhone(rideId);
    contactParty(tel, `ton ${terme}`);
  };

  const partagerTrajet = () =>
    shareTrip({
      kind: 'course',
      token: ride?.share_token ?? null,
      chauffeur: ride?.chauffeur_nom ?? null,
      vehicule: ride?.vehicule ?? null,
      plaque: ride?.plaque ?? null,
      destination: ride?.destination ?? null,
      etaMin: !enCours && !arrived && aChauffeur && approachEta != null ? approachEta : null,
      lat: pos?.latitude ?? null,
      lng: pos?.longitude ?? null,
    });

  // Fiche conducteur glissable (bottom sheet) : on peut la baisser pour voir la carte, la remonter
  // pour revoir les détails. On glisse depuis la poignée. Deux positions : ouverte / repliée (peek).
  const sheetY = useRef(new Animated.Value(0)).current;
  const sheetH = useRef(0);
  const collapsed = useRef(false);
  const maxDown = () => Math.max(0, sheetH.current - 150); // laisse ~150 px visibles en position repliée
  const sheetPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => {
        const base = collapsed.current ? maxDown() : 0;
        sheetY.setValue(Math.max(0, Math.min(maxDown(), base + g.dy)));
      },
      onPanResponderRelease: (_e, g) => {
        const goDown = collapsed.current ? g.dy > -40 : g.dy > 40;
        collapsed.current = goDown;
        Animated.spring(sheetY, { toValue: goDown ? maxDown() : 0, useNativeDriver: true, bounciness: 3 }).start();
      },
    }),
  ).current;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface2 }}>
      {locEnCours ? (
        // LOCATION démarrée : le chauffeur a pris le client, le plan n'a plus d'utilité. On affiche un
        // écran centré sur le TEMPS — décompte avant la fin de la réservation, puis « durée atteinte ».
        <View style={st.locHero}>
          <Text style={st.locHeroLabel}>{locRemainingSec > 0 ? 'Fin de la réservation dans' : 'Durée réservée atteinte'}</Text>
          <Text style={st.locHeroTime}>{locRemainingSec > 0 ? locRestant : locChrono}</Text>
          {locRemainingSec > 0 ? null : (
            <Text style={st.locHeroSub}>Merci d'avoir choisi Taga, à très bientôt</Text>
          )}
        </View>
      ) : (
        <TripMap
          fill
          rounded={false}
          origin={pickup}
          driver={pos}
          vehicle={iconeCarte(ride?.type)}
          routeCoords={approachRoute?.coords}
          waitingAtOrigin={!enCours}
          followDriver={aChauffeur}
          driverEta={!arrived && !enCours && aChauffeur ? etaText : undefined}
          driverHeading={driverHeading}
          stops={enCours && stopPtsClient.length ? stopPtsClient : undefined}
          destination={enCours && destLatN != null && destLngN != null ? { latitude: destLatN, longitude: destLngN } : undefined}
        />
      )}
      <SafeAreaView edges={['top']} style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
        <View style={st.topBar}>
          <Pressable onPress={() => router.replace('/(tabs)')} style={st.close}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
          <Pressable onPress={partagerTrajet} style={st.shareBtn} accessibilityLabel="Partager mon trajet">
            <Ionicons name="share-social" size={18} color={colors.white} />
            <Text style={st.shareBtnText}>Partager mon trajet</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Carte conducteur — glissable (poignée) : baisser pour voir la carte, remonter pour les détails */}
      <Animated.View
        style={[st.sheet, { transform: [{ translateY: sheetY }] }]}
        onLayout={(e) => { sheetH.current = e.nativeEvent.layout.height; }}
      >
        <View style={st.handleHit} {...sheetPan.panHandlers}>
          <View style={st.handle} />
        </View>
        {/* En course (location OU course normale) : on n'affiche QUE la pastille « En course » en haut
            (demande fondateur : « mets seulement en cours en haut »). Le reste (titre, sous-titre) est retiré. */}
        {enCours && !isColis ? (
          <View style={[st.etaRow, { justifyContent: 'flex-end' }]}>
            <View style={[st.etaPill, { backgroundColor: colors.green }]}><Text style={st.etaPillText}>En course</Text></View>
          </View>
        ) : (
          <>
            <View style={st.etaRow}>
              <Text style={st.etaTitle} numberOfLines={1}>{titre}</Text>
              {/* Colis en livraison : on masque la pastille « En course » (vocabulaire course inadapté au colis). */}
              {isColis && enCours ? null : (
                <View style={[st.etaPill, (arrived || enCours) && { backgroundColor: colors.green }]}><Text style={st.etaPillText}>{etaText}</Text></View>
              )}
            </View>
            {sousTitre ? <Text style={st.etaLabel}>{sousTitre}</Text> : null}
          </>
        )}

        <View style={st.driver}>
          <Avatar text={ini} size={52} tone="ink" uri={ride?.chauffeur_photo ?? undefined} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Text style={st.driverName} numberOfLines={1}>{chauffeurNom}</Text>
              {chauffeurNote != null && (
                <>
                  <Ionicons name="star" size={13} color={colors.gold} />
                  <Text style={st.driverNote}>{chauffeurNote}</Text>
                </>
              )}
            </View>
            <Text style={st.driverCar}>{vehicule}</Text>
          </View>
          <View style={st.plaque}><Text style={st.plaqueText}>{plaque}</Text></View>
        </View>

        {/* Suivi colis : progression en 3 étapes (En route → Récupéré → Livré). */}
        {isColis && colisStep >= 0 && statut !== 'termine' && statut !== 'annule' ? (
          <View style={st.colisSteps}>
            {['En route', 'Récupéré', 'Livré'].map((lbl, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                <View style={st.colisStepRow}>
                  <View style={[st.colisSeg, i <= colisStep && st.colisSegOn, i === 0 && { opacity: 0 }]} />
                  <View style={[st.colisDot, i <= colisStep && st.colisDotOn]}>
                    {i < colisStep ? <Ionicons name="checkmark" size={11} color={colors.white} /> : null}
                  </View>
                  <View style={[st.colisSeg, i < colisStep && st.colisSegOn, i === 2 && { opacity: 0 }]} />
                </View>
                <Text style={[st.colisStepLabel, i <= colisStep && st.colisStepLabelOn]}>{lbl}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {ride?.type === 'colis' && ride?.delivery_code && statut !== 'termine' && statut !== 'annule' ? (
          <View style={st.codeCard}>
            <View style={st.codeIcon}><Ionicons name="keypad" size={18} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.codeLabel}>Code de remise</Text>
            </View>
            <Text style={st.codeValue}>{ride.delivery_code}</Text>
          </View>
        ) : null}

        {/* Attente au rendez-vous : information honnête et anticipée. Les premières minutes sont
            offertes ; au-delà, un supplément FIXE (pas un prix à la minute) s'ajoute au trajet.
            PAS pour un COLIS : le coursier vient chercher un paquet, il n'attend pas un passager
            qui doit descendre — il n'y a donc aucun supplément d'attente à annoncer. */}
        {statut === 'arrive' && !isLocation && ride?.type !== 'colis' ? (
          <View style={st.waitCard}>
            <Ionicons name="time-outline" size={18} color={colors.brandDeep} />
            <Text style={st.waitText}>
              Les {waitCfg.graceMin} premières minutes d'attente sont offertes. Au-delà, un supplément de {fcfa(waitCfg.fee)} s'ajoute au trajet.
            </Text>
          </View>
        ) : null}

        <View style={st.actions}>
          {/* Pendant la course : on ne garde que Sécurité (demande fondateur). Avant (recherche/approche/arrivé) :
              Message + Contacter + Sécurité. */}
          {enCours && !isColis ? (
            <Action icon="shield-checkmark" label="Sécurité" highlight onPress={() => setSafetyOpen(true)} />
          ) : (
            <>
              <Action icon="chatbubble" label="Message" badge={unread} onPress={() => { setUnread(0); router.push({ pathname: '/chat', params: { rideId: rideId ?? '', name: chauffeurNom } }); }} />
              {aChauffeur ? (
                <Action icon="call" label="Contacter" onPress={appelerChauffeur} />
              ) : null}
              <Action icon="shield-checkmark" label="Sécurité" highlight onPress={() => setSafetyOpen(true)} />
            </>
          )}
        </View>

        {/* Itinéraire (adresses) retiré de l'écran client à la demande du fondateur : l'écran reste épuré
            (statut, chauffeur, actions). Le client peut toujours modifier la destination ci-dessous. */}

        {/* Modifier l'itinéraire : destination pendant la course, départ avant l'arrivée.
            Colis inclus — le destinataire (« · Pour X ») est reconduit et le prix recalculé côté serveur. */}
        {!isLocation && statut !== 'annule' && statut !== 'termine' ? (
          <View style={st.modifRow}>
            <Pressable style={st.modifBtn} onPress={() => setDestPickerOpen(true)}>
              <Ionicons name="flag-outline" size={16} color={colors.brandDeep} />
              <Text style={st.modifText} numberOfLines={1} adjustsFontSizeToFit>Modifier la destination</Text>
            </Pressable>
            {statut === 'en_route' ? (
              <Pressable style={st.modifBtn} onPress={() => setAdjust({ kind: 'pickup', point: pickup, title: 'Ajuster le départ' })}>
                <Ionicons name="locate-outline" size={16} color={colors.brandDeep} />
                <Text style={st.modifText} numberOfLines={1} adjustsFontSizeToFit>Ajuster le départ</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Annulation possible AVANT le démarrage (recherche / en route / arrivé).
            Une fois EN COURSE, on ne peut plus annuler — c'est le chauffeur qui termine. */}
        {enCours ? (
          // Location : pas de bandeau « en cours » (le grand compte à rebours suffit).
          locEnCours ? null : (
            <View style={st.enCoursNote}>
              <Ionicons name="information-circle-outline" size={17} color={colors.inkSoft} />
              <Text style={st.enCoursNoteText}>{isColis ? 'Livraison' : 'Course'} en cours.</Text>
            </View>
          )
        ) : (
        <Btn
          label={`Annuler la ${objet}`}
          variant="ghost"
          onPress={() => {
            // Avant qu'un chauffeur/coursier accepte : annulation libre (aucun motif).
            if (!aChauffeur) {
              Alert.alert(`Annuler la ${objet}`, `Veux-tu vraiment annuler cette ${objet} ?`, [
                { text: 'Non', style: 'cancel' },
                { text: 'Oui, annuler', style: 'destructive', onPress: () => doCancel() },
              ]);
              return;
            }
            // Après acceptation : motif obligatoire → fenêtre personnalisée (identique iOS/Android).
            setCancelOpen(true);
          }}
          style={{ marginTop: 14 }}
        />
        )}
      </Animated.View>

      {/* « Pourquoi annuler ? » — fenêtre personnalisée : rendu STRICTEMENT identique iOS/Android
          (l'Alert natif réordonnait/coupait les options sur Android). */}
      <Modal visible={cancelOpen} transparent animationType="fade" onRequestClose={() => setCancelOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(20,16,12,0.45)', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 24, padding: 20 }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: colors.ink }}>Pourquoi annuler ?</Text>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.inkSoft, marginTop: 8, lineHeight: 20 }}>
              {aChauffeur && statut === 'arrive' && cancelFee > 0
                ? `Ton ${terme} est arrivé au point de rendez-vous. Des frais de ${fcfa(cancelFee)} peuvent s'appliquer. Indique la raison :`
                : `Ton ${terme} est en route. L'annulation est sans frais. Indique la raison :`}
            </Text>
            {[
              { r: 'chauffeur_loin', label: `Le ${terme} est loin` },
              { r: 'chauffeur_demande', label: `Le ${terme} me demande d'annuler` },
              { r: 'change_avis', label: "J'ai changé d'avis" },
              { r: 'autre', label: 'Autre raison personnelle' },
            ].map((o) => (
              <Pressable key={o.r} onPress={() => doCancel(o.r)} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 10 }}>
                <Text style={{ fontSize: 15.5, fontWeight: '800', color: colors.ink }}>{o.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setCancelOpen(false)} style={{ paddingVertical: 15, alignItems: 'center', marginTop: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: colors.inkSoft }}>Retour</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <SafetySheet
        open={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        chauffeur={chauffeurNom}
        vehicule={vehicule}
        plaque={plaque}
        destination={ride?.destination ?? null}
        eta={etaText}
      />

      {/* Choix d'une nouvelle destination (recherche + carte) */}
      <DestinationPicker
        open={destPickerOpen}
        title="Nouvelle destination"
        onClose={() => setDestPickerOpen(false)}
        onPickOnMap={() => {
          const seed = (destLatN != null && destLngN != null) ? { latitude: destLatN, longitude: destLngN } : pickup;
          setDestPickerOpen(false);
          setAdjust({ kind: 'dest', point: seed, title: 'Ajuster la destination' });
        }}
        onSelect={(p: Place) => { setDestPickerOpen(false); majAdresse('dest', p.label, p.point.latitude, p.point.longitude); }}
      />

      {/* Ajustement d'un point sur la carte (destination ou départ) */}
      <AdjustOnMap
        open={adjust !== null}
        initial={adjust?.point ?? pickup}
        title={adjust?.title ?? 'Ajuster'}
        onClose={() => setAdjust(null)}
        onConfirm={(pt, label) => { const k = adjust?.kind ?? 'dest'; setAdjust(null); majAdresse(k, label, pt.latitude, pt.longitude); }}
      />
    </View>
  );
}

function SafetySheet({ open, onClose, chauffeur, vehicule, plaque, destination, eta }: {
  open: boolean; onClose: () => void; chauffeur: string; vehicule: string; plaque: string; destination: string | null; eta: string;
}) {
  const partager = async () => {
    const lignes = [
      '🚖 Je suis en course avec Taga.',
      `Chauffeur : ${chauffeur}`,
      `Véhicule : ${vehicule} · plaque ${plaque}`,
      destination ? `Destination : ${destination}` : null,
      eta && eta !== '…' ? `Arrivée estimée : ${eta}` : null,
      'Merci de garder un œil sur mon trajet. 🙏',
    ].filter(Boolean).join('\n');
    try { await Share.share({ message: lignes }); } catch { /* ignore */ }
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.backdrop}>
        <SafeAreaView edges={['bottom']} style={st.safeSheet}>
          <View style={st.handle} />
          <View style={st.safeHead}>
            <View style={st.safeIcon}><Ionicons name="shield-checkmark" size={20} color={colors.green} /></View>
            <Text style={st.safeTitle}>Sécurité</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
          </View>

          {/* Rappel chauffeur / véhicule à vérifier */}
          <View style={st.safeVerify}>
            <Ionicons name="car" size={18} color={colors.ink2} />
            <Text style={st.safeVerifyText} numberOfLines={2}>
              Vérifie : <Text style={{ fontWeight: '800', color: colors.ink }}>{chauffeur}</Text> · {vehicule} · plaque <Text style={{ fontWeight: '800', color: colors.ink }}>{plaque}</Text>
            </Text>
          </View>

          <SafeRow icon="share-social" tone={colors.brand} title="Partager mon trajet" sub="Envoie les détails à un proche" onPress={partager} />
          {/* Numéros d'urgence — un seul intitulé par service (pas de doublon « Police secours »). */}
          <SafeRow icon="shield" tone="#137A4B" title="Police · 17" sub="Police secours" onPress={() => Linking.openURL('tel:17')} />
          <SafeRow icon="flame" tone="#E0A82E" title="Pompiers · 18" sub="Incendie & secours" onPress={() => Linking.openURL('tel:18')} />
          <SafeRow icon="call" tone="#C0392B" title="Urgences · 80 00 11 15" sub="Ligne nationale gratuite" onPress={() => Linking.openURL('tel:80001115')} />

          <Text style={st.safeNote}>En cas de danger immédiat, appelle les secours.</Text>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function SafeRow({ icon, tone, title, sub, onPress }: { icon: any; tone: string; title: string; sub: string; onPress?: () => void }) {
  return (
    <Pressable style={st.safeRow} onPress={onPress}>
      <View style={[st.safeRowIcon, { backgroundColor: tone + '22' }]}><Ionicons name={icon} size={20} color={tone} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.safeRowTitle}>{title}</Text>
        <Text style={st.safeRowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
    </Pressable>
  );
}

function Action({ icon, label, onPress, highlight, badge = 0 }: { icon: any; label: string; onPress?: () => void; highlight?: boolean; badge?: number }) {
  return (
    <Pressable style={st.action} onPress={onPress}>
      <View style={[st.actionIcon, highlight && { backgroundColor: colors.greenSoft }]}>
        <Ionicons name={icon} size={22} color={highlight ? colors.green : colors.ink} />
        {badge > 0 ? (
          <View style={st.actionBadge}><Text style={st.actionBadgeTxt}>{badge > 9 ? '9+' : badge}</Text></View>
        ) : null}
      </View>
      <Text style={st.actionLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  locHero: { flex: 1, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  locHeroLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 15, fontWeight: '700', letterSpacing: 0.3, textAlign: 'center' },
  locHeroTime: { color: colors.white, fontSize: 64, fontWeight: '800', marginVertical: 10, fontVariant: ['tabular-nums'] },
  locHeroSub: { color: colors.brand, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', margin: space.lg },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: colors.brand, ...shadow.card },
  shareBtnText: { color: colors.white, fontSize: 13.5, fontWeight: '800' },
  carDot: { position: 'absolute', left: '30%', top: '38%', width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white },
  meDot: { position: 'absolute', right: '28%', bottom: '24%' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.lg, paddingBottom: 34, ...shadow.pop },
  handleHit: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 6, marginTop: -6, marginBottom: 8 }, // zone de préhension large pour glisser
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2 },
  etaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  etaTitle: { fontSize: 21, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  etaPill: { backgroundColor: colors.brand, paddingHorizontal: 14, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  etaPillText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  etaLabel: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  itin: { marginTop: 12, backgroundColor: colors.surface2, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.line },
  itinRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  itinPointDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3 },
  itinCap: { fontSize: 11, fontWeight: '700', color: colors.inkSoft },
  itinDot: { width: 9, height: 9, borderRadius: 5, marginLeft: 2 },
  itinConn: { width: 1, height: 12, backgroundColor: colors.line2, marginLeft: 6, marginVertical: 2 },
  itinText: { fontSize: 13.5, fontWeight: '700', color: colors.ink2, marginTop: 1 },
  modifRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modifBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.brandSoft, backgroundColor: colors.brandTint, paddingHorizontal: 6 },
  modifText: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: colors.brandDeep, textAlign: 'center' },
  enCoursNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colors.surface2, borderRadius: radius.md },
  enCoursNoteText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 18 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  driverName: { fontSize: 16.5, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  driverNote: { fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  driverCar: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  plaque: { backgroundColor: colors.surface2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.line2 },
  plaqueText: { fontSize: 13.5, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 },
  colisSteps: { flexDirection: 'row', marginTop: 16, marginBottom: 2 },
  colisStepRow: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  colisSeg: { flex: 1, height: 3, backgroundColor: colors.line2 },
  colisSegOn: { backgroundColor: colors.brand },
  colisDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  colisDotOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  colisStepLabel: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft, marginTop: 5 },
  colisStepLabelOn: { color: colors.ink },
  codeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.brandTint, borderRadius: radius.lg, padding: 12, marginTop: 14, borderWidth: 1, borderColor: colors.brandSoft },
  codeIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  codeLabel: { fontSize: 14, fontWeight: '800', color: colors.brandDeep },
  codeSub: { fontSize: 12, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  codeValue: { fontSize: 26, fontWeight: '800', color: colors.brandDeep, letterSpacing: 5 },
  // Attente au rendez-vous : bandeau d'information (forfait, pas de prix à la minute).
  waitCard: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, paddingVertical: 11, paddingHorizontal: 12, backgroundColor: colors.brandTint, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brandSoft },
  waitText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: colors.ink2, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  action: { flex: 1, alignItems: 'center', gap: 7, minWidth: 0 },
  actionIcon: { width: '100%', height: 54, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  actionBadge: { position: 'absolute', top: 6, right: '24%', minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  actionBadgeTxt: { color: colors.white, fontSize: 10.5, fontWeight: '800' },
  actionLabel: { fontSize: 12.5, fontWeight: '800', color: colors.ink, textAlign: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.45)', justifyContent: 'flex-end' },
  safeSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 16 },
  safeHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  safeIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  safeTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: colors.ink },
  safeVerify: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface2, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  safeVerifyText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.ink2, lineHeight: 18 },
  safeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
  safeRowIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  safeRowTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  safeRowSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  safeNote: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', lineHeight: 17, marginTop: 6, textAlign: 'center', paddingHorizontal: 6 },
});
