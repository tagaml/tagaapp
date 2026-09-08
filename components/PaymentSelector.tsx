import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { fcfa } from '../data/mock';
import { getWalletCredit, getTagaPayNumber } from '../lib/db';

export type PaymentChoice = { method: string; creditApplied: number };

/**
 * Sélecteur de paiement : Espèces (live), Orange Money (grisé · à venir),
 * Numéro Taga (mobile money, si activé), + crédit Taga si le client en a.
 */
export function PaymentSelector({ total, onChange, allowTaga = false }: { total: number; onChange: (v: PaymentChoice) => void; allowTaga?: boolean }) {
  const [credit, setCredit] = useState(0);
  const [method, setMethod] = useState('Espèces');
  const [useCredit, setUseCredit] = useState(false);
  const [open, setOpen] = useState(false);
  const [tagaNum, setTagaNum] = useState('');

  useEffect(() => { getWalletCredit().then(setCredit).catch(() => {}); }, []);
  useEffect(() => { if (allowTaga) getTagaPayNumber().then(setTagaNum).catch(() => {}); }, [allowTaga]);

  const applied = useCredit ? Math.min(credit, total) : 0;
  useEffect(() => { onChange({ method, creditApplied: applied }); }, [method, applied]);

  return (
    <>
      <Pressable style={st.row} onPress={() => setOpen(true)}>
        <View style={st.badge}><Ionicons name="cash" size={16} color={colors.white} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.label}>{method}</Text>
          {applied > 0 ? <Text style={st.sub}>Crédit Taga : −{fcfa(applied)}</Text> : null}
        </View>
        <Text style={st.change}>Modifier</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.inkMute} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={st.backdrop}>
          <SafeAreaView edges={['bottom']} style={st.sheet}>
            <View style={st.handle} />
            <Text style={st.title}>Moyen de paiement</Text>

            <Pressable style={[st.opt, method === 'Espèces' && st.optOn]} onPress={() => { setMethod('Espèces'); }}>
              <View style={st.optIcon}><Ionicons name="cash" size={20} color={colors.green} /></View>
              <View style={{ flex: 1 }}>
                <Text style={st.optLabel}>Espèces</Text>
                <Text style={st.optSub}>Tu payes le chauffeur à la fin</Text>
              </View>
              {method === 'Espèces' && <Ionicons name="checkmark-circle" size={22} color={colors.brand} />}
            </Pressable>

            {allowTaga && tagaNum ? (
              <Pressable style={[st.opt, method === 'Numéro Taga' && st.optOn]} onPress={() => { setMethod('Numéro Taga'); }}>
                <View style={st.optIcon}><Ionicons name="phone-portrait" size={20} color={colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.optLabel}>Numéro Taga</Text>
                  <Text style={st.optSub}>Payer sur {tagaNum} · confirmé par Taga</Text>
                </View>
                {method === 'Numéro Taga' && <Ionicons name="checkmark-circle" size={22} color={colors.brand} />}
              </Pressable>
            ) : null}

            <View style={[st.opt, st.optDisabled]}>
              <View style={st.optIcon}><Text style={st.om}>OM</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[st.optLabel, { color: colors.inkMute }]}>Orange Money</Text>
                <Text style={st.optSub}>Bientôt disponible</Text>
              </View>
              <View style={st.soon}><Text style={st.soonText}>Bientôt</Text></View>
            </View>

            {credit > 0 && (
              <Pressable style={st.creditRow} onPress={() => setUseCredit((v) => !v)}>
                <View style={st.optIcon}><Ionicons name="wallet" size={20} color={colors.brand} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={st.optLabel}>Utiliser mon crédit Taga</Text>
                  <Text style={st.optSub}>Solde : {fcfa(credit)}</Text>
                </View>
                <View style={[st.check, useCredit && st.checkOn]}>{useCredit && <Ionicons name="checkmark" size={15} color={colors.white} />}</View>
              </Pressable>
            )}

            <Pressable style={st.done} onPress={() => setOpen(false)}>
              <Text style={st.doneText}>OK</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line, marginBottom: 12 },
  badge: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14.5, fontWeight: '800', color: colors.ink },
  sub: { fontSize: 12, fontWeight: '700', color: colors.green, marginTop: 1 },
  change: { fontSize: 13, fontWeight: '700', color: colors.brand },
  backdrop: { flex: 1, backgroundColor: 'rgba(21,17,14,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 14 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, marginBottom: 12 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 2, borderColor: colors.line, marginBottom: 10 },
  optOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  optDisabled: { opacity: 0.6 },
  optIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  om: { color: '#FF6600', fontWeight: '800', fontSize: 12 },
  optLabel: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  optSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  soon: { backgroundColor: colors.line2, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
  soonText: { fontSize: 11, fontWeight: '800', color: colors.inkSoft },
  creditRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line, marginBottom: 10 },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  done: { height: 52, borderRadius: radius.lg, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  doneText: { fontSize: 15.5, fontWeight: '800', color: colors.white },
});
