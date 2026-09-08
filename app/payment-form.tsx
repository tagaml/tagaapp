import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn, useToast } from '../components/ui';
import { savePaymentMethod } from '../lib/db';

type TypeId = 'om' | 'mm' | 'card' | 'cash';

const types: { id: TypeId; label: string; icon: keyof typeof Ionicons.glyphMap; suggest: string; detailLabel?: string; placeholder?: string; keyboard?: any }[] = [
  { id: 'om', label: 'Orange Money', icon: 'phone-portrait', suggest: 'Orange Money', detailLabel: 'Numéro de téléphone', placeholder: '+223 •• •• •• ••', keyboard: 'phone-pad' },
  { id: 'mm', label: 'Moov Money', icon: 'phone-portrait', suggest: 'Moov Money', detailLabel: 'Numéro de téléphone', placeholder: '+223 •• •• •• ••', keyboard: 'phone-pad' },
  { id: 'card', label: 'Carte bancaire', icon: 'card', suggest: 'Carte bancaire', detailLabel: '4 derniers chiffres', placeholder: '1234', keyboard: 'number-pad' },
  { id: 'cash', label: 'Espèces', icon: 'cash', suggest: 'Espèces' },
];

export default function PaymentForm() {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState<TypeId>('om');
  const [label, setLabel] = useState('Orange Money');
  const [labelEdited, setLabelEdited] = useState(false);
  const [detail, setDetail] = useState('');
  const [parDefaut, setParDefaut] = useState(false);
  const [saving, setSaving] = useState(false);

  const current = types.find((t) => t.id === type)!;
  const besoinDetail = type !== 'cash';

  const choisirType = (t: typeof types[number]) => {
    setType(t.id);
    if (!labelEdited) setLabel(t.suggest);
  };

  const valide = label.trim().length > 0 && (!besoinDetail || detail.trim().length > 0);

  const enregistrer = async () => {
    if (!valide || saving) return;
    setSaving(true);
    try {
      await savePaymentMethod({
        type,
        label: label.trim(),
        detail: besoinDetail ? detail.trim() : undefined,
        is_default: parDefaut,
      });
      toast('Moyen de paiement ajouté');
      router.back();
    } catch {
      toast('Échec de l’enregistrement', { tone: 'error' });
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Ajouter un paiement" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 32 }}>
        <Text style={st.hint}>Type de paiement</Text>
        <View style={st.types}>
          {types.map((t) => {
            const actif = type === t.id;
            return (
              <Pressable key={t.id} style={[st.typeCard, actif && st.typeCardOn]} onPress={() => choisirType(t)}>
                <Ionicons name={t.icon} size={22} color={actif ? colors.brand : colors.inkSoft} />
                <Text style={[st.typeLabel, actif && st.typeLabelOn]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          label="Nom"
          value={label}
          onChange={(v) => { setLabel(v); setLabelEdited(true); }}
          placeholder={current.suggest}
        />

        {besoinDetail ? (
          <Field
            label={current.detailLabel ?? 'Détail'}
            value={detail}
            onChange={setDetail}
            placeholder={current.placeholder}
            keyboard={current.keyboard}
          />
        ) : null}

        <Pressable style={st.toggle} onPress={() => setParDefaut((v) => !v)}>
          <View style={{ flex: 1 }}>
            <Text style={st.toggleLabel}>Définir par défaut</Text>
          </View>
          <View style={[st.switch, parDefaut && st.switchOn]}>
            <View style={[st.knob, parDefaut && st.knobOn]} />
          </View>
        </Pressable>

        <Btn label="Enregistrer" onPress={enregistrer} disabled={!valide} loading={saving} style={{ marginTop: 20 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }: { label: string; value: string; onChange: (s: string) => void; placeholder?: string; keyboard?: any }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} keyboardType={keyboard} style={st.input} placeholderTextColor={colors.inkMute} />
    </View>
  );
}

const st = StyleSheet.create({
  hint: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 16, marginBottom: 10 },
  types: { gap: 10 },
  typeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 16, height: 56 },
  typeCardOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  typeLabel: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  typeLabelOn: { color: colors.brand },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, height: 52, fontSize: 16, fontWeight: '700', color: colors.ink, borderWidth: 1, borderColor: colors.line },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, paddingVertical: 14 },
  toggleLabel: { fontSize: 15.5, fontWeight: '800', color: colors.ink },
  toggleSub: { fontSize: 12.5, fontWeight: '600', color: colors.inkSoft, marginTop: 2 },
  switch: { width: 48, height: 28, borderRadius: 14, backgroundColor: colors.line2, padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: colors.brand },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.white },
  knobOn: { alignSelf: 'flex-end' },
  secure: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  secureText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.inkSoft },
});
