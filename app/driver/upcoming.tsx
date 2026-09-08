import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../../theme';
import { fcfa } from '../../data/mock';
import { getMyScheduledRides, type DriverRide } from '../../lib/db';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function quand(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const h = `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  const demain = new Date(); demain.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `Aujourd'hui à ${h}`;
  if (d.toDateString() === demain.toDateString()) return `Demain à ${h}`;
  return `${d.getDate()} ${MOIS[d.getMonth()]} à ${h}`;
}
function fmtHours(h: number | null | undefined): string {
  const v = h ?? 0;
  const wh = Math.floor(v);
  return `${wh}h${v - wh >= 0.5 ? '30' : ''}`;
}

export default function Upcoming() {
  const router = useRouter();
  const [rides, setRides] = useState<DriverRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false); // panne réseau ≠ « aucune course » : on distingue les deux
  const [refreshing, setRefreshing] = useState(false);

  const charger = useCallback(async () => {
    setErreur(false);
    try {
      setRides(await getMyScheduledRides());
    } catch {
      // Échec de chargement : ne JAMAIS afficher « aucune course programmée » comme si c'était réel.
      setRides((prev) => { if (prev.length === 0) setErreur(true); return prev; });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { charger(); }, [charger]));
  const refresh = () => { setRefreshing(true); charger().finally(() => setRefreshing(false)); };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.head}>
        <Pressable onPress={() => router.replace('/driver')} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Text style={st.headTitle}>Courses à venir</Text>
        <View style={{ width: 42 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brand} />}
      >
        <Text style={st.intro}>Tes locations réservées. La course t'arrivera automatiquement peu avant l'heure prévue.</Text>

        {!loading && erreur && rides.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.brand} />
            <Text style={st.emptyText}>Impossible de charger tes courses à venir. Vérifie ta connexion.</Text>
            <Pressable style={st.retry} onPress={charger} hitSlop={8}>
              <Text style={st.retryTxt}>Réessayer</Text>
            </Pressable>
          </View>
        ) : !loading && rides.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="calendar-outline" size={40} color={colors.inkMute} />
            <Text style={st.emptyText}>Aucune course programmée pour le moment.</Text>
          </View>
        ) : null}

        {rides.map((r) => (
          <View key={r.id} style={st.card}>
            <View style={st.cardTop}>
              <View style={st.whenPill}>
                <Ionicons name="time" size={14} color={colors.brandDeep} />
                <Text style={st.whenText}>{quand(r.scheduled_at ?? null)}</Text>
              </View>
              <Text style={st.prix}>{fcfa(r.prix)}</Text>
            </View>

            <View style={st.row}>
              <Ionicons name="location" size={16} color={colors.green} />
              <Text style={st.rowText} numberOfLines={1}>{r.depart || 'Point de prise en charge'}</Text>
            </View>
            <View style={st.row}>
              <Ionicons name="hourglass-outline" size={16} color={colors.inkSoft} />
              <Text style={st.rowText}>Location · {fmtHours(r.location_hours)}</Text>
            </View>
            {r.vehicule ? (
              <View style={st.row}>
                <Ionicons name="car-outline" size={16} color={colors.inkSoft} />
                <Text style={st.rowText} numberOfLines={1}>{r.vehicule}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: 8 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card },
  headTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  intro: { fontSize: 13.5, fontWeight: '600', color: colors.inkSoft, lineHeight: 19, marginTop: 8, marginBottom: 14 },
  empty: { alignItems: 'center', paddingVertical: 50, gap: 12 },
  emptyText: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', textAlign: 'center', lineHeight: 20 },
  retry: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
  retryTxt: { color: '#fff', fontSize: 14, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.line, marginBottom: 12, ...shadow.card },
  // Ligne « libellé + montant » : le libellé CÈDE (flex 1, il se replie), le montant JAMAIS
  // (flexShrink 0). Sans ça, les deux textes prenaient leur largeur naturelle et le montant
  // sortait de la carte quand le libellé était long (ex. « Encaissé en espèces (déjà en main) »).
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  whenPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brandTint, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  whenText: { flex: 1, flexShrink: 1, fontSize: 12.5, fontWeight: '800', color: colors.brandDeep },
  prix: { flexShrink: 0, textAlign: 'right', fontSize: 17, fontWeight: '800', color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rowText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink2 },
});
