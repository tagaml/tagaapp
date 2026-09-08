import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch } from 'react-native';
import { colors, radius, space } from '../theme';
import { Header } from '../components/ui';
import { prefsNotifs } from '../data/mock';
import { getNotifPrefs, saveNotifPrefs } from '../lib/db';

export default function NotificationSettings() {
  const [etats, setEtats] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(prefsNotifs.map((p) => [p.id, p.defaut]))
  );

  // Charge les préférences enregistrées (fusionnées avec les valeurs par défaut).
  useEffect(() => {
    getNotifPrefs().then((saved) => {
      if (saved) setEtats((e) => ({ ...e, ...saved }));
    }).catch(() => {});
  }, []);

  const toggle = (id: string) => {
    setEtats((e) => {
      const next = { ...e, [id]: !e[id] };
      saveNotifPrefs(next).catch(() => {});
      return next;
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Notifications" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        <View style={[st.card, { marginTop: 18 }]}>
          {prefsNotifs.map((p, i) => (
            <View key={p.id} style={[st.row, i < prefsNotifs.length - 1 && st.rowBorder]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={st.label}>{p.label}</Text>
                <Text style={st.desc}>{p.desc}</Text>
              </View>
              <Switch
                value={etats[p.id]}
                onValueChange={() => toggle(p.id)}
                trackColor={{ false: colors.line2, true: colors.brand }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.line2}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  intro: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', marginTop: 6, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  label: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  desc: { fontSize: 13, fontWeight: '600', color: colors.inkSoft, marginTop: 3, lineHeight: 18 },
});
