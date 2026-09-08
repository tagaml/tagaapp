import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Image, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn, CtaBar, voitureImages, serviceImages } from '../components/ui';
import { BAMAKO, distanceKm } from '../components/TripMap';
import { RideMap, Place } from '../components/RideMap';
import { type GeoRoute } from '../lib/geo';
import { vehiculesVoiture, fcfa } from '../data/mock';
import { createRide, getPricing, estimatePrice, getSharedDiscountPct, getServiceFees, type PricingTier } from '../lib/db';
import { realisticEta, arrivalLabel, fallbackEstimate, priceBracket, serverPathKm } from '../lib/estimate';
import { PaymentSelector, type PaymentChoice } from '../components/PaymentSelector';
import { ConfirmOrder } from '../components/ConfirmOrder';
import { ensureInMali, HORS_MALI_MSG } from '../lib/geoGuard';
import { play } from '../lib/sound';

export default function RideVoiture() {
  const router = useRouter();
  const rp = useLocalSearchParams<{ destLabel?: string; destLat?: string; destLng?: string }>();
  const initialDest: Place | null = rp.destLabel && rp.destLat && rp.destLng
    ? { id: 'redo', label: String(rp.destLabel), sub: String(rp.destLabel), point: { latitude: Number(rp.destLat), longitude: Number(rp.destLng) }, icon: 'location' }
    : null;
  const [sel, setSel] = useState(vehiculesVoiture[0].id);
  const [dest, setDest] = useState<Place | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number }>(BAMAKO.aci2000);
  const [departLabel, setDepartLabel] = useState('Ma position'); // vrai libellé de départ (édité/géocodé)
  const [route, setRoute] = useState<GeoRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false); // récap avant recherche
  const [pricing, setPricing] = useState<Record<string, PricingTier>>({});
  const [pay, setPay] = useState<PaymentChoice>({ method: 'Espèces', creditApplied: 0 });
  // « Partage » est une option du même sélecteur (radio) : Eco / Fresh / SUV / Partage.
  const shared = sel === 'partage';
  const tier = shared ? 'standard' : sel; // le partage roule sur une Eco (id « standard » en base)
  const choisi = vehiculesVoiture.find((v) => v.id === tier)!;
  // Réduction Partage : % réglé côté admin (aligné sur le serveur), arrondi à 50 F.
  const [discPct, setDiscPct] = useState(30);
  const [ridePct, setRidePct] = useState(0); // frais de service courses (%) — réglé admin
  const disc = (p: number) => (shared ? Math.round((p * (100 - discPct) / 100) / 50) * 50 : p);
  // Remise Partage TOUJOURS appliquée (indépendante du véhicule actuellement sélectionné) :
  // la ligne Partage doit montrer son prix réduit dès que l'adresse est posée, sans avoir à la choisir.
  const remisePartage = (p: number) => Math.round((p * (100 - discPct) / 100) / 50) * 50;
  // Prix de base Eco (tier « standard ») — repli quand la grille serveur n'a pas encore chargé.
  const ecoBase = vehiculesVoiture.find((v) => v.id === 'standard')?.prix ?? choisi.prix;

  React.useEffect(() => {
    getPricing().then(setPricing).catch(() => {});
    getSharedDiscountPct().then(setDiscPct).catch(() => {});
    getServiceFees().then((f) => setRidePct(f.ridePct)).catch(() => {});
  }, []);

  // PRIX : distance calculée EXACTEMENT comme le serveur (taga_path_km = vol d'oiseau à travers
  // les arrêts × 1.3). Le serveur recalcule le prix ainsi et l'affiche au chauffeur ; en utilisant
  // la même formule ici, le prix montré au client est identique à l'offre reçue par le chauffeur.
  const km = dest ? serverPathKm([origin, ...stops.map((s) => s.point), dest.point]) : 0;
  // Durée/ETA : on garde le routage OSRM (plus réaliste) pour l'affichage du temps uniquement.
  const fb = dest ? fallbackEstimate(origin, dest.point) : null;
  const eta = realisticEta(route?.durationMin ?? fb?.durationMin ?? null);
  const arrive = arrivalLabel(eta);
  // Estimation depuis la grille serveur (repli sur le prix mock si la grille n'a pas chargé).
  const prixDe = (id: string, base: number) => {
    if (!dest) return base;
    const est = estimatePrice(pricing[id], km);
    return est ?? base + Math.round((km * 350) / 50) * 50;
  };
  // Frais de service Taga (courses) : % du prix de base, ajouté au total.
  const baseTotal = disc(prixDe(choisi.id, choisi.prix));
  const svcFee = Math.round((baseTotal * ridePct) / 100);
  const totalTTC = baseTotal + svcFee;

  // « Commander » ouvre d'abord le récapitulatif ; rien n'est réservé sans confirmation.
  const ouvrirRecap = async () => {
    if (!dest) return;
    if (!(await ensureInMali())) { Alert.alert('Taga au Mali', HORS_MALI_MSG); return; }
    setConfirmOpen(true);
  };

  const commander = async () => {
    if (!(await ensureInMali())) { Alert.alert('Taga au Mali', HORS_MALI_MSG); return; }
    play('order');
    setLoading(true);
    try {
      const id = await createRide({
        type: 'voiture',
        tier: choisi.id,
        depart: departLabel,
        destination: dest?.label,
        distanceKm: km,
        prix: totalTTC,
        fraisService: svcFee,
        shared,
        paiement: pay.method,
        creditApplied: pay.creditApplied,
        vehicule: shared ? `${choisi.nom} · Partage` : choisi.nom,
        departLat: origin.latitude,
        departLng: origin.longitude,
        destLat: dest?.point.latitude,
        destLng: dest?.point.longitude,
        stops: shared ? [] : stops.map((s) => ({ label: s.label, lat: s.point.latitude, lng: s.point.longitude })),
      });
      if (!id) { Alert.alert('Oups', "La course n'a pas pu être enregistrée. Réessaie."); return; }
      router.push({ pathname: '/searching', params: { rideId: id } });
    } catch {
      Alert.alert('Oups', "La course n'a pas pu être enregistrée. Réessaie.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Réserver une voiture" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Partage = un seul trajet : pas d'arrêt intermédiaire (les stops sont réservés aux courses Eco/Fresh/SUV). */}
      <RideMap vehicle="car" height={210} defaultOrigin={BAMAKO.aci2000} allowStops={!shared} pickupEditable departCaption="Départ" initialDest={initialDest} onChange={(d, o, r, s, dl) => { setDest(d); setOrigin(o); setRoute(r ?? null); setStops(shared ? [] : (s ?? [])); setDepartLabel(dl || 'Ma position'); }} />

      {/* Aperçu du trajet EN DIRECT : distance · durée · arrivée · arrêt(s) — se met à jour dès qu'on
          ajoute/retire un arrêt ou change la destination. */}
      {dest ? (
        <View style={st.tripStrip}>
          <View style={st.tripItem}><Ionicons name="navigate" size={15} color={colors.brand} /><Text style={st.tripVal}>{km.toFixed(1).replace('.', ',')} km</Text></View>
          {eta ? <><View style={st.tripSep} /><View style={st.tripItem}><Ionicons name="time-outline" size={15} color={colors.brand} /><Text style={st.tripVal}>~{eta} min</Text></View></> : null}
          {arrive ? <><View style={st.tripSep} /><View style={st.tripItem}><Text style={st.tripArrive}>Arrivée ~{arrive}</Text></View></> : null}
          {stops.length ? <View style={st.tripStopChip}><Ionicons name="flag" size={12} color={colors.white} /><Text style={st.tripStopChipTxt}>{stops.length} stop{stops.length > 1 ? 's' : ''}</Text></View> : null}
        </View>
      ) : null}

      <Text style={st.section}>Choisir un véhicule</Text>
      <View style={{ paddingHorizontal: space.lg, gap: 12 }}>
        {vehiculesVoiture.map((v) => {
          const on = v.id === sel;
          return (
            <Pressable key={v.id} onPress={() => setSel(v.id)} style={[st.opt, on && st.optOn]}>
              <View style={st.carThumb}>
                <Image source={voitureImages[v.id] ?? serviceImages.classic} style={st.carImg} resizeMode="contain" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={st.optName}>{v.nom}</Text>
                  {v.badge && <View style={st.vip}><Text style={st.vipText}>{v.badge}</Text></View>}
                </View>
                <Text style={st.optMeta}>{v.places} · {v.eta}{v.extra ? ' · ' + v.extra : ''}</Text>
              </View>
              {dest ? <Text style={st.optPrix}>{fcfa(prixDe(v.id, v.prix))}</Text> : null}
            </Pressable>
          );
        })}

        {/* Taga Partage : option du même sélecteur (course partagée moins chère) */}
        <Pressable onPress={() => setSel('partage')} style={[st.opt, shared && st.optOn]}>
          <View style={st.carThumb}>
            <Image source={serviceImages.share} style={st.carImg} resizeMode="contain" />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={st.optName}>Partage</Text>
              <View style={st.shareTag}><Text style={st.shareTagText}>-{discPct}%</Text></View>
            </View>
            <Text style={st.optMeta}>Partage la voiture avec un passager</Text>
          </View>
          {dest ? <Text style={st.optPrix}>{fcfa(remisePartage(prixDe('standard', ecoBase)))}</Text> : null}
        </Pressable>
      </View>
      </ScrollView>

      <CtaBar>
        {dest ? <PaymentSelector total={totalTTC} onChange={setPay} /> : null}
        <View style={st.totalRow}>
          <View>
            <Text style={st.totalLabel}>{shared ? 'Total estimé · Partage' : 'Total estimé'}</Text>
            <Text style={st.totalVal}>{dest ? fcfa(Math.max(0, totalTTC - pay.creditApplied)) : '—'}</Text>
          </View>
          <Btn label={dest ? 'Commander' : 'Choisis ta destination'} disabled={!dest} loading={loading} onPress={ouvrirRecap} style={{ flex: 1, marginLeft: 14 }} />
        </View>
      </CtaBar>

      <ConfirmOrder
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        loading={loading}
        onConfirm={() => { setConfirmOpen(false); commander(); }}
        titre="Confirmer ta course"
        moyen={shared ? 'Taga Partage' : choisi.nom}
        rows={[
          { icon: 'ellipse', label: 'Départ', value: departLabel },
          ...stops.map((s, i) => ({ icon: 'flag' as const, label: stops.length > 1 ? `Stop ${i + 1}` : 'Stop', value: s.label })),
          { icon: 'location', label: 'Destination', value: dest?.label ?? '' },
          { icon: 'navigate', label: 'Trajet', value: `${km.toFixed(1).replace('.', ',')} km${eta ? ` · ~${eta} min` : ''}` },
          ...(svcFee > 0 ? [{ icon: 'card' as const, label: 'Frais de service', value: fcfa(svcFee) }] : []),
          { icon: 'card', label: 'Paiement', value: pay.method },
        ]}
        total={Math.max(0, totalTTC - pay.creditApplied)}
        cta="Confirmer et chercher un chauffeur"
      />
    </View>
  );
}

export const st = StyleSheet.create({
  pinA: { position: 'absolute', left: '22%', top: '30%' },
  pinB: { position: 'absolute', right: '24%', bottom: '20%' },
  tripStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: space.lg, marginTop: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingVertical: 10, paddingHorizontal: 14 },
  tripItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tripVal: { fontSize: 13.5, fontWeight: '800', color: colors.ink },
  tripSep: { width: 1, height: 14, backgroundColor: colors.line2 },
  tripArrive: { fontSize: 13, fontWeight: '700', color: colors.inkSoft },
  tripStopChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto', backgroundColor: colors.ink, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  tripStopChipTxt: { fontSize: 12, fontWeight: '800', color: colors.white },
  section: { fontSize: 14.5, fontWeight: '800', color: colors.ink, paddingHorizontal: space.lg, marginTop: 8, marginBottom: 6 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 12, borderWidth: 2, borderColor: colors.line },
  optOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  optIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  carThumb: { width: 54, height: 38, alignItems: 'center', justifyContent: 'center' },
  carImg: { width: 54, height: 38 },
  // flexShrink : un libellé long (ex. « Livraison Tricycle » + badge) ne doit jamais
  // pousser le badge ou le prix hors de la carte sur un écran Android étroit.
  optName: { fontSize: 16, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  optMeta: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 3 },
  optPrix: { fontSize: 15.5, fontWeight: '800', color: colors.ink, flexShrink: 0, marginLeft: 8 },
  vip: { backgroundColor: colors.green, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  vipText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  shareCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 2, borderColor: colors.line, marginTop: 2 },
  shareOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  shareIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  shareTag: { backgroundColor: colors.green, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  shareTagText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  omBadge: { width: 32, height: 32, borderRadius: 9, backgroundColor: '#FF6600', alignItems: 'center', justifyContent: 'center' },
  omText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  payLabel: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  payNum: { flex: 1, textAlign: 'right', fontSize: 13, color: colors.inkSoft, fontWeight: '600' },
  totalRow: { flexDirection: 'row', alignItems: 'center' },
  totalLabel: { fontSize: 12, color: colors.inkSoft, fontWeight: '700' },
  totalVal: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 1 },
  totalRange: { fontSize: 11.5, fontWeight: '700', color: colors.inkSoft, marginTop: 2 },
});
