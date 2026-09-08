import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn } from '../components/ui';
import { sendOtp } from '../lib/authOtp';
import { CountryCode } from '../components/PhonePrefix';

export default function ForgotPassword() {
  const router = useRouter();
  const [dial, setDial] = useState('223');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const fullPhone = dial + phone.replace(/\D/g, '');
  const valide = phone.replace(/\D/g, '').length >= 6;

  const envoyer = async () => {
    if (!valide || loading) return;
    setLoading(true);
    try {
      const res = await sendOtp(fullPhone, 'reset');
      if (!res.ok) { Alert.alert('Mot de passe oublié', res.message); return; }
      router.push({ pathname: '/verify-otp', params: { phone: fullPhone, purpose: 'reset' } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mot de passe oublié" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={st.badge}><Ionicons name="logo-whatsapp" size={26} color="#25D366" /></View>
          <Text style={st.title}>Récupère ton compte</Text>
          <Text style={st.sub}>Entre ton numéro : on t'envoie un code par WhatsApp pour choisir un nouveau mot de passe.</Text>

          <Text style={st.label}>Numéro de téléphone</Text>
          <View style={st.field}>
            <CountryCode value={dial} onChange={setDial} />
            <TextInput
              placeholder="76 00 00 00"
              placeholderTextColor={colors.inkMute}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              style={st.input}
              autoFocus
            />
          </View>

          <Btn label="Recevoir mon code" onPress={envoyer} loading={loading} disabled={!valide} style={{ marginTop: 22 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  badge: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E8FBEF', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  title: { fontSize: 24, fontWeight: '800', color: colors.ink, marginTop: 18 },
  sub: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', marginTop: 8, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 22, marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 56 },
  prefix: { paddingHorizontal: 14, height: '100%', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.line },
  prefixText: { fontSize: 16, fontWeight: '800', color: colors.ink },
  input: { flex: 1, paddingHorizontal: 14, fontSize: 16, fontWeight: '700', color: colors.ink, height: '100%' },
});
