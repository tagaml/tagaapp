import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Avatar } from './ui';
import { getMessages, sendMessage, subscribeMessages, markRideRead, getOrderMessages, sendOrderMessage, subscribeOrderMessages, getRide, getOrderStatut, subscribeRide, subscribeOrder, type Message } from '../lib/db';
import { playMessage } from '../lib/sound';

const RIDE_CLOS = ['termine', 'annule'];
const ORDER_CLOS = ['livree', 'annulee'];

export function RideChat({ rideId, orderId, role, peerName, peerInitials, peerPhone, onClose }: {
  rideId?: string;
  orderId?: string;
  role: 'client' | 'driver';
  peerName: string;
  peerInitials: string;
  peerPhone?: string; // numéro réel de l'autre partie ; si absent, pas de bouton d'appel
  onClose?: () => void; // si fourni (chat en overlay/Modal), le bouton retour ferme l'overlay au lieu de naviguer
}) {
  const router = useRouter();
  const goBack = () => { if (onClose) onClose(); else router.back(); };
  const isOrder = !!orderId && !rideId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [txt, setTxt] = useState('');
  const [closed, setClosed] = useState(false); // course/commande terminée → messagerie fermée
  const scrollRef = useRef<ScrollView>(null);

  // Statut de la course/commande : ferme la messagerie dès qu'elle est terminée ou annulée.
  useEffect(() => {
    let actif = true;
    (async () => {
      try {
        if (isOrder) {
          const s = await getOrderStatut(orderId!);
          if (actif && s && ORDER_CLOS.includes(s)) setClosed(true);
        } else {
          const r = await getRide(rideId!);
          if (actif && r && RIDE_CLOS.includes(r.statut)) setClosed(true);
        }
      } catch { /* ignore */ }
    })();
    const off = isOrder
      ? subscribeOrder(orderId!, (s) => { if (actif && ORDER_CLOS.includes(s)) setClosed(true); })
      : subscribeRide(rideId!, (s) => { if (actif && RIDE_CLOS.includes(s)) setClosed(true); });
    return () => { actif = false; off(); };
  }, [rideId, orderId]);

  useEffect(() => {
    let actif = true;
    setMessages([]);
    (async () => {
      try {
        const m = isOrder ? await getOrderMessages(orderId!) : await getMessages(rideId!);
        if (!actif) return;
        // Fusionne avec les messages déjà reçus en temps réel (évite la perte
        // d'un message arrivé pendant le chargement initial).
        setMessages((prev) => {
          const known = new Set(m.map((x) => x.id));
          const extra = prev.filter((x) => !known.has(x.id));
          return [...m, ...extra];
        });
      } catch { /* garde la liste vide en cas d'erreur réseau */ }
      if (!isOrder) markRideRead(rideId!).catch(() => {});
    })();
    const handle = (m: Message) => {
      if (!actif) return;
      let added = false;
      setMessages((prev) => { if (prev.some((x) => x.id === m.id)) return prev; added = true; return [...prev, m]; });
      if (added && m.sender_role !== role) playMessage(); // son pour un message entrant (pas les miens)
      if (!isOrder) markRideRead(rideId!).catch(() => {});
    };
    const off = isOrder ? subscribeOrderMessages(orderId!, handle) : subscribeMessages(rideId!, handle);
    return () => { actif = false; off(); };
  }, [rideId, orderId]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  const sendText = async (t: string, restoreOnFail?: string) => {
    if (closed || !t) return;
    try {
      if (isOrder) await sendOrderMessage(orderId!, role, t);
      else await sendMessage(rideId!, role, t);
    } catch { if (restoreOnFail !== undefined) setTxt(restoreOnFail); }
  };

  const send = async () => {
    const t = txt.trim();
    if (!t) return;
    setTxt('');
    await sendText(t, t);
  };

  // Réponses rapides prêtes à envoyer (un tap) — utile pour ceux qui n'écrivent pas facilement.
  // Adaptées au rôle : ce que le chauffeur dit / ce que le client dit.
  const quickReplies = role === 'driver'
    ? (isOrder
        ? ['Je suis en route 🛵', 'Je suis arrivé 📍', 'Je suis en bas', 'Je suis dans les embouteillages', 'Appelle-moi stp']
        : ['Je suis en route vers toi 🚗', 'Je suis arrivé 📍', 'Je suis dans les embouteillages', "Je t'attends", 'Appelle-moi stp'])
    : ["J'arrive dans 1 min", 'Attends-moi un peu', 'Je suis à la position 📍', 'Je te vois pas', 'Je suis pressé', 'Appelle-moi stp'];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.header}>
        <Pressable onPress={goBack} hitSlop={10} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Avatar text={peerInitials} size={40} tone="ink" />
        <View style={{ flex: 1 }}>
          <Text style={st.name}>{peerName}</Text>
          <Text style={st.online}>{role === 'client' ? 'Ton chauffeur' : 'Ton client'}</Text>
        </View>
        {peerPhone && !closed ? (
          <Pressable style={st.callBtn} onPress={() => Linking.openURL(`tel:${peerPhone}`)}>
            <Ionicons name="call" size={20} color={colors.brand} />
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={8}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: space.lg, gap: 10 }}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 && (
            <Text style={st.empty}>Démarre la conversation avec {peerName.split(' ')[0]}.</Text>
          )}
          {messages.map((m) => {
            const mine = m.sender_role === role;
            return (
              <View key={m.id} style={[st.bubble, mine ? st.mine : st.theirs]}>
                <Text style={[st.bubbleText, mine && { color: colors.white }]}>{m.texte}</Text>
              </View>
            );
          })}
        </ScrollView>

        {closed ? (
          <View style={st.closedBar}>
            <Ionicons name="lock-closed" size={16} color={colors.inkSoft} />
            <Text style={st.closedText}>
              {isOrder ? 'Cette commande est terminée. La messagerie est fermée.' : 'Cette course est terminée. La messagerie est fermée.'}
            </Text>
          </View>
        ) : (
          <>
            {/* Réponses rapides pour LES DEUX côtés (chauffeur ET client) */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={st.quickWrap}
              contentContainerStyle={st.quickRow}
            >
              {quickReplies.map((q) => (
                <Pressable key={q} style={st.quick} onPress={() => sendText(q)}>
                  <Text style={st.quickText}>{q}</Text>
                </Pressable>
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
              returnKeyType="send"
            />
            <Pressable style={st.sendBtn} onPress={send}>
              <Ionicons name="arrow-up" size={22} color={colors.white} />
            </Pressable>
          </View>
          </>
        )}
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
  empty: { textAlign: 'center', color: colors.inkMute, fontWeight: '600', fontSize: 13.5, marginTop: 20 },
  bubble: { maxWidth: '78%', paddingHorizontal: 15, paddingVertical: 11, borderRadius: 20 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.line },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: 6 },
  bubbleText: { fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 20 },
  quickWrap: { maxHeight: 52, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  quickRow: { paddingHorizontal: space.lg, paddingVertical: 9, gap: 8, alignItems: 'center' },
  quick: { backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brandSoft, borderRadius: 20, paddingHorizontal: 14, height: 34, alignItems: 'center', justifyContent: 'center' },
  quickText: { fontSize: 13.5, fontWeight: '800', color: colors.brandDeep },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.lg, paddingVertical: 10, paddingBottom: 24, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface },
  input: { flex: 1, backgroundColor: colors.surface2, borderRadius: 22, paddingHorizontal: 18, height: 46, fontSize: 15, color: colors.ink, fontWeight: '600' },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  closedBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: space.lg, paddingVertical: 14, paddingBottom: 26, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface2 },
  closedText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.inkSoft, lineHeight: 18 },
});
