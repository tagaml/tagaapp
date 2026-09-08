import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn, Avatar } from '../components/ui';
import { TripMap, BAMAKO } from '../components/TripMap';
import { fcfa } from '../data/mock';
import { getRide, type DriverRide } from '../lib/db';

function hm(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function TripDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [ride, setRide] = useState<DriverRide | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    getRide(id).then((r) => setRide(r)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Détail" />
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      </View>
    );
  }
  if (!ride) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Détail" />
        <Text style={st.empty}>Course introuvable.</Text>
      </View>
    );
  }

  const origin = ride.depart_lat != null && ride.depart_lng != null
    ? { latitude: ride.depart_lat, longitude: ride.depart_lng } : BAMAKO.aci2000;
  const dest = (ride as any).dest_lat != null && (ride as any).dest_lng != null
    ? { latitude: (ride as any).dest_lat, longitude: (ride as any).dest_lng } : BAMAKO.aeroport;
  const prix = ride.prix ?? 0;
  // Vrai frais de service enregistré à la réservation (0 si non appliqué). Plus de 6 % cosmétique.
  const service = ride.frais_service ?? 0;
  const base = Math.max(0, prix - service);
  const ini = ride.chauffeur_nom ? ride.chauffeur_nom.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '🚕';
  const locHours = ride.location_hours ?? 0;
  const isLocation = locHours > 0;
  const locTarifH = isLocation ? Math.round(base / locHours) : 0;
  const fmtH = (h: number) => {
    const whole = Math.floor(h);
    const half = h - whole >= 0.5;
    if (whole === 0) return '30 min';
    return `${whole} h${half ? ' 30' : ''}`;
  };
  const ref = `#${ride.id.slice(0, 6).toUpperCase()}`;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Détail" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        {isLocation ? (
          <>
            <Text style={[st.dest, { marginTop: 6 }]}>Chauffeur à l'heure · {fmtH(locHours)}</Text>
            <Text style={st.refLine}>{ref}</Text>
            {ride.chauffeur_nom && (
              <View style={[st.driver, { marginTop: 12 }]}>
                <Avatar text={ini} size={48} tone="ink" uri={ride.chauffeur_photo ?? undefined} />
                <View style={{ flex: 1 }}>
                  <Text style={st.driverName}>{ride.chauffeur_nom}</Text>
                  {ride.plaque ? <Text style={st.driverCar}>{ride.plaque}</Text> : null}
                </View>
              </View>
            )}
            <Text style={st.locDetail}>{hm(ride.created_at)} · {ride.vehicule || 'Taga'}</Text>
          </>
        ) : (
          <>
            <TripMap origin={origin} destination={dest} height={160} />
            <Text style={st.dest}>{ride.destination || 'Course Taga'}</Text>
            <Text style={st.date}>{hm(ride.created_at)} · {ride.vehicule || 'Taga'} · {ref}</Text>
            {ride.chauffeur_nom && (
              <View style={st.driver}>
                <Avatar text={ini} size={48} tone="ink" uri={ride.chauffeur_photo ?? undefined} />
                <View style={{ flex: 1 }}>
                  <Text style={st.driverName}>{ride.chauffeur_nom}</Text>
                  <Text style={st.driverCar}>
                    {ride.chauffeur_note ? `${ride.chauffeur_note} · ` : ''}{ride.vehicule || ''}{ride.plaque ? ` · ${ride.plaque}` : ''}
                  </Text>
                </View>
              </View>
            )}
          </>
        )}

        <View style={st.route}>
          <View style={st.routeRow}>
            <View style={st.dotStart} />
            <View style={{ flex: 1 }}>
              <Text style={st.routeTitle}>{ride.depart || 'Départ'}</Text>
              <Text style={st.routeSub}>{isLocation ? 'Prise en charge' : 'Départ'} · {hm(ride.created_at)}</Text>
            </View>
          </View>
          {isLocation ? (
            <>
              <View style={st.routeLine} />
              <View style={st.routeRow}>
                <Ionicons name="time" size={18} color={colors.brand} style={{ marginLeft: -1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={st.routeTitle}>Chauffeur à disposition</Text>
                  <Text style={st.routeSub}>Pendant {fmtH(locHours)}</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              {[(ride as any).stop1_label, (ride as any).stop2_label].filter(Boolean).map((s: string, i: number) => (
                <View key={i}>
                  <View style={st.routeLine} />
                  <View style={st.routeRow}>
                    <View style={[st.dotStart, { backgroundColor: colors.ink }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={st.routeTitle}>{s}</Text>
                      <Text style={st.routeSub}>Stop {i + 1}</Text>
                    </View>
                  </View>
                </View>
              ))}
              <View style={st.routeLine} />
              <View style={st.routeRow}>
                <Ionicons name="location" size={18} color={colors.brand} style={{ marginLeft: -1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={st.routeTitle}>{ride.destination || 'Destination'}</Text>
                  <Text style={st.routeSub}>{ride.distance_km ? `${Number(ride.distance_km).toFixed(1).replace('.', ',')} km` : 'Arrivée'}</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {ride.type === 'colis' && ride.colis_note ? (
          <>
            <Text style={st.label}>Contenu du colis</Text>
            <View style={st.box}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                <Ionicons name="cube-outline" size={18} color={colors.brand} />
                <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '700', color: colors.ink2, lineHeight: 20 }}>{ride.colis_note}</Text>
              </View>
            </View>
          </>
        ) : null}

        <Text style={st.label}>Paiement</Text>
        <View style={st.box}>
          {isLocation ? (
            <>
              <Line label={`Location · ${fmtH(locHours)} × ${fcfa(locTarifH)}/h`} value={fcfa(base)} />
              {service > 0 ? <Line label="Frais de service" value={fcfa(service)} /> : null}
              <View style={st.sep} />
              <Line label="Total" value={fcfa(prix)} bold />
            </>
          ) : (
            <>
              <Line label="Prix de la course" value={fcfa(base)} />
              {service > 0 ? <Line label="Frais de service" value={fcfa(service)} /> : null}
              <View style={st.sep} />
              <Line label="Total" value={fcfa(prix)} bold />
            </>
          )}
        </View>
        <Text style={st.payNote}>Payé avec {(ride as any).paiement || 'Orange Money'}</Text>

        <Btn
          label="Refaire ce trajet"
          onPress={() => {
            const pathname = ride.type === 'moto' ? '/ride-moto' : ride.type === 'colis' ? '/colis' : '/ride-voiture';
            const dLat = (ride as any).dest_lat, dLng = (ride as any).dest_lng;
            // Pré-remplit la destination si on a ses coordonnées (sinon écran vierge).
            const params = (ride.destination && dLat != null && dLng != null)
              ? { destLabel: ride.destination, destLat: String(dLat), destLng: String(dLng) }
              : undefined;
            router.push({ pathname, params } as any);
          }}
          style={{ marginTop: 18 }}
        />
      </ScrollView>
    </View>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={st.line}>
      <Text style={[st.lineLabel, bold && { color: colors.ink, fontWeight: '800', fontSize: 16 }]}>{label}</Text>
      <Text style={[st.lineValue, bold && { fontSize: 18 }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  empty: { textAlign: 'center', color: colors.inkSoft, fontWeight: '600', marginTop: 40, paddingHorizontal: space.lg },
  dest: { fontSize: 22, fontWeight: '800', color: colors.ink, marginTop: 16 },
  date: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 4 },
  refLine: { fontSize: 13, color: colors.inkSoft, fontWeight: '700', marginTop: 4 },
  locDetail: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 10 },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 13, marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line },
  driverName: { fontSize: 16, fontWeight: '800', color: colors.ink },
  driverCar: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  route: { marginTop: 16, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  dotStart: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: colors.ink, marginLeft: 2, marginTop: 2 },
  routeLine: { width: 2, height: 22, backgroundColor: colors.line2, marginLeft: 8, marginVertical: 4 },
  routeTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  routeSub: { fontSize: 12.5, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 22, marginBottom: 10 },
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line },
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, gap: 10 },
  lineLabel: { flex: 1, flexShrink: 1, fontSize: 14.5, color: colors.inkSoft, fontWeight: '600' },
  lineValue: { flexShrink: 0, textAlign: 'right', fontSize: 14.5, fontWeight: '700', color: colors.ink },
  sep: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  payNote: { fontSize: 12.5, color: colors.inkSoft, fontWeight: '600', marginTop: 10 },
});
