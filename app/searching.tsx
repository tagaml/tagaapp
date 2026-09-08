import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, Alert, ScrollView, BackHandler } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { TripMap, BAMAKO } from '../components/TripMap';
import { subscribeRide, getRide, setRideStatut, redispatchRide, getNearbyDrivers, getNearbyRadiusKm, getPoolEnabled, poolEcoQuote, convertPoolToEco } from '../lib/db';
import { notify } from '../lib/notify';
import { fcfa } from '../data/mock';

type Pt = { latitude: number; longitude: number };

export default function Searching() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const pulse = useRef(new Animated.Value(0)).current;
  const [tooLong, setTooLong] = useState(false);
  const [sysCancel, setSysCancel] = useState(false); // annulée par le système (aucun chauffeur)
  const [partageCancel, setPartageCancel] = useState(false); // annulée faute de co-passager (Partage)
  const [pickup, setPickup] = useState<Pt | null>(null); // vrai point de départ
  const [vehType, setVehType] = useState<'car' | 'moto' | 'tricycle'>('car'); // type demandé
  const [nearby, setNearby] = useState<Pt[]>([]); // chauffeurs dispo du bon type autour
  const [isColis, setIsColis] = useState(false); // un colis cherche un COURSIER, pas un chauffeur
  // Covoiturage Taga Partage : cette course attend un binôme (si le covoiturage est activé).
  const [sharedPool, setSharedPool] = useState(false);
  const [ecoQuote, setEcoQuote] = useState<number | null>(null);
  const [showFallback, setShowFallback] = useState(false); // proposer le repli Eco (pas de binôme)
  const [converting, setConverting] = useState(false);

  // Centre la carte sur le VRAI point de prise en charge + retient le type de véhicule demandé.
  useEffect(() => {
    if (!rideId) return;
    getRide(rideId).then((r) => {
      if (r?.depart_lat != null && r?.depart_lng != null) setPickup({ latitude: r.depart_lat, longitude: r.depart_lng });
      const t = String((r as any)?.type ?? '').toLowerCase();
      const tier = String((r as any)?.tier ?? '').toLowerCase();
      setIsColis(t === 'colis');
      setVehType(t === 'moto' ? 'moto' : t === 'colis' ? (tier === 'tricycle' ? 'tricycle' : 'moto') : 'car');
    }).catch(() => {});
  }, [rideId]);

  // Détecte une course Partage en attente de binôme (uniquement si le covoiturage est activé).
  useEffect(() => {
    if (!rideId) return;
    let on = true;
    (async () => {
      const r = await getRide(rideId).catch(() => null);
      if (!on || !r || !r.shared || r.type !== 'voiture' || r.statut !== 'recherche') return;
      const enabled = await getPoolEnabled().catch(() => false);
      if (!on || !enabled) return;
      setSharedPool(true);
      poolEcoQuote(rideId).then((q) => { if (on) setEcoQuote(q); }).catch(() => {});
    })();
    return () => { on = false; };
  }, [rideId]);

  // Après ~60 s sans binôme, on propose de continuer en Eco au tarif normal (le chauffeur n'est
  // jamais sous-payé). Non bloquant : le client peut aussi patienter encore.
  useEffect(() => {
    if (!sharedPool || !rideId) return;
    const t = setTimeout(async () => {
      const r = await getRide(rideId).catch(() => null);
      if (r && r.statut === 'recherche' && !r.driver_id && r.pool_state !== 'jumele' && r.shared) setShowFallback(true);
    }, 60000);
    return () => clearTimeout(t);
  }, [sharedPool, rideId]);

  const continuerEco = async () => {
    if (!rideId || converting) return;
    setConverting(true);
    try {
      const price = await convertPoolToEco(rideId);
      if (price != null) setEcoQuote(price);
      setShowFallback(false);
      setSharedPool(false);
      redispatchRide(rideId); // relance le dispatch en Eco solo
    } catch {
      Alert.alert('Oups', 'Impossible de continuer en Eco — réessaie.');
    } finally {
      setConverting(false);
    }
  };

  // Vocabulaire aligné sur le service demandé (colis = coursier / livraison).
  const terme = isColis ? 'coursier' : 'chauffeur';
  const objet = isColis ? 'livraison' : 'course';
  // Miroir en ref : l'effet d'abonnement ne tourne qu'au montage et doit lire la valeur à jour.
  const isColisRef = useRef(false);
  useEffect(() => { isColisRef.current = isColis; }, [isColis]);

  // Montre les VRAIS chauffeurs disponibles du bon type autour du point de prise en charge.
  const [nearbyR, setNearbyR] = useState(6); // rayon réglable admin
  useEffect(() => { getNearbyRadiusKm().then(setNearbyR).catch(() => {}); }, []);
  useEffect(() => {
    if (!pickup) return;
    let on = true;
    const refresh = () => getNearbyDrivers(pickup, nearbyR, vehType).then((d) => { if (on) setNearby(d); }).catch(() => {});
    refresh();
    const iv = setInterval(refresh, 8000);
    return () => { on = false; clearInterval(iv); };
  }, [pickup?.latitude, pickup?.longitude, vehType, nearbyR]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true })
    );
    loop.start();

    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      const t = isColisRef.current ? 'coursier' : 'chauffeur';
      notify(`${t === 'coursier' ? 'Coursier' : 'Chauffeur'} trouvé !`, `Ton ${t} a accepté et arrive vers toi.`);
      router.replace({ pathname: '/trip-active', params: { rideId: rideId ?? '' } });
    };

    // Annulation pendant la recherche. Système (aucun chauffeur en 10 min) → écran « réessayer ».
    // Toute autre annulation (admin, autre appareil…) → retour accueil : jamais bloqué sur le radar.
    const checkCancel = () => {
      if (done || !rideId) return;
      getRide(rideId).then((r) => {
        if (!r || r.statut !== 'annule') return;
        done = true;
        if (r.annul_raison === 'aucun_chauffeur' || r.annul_raison === 'aucun_chauffeur_horaire') { setSysCancel(true); if (r.shared) setPartageCancel(true); }
        else router.replace('/(tabs)');
      }).catch(() => {});
    };

    // On attend qu'un VRAI chauffeur accepte (statut quitte « recherche »).
    const off = rideId
      ? subscribeRide(rideId, (s) => { if (s === 'annule') checkCancel(); else if (s !== 'recherche') go(); })
      : () => {};

    // Sécurité : si l'abonnement temps réel a raté l'événement, on vérifie l'état réel toutes les 4 s.
    const poll = rideId
      ? setInterval(() => {
          getRide(rideId).then((r) => {
            if (!r || done) return;
            if (r.statut === 'annule') {
              done = true;
              if (r.annul_raison === 'aucun_chauffeur' || r.annul_raison === 'aucun_chauffeur_horaire') { setSysCancel(true); if (r.shared) setPartageCancel(true); }
              else router.replace('/(tabs)');
            } else if (r.statut !== 'recherche') go();
          });
        }, 4000)
      : undefined;

    // Au bout de ~45 s sans chauffeur, on propose d'attendre encore ou d'annuler.
    const slow = setTimeout(() => setTooLong(true), 45000);

    // Filet de sécurité : relance le dispatch toutes les 20 s tant que la course cherche
    // (réoffre au prochain chauffeur si la chaîne d'offres s'est épuisée).
    const redispatch = rideId
      ? setInterval(() => {
          getRide(rideId).then((r) => { if (r && r.statut === 'recherche') redispatchRide(rideId); });
        }, 20000)
      : undefined;

    return () => { loop.stop(); if (poll) clearInterval(poll); if (redispatch) clearInterval(redispatch); clearTimeout(slow); off(); };
  }, []);

  const annuler = () => {
    Alert.alert(
      `Annuler la ${objet}`,
      `Veux-tu vraiment annuler cette recherche de ${terme} ?`,
      [
        { text: 'Non, continuer', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            if (rideId) {
              try { await setRideStatut(rideId, 'annule'); }
              catch { Alert.alert('Annulation impossible', 'Annulation impossible — vérifie ta connexion.'); return; }
            }
            router.replace('/(tabs)');
          },
        },
      ],
    );
  };

  // Retour matériel Android → demande confirmation d'annulation (jamais de sortie silencieuse).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { annuler(); return true; });
    return () => sub.remove();
  }, [rideId]);

  const rings = [0, 0.5].map((_delay, i) => {
    return (
      <Animated.View
        key={i}
        style={[
          st.ring,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4 + i * 0.2, 2.4 + i * 0.2] }) }],
          },
        ]}
      />
    );
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Carte plein largeur en haut (~60 %) avec le radar centré sur ta position. */}
      <View style={st.mapArea}>
        <TripMap fill rounded={false} origin={pickup ?? BAMAKO.aci2000} drivers={nearby} vehicle={vehType === 'car' ? 'car' : 'moto'} showsUser interactive={false} recenterKey={pickup ? 1 : 0} />

        {/* Flèche retour : demande confirmation d'annulation (pas de sortie silencieuse). */}
        <SafeAreaView edges={['top']} style={st.topBar} pointerEvents="box-none">
          <Pressable style={st.backBtn} onPress={annuler} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.ink} />
          </Pressable>
        </SafeAreaView>

        {/* Radar au centre de la carte */}
        <View style={st.center} pointerEvents="none">
          {rings}
          <View style={st.core}>
            <Ionicons name="person" size={26} color={colors.white} />
          </View>
        </View>
      </View>

      {/* Contenu bas plein écran : texte + bouton Annuler toujours visibles (scroll si petit écran). */}
      <SafeAreaView edges={['bottom']} style={st.bottomArea}>
        <ScrollView contentContainerStyle={[st.bottomContent, { paddingBottom: Math.max(16, insets.bottom) }]} showsVerticalScrollIndicator={false}>
          {sysCancel ? (
            <>
              <View style={st.textBlock}>
                <Text style={st.title}>{partageCancel ? 'Pas de co-passager trouvé' : `Aucun ${terme} disponible`}</Text>
                {partageCancel ? <Text style={st.sub}>On n'a pas trouvé de co-passager pour ta course partagée. Refais ta demande, ou pars maintenant en Eco ou Fresh.</Text> : null}
              </View>
              <View style={{ flex: 1 }} />
              {partageCancel ? (
                <Pressable style={[st.cancel, { backgroundColor: colors.brand, borderColor: colors.brand }]} onPress={() => router.replace('/ride-voiture')}>
                  <Text style={[st.cancelText, { color: colors.white }]}>Commander en Eco / Fresh</Text>
                </Pressable>
              ) : (
                <Pressable style={[st.cancel, { backgroundColor: colors.brand, borderColor: colors.brand }]} onPress={() => router.back()}>
                  <Text style={[st.cancelText, { color: colors.white }]}>Réessayer</Text>
                </Pressable>
              )}
              <Pressable style={st.cancel} onPress={() => router.replace('/(tabs)')}>
                <Text style={st.cancelText}>Retour à l'accueil</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={st.textBlock}>
                <Text style={st.title}>{sharedPool ? 'Recherche d\'un covoiturage' : `Recherche de ${terme} en cours`}</Text>
                {sharedPool ? <Text style={st.sub}>On te jumelle avec un passager sur le même trajet.</Text> : null}
                <View style={st.dots}>
                  <Dot i={0} v={pulse} /><Dot i={1} v={pulse} /><Dot i={2} v={pulse} />
                </View>
              </View>
              <View style={{ flex: 1, minHeight: 12 }} />
              {showFallback ? (
                <View style={st.fallbackCard}>
                  <Text style={st.fallbackTitle}>Pas encore de binôme</Text>
                  <Text style={st.fallbackSub}>
                    Tu peux patienter encore, ou partir maintenant en Eco au tarif normal{ecoQuote != null ? ` (${fcfa(ecoQuote)})` : ''}.
                  </Text>
                  <Pressable style={[st.fallbackBtn, converting && { opacity: 0.6 }]} onPress={continuerEco} disabled={converting}>
                    <Ionicons name="car" size={17} color={colors.white} />
                    <Text style={st.fallbackBtnText}>{converting ? '…' : `Continuer en Eco${ecoQuote != null ? ` · ${fcfa(ecoQuote)}` : ''}`}</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable style={st.cancel} onPress={annuler}>
                <Text style={st.cancelText}>Annuler la {objet}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Dot({ i, v }: { i: number; v: Animated.Value }) {
  const o = v.interpolate({ inputRange: [0, 0.33, 0.66, 1], outputRange: i === 0 ? [1, 0.3, 0.3, 1] : i === 1 ? [0.3, 1, 0.3, 0.3] : [0.3, 0.3, 1, 0.3] });
  return <Animated.View style={[st.dot, { opacity: o }]} />;
}

const st = StyleSheet.create({
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.lg },
  backBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginTop: 6, ...shadow.card },
  center: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, backgroundColor: colors.brand },
  core: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.white, ...shadow.pop },
  // Plein écran : carte en haut (~60 %), contenu en dessous.
  mapArea: { height: '60%', backgroundColor: colors.surface2 },
  bottomArea: { flex: 1, backgroundColor: colors.surface },
  bottomContent: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: 24 },
  textBlock: { alignItems: 'center' },
  title: { fontSize: 21, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 14.5, color: colors.inkSoft, fontWeight: '600', marginTop: 8, lineHeight: 21, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginTop: 18, marginBottom: 4 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand },
  cancel: { marginTop: 14, height: 54, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  fallbackCard: { backgroundColor: colors.surface2, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginTop: 6 },
  fallbackTitle: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  fallbackSub: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft, marginTop: 5, lineHeight: 19 },
  fallbackBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.brand, height: 50, borderRadius: radius.md, marginTop: 12 },
  fallbackBtnText: { color: colors.white, fontSize: 15, fontWeight: '800' },
});
