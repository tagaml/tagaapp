import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { colors, radius, shadow, space } from '../../theme';
import { Avatar, useToast, Btn } from '../../components/ui';
import { TripMap, BAMAKO, distanceKm } from '../../components/TripMap';
import { fcfa } from '../../data/mock';
import { getPoolLegs, setRideStatut, markRidePaid, updateDriverPosition, getRideContactPhone, subscribeRide, notifyPoolPickupOrder, type DriverRide } from '../../lib/db';
import { contactParty } from '../../lib/contact';
import { notify } from '../../lib/notify';
import { routeBetween, routeVia, moveHeading, type GeoRoute } from '../../lib/geo';
import { openNavigation } from '../../lib/navigation';
import { playDriver } from '../../lib/sound';
import { SlideButton } from '../../components/SlideButton';

type Pt = { latitude: number; longitude: number };
type Step = { kind: 'pickup' | 'drop'; legId: string; pt: Pt; name: string; addr: string };

function capGps(h?: number | null): number | null {
  return typeof h === 'number' && Number.isFinite(h) && h >= 0 && h <= 360 ? h : null;
}
const nom = (l: DriverRide) => l.passager_nom || 'Passager';
const pt = (lat?: number | null, lng?: number | null): Pt | null =>
  lat != null && lng != null ? { latitude: Number(lat), longitude: Number(lng) } : null;
const net = (l: DriverRide) => Math.max(0, (l.prix ?? 0) - (l.credit_applied ?? 0));

// Ordonne la course partagée : récupère le passager le plus proche du chauffeur d'abord, puis l'autre ;
// dépose ensuite en partant du dépôt le plus proche du dernier point de prise en charge.
//
// IMPORTANT (retour testeur Retouche 2) : un passager DÉJÀ À BORD n'a plus d'étape « récupérer ».
// Cas typique de l'empilement « +1 » : le chauffeur a d'abord pris la 1re course partagée seul, a
// RÉCUPÉRÉ le client 1 (course `en_cours`), PUIS la 2e course s'empile. Avant, on réinsérait quand
// même une étape « récupérer client 1 » verrouillée sur son point de départ (déjà quitté) : le
// chauffeur restait bloqué là, incapable d'avancer vers le client 2 → « la 2e prise en charge est
// ignorée ». On ne crée donc une récupération QUE pour les passagers pas encore montés.
function buildSteps(legs: DriverRide[], start: Pt): Step[] {
  if (legs.length < 2) return [];
  const aBord = (l: DriverRide) => l.statut === 'en_cours';   // passager déjà monté
  const fini = (l: DriverRide) => l.statut === 'termine';     // course déjà déposée
  const withPts = legs.map((l) => ({ l, pick: pt(l.depart_lat, l.depart_lng), drop: pt(l.dest_lat, l.dest_lng) }));
  const pickups = withPts
    .filter((x) => x.pick && !aBord(x.l) && !fini(x.l))       // seulement ceux qu'il reste à récupérer
    .sort((a, b) => distanceKm(start, a.pick as Pt) - distanceKm(start, b.pick as Pt));
  const lastPick = (pickups[pickups.length - 1]?.pick ?? start) as Pt;
  const drops = withPts
    .filter((x) => x.drop && !fini(x.l))                       // tous les dépôts restants (y c. déjà à bord)
    .sort((a, b) => distanceKm(lastPick, a.drop as Pt) - distanceKm(lastPick, b.drop as Pt));
  const steps: Step[] = [];
  for (const p of pickups) steps.push({ kind: 'pickup', legId: p.l.id, pt: p.pick as Pt, name: nom(p.l), addr: p.l.depart || 'Point de prise en charge' });
  for (const d of drops) steps.push({ kind: 'drop', legId: d.l.id, pt: d.drop as Pt, name: nom(d.l), addr: d.l.destination || 'Destination' });
  return steps;
}

