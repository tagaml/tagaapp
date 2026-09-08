import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn } from '../components/ui';
import { useAuth } from '../components/auth';
import { sendOtp, verifyOtpSignup, verifyOtpReset } from '../lib/authOtp';

export default function VerifyOtp() {
  const router = useRouter();
  const { signIn } = useAuth();
  const p = useLocalSearchParams<{ phone?: string; purpose?: string; prenom?: string; nom?: string; password?: string }>();
  const phone = String(p.phone ?? '');
  const purpose = (p.purpose === 'reset' ? 'reset' : 'signup') as 'signup' | 'reset';
  const isReset = purpose === 'reset';

  const [code, setCode] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const valide = code.replace(/\D/g, '').length === 6 && (!isReset || newPwd.length >= 6);

  const verifier = async () => {
    if (!valide || loading) return;
    setLoading(true);
    try {
      const res = isReset
        ? await verifyOtpReset(phone, code, newPwd)
        : await verifyOtpSignup(phone, code, { prenom: String(p.prenom ?? ''), nom: String(p.nom ?? ''), password: String(p.password ?? '') });
      if (!res.ok) { Alert.alert('Code', res.message); return; }
      // Compte créé / mot de passe changé : on connecte directement.
      try {
        await signIn(phone, isReset ? newPwd : String(p.password ?? ''));
        // La garde de navigation redirige vers l'accueil.
      } catch (e: any) {
        Alert.alert('Connexion', e?.message ?? 'Compte prêt — reconnecte-toi.');
        router.replace('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const renvoyer = async () => {
    if (resendIn > 0) return;
    const res = await sendOtp(phone, purpose);
    if (res.ok) { setResendIn(60); Alert.alert('Code renvoyé', 'Un nouveau code WhatsApp a été envoyé.'); }
    else Alert.alert('Renvoi', res.message);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title={isReset ? 'Réinitialiser le mot de passe' : 'Vérifie ton numéro'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={st.badge}><Ionicons name="logo-whatsapp" size={26} color="#25D366" /></View>
          <Text style={st.title}>Entre le code reçu</Text>
          <Text style={st.sub}>Nous avons envoyé un code à 6 chiffres par WhatsApp au +{phone}.</Text>

          <Text style={st.label}>Code de vérification</Text>
          <TextInput
            placeholder="— — — — — —"
            placeholderTextColor={colors.inkMute}
            value={code}
            onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            style={st.codeInput}
            autoFocus
          />

          {isReset ? (
            <>
              <Text style={st.label}>Nouveau mot de passe</Text>
              <View style={st.field}>
                <Ionicons name="lock-closed-outline" size={20} color={colors.inkMute} style={{ marginLeft: 14 }} />
                <TextInput
                  placeholder="Au moins 6 caractères"
                  placeholderTextColor={colors.inkMute}
                  value={newPwd}
                  onChangeText={setNewPwd}
                  secureTextEntry={!show}
                  style={st.input}
                />
                <Pressable onPress={() => setShow((s) => !s)} hitSlop={10} style={{ paddingHorizontal: 14 }}>
                  <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.inkMute} />
                </Pressable>
              </View>
            </>
          ) : null}

          <Btn label={isReset ? 'Réinitialiser' : 'Vérifier'} onPress={verifier} loading={loading} disabled={!valide} style={{ marginTop: 22 }} />

          <Pressable onPress={renvoyer} disabled={resendIn > 0} style={{ alignSelf: 'center', marginTop: 20 }}>
            <Text style={[st.resend, resendIn > 0 && { color: colors.inkMute }]}>
              {resendIn > 0 ? `Renvoyer le code dans ${resendIn}s` : 'Renvoyer le code'}
            </Text>
          </Pressable>
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
  codeInput: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 62, paddingHorizontal: 14, fontSize: 26, fontWeight: '800', color: colors.ink, textAlign: 'center', letterSpacing: 10 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 54 },
  input: { flex: 1, paddingHorizontal: 10, fontSize: 16, fontWeight: '700', color: colors.ink, height: '100%' },
  resend: { fontSize: 14.5, fontWeight: '800', color: colors.brand },
});
