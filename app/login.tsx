import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, KeyboardAvoidingView, Platform, ScrollView, Alert, ImageBackground } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Btn } from '../components/ui';
import { useAuth } from '../components/auth';
import { CountryCode } from '../components/PhonePrefix';

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [dial, setDial] = useState('223');
  const [phone, setPhone] = useState('');
  const fullPhone = dial + phone.replace(/\D/g, '');
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Remonte le champ actif AU-DESSUS du clavier de façon fiable (Android inclus) via la
  // méthode native du ScrollView responder (mesure réelle du champ, pas un scrollToEnd approximatif).
  const focusScroll = (e: any) => {
    const node = e?.target ?? e?.nativeEvent?.target;
    const responder: any = (scrollRef.current as any)?.getScrollResponder?.();
    if (responder && node != null) {
      setTimeout(() => { try { responder.scrollResponderScrollNativeHandleToKeyboard(node, 110, true); } catch { /* ignore */ } }, 60);
    }
  };

  const valide = phone.replace(/\D/g, '').length >= 6 && pwd.length >= 6;

  const onLogin = async () => {
    if (!valide) return;
    setLoading(true);
    try {
      await signIn(fullPhone, pwd);
      // La garde de navigation (RootNavigator) redirige vers (tabs).
    } catch (e: any) {
      Alert.alert('Connexion impossible', e?.message ?? 'Vérifie ton numéro et ton mot de passe.');
    } finally {
      setLoading(false);
    }
  };


  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={false}>
          {/* Hero photo */}
          <ImageBackground source={require('../assets/services/hero.jpg')} style={st.hero} resizeMode="cover">
            <View style={st.heroShade} />
            <SafeAreaView edges={['top']} style={st.heroSafe}>
              <View style={st.langRow}>
                <Pressable style={st.langPill} onPress={() => Alert.alert('Langue', 'Français sélectionné. D\'autres langues arrivent bientôt.')}>
                  <Ionicons name="globe-outline" size={15} color={colors.ink} />
                  <Text style={st.langText}>FR</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.inkMute} />
                </Pressable>
              </View>
            </SafeAreaView>
          </ImageBackground>

          {/* Carte de connexion */}
          <View style={st.card}>
            <Text style={st.title}>Bon retour 👋</Text>

            <Text style={st.label}>Numéro de téléphone</Text>
            <View style={st.field}>
              <CountryCode value={dial} onChange={setDial} />
              <TextInput
                placeholder="76 00 00 00"
                placeholderTextColor={colors.inkMute}
                value={phone}
                onChangeText={setPhone}
                onFocus={focusScroll}
                keyboardType="phone-pad"
                style={st.input}
              />
            </View>

            <Text style={st.label}>Mot de passe</Text>
            <View style={st.field}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.inkMute} style={{ marginLeft: 14 }} />
              <TextInput
                placeholder="Ton mot de passe"
                placeholderTextColor={colors.inkMute}
                value={pwd}
                onChangeText={setPwd}
                onFocus={focusScroll}
                secureTextEntry={!show}
                style={[st.input, { paddingLeft: 10 }]}
              />
              <Pressable onPress={() => setShow((s) => !s)} hitSlop={10} style={{ paddingHorizontal: 14 }}>
                <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.inkMute} />
              </Pressable>
            </View>

            <Pressable onPress={() => router.push('/forgot-password')} style={{ alignSelf: 'flex-end', marginTop: 12 }}>
              <Text style={st.forgot}>Mot de passe oublié ?</Text>
            </Pressable>

            <Btn label="Se connecter" onPress={onLogin} loading={loading} disabled={!valide} style={{ marginTop: 20 }} />

            <View style={[st.footer, { marginTop: 24 }]}>
              <Text style={st.footerText}>Pas encore de compte ? </Text>
              <Pressable onPress={() => router.push('/signup')}>
                <Text style={st.footerLink}>Créer un compte</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { height: 250, width: '100%', justifyContent: 'flex-start' },
  heroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,12,10,0.18)' },
  heroSafe: { paddingHorizontal: space.lg },
  langRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  langPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, paddingHorizontal: 12, height: 38, borderRadius: 20, ...shadow.card },
  langText: { fontSize: 14, fontWeight: '800', color: colors.ink },

  card: { marginTop: -34, backgroundColor: colors.surface, borderTopLeftRadius: 32, borderTopRightRadius: 32, paddingHorizontal: space.lg, paddingTop: 28, paddingBottom: 40 },
  title: { fontSize: 27, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  sub: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', marginTop: 8, lineHeight: 21, textAlign: 'center', paddingHorizontal: 10 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginTop: 20, marginBottom: 8 },
  field: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, height: 56 },
  prefix: { paddingHorizontal: 14, height: '100%', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.line },
  prefixText: { fontSize: 16, fontWeight: '800', color: colors.ink },
  input: { flex: 1, paddingHorizontal: 14, fontSize: 16, fontWeight: '700', color: colors.ink, height: '100%' },
  forgot: { fontSize: 13.5, fontWeight: '700', color: colors.brand },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 },
  line: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerText: { fontSize: 12.5, fontWeight: '700', color: colors.inkMute },
  socialRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  social: { flex: 1, height: 56, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', gap: 2, ...shadow.card },
  socialSoon: { fontSize: 10, fontWeight: '800', color: colors.inkMute, letterSpacing: 0.2 },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  footerText: { fontSize: 14.5, color: colors.inkSoft, fontWeight: '600' },
  footerLink: { fontSize: 14.5, color: colors.brand, fontWeight: '800' },
});
