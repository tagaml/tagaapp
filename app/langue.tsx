import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, useToast } from '../components/ui';
import { langues } from '../data/mock';

// Seul le français est disponible pour l'instant — pas de moteur de traduction embarqué.
const LANGUE_ACTIVE = 'fr';

export default function Langue() {
  const toast = useToast();
  const [selected] = useState(LANGUE_ACTIVE);

  const choisir = (id: string) => {
    if (id === LANGUE_ACTIVE) return;
    toast('Cette langue arrive bientôt sur Taga');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Langue" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        <View style={st.card}>
          {langues.map((l, i) => {
            const actif = selected === l.id;
            const disponible = l.id === LANGUE_ACTIVE;
            return (
              <Pressable
                key={l.id}
                onPress={() => choisir(l.id)}
                style={({ pressed }) => [st.row, i < langues.length - 1 && st.rowBorder, pressed && disponible && { backgroundColor: colors.surface2 }]}
              >
                <Text style={[st.flag, !disponible && { opacity: 0.5 }]}>{l.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[st.label, !disponible && { color: colors.inkSoft }]}>{l.label}</Text>
                  <Text style={st.sub}>{l.sub}</Text>
                </View>
                {actif
                  ? <Ionicons name="checkmark-circle" size={24} color={colors.brand} />
                  : <Text style={st.bientot}>Bientôt</Text>}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  intro: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', marginTop: 6, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  flag: { fontSize: 26 },
  label: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  bientot: { fontSize: 12.5, fontWeight: '700', color: colors.inkMute },
});
