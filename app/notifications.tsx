import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../components/ui';
import { colors, radius, space } from '../theme';
import { getNotifications, markNotificationsRead, type Notif } from '../lib/db';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  course: 'car', commande: 'fast-food', info: 'notifications', promo: 'gift',
};

function tempsRelatif(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export default function Notifications() {
  const router = useRouter();
  const [items, setItems] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sel, setSel] = useState<Notif | null>(null);

  const charger = useCallback(() => {
    setError(false);
    setLoading(true);
    let on = true;
    getNotifications()
      .then((list) => { if (on) setItems(list); })
      .catch(() => { if (on) setError(true); })
      .finally(() => { if (on) setLoading(false); });
    markNotificationsRead().catch(() => {});
    return () => { on = false; };
  }, []);

  // Ouvre l'élément lié à la notification (conversation, course, commande) ; sinon détail lisible.
  const openNotif = (n: Notif) => {
    // La pastille rouge disparaît dès le clic (marquée lue localement).
    if (!n.lu) setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, lu: true } : x)));
    if (n.ref_id) {
      if (n.type === 'message') {
        router.push({ pathname: '/chat', params: n.ref_type === 'order' ? { orderId: n.ref_id } : { rideId: n.ref_id } });
      } else if (n.ref_type === 'order') {
        router.push({ pathname: '/receipt', params: { id: n.ref_id } });
      } else if (n.ref_type === 'ride') {
        router.push({ pathname: '/trip-detail', params: { id: n.ref_id } });
      } else {
        setSel(n);
      }
    } else {
      setSel(n);
    }
  };

  // Charge les notifications et les marque lues à l'ouverture de l'écran.
  useFocusEffect(charger);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Notifications" />

      {loading ? (
        <View style={st.empty}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : error && items.length === 0 ? (
        <View style={st.empty}>
          <View style={st.emptyIcon}>
            <Ionicons name="cloud-offline-outline" size={34} color={colors.inkMute} />
          </View>
          <Text style={st.emptyText}>Chargement impossible. Vérifie ta connexion.</Text>
          <Pressable style={st.retry} onPress={charger}>
            <Ionicons name="refresh" size={16} color={colors.brand} />
            <Text style={st.retryText}>Réessayer</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={st.empty}>
          <View style={st.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={34} color={colors.inkMute} />
          </View>
          <Text style={st.emptyText}>Aucune notification pour le moment.</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: space.lg, paddingTop: 12, gap: 10 }}
        >
          {items.map((n) => (
            <Pressable key={n.id} style={[st.card, !n.lu && st.cardNonLu]} onPress={() => openNotif(n)}>
              <View style={st.iconWrap}>
                <Ionicons name={ICON[n.type] ?? 'notifications'} size={20} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.titre}>{n.titre}</Text>
                {n.corps ? <Text style={st.corps} numberOfLines={2}>{n.corps}</Text> : null}
                <Text style={st.temps}>{tempsRelatif(n.created_at)}</Text>
              </View>
              {!n.lu ? <View style={st.dot} /> : <Ionicons name="chevron-forward" size={16} color={colors.inkMute} />}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Détail d'une notification (lecture complète) */}
      <Modal visible={!!sel} transparent animationType="fade" onRequestClose={() => setSel(null)}>
        <Pressable style={st.backdrop} onPress={() => setSel(null)} />
        {sel && (
          <View style={st.detailWrap} pointerEvents="box-none">
            <View style={st.detail}>
              <View style={st.detailIcon}><Ionicons name={ICON[sel.type] ?? 'notifications'} size={24} color={colors.brand} /></View>
              <Text style={st.detailTitre}>{sel.titre}</Text>
              <Text style={st.detailTemps}>{tempsRelatif(sel.created_at)}</Text>
              {sel.corps ? <Text style={st.detailCorps}>{sel.corps}</Text> : null}
              <Pressable style={st.detailBtn} onPress={() => setSel(null)}>
                <Text style={st.detailBtnText}>Fermer</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  toutLire: { fontSize: 14, fontWeight: '700', color: colors.brand },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  cardNonLu: { backgroundColor: colors.brandTint, borderColor: colors.brandSoft },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titre: { fontSize: 15, fontWeight: '800', color: colors.ink },
  corps: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '500', marginTop: 2, lineHeight: 18 },
  temps: { fontSize: 12, color: colors.inkMute, fontWeight: '600', marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: 16 },
  emptyIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', textAlign: 'center' },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  retryText: { fontSize: 14.5, fontWeight: '800', color: colors.brand },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  detailWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  detail: { width: '100%', backgroundColor: colors.bg, borderRadius: 22, padding: 22, alignItems: 'center' },
  detailIcon: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  detailTitre: { fontSize: 18, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  detailTemps: { fontSize: 12.5, fontWeight: '600', color: colors.inkMute, marginTop: 4 },
  detailCorps: { fontSize: 15, fontWeight: '500', color: colors.ink2, textAlign: 'center', lineHeight: 22, marginTop: 14 },
  detailBtn: { alignSelf: 'stretch', marginTop: 22, height: 50, borderRadius: radius.md, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  detailBtnText: { fontSize: 15.5, fontWeight: '800', color: colors.white },
});
