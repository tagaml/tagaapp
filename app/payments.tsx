import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useLiveRefresh, srcCredits } from '../lib/live';
import { colors, radius, space } from '../theme';
import { Header, Btn } from '../components/ui';
import { getPaymentMethods, setDefaultPayment, deletePaymentMethod, type PaymentMethod } from '../lib/db';

const bg: Record<string, string> = { om: '#FF6600', mm: '#1565C0' };

function iconFor(type: string): string {
  if (type === 'om') return 'OM';
  if (type === 'mm') return 'MM';
  if (type === 'card') return '💳';
  return '💵';
}

export default function Payments() {
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      const list = await getPaymentMethods();
      setMethods(list);
    } catch {
      setError(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  // Temps réel : un crédit accordé par l'admin apparaît tout de suite dans le solde.
  useLiveRefresh(load, srcCredits);

  const onPressItem = (p: PaymentMethod) => {
    Alert.alert(p.label, p.detail ?? '', [
      ...(p.is_default ? [] : [{
        text: 'Définir par défaut',
        onPress: async () => {
          try { await setDefaultPayment(p.id); await load(); }
          catch { Alert.alert('Échec', 'Action impossible. Réessaie.'); }
        },
      }]),
      {
        text: 'Supprimer',
        style: 'destructive' as const,
        onPress: async () => {
          try { await deletePaymentMethod(p.id); await load(); }
          catch { Alert.alert('Échec', 'Suppression impossible. Réessaie.'); }
        },
      },
      { text: 'Annuler', style: 'cancel' as const },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Paiement" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 20 }}>
        {loaded && error && methods.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={44} color={colors.inkMute} />
            <Text style={st.emptyTitle}>Chargement impossible</Text>
            <Text style={st.emptyText}>Vérifie ta connexion et réessaie.</Text>
            <Pressable style={st.retry} onPress={load}>
              <Ionicons name="refresh" size={16} color={colors.brand} />
              <Text style={st.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : loaded && methods.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="card-outline" size={44} color={colors.inkMute} />
            <Text style={st.emptyTitle}>Aucun moyen de paiement</Text>
            <Text style={st.emptyText}>Ajoute un moyen de paiement pour régler tes courses et commandes.</Text>
          </View>
        ) : methods.map((p) => {
          const icon = iconFor(p.type);
          return (
            <Pressable key={p.id} style={st.item} onPress={() => onPressItem(p)}>
              <View style={[st.icon, icon.length <= 2 && { backgroundColor: bg[p.type] || colors.ink }]}>
                {icon.length <= 2
                  ? <Text style={st.iconText}>{icon}</Text>
                  : <Text style={{ fontSize: 22 }}>{icon}</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.label}>{p.label}</Text>
                <Text style={st.detail}>{p.detail ?? ''}{p.is_default ? (p.detail ? ' · ' : '') + 'Par défaut' : ''}</Text>
              </View>
              {p.is_default
                ? <View style={st.check}><Ionicons name="checkmark" size={14} color={colors.white} /></View>
                : <Ionicons name="ellipsis-horizontal" size={20} color={colors.inkMute} />}
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: 28 }}>
        <Btn label="Ajouter un moyen de paiement" onPress={() => router.push('/payment-form')} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  icon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: colors.white, fontSize: 14, fontWeight: '800' },
  label: { fontSize: 16, fontWeight: '800', color: colors.ink },
  detail: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: colors.ink, marginTop: 6 },
  emptyText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 20 },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 16, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  retryText: { fontSize: 14.5, fontWeight: '800', color: colors.brand },
});