export default function PoolTrip() {
  const toast = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ poolId?: string }>();
  const poolId = typeof params.poolId === 'string' ? params.poolId : undefined;

  const [legs, setLegs] = useState<DriverRide[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Record<string, boolean>>({}); // legId -> déposé
  const [cancelled, setCancelled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<Pt>(BAMAKO.driver);
  const [cap, setCap] = useState<number | undefined>(undefined);
  const [locFixed, setLocFixed] = useState(false);
  const [route, setRoute] = useState<GeoRoute | null>(null);
  const posRef = useRef<Pt>(BAMAKO.driver);
  const builtRef = useRef(false);

  const legById = (id: string) => legs.find((l) => l.id === id);
  const cur = steps[Math.min(stepIdx, steps.length - 1)];
  const curLeg = cur ? legById(cur.legId) : undefined;
  // Étapes RESTANTES (non annulées) : sert à tracer TOUT le parcours sur la carte (les 2 récupérations
  // puis les 2 dépôts), pas seulement l'étape courante — comme demandé.
  const remaining = steps.slice(stepIdx).filter((s) => !cancelled[s.legId]);
  const totalGain = legs.reduce((s, l) => s + (l.prix ?? 0), 0);

  // Chargement du pool (2 legs).
  useEffect(() => {
    if (!poolId) return;
    getPoolLegs(poolId).then((ls) => setLegs(ls)).catch(() => {});
  }, [poolId]);

  // Construit la séquence une fois les legs chargés. On ATTEND la vraie position GPS pour ordonner
  // « le passager le plus proche d'abord » (sinon on trie depuis un point par défaut = mauvais ordre).
  // Repli : si le GPS ne se fixe pas sous 4 s, on construit quand même pour ne jamais bloquer l'écran.
  const [buildFallback, setBuildFallback] = useState(false);
  useEffect(() => {
    if (locFixed) return;
    const t = setTimeout(() => setBuildFallback(true), 4000);
    return () => clearTimeout(t);
  }, [locFixed]);
  useEffect(() => {
    if (builtRef.current || legs.length < 2) return;
    if (!locFixed && !buildFallback) return;
    builtRef.current = true;
    setSteps(buildSteps(legs, posRef.current));
  }, [legs, locFixed, buildFallback]);

  // Suivi des annulations client par leg.
  useEffect(() => {
    if (legs.length < 2) return;
    const offs = legs.map((l) =>
      subscribeRide(l.id, (statut) => {
        if (statut === 'annule') {
          setCancelled((c) => ({ ...c, [l.id]: true }));
          notify('Passager annulé', `${nom(l)} a annulé sa course.`);
          playDriver('request');
        }
      })
    );
    return () => offs.forEach((o) => o());
  }, [legs]);

  // Diffuse la position GPS réelle aux DEUX passagers tant que leur course n'est pas terminée.
  useEffect(() => {
    if (!poolId || legs.length < 2) return;
    let active = true;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || !active) return;
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const fp = { latitude: first.coords.latitude, longitude: first.coords.longitude };
        posRef.current = fp; setPos(fp); setLocFixed(true);
        const c0 = capGps(first.coords.heading); if (c0 != null) setCap(c0);
        let prev = fp;
        const broadcast = (p: Pt) => legs.forEach((l) => { if (!done[l.id] && !cancelled[l.id]) updateDriverPosition(l.id, p.latitude, p.longitude).catch(() => {}); });
        broadcast(fp);
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 15 },
          (loc) => {
            const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
            const c = moveHeading(prev, p) ?? capGps(loc.coords.heading);
            if (c != null) setCap(c);
            prev = p; posRef.current = p; setPos(p); setLocFixed(true);
            broadcast(p);
          },
        );
      } catch { /* GPS indisponible : on n'affiche pas la position */ }
    })();
    return () => { active = false; sub?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId, legs.length]);

  // Itinéraire chauffeur → TOUTES les étapes restantes (récup 1 → récup 2 → dépose 1 → dépose 2).
  useEffect(() => {
    if (!remaining.length) { setRoute(null); return; }
    let actif = true;
    const calc = () => {
      const pts = [posRef.current, ...remaining.map((s) => s.pt)];
      (pts.length > 2 ? routeVia(pts) : routeBetween(posRef.current, remaining[0].pt)).then((r) => { if (actif) setRoute(r); }).catch(() => {});
    };
    calc();
    const iv = setInterval(calc, 15000);
    return () => { actif = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, steps.length]);

  // Informe UNE fois chaque passager de l'ordre de prise en charge (1er récupéré / 2e ensuite).
  const orderNotifiedRef = useRef(false);
  useEffect(() => {
    if (orderNotifiedRef.current) return;
    const pickups = steps.filter((s) => s.kind === 'pickup');
    if (pickups.length < 2) return;
    orderNotifiedRef.current = true;
    notifyPoolPickupOrder(pickups[0].legId, pickups[1].legId).catch(() => {});
  }, [steps.length]);

  // Passe automatiquement les étapes d'un passager qui a annulé.
  useEffect(() => {
    if (cur && cancelled[cur.legId]) setStepIdx((i) => Math.min(i + 1, steps.length));
  }, [cur, cancelled, steps.length]);

  const ARRIVE_M = 160, DROP_M = 190;
  const gpsGate = locFixed;
  const distM = cur ? Math.round(distanceKm(pos, cur.pt) * 1000) : 0;
  const near = !gpsGate || distM <= (cur?.kind === 'drop' ? DROP_M : ARRIVE_M);

  const allDone = steps.length > 0 && stepIdx >= steps.length;

  useEffect(() => {
    if (!allDone) return;
    playDriver('complete');
    const enc = legs.filter((l) => !cancelled[l.id]).reduce((s, l) => s + net(l), 0);
    Alert.alert('Course partagée terminée', `Tu as encaissé ${fcfa(enc)} au total (2 passagers).`, [
      { text: 'OK', onPress: () => router.replace('/driver') },
    ]);
  }, [allDone]);

  const avancerPickup = async () => {
    if (busy || !cur || !curLeg) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      await setRideStatut(curLeg.id, 'en_cours'); // passager à bord
      setStepIdx((i) => i + 1);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      toast('Connexion instable — réessaie.', { tone: 'error' });
    } finally { setBusy(false); }
  };

  const deposer = async () => {
    if (busy || !cur || !curLeg) return;
    const finaliser = async () => {
      setBusy(true);
      try {
        await setRideStatut(curLeg.id, 'termine');
        await markRidePaid(curLeg.id);
        setDone((d) => ({ ...d, [curLeg.id]: true }));
        playDriver('complete');
        setStepIdx((i) => i + 1);
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        toast('Connexion instable — réessaie.', { tone: 'error' });
      } finally { setBusy(false); }
    };
    const paie = (curLeg.paiement || 'Espèces');
    if (paie === 'Espèces') {
      Alert.alert('Encaissement', `As-tu bien reçu ${fcfa(net(curLeg))} en espèces de ${nom(curLeg)} ?`, [
        { text: 'Pas encore', style: 'cancel' },
        { text: 'Oui, encaissé', onPress: finaliser },
      ]);
    } else {
      await finaliser();
    }
  };

  const boarded = (legId: string) => stepIdx > steps.findIndex((s) => s.kind === 'pickup' && s.legId === legId);

  if (!poolId || (legs.length && legs.length < 2)) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.inkSoft }}>Course partagée introuvable.</Text>
        <Pressable onPress={() => router.replace('/driver')} style={{ marginTop: 14 }}><Text style={{ color: colors.brand, fontWeight: '800' }}>Retour</Text></Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.top}>
        <View style={st.poolTag}><Ionicons name="people" size={15} color="#fff" /><Text style={st.poolTagText}>Course partagée · 2 passagers</Text></View>
        <Pressable onPress={() => router.replace('/driver')} hitSlop={10} style={st.close}>
          <Ionicons name="close" size={22} color={colors.ink} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: space.lg }}>
        <Pressable
          style={st.navBanner}
          onPress={() => cur && openNavigation({ lat: cur.pt.latitude, lng: cur.pt.longitude, address: cur.addr, label: `${cur.kind === 'pickup' ? 'Récupérer' : 'Déposer'} ${cur.name}` })}
        >
          <Ionicons name="navigate" size={20} color="#fff" />
          <Text style={st.navText}>{cur ? `${cur.kind === 'pickup' ? 'Naviguer — récupérer' : 'Naviguer — déposer'} ${cur.name}` : 'Course terminée'}</Text>
          <Ionicons name="open-outline" size={17} color="#fff" />
        </Pressable>
        <TripMap
          origin={remaining[0]?.pt}
          destination={remaining.length > 1 ? remaining[remaining.length - 1]?.pt : remaining[0]?.pt}
          stops={remaining.length > 2 ? remaining.slice(1, -1).map((s) => s.pt) : undefined}
          driver={pos} driverHeading={cap} routeCoords={route?.coords} height={150} vehicle="car" fitRoute
        />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        <View style={st.header}>
          <Text style={st.big}>{cur ? (cur.kind === 'pickup' ? `Récupérer ${cur.name}` : `Déposer ${cur.name}`) : 'Terminé'}</Text>
          <Text style={st.bigSub}>Étape {Math.min(stepIdx + 1, steps.length)} / {steps.length}{route ? ` · ${route.durationMin} min` : ''}</Text>
          <Text style={st.dest} numberOfLines={1}>{cur?.addr}</Text>
        </View>

        {/* Séquence des étapes */}
        <View style={st.card}>
          {/* Seulement les étapes RESTANTES : une fois un passager récupéré (ou déposé), sa ligne
              DISPARAÎT — l'écran reste léger et n'affiche que ce qu'il reste à faire. */}
          {remaining.map((s, i) => {
            const l = legById(s.legId);
            const active = i === 0;
            return (
              <View key={`${s.kind}-${s.legId}`} style={[st.stepRow, active && st.stepRowOn]}>
                <View style={[st.stepDot, { backgroundColor: s.kind === 'pickup' ? colors.green : colors.brand }]}>
                  <Ionicons name={s.kind === 'pickup' ? 'person' : 'flag'} size={12} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.stepTitle} numberOfLines={1}>
                    {s.kind === 'pickup' ? 'Récupérer' : 'Déposer'} {s.name}
                  </Text>
                  <Text style={st.stepAddr} numberOfLines={1}>{s.addr}</Text>
                </View>
                {s.kind === 'drop' && l ? <Text style={st.stepPrix}>{fcfa(net(l))}</Text> : null}
              </View>
            );
          })}

          <View style={st.gainRow}>
            <Text style={st.gainLabel}>Total course partagée</Text>
            <Text style={st.gainVal}>{fcfa(totalGain)}</Text>
          </View>

          {curLeg && !cancelled[curLeg.id] ? (
            <Pressable style={st.callBtn} onPress={async () => { const tel = await getRideContactPhone(curLeg.id); contactParty(tel, nom(curLeg)); }}>
              <Ionicons name="call" size={17} color={colors.ink} />
              <Text style={st.callText}>Appeler {nom(curLeg)}</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Passagers déjà à bord */}
        <View style={{ marginTop: 14, gap: 8 }}>
          {legs.map((l) => (
            <View key={l.id} style={st.paxRow}>
              <Avatar text={nom(l).split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()} size={38} tone="ink" uri={l.passager_photo ?? undefined} />
              <Text style={st.paxName}>{nom(l)}</Text>
              <Text style={[st.paxState, cancelled[l.id] && { color: colors.brand }]}>
                {cancelled[l.id] ? 'Annulé' : done[l.id] ? 'Déposé' : boarded(l.id) ? 'À bord' : 'En attente'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={[st.bottom, { paddingBottom: insets.bottom + 14 }]}>
        {cur && cur.kind === 'pickup' ? (
          <>
            <Btn label={`${cur.name} récupéré`} onPress={avancerPickup} loading={busy} disabled={!near} style={{ height: 58 }} />
            {!near ? <Text style={st.gateHint}>Rapproche-toi du point de prise en charge · {distM} m</Text> : null}
          </>
        ) : cur ? (
          <SlideButton label={`Glissez : déposer ${cur.name}`} onComplete={deposer} disabled={!near} disabledLabel={`Rapproche-toi de la destination · ${distM} m`} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: 6, paddingBottom: 4 },
  poolTag: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.ink, paddingHorizontal: 12, height: 34, borderRadius: 17 },
  poolTagText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  navBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.brand, paddingVertical: 15, borderRadius: radius.md, marginBottom: 10, ...shadow.card },
  navText: { fontSize: 15.5, fontWeight: '800', color: '#fff', flexShrink: 1 },
  header: { alignItems: 'center', marginTop: 14 },
  big: { fontSize: 26, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  bigSub: { fontSize: 14.5, fontWeight: '700', color: colors.inkSoft, marginTop: 3 },
  dest: { fontSize: 15, fontWeight: '800', color: colors.ink, marginTop: 10, textAlign: 'center', maxWidth: '92%' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, ...shadow.card, marginTop: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 8, borderRadius: radius.md },
  stepRowOn: { backgroundColor: colors.brandTint },
  stepDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  stepPast: { color: colors.inkMute, textDecorationLine: 'line-through' },
  stepAddr: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 1 },
  stepPrix: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  gainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  gainLabel: { fontSize: 13.5, fontWeight: '700', color: colors.inkSoft },
  gainVal: { fontSize: 18, fontWeight: '800', color: colors.ink },
  callBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, borderRadius: radius.md, backgroundColor: colors.surface2, marginTop: 14 },
  callText: { fontSize: 14, fontWeight: '800', color: colors.ink },
  paxRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: colors.line },
  paxName: { flex: 1, fontSize: 14.5, fontWeight: '800', color: colors.ink },
  paxState: { fontSize: 12.5, fontWeight: '800', color: colors.inkSoft },
  bottom: { paddingHorizontal: space.lg, paddingTop: 12 },
  gateHint: { fontSize: 12.5, fontWeight: '700', color: colors.brandDeep, textAlign: 'center', marginTop: 8 },
});
