import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Header, Btn } from '../components/ui';
import { sendOtp } from '../lib/authOtp';
import { CountryCode } from '../components/PhonePrefix';

export default function Signup() {
  const router = useRouter();
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [dial, setDial] = useState('223');
  const [phone, setPhone] = useState('');
  const fullPhone = dial + phone.replace(/\D/g, '');
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [accepte, setAccepte] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Remonte le champ actif AU-DESSUS du clavier de façon fiable (Android inclus) via la méthode
  // native du ScrollView responder (mesure réelle du champ).
  const focusScroll = (e: any) => {
    const node = e?.target ?? e?.nativeEvent?.target;
    const responder: any = (scrollRef.current as any)?.getScrollResponder?.();
    if (responder && node != null) {
      setTimeout(() => { try { responder.scrollResponderScrollNativeHandleToKeyboard(node, 110, true); } catch { /* ignore */ } }, 60);
    }
  };

  const valide = prenom.trim().length >= 2 && nom.trim().length >= 2 && phone.replace(/\D/g, '').length >= 6 && pwd.length >= 6 && accepte;

  // Inscription en 2 temps : on envoie d'abord un code WhatsApp pour PROUVER le numéro,
  // puis le compte n'est créé qu'après vérification du code (écran verify-otp).
  const onSignup = async () => {
    if (!valide) return;
    setLoading(true);
    try {
      const res = await sendOtp(fullPhone, 'signup');
      if (!res.ok) { Alert.alert('Vérification', res.message); return; }
      router.push({ pathname: '/verify-otp', params: { phone: fullPhone, purpose: 'signup', prenom: prenom.trim(), nom: nom.trim(), password: pwd } });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Créer un compte" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={st.label}>Prénom</Text>
              <TextInput placeholder="Awa" placeholderTextColor={colors.inkMute} value={prenom} onChangeText={setPrenom} onFocus={focusScroll} style={st.input} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.label}>Nom</Text>
              <TextInput placeholder="Touré" placeholderTextColor={colors.inkMute} value={nom} onChangeText={setNom} onFocus={focusScroll} style={st.input} />
            </View>
          </View>

          <Text style={st.label}>Numéro de téléphone</Text>
          <View style={st.field}>
            <CountryCode value={dial} onChange={setDial} />
            <TextInput placeholder="76 00 00 00" placeholderTextColor={colors.inkMute} value={phone} onChangeText={setPhone} onFocus={focusScroll} keyboardType="phone-pad" style={[st.input, { flex: 1, borderWidth: 0, marginTop: 0 }]} />
          </View>

          <Text style={st.label}>Mot de passe</Text>
          <View style={st.field}>
            <Ionicons name="lock-closed-outline" size={20} color={colors.inkMute} style={{ marginLeft: 14 }} />
            <TextInput placeholder="Au moins 6 caractères" placeholderTextColor={colors.inkMute} value={pwd} onChangeText={setPwd} onFocus={focusScroll} secureTextEntry={!show} style={[st.input, { flex: 1, borderWidth: 0, marginTop: 0, paddingLeft: 10 }]} />
            <Pressable onPress={() => setShow((s) => !s)} hitSlop={10} style={{ paddingHorizontal: 14 }}>
              <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.inkMute} />
            </Pressable>
          </View>

          <Pressable style={st.cguRow} onPress={() => setAccepte((v) => !v)}>
            <View style={[st.checkbox, accepte && st.checkboxOn]}>
              {accepte ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
            </View>
            <Text style={st.cgu}>
              J'accepte les{' '}
              <Text style={st.cguLink} onPress={() => router.push('/conditions')}>Conditions d'utilisation et la Politique de confidentialité</Text>
              {' '}de Taga.
            </Text>
          </Pressable>

          <Btn label="Créer mon compte" onPress={onSignup} loading={loading} disabled={!valide} style={{ marginTop: 18 }} />

          <View style={st.footer}>
            <Text style={st.footerText}>Déjà un compte ? </Text>
            <Pressable onPress={() => router.back()}>
              <Text style={st.footerLink}>Se connecter</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  sub: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', marginTop: 4, marginBottom: 6, lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 18, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 54, paddingHorizontal: 14, fontSize: 16, fontWeight: '700', color: colors.ink },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 54 },
  prefix: { paddingHorizontal: 14, height: '100%', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.line },
  prefixText: { fontSize: 16, fontWeight: '800', color: colors.ink },
  cguRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 18 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, marginTop: 1 },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  cgu: { flex: 1, fontSize: 12.5, color: colors.inkSoft, fontWeight: '600', lineHeight: 18 },
  cguLink: { color: colors.brand, fontWeight: '800' },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 22 },
  footerText: { fontSize: 14.5, color: colors.inkSoft, fontWeight: '600' },
  footerLink: { fontSize: 14.5, color: colors.brand, fontWeight: '800' },
});
