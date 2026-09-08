import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { colors, radius } from '../theme';

/** Numéro Taga + bouton « Copier » (feedback « Copié ✓ » 1,8 s). Tape n'importe où sur la ligne pour copier. */
export function CopyNumber({ number }: { number: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(number);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  };
  return (
    <Pressable style={st.row} onPress={copy}>
      <Text style={st.num} numberOfLines={1}>{number}</Text>
      <View style={[st.btn, copied && { backgroundColor: colors.green }]}>
        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={colors.white} />
        <Text style={st.btnText}>{copied ? 'Copié' : 'Copier'}</Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, paddingLeft: 16, paddingRight: 8, paddingVertical: 8, marginTop: 10, borderWidth: 1, borderColor: colors.brandSoft },
  num: { flexShrink: 1, fontSize: 18, fontWeight: '800', color: colors.ink, letterSpacing: 0.5 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.brand, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  btnText: { color: colors.white, fontWeight: '800', fontSize: 12.5 },
});
