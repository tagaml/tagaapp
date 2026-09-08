import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { useToast } from '../components/ui';
import { supabase } from '../lib/supabase';
import { getSupportMessages, sendSupportMessage, subscribeSupportMessages, markSupportRead, type SupportMsg } from '../lib/db';

export default function SupportChat() {
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState<SupportMsg[]>([]);
  const [txt, setTxt] = useState('');
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    let actif = true;
    let off: (() => void) | undefined;
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        const m = await getSupportMessages();
        if (!actif) return;
        setMessages(m);
        setLoading(false);
        markSupportRead().catch(() => {});
        if (uid) {
          off = subscribeSupportMessages(uid, (nm) => {
            setMessages((prev) => (prev.some((x) => x.id === nm.id) ? prev : [...prev, nm]));
            markSupportRead().catch(() => {});
          });
        }
      } catch { if (actif) setLoading(false); }
    })();
    return () => { actif = false; off?.(); };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const send = async () => {
    const t = txt.trim();
    if (!t) return;
    setTxt('');
    try {
      await sendSupportMessage(t);
    } catch {
      setTxt(t);
      toast("Message non envoyé. Réessaie.", { tone: 'error' });
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <View style={st.avatar}><Ionicons name="headset" size={20} color={colors.white} /></View>
        <View style={{ flex: 1 }}>
          <Text style={st.name}>Support Taga</Text>
          <Text style={st.online}>Réponse en général sous 24 h</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={8}>
        {loading ? (
          <View style={st.center}><ActivityIndicator color={colors.brand} size="large" /></View>
        ) : (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{ padding: space.lg, gap: 10 }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 && (
              <View style={st.intro}>
                <View style={st.introIcon}><Ionicons name="chatbubbles" size={26} color={colors.brand} /></View>
                <Text style={st.introTitle}>Un souci ? Écris-nous.</Text>
                <Text style={st.introText}>Décris ton problème (course, paiement, abonnement, colis…). L'équipe Taga te répond ici même.</Text>
              </View>
            )}
            {messages.map((m) => {
              const mine = m.sender === 'user';
              return (
                <View key={m.id} style={[st.bubble, mine ? st.mine : st.theirs]}>
                  {!mine && <Text style={st.tag}>Support Taga</Text>}
                  <Text style={[st.bubbleText, mine && { color: colors.white }]}>{m.texte}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={st.inputBar}>
          <TextInput
            placeholder="Écris ton message…"
            placeholderTextColor={colors.inkMute}
            value={txt}
            onChangeText={setTxt}
            style={st.input}
            onSubmitEditing={send}
            returnKeyType="send"
            multiline
          />
          <Pressable style={st.sendBtn} onPress={send}>
            <Ionicons name="arrow-up" size={22} color={colors.white} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space.lg, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '800', color: colors.ink },
  online: { fontSize: 12, fontWeight: '700', color: colors.inkSoft, marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 16, gap: 8 },
  introIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  introTitle: { fontSize: 17, fontWeight: '800', color: colors.ink },
  introText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, textAlign: 'center', lineHeight: 20 },
  bubble: { maxWidth: '82%', paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.line },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  tag: { fontSize: 11, fontWeight: '800', color: colors.brand, marginBottom: 3 },
  bubbleText: { fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 20 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: space.lg, paddingVertical: 10, paddingBottom: 24, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, backgroundColor: colors.surface2, borderRadius: 22, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12, minHeight: 46, maxHeight: 120, fontSize: 15, color: colors.ink, fontWeight: '600' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
