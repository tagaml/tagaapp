import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { colors, radius, space } from '../theme';
import { Header, Btn, useToast } from '../components/ui';
import { createTicket } from '../lib/db';
import { sharePosition } from '../lib/share';

const faq = [
  { q: 'Comment annuler une commande ?', r: "Tu peux annuler depuis l'écran de suivi tant que le restaurant n'a pas commencé la préparation. Au-delà, contacte le support." },
  // Tutoiement : la question est posée du point de vue du client, sans « vous ».
  { q: 'Quels moyens de paiement sont acceptés ?', r: 'Pour les courses : espèces. Pour les repas : Orange Money ou Wave via le numéro Taga (paiement confirmé avant préparation). D\'autres moyens arrivent bientôt.' },
  { q: 'La livraison est-elle disponible la nuit ?', r: "Oui, de nombreux restaurants livrent jusqu'à 1h du matin à Bamako." },
];

export default function Help() {
  const [open, setOpen] = useState<number | null>(0);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const sendTicket = async () => {
    if (message.trim().length < 5) {
      toast('Décris ton souci en quelques mots', { tone: 'error' });
      return;
    }
    setSending(true);
    try {
      await createTicket(message.trim(), 'Général');
      toast('Ticket envoyé · le support te recontacte');
      setMessage('');
    } catch (e) {
      toast("Impossible d'envoyer le ticket", { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const shareMyPosition = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Position indisponible', "Autorise l'accès à ta position pour la partager en cas d'urgence.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await sharePosition(pos.coords.latitude, pos.coords.longitude, 'Urgence — ma position');
    } catch (e) {
      Alert.alert('Erreur', "Impossible de récupérer ta position pour le moment.");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Aide & sécurité" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        <Pressable style={[st.support, { marginTop: 6 }]} onPress={() => router.push('/support-chat')}>
          <View style={st.supportIcon}><Ionicons name="chatbubbles" size={22} color={colors.white} /></View>
          <Text style={st.supportText}>Discuter avec le support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.white} />
        </Pressable>

        <Pressable style={st.supportSec} onPress={() => Linking.openURL('tel:+22376000012')}>
          <View style={st.supportSecIcon}><Ionicons name="call" size={19} color={colors.brand} /></View>
          <Text style={st.supportSecText}>Appeler le support</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
        </Pressable>

        <Text style={st.label}>Décris ton problème</Text>
        <TextInput
          style={st.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Explique ton souci en quelques mots…"
          placeholderTextColor={colors.inkMute}
          multiline
        />
        <Btn label="Envoyer au support" onPress={sendTicket} loading={sending} style={{ marginTop: 10 }} />

        <Text style={st.label}>Questions fréquentes</Text>
        <View style={st.faqBox}>
          {faq.map((f, i) => (
            <View key={i} style={[i < faq.length - 1 && st.faqBorder]}>
              <Pressable style={st.faqQ} onPress={() => setOpen(open === i ? null : i)}>
                <Text style={st.faqQText}>{f.q}</Text>
                <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.inkMute} />
              </Pressable>
              {open === i && <Text style={st.faqR}>{f.r}</Text>}
            </View>
          ))}
        </View>

        {/* « Partager mon trajet » vit dans l'écran de course (avec les vraies infos chauffeur/position).
            Ici on ne garde que l'appel d'urgence et le partage de position réelle. */}
        <Text style={st.label}>Sécurité</Text>
        <Pressable
          style={[st.secItem, { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }]}
          onPress={() => Alert.alert('Appel d\'urgence', 'Quel service veux-tu appeler ?', [
            { text: 'Police · 17', onPress: () => Linking.openURL('tel:17') },
            { text: 'Pompiers · 18', onPress: () => Linking.openURL('tel:18') },
            { text: 'Annuler', style: 'cancel' },
          ])}
        >
          <View style={[st.secIcon, { backgroundColor: colors.brand }]}><Ionicons name="warning" size={20} color={colors.white} /></View>
          <Text style={[st.secText, { color: colors.brandDeep }]}>Appel d'urgence</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.brandDeep} />
        </Pressable>
        <Pressable style={st.secItem} onPress={shareMyPosition}>
          <View style={st.secIcon}><Ionicons name="location" size={20} color={colors.green} /></View>
          <Text style={st.secText}>Partager ma position</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMute} />
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const st = StyleSheet.create({
  intro: { fontSize: 15, color: colors.inkSoft, fontWeight: '600', marginTop: 6, lineHeight: 21 },
  support: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.ink, borderRadius: radius.lg, padding: 16, marginTop: 18 },
  supportSec: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginTop: 10, borderWidth: 1, borderColor: colors.line },
  supportSecIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  supportSecText: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
  supportIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  supportText: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.white },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 10 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: colors.line, color: colors.ink, minHeight: 90, textAlignVertical: 'top', fontSize: 15, fontWeight: '600' },
  faqBox: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16 },
  faqBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  faqQ: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, gap: 12 },
  faqQText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  faqR: { fontSize: 13.5, color: colors.inkSoft, fontWeight: '600', lineHeight: 20, paddingBottom: 16 },
  secItem: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  secIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  secText: { flex: 1, fontSize: 15.5, fontWeight: '800', color: colors.ink },
});
