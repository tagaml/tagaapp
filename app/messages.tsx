import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Avatar } from '../components/ui';
import { getConversations, type Conversation } from '../lib/db';

function initials(nom: string): string {
  return nom.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
}

export default function Messages() {
  const router = useRouter();
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const list = await getConversations();
      setConvos(list);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Messages" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}>
        {loaded && error && convos.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.inkMute} />
            <Text style={st.emptyTitle}>Chargement impossible</Text>
            <Text style={st.emptyText}>Vérifie ta connexion et réessaie.</Text>
            <Pressable style={st.retry} onPress={load}>
              <Ionicons name="refresh" size={16} color={colors.brand} />
              <Text style={st.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : loaded && convos.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="chatbubbles-outline" size={44} color={colors.inkMute} />
            <Text style={st.emptyTitle}>Aucune conversation</Text>
            <Text style={st.emptyText}>Tes échanges avec tes chauffeurs et tes coursiers apparaîtront ici.</Text>
          </View>
        ) : convos.map((c) => (
          <Pressable
            key={c.rideId ?? c.orderId}
            style={st.item}
            onPress={() => router.push({ pathname: '/chat', params: c.orderId ? { orderId: c.orderId, name: c.nom } : { rideId: c.rideId, name: c.nom } })}
          >
            <Avatar text={initials(c.nom)} size={50} tone="ink" />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                {/* Un nom long ne doit pas repousser l'heure hors de l'écran (Android étroit). */}
                <Text style={st.itemName} numberOfLines={1}>{c.nom}</Text>
                <Text style={st.itemTime}>{c.heure}</Text>
              </View>
              <Text style={st.itemMsg} numberOfLines={1}>{c.dernier}</Text>
            </View>
            {c.nonLus > 0 && <View style={st.badge}><Text style={st.badgeText}>{c.nonLus}</Text></View>}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 13, marginHorizontal: space.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  itemName: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink, marginRight: 8 },
  itemTime: { fontSize: 12.5, color: colors.inkMute, fontWeight: '600' },
  itemMsg: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 3 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 6 },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 20 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 16, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  retryText: { fontSize: 14.5, fontWeight: '800', color: colors.brand },
});
