import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';

// Liste courte d'indicatifs (Mali par défaut + diaspora / pays proches).
export const COUNTRIES: { flag: string; name: string; dial: string }[] = [
  { flag: '🇲🇱', name: 'Mali', dial: '223' },
  { flag: '🇨🇮', name: "Côte d'Ivoire", dial: '225' },
  { flag: '🇸🇳', name: 'Sénégal', dial: '221' },
  { flag: '🇬🇳', name: 'Guinée', dial: '224' },
  { flag: '🇧🇫', name: 'Burkina Faso', dial: '226' },
  { flag: '🇫🇷', name: 'France', dial: '33' },
  { flag: '🇺🇸', name: 'États-Unis / Canada', dial: '1' },
];

/** Bouton indicatif (drapeau + +code) qui ouvre une petite liste. `value`/`onChange` = code sans le +. */
export function CountryCode({ value, onChange }: { value: string; onChange: (dial: string) => void }) {
  const [open, setOpen] = useState(false);
  const c = COUNTRIES.find((x) => x.dial === value) ?? COUNTRIES[0];
  return (
    <>
      <Pressable style={st.prefix} onPress={() => setOpen(true)} hitSlop={6}>
        <Text style={st.flag}>{c.flag}</Text>
        <Text style={st.dial}>+{c.dial}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.inkMute} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={st.backdrop} onPress={() => setOpen(false)}>
          <View style={st.sheet}>
            <Text style={st.sheetTitle}>Indicatif du pays</Text>
            {COUNTRIES.map((x) => {
              const on = x.dial === value;
              return (
                <Pressable key={x.name} style={[st.row, on && st.rowOn]} onPress={() => { onChange(x.dial); setOpen(false); }}>
                  <Text style={st.flag}>{x.flag}</Text>
                  <Text style={st.rowName}>{x.name}</Text>
                  <Text style={st.rowDial}>+{x.dial}</Text>
                  {on ? <Ionicons name="checkmark" size={18} color={colors.brand} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const st = StyleSheet.create({
  prefix: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, height: '100%', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.line },
  flag: { fontSize: 18 },
  dial: { fontSize: 16, fontWeight: '800', color: colors.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.45)', justifyContent: 'center', paddingHorizontal: space.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingVertical: 10, paddingHorizontal: 6 },
  sheetTitle: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, paddingHorizontal: 14, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: radius.md },
  rowOn: { backgroundColor: colors.brandTint },
  rowName: { flex: 1, fontSize: 15.5, fontWeight: '700', color: colors.ink },
  rowDial: { fontSize: 15, fontWeight: '800', color: colors.inkSoft },
});
