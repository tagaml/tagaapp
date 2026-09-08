import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Header, Avatar } from '../../components/ui';
import { colors, radius, space } from '../../theme';
import {
  getNotifications, markNotificationsRead, type Notif,
  getConversations, type Conversation,
} from '../../lib/db';

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  course: 'car', commande: 'fast-food', info: 'notifications', promo: 'gift', paiement: 'cash',
};

function tempsRelatif(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

function initials(nom: string): string {
  return nom.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

export default function DriverNotifications() {
  const router = useRouter();
  const [tab, setTab] = useState<'alertes' | 'messages'>('alertes');
  const [items, setItems] = useState<Notif[]>([]);
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false); // panne réseau ≠ « aucune alerte » : on distingue les deux
  const [sel, setSel] = useState<Notif | null>(null);
  const hasLoaded = useRef(false); // le plein écran de chargement ne s'affiche qu'au premier chargement

  // Ouvre l'élément lié à une alerte : conversation → chat, sinon détail lisible.
  const openNotif = (n: Notif) => {
    // La pastille rouge disparaît dès le clic (marquée lue localement).
    if (!n.lu) setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, lu: true } : x)));
    if (n.type === 'message' && n.ref_id) {
      router.push({ pathname: '/chat', params: { ...(n.ref_type === 'order' ? { orderId: n.ref_id } : { rideId: n.ref_id }), role: 'driver' } });
    } else {
      setSel(n);
    }
  };

  const charger = useCallback(() => {
    if (!hasLoaded.current) setLoading(true); // sinon on rafraîchit en silence (pas de spinner plein écran)
    setErreur(false);
    // On distingue une vraie liste vide d'un échec réseau : sans ça, une coupure afficherait
    // « Aucune alerte » comme si c'était la réalité.
    Promise.all([getNotifications(), getConversations()])
      .then(([n, c]) => { setItems(n); setConvos(c); hasLoaded.current = true; })
      .catch(() => { if (!hasLoaded.current) setErreur(true); })
      .finally(() => setLoading(false));
    markNotificationsRead().catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  const unreadConvos = convos.reduce((s, c) => s + (c.nonLus || 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Notifications" />

      <View style={st.tabs}>
        <Pressable style={[st.tab, tab === 'alertes' && st.tabOn]} onPress={() => setTab('alertes')}>
          <Text style={[st.tabText, tab === 'alertes' && st.tabTextOn]}>Alertes</Text>
        </Pressable>
        <Pressable style={[st.tab, tab === 'messages' && st.tabOn]} onPress={() => setTab('messages')}>
          <Text style={[st.tabText, tab === 'messages' && st.tabTextOn]}>Messages{unreadConvos > 0 ? ` · ${unreadConvos}` : ''}</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={st.empty}><ActivityIndicator color={colors.brand} size="large" /></View>
      ) : erreur ? (
        <View style={st.empty}>
          <View style={st.emptyIcon}><Ionicons name="cloud-offline-outline" size={34} color={colors.brand} /></View>
          <Text style={st.emptyText}>Impossible de charger tes notifications.{'\n'}Vérifie ta connexion.</Text>
          <Pressable style={st.retry} onPress={charger} hitSlop={8}>
            <Text style={st.retryTxt}>Réessayer</Text>
          </Pressable>
        </View>
      ) : tab === 'alertes' ? (
        items.length === 0 ? (
          <View style={st.empty}>
            <View style={st.emptyIcon}><Ionicons name="notifications-off-outline" size={34} color={colors.inkMute} /></View>
            <Text style={st.emptyText}>Aucune alerte pour le moment.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: space.lg, paddingTop: 12, gap: 10 }}>
            {items.map((n) => (
              <Pressable key={n.id} style={[st.card, !n.lu && st.cardNonLu]} onPress={() => openNotif(n)}>
                <View style={st.iconWrap}><Ionicons name={ICON[n.type] ?? 'notifications'} size={20} color={colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.titre}>{n.titre}</Text>
                  {n.corps ? <Text style={st.corps} numberOfLines={2}>{n.corps}</Text> : null}
                  <Text style={st.temps}>{tempsRelatif(n.created_at)}</Text>
                </View>
                {!n.lu ? <View style={st.dot} /> : <Ionicons name="chevron-forward" size={16} color={colors.inkMute} />}
              </Pressable>
            ))}
          </ScrollView>
        )
      ) : (
        convos.length === 0 ? (
          <View style={st.empty}>
            <View style={st.emptyIcon}><Ionicons name="chatbubbles-outline" size={34} color={colors.inkMute} /></View>
            <Text style={st.emptyText}>Aucune conversation.{'\n'}Tes échanges avec les clients apparaîtront ici.</Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {convos.map((c) => (
              <Pressable
                key={c.rideId ?? c.orderId}
                style={st.item}
                onPress={() => router.push({ pathname: '/chat', params: { ...(c.orderId ? { orderId: c.orderId } : { rideId: c.rideId }), name: c.nom, role: 'driver' } })}
              >
                <Avatar text={initials(c.nom)} size={50} tone="ink" />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={st.itemName}>{c.nom}</Text>
                    <Text style={st.itemTime}>{c.heure}</Text>
                  </View>
                  <Text style={st.itemMsg} numberOfLines={1}>{c.dernier}</Text>
                </View>
                {c.nonLus > 0 && <View style={st.badge}><Text style={st.badgeText}>{c.nonLus}</Text></View>}
              </Pressable>
            ))}
          </ScrollView>
        )
      )}

      {/* Détail d'une alerte (lecture complète du message) */}
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
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: space.lg, marginTop: 6, marginBottom: 8 },
  tab: { flex: 1, height: 42, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line2 },
  tabOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  tabText: { fontSize: 14, fontWeight: '800', color: colors.ink2 },
  tabTextOn: { color: colors.white },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14 },
  cardNonLu: { backgroundColor: colors.brandTint, borderColor: colors.brandSoft },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  titre: { fontSize: 15, fontWeight: '800', color: colors.ink },
  corps: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '500', marginTop: 2, lineHeight: 18 },
  temps: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', marginTop: 6 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand, marginTop: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: space.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  itemName: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  itemTime: { fontSize: 12.5, color: colors.inkSoft, fontWeight: '600' },
  itemMsg: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 3 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: 16 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
  retry: { backgroundColor: colors.brand, borderRadius: radius.md, paddingHorizontal: 20, paddingVertical: 12 },
  retryTxt: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  // Détail alerte (modal)
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
