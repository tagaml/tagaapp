import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Avatar } from '../components/ui';
import { RideChat } from '../components/RideChat';
import { chatMessages } from '../data/mock';

export default function Chat() {
  const { rideId, orderId, name, tel, role: roleParam } = useLocalSearchParams<{ rideId?: string; orderId?: string; name?: string; tel?: string; role?: string }>();
  const role: 'client' | 'driver' = roleParam === 'driver' ? 'driver' : 'client';
  const ini = (nm: string) => nm.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  // Vraie messagerie temps réel quand on vient d'une course.
  if (rideId) {
    const nm = name || (role === 'driver' ? 'Passager' : 'Chauffeur');
    return <RideChat rideId={rideId} role={role} peerName={nm} peerInitials={ini(nm)} />;
  }
  // Messagerie commande (client ↔ livreur).
  if (orderId) {
    const nm = name || (role === 'driver' ? 'Client' : 'Livreur');
    return <RideChat orderId={orderId} role={role} peerName={nm} peerInitials={ini(nm)} peerPhone={role === 'client' ? (tel || undefined) : undefined} />;
  }
  return <DemoChat />;
}

function DemoChat() {
  const router = useRouter();
  const [msgs, setMsgs] = useState(chatMessages);
  const [txt, setTxt] = useState('');

  const send = () => {
    if (!txt.trim()) return;
    setMsgs((m) => [...m, { id: 'n' + m.length, from: 'moi', text: txt.trim() }]);
    setTxt('');
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Avatar text="MK" size={40} tone="ink" />
        <View style={{ flex: 1 }}>
          <Text style={st.name}>Moussa K.</Text>
          <Text style={st.online}>● En ligne</Text>
        </View>
        <Pressable style={st.callBtn} onPress={() => Linking.openURL('tel:+22376000012')}><Ionicons name="call" size={20} color={colors.brand} /></Pressable>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: 10 }}>
          <Text style={st.day}>Aujourd'hui</Text>
          {msgs.map((m) => (
            <View key={m.id} style={[st.bubble, m.from === 'moi' ? st.mine : st.theirs]}>
              <Text style={[st.bubbleText, m.from === 'moi' && { color: colors.white }]}>{m.text}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={st.inputBar}>
          <TextInput
            placeholder="Message…"
            placeholderTextColor={colors.inkMute}
            value={txt}
            onChangeText={setTxt}
            style={st.input}
            onSubmitEditing={send}
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
  name: { fontSize: 16, fontWeight: '800', color: colors.ink },
  online: { fontSize: 12, fontWeight: '700', color: colors.green, marginTop: 1 },
  callBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  day: { textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.inkMute, marginVertical: 6 },
  bubble: { maxWidth: '78%', paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.line },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  bubbleText: { fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 20 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.lg, paddingVertical: 10, paddingBottom: 24, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, backgroundColor: colors.surface2, borderRadius: 22, paddingHorizontal: 18, height: 46, fontSize: 15, color: colors.ink, fontWeight: '600' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
});
