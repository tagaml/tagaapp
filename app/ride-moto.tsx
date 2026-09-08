import React, { useState } from 'react';
import { View, Text, Pressable, Alert, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, space } from '../theme';
import { Header, Btn, CtaBar, ServiceIcon } from '../components/ui';
import { BAMAKO, distanceKm } from '../components/TripMap';
import { RideMap, Place } from '../components/RideMap';
import { type GeoRoute } from '../lib/geo';
import { vehiculesMoto, fcfa } from '../data/mock';
import { createRide, getPricing, estimatePrice, getServiceFees, type PricingTier } from '../lib/db';
import { realisticEta, arrivalLabel, fallbackEstimate, priceBracket, serverPathKm } from '../lib/estimate';
import { PaymentSelector, type PaymentChoice } from '../components/PaymentSelector';
import { ConfirmOrder } from '../components/ConfirmOrder';
import { ensureInMali, HORS_MALI_MSG } from '../lib/geoGuard';
import { play } from '../lib/sound';
import { st } from './ride-voiture';

export default function RideMoto() {
  const router = useRouter();
  const rp = useLocalSearchParams<{ destLabel?: string; destLat?: string; destLng?: string }>();
  const initialDest: Place | null = rp.destLabel && rp.destLat && rp.destLng
    ? { id: 'redo', label: String(rp.destLabel), sub: String(rp.destLabel), point: { latitude: Number(rp.destLat), longitude: Number(rp.destLng) }, icon: 'location' }
    : null;
  const [sel, setSel] = useState(vehiculesMoto[0].id);
  const [dest, setDest] = useState<Place | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [origin, setOrigin] = useState<{ latitude: number; longitude: number }>(BAMAKO.aci2000);
  const [departLabel, setDepartLabel] = useState('Ma position'); // vrai libellé de départ (édité/géocodé)
  const [route, setRoute] = useState<GeoRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pricing, setPricing] = useState<Record<string, PricingTier>>({});
  const [pay, setPay] = useState<PaymentChoice>({ method: 'Espèces', creditApplied: 0 });
  const [ridePct, setRidePct] = useState(0); // frais de service courses (%) — réglé admin
  const choisi = vehiculesMoto.find((v) => v.id === sel)!;

  React.useEffect(() => {
    getPricing().then(setPricing).catch(() => {});
    getServiceFees().then((f) => setRidePct(f.ridePct)).catch(() => {});
  }, []);

  // PRIX : distance identique au serveur (taga_path_km, arrêts inclus) → prix affiché = offre chauffeur.
  const km = dest ? serverPathKm([origin, ...stops.map((s) => s.point), dest.point]) : 0;
  const fb = dest ? fallbackEstimate(origin, dest.point) : null;
  const eta = realisticEta(route?.durationMin ?? fb?.durationMin ?? null);
  const arrive = arrivalLabel(eta);
  const prixDe = (id: string, base: number) => {
    if (!dest) return base;
    const est = estimatePrice(pricing[id], km);
    return est ?? base + Math.round((km * 200) / 50) * 50;
  };
  // Frais de service Taga (courses) : % du prix de base, ajouté au total.
  const baseTotal = prixDe(choisi.id, choisi.prix);
  const svcFee = Math.round((baseTotal * ridePct) / 100);
  const totalTTC = baseTotal + svcFee;

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
        type: 'moto',
        tier: choisi.id,
        depart: departLabel,
        destination: dest?.label,
        distanceKm: km,
        prix: totalTTC,
        fraisService: svcFee,
        paiement: pay.method,
        creditApplied: pay.creditApplied,
        vehicule: choisi.nom,
        departLat: origin.latitude,
        departLng: origin.longitude,
        destLat: dest?.point.latitude,
        destLng: dest?.point.longitude,
        stops: stops.map((s) => ({ label: s.label, lat: s.point.latitude, lng: s.point.longitude })),
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
      <Header title="Réserver une moto" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <RideMap vehicle="moto" height={215} defaultOrigin={BAMAKO.aci2000} allowStops pickupEditable departCaption="Départ" initialDest={initialDest} onChange={(d, o, r, s, dl) => { setDest(d); setOrigin(o); setRoute(r ?? null); setStops(s ?? []); setDepartLabel(dl || 'Ma position'); }} />

      {dest ? (
        <View style={st.tripStrip}>
          <View style={st.tripItem}><Ionicons name="navigate" size={15} color={colors.brand} /><Text style={st.tripVal}>{km.toFixed(1).replace('.', ',')} km</Text></View>
          {eta ? <><View style={st.tripSep} /><View style={st.tripItem}><Ionicons name="time-outline" size={15} color={colors.brand} /><Text style={st.tripVal}>~{eta} min</Text></View></> : null}
          {arrive ? <><View style={st.tripSep} /><View style={st.tripItem}><Text style={st.tripArrive}>Arrivée ~{arrive}</Text></View></> : null}
          {stops.length ? <View style={st.tripStopChip}><Ionicons name="flag" size={12} color={colors.white} /><Text style={st.tripStopChipTxt}>{stops.length} stop{stops.length > 1 ? 's' : ''}</Text></View> : null}
        </View>
      ) : null}

      <Text style={st.section}>Choisir une moto</Text>
      <View style={{ paddingHorizontal: space.lg, gap: 10 }}>
        {vehiculesMoto.map((v) => {
          const on = v.id === sel;
          return (
            <Pressable key={v.id} onPress={() => setSel(v.id)} style={[st.opt, on && st.optOn]}>
              <View style={st.optIcon}><ServiceIcon name="moto" size={36} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.optName}>{v.nom}</Text>
                <Text style={st.optMeta}>{v.places} · {v.eta}{v.extra ? ' · ' + v.extra : ''}</Text>
              </View>
              {dest ? <Text style={st.optPrix}>{fcfa(prixDe(v.id, v.prix))}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      </ScrollView>

      <CtaBar>
        {dest ? <PaymentSelector total={totalTTC} onChange={setPay} /> : null}
        <View style={st.totalRow}>
          <View>
            <Text style={st.totalLabel}>Total estimé</Text>
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
        moyen={choisi.nom}
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
