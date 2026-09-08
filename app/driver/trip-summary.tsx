import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../../theme';
import { Btn, Avatar } from '../../components/ui';
import { fcfa } from '../../data/mock';
import { setPassengerRating, getRide } from '../../lib/db';

const COMPLIMENTS = ['Ponctuel', 'Aimable', 'Respectueux', 'Bonne ambiance'];

export default function TripSummary() {
  const router = useRouter();
  const params = useLocalSearchParams<{ prix?: string; destination?: string; passager?: string; rideId?: string }>();
  // Aucune valeur de démonstration ici : un écran de gain ne doit JAMAIS afficher un montant
  // ou un nom inventé. À défaut de paramètre, on reste neutre.
  const prix = Number(params.prix ?? '0') || 0;
  const destination = (params.destination as string) || '';
  const passager = (params.passager as string) || 'ton client';
  const rideId = typeof params.rideId === 'string' ? params.rideId : undefined;

  const [note, setNote] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [passPhoto, setPassPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!rideId) return;
    getRide(rideId).then((r) => setPassPhoto(r?.passager_photo ?? null)).catch(() => {});
  }, [rideId]);

  const toggle = (c: string) => setSel((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const initiales = passager.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  // Enregistre la note du chauffeur sur la course réelle puis revient à l'accueil.
  const terminer = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (rideId && note > 0) {
        await setPassengerRating(rideId, note);
      }
    } catch {
      /* on revient à l'accueil même si l'enregistrement de la note échoue */
    } finally {
      setSaving(false);
      router.replace('/driver');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        <View style={st.gainWrap}>
          <Text style={st.gainLabel}>Tu as gagné</Text>
          <Text style={st.gain} numberOfLines={1} adjustsFontSizeToFit>{fcfa(prix)}</Text>
          {destination ? <Text style={st.course}>Course vers {destination}</Text> : null}
        </View>

        <View style={st.rateCard}>
          <Avatar text={initiales} size={56} tone="ink" uri={passPhoto ?? undefined} />
          <Text style={st.rateName} numberOfLines={1}>Note {passager}</Text>

          <View style={st.stars}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Pressable key={i} onPress={() => setNote(i)} hitSlop={6}>
                <Ionicons name={i <= note ? 'star' : 'star-outline'} size={38} color={i <= note ? colors.gold : colors.line2} />
              </Pressable>
            ))}
          </View>

          <View style={st.chips}>
            {COMPLIMENTS.map((c) => (
              <Pressable key={c} style={[st.chip, sel.includes(c) && st.chipOn]} onPress={() => toggle(c)}>
                <Text style={[st.chipText, sel.includes(c) && st.chipTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Btn label="Terminer" onPress={terminer} loading={saving} style={{ marginTop: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  gainWrap: { alignItems: 'center', marginTop: 36 },
  gainLabel: { fontSize: 16, fontWeight: '700', color: colors.inkSoft },
  gain: { fontSize: 46, fontWeight: '800', color: colors.green, marginTop: 8 },
  course: { fontSize: 14, fontWeight: '700', color: colors.inkSoft, marginTop: 10 },
  rateCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22, borderWidth: 1, borderColor: colors.line, alignItems: 'center', marginTop: 30 },
  rateName: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 12 },
  stars: { flexDirection: 'row', gap: 8, marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 20 },
  chip: { paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.line2 },
  chipOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  chipTextOn: { color: colors.brand },
});
