import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors, radius, space } from '../theme';
import { Header, Btn, useToast } from '../components/ui';
import { getAddresses, setDefaultAddress, type Address } from '../lib/db';

const icons: Record<string, any> = { Maison: 'home', Travail: 'briefcase' };

export default function Addresses() {
  const router = useRouter();
  const toast = useToast();
  // `select=1` → on vient du checkout/d'une commande : taper une adresse la CHOISIT.
  // Sinon on est en simple gestion : taper une adresse l'ouvre en modification.
  const { select } = useLocalSearchParams<{ select?: string }>();
  const modeChoix = select === '1';

  const [items, setItems] = useState<Address[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(false);
    getAddresses()
      .then((list) => { setItems(list); })
      .catch(() => { setError(true); })
      .finally(() => setLoaded(true));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const modifier = (a: Address) => router.push({ pathname: '/address-form', params: { id: a.id } });

  // Choisir une adresse = la définir par défaut → tous les écrans (checkout, courses)
  // relisent l'adresse par défaut au focus et affichent donc celle-ci.
  const choisir = async (a: Address) => {
    if (busy) return;
    setBusy(a.id);
    try {
      await setDefaultAddress(a.id);
      if (modeChoix) { router.back(); return; }
      toast('Adresse par défaut mise à jour');
      load();
    } catch {
      toast("Impossible de sélectionner cette adresse", { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={modeChoix ? 'Choisir une adresse' : 'Mes adresses'} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 20 }}>
        {modeChoix && items.length > 0 ? (
          <Text style={st.hint}>Touche une adresse pour l'utiliser</Text>
        ) : null}

        {!loaded ? (
          <View style={st.empty}>
            <ActivityIndicator color={colors.brand} size="large" />
          </View>
        ) : error && items.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="cloud-offline-outline" size={40} color={colors.inkMute} />
            <Text style={st.emptyText}>Chargement impossible</Text>
            <Pressable style={st.retry} onPress={load}>
              <Ionicons name="refresh" size={16} color={colors.brand} />
              <Text style={st.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={st.empty}>
            <Ionicons name="location-outline" size={40} color={colors.inkMute} />
            <Text style={st.emptyText}>Aucune adresse enregistrée</Text>
          </View>
        ) : (
          items.map((a) => (
            <Pressable
              key={a.id}
              style={({ pressed }) => [st.item, a.is_default && st.itemOn, pressed && { opacity: 0.9 }]}
              onPress={() => (modeChoix ? choisir(a) : modifier(a))}
            >
              <View style={st.icon}><Ionicons name={icons[a.label] || 'location'} size={20} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <View style={st.labelRow}>
                  <Text style={st.label} numberOfLines={1}>{a.label}</Text>
                  {a.is_default ? (
                    <View style={st.badge}><Text style={st.badgeText}>Par défaut</Text></View>
                  ) : null}
                </View>
                <Text style={st.detail} numberOfLines={2}>{a.detail}</Text>
                {!modeChoix && !a.is_default ? (
                  <Pressable hitSlop={8} onPress={() => choisir(a)} style={st.defBtn}>
                    <Text style={st.defBtnText}>Définir par défaut</Text>
                  </Pressable>
                ) : null}
              </View>

              {busy === a.id ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : modeChoix ? (
                // En mode choix, on garde un accès explicite à la modification.
                <Pressable hitSlop={10} onPress={() => modifier(a)} style={st.editBtn}>
                  <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
                </Pressable>
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.inkMute} />
              )}
            </Pressable>
          ))
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: 28 }}>
        <Btn
          label="Ajouter une adresse"
          onPress={() =>
            // Ajoutée depuis une commande → la nouvelle adresse devient celle utilisée.
            router.push(modeChoix ? { pathname: '/address-form', params: { select: '1' } } : '/address-form')
          }
        />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 13, fontWeight: '700', color: colors.inkSoft, marginTop: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginTop: 12, borderWidth: 1, borderColor: colors.line },
  itemOn: { borderColor: colors.brand, borderWidth: 1.5 },
  icon: { width: 46, height: 46, borderRadius: 14, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 16, fontWeight: '800', color: colors.ink, flexShrink: 1 },
  badge: { backgroundColor: colors.brandTint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 10.5, fontWeight: '800', color: colors.brand },
  detail: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
  defBtn: { marginTop: 8, alignSelf: 'flex-start' },
  defBtnText: { fontSize: 12.5, fontWeight: '800', color: colors.brand },
  editBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: 15, fontWeight: '700', color: colors.inkSoft },
  retry: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  retryText: { fontSize: 14.5, fontWeight: '800', color: colors.brand },
});
