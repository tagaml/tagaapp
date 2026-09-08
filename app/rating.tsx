import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space } from '../theme';
import { Btn, Avatar } from '../components/ui';
import { useToast } from '../components/ui';
import { pourboires, fcfa } from '../data/mock';
import { getRide, setRideRating } from '../lib/db';

// Motifs proposés selon la note : négatifs si note basse, positifs si note haute.
const TAGS_BAS = ['Roule trop vite', 'Conduite dangereuse', 'Chauffeur indiscipliné', 'En retard', 'Voiture sale', 'Impoli', 'Détour inutile'];
const TAGS_MOYEN = ['Conduite correcte', 'Léger retard', 'Peut mieux faire', 'Voiture moyenne'];
const TAGS_HAUT = ['Conduite sûre', 'Ponctuel', 'Sympa', 'Voiture propre', 'Bonne route'];
function tagsForNote(note: number): string[] {
  if (note <= 2) return TAGS_BAS;
  if (note === 3) return TAGS_MOYEN;
  return TAGS_HAUT;
}
function labelForNote(note: number): string {
  if (note <= 2) return "Qu'est-ce qui n'a pas été ?";
  if (note === 3) return 'Un retour ?';
  return 'Un compliment ?';
}

export default function Rating() {
  const router = useRouter();
  const toast = useToast();
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  const [note, setNote] = useState(0);
  const [tip, setTip] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [chauffeur, setChauffeur] = useState<{ nom: string; ini: string; photo: string | null }>({ nom: 'ton chauffeur', ini: '🚕', photo: null });

  // Récupère le vrai chauffeur de la course pour personnaliser l'écran.
  useEffect(() => {
    if (!rideId) return;
    getRide(rideId).then((r) => {
      const nom = r?.chauffeur_nom?.trim();
      if (nom) setChauffeur({ nom, ini: nom.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), photo: r?.chauffeur_photo ?? null });
    }).catch(() => {});
  }, [rideId]);

  const toggle = (c: string) => setSel((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  const envoyer = async () => {
    if (note === 0) return;
    setSaving(true);
    try {
      if (rideId) {
        const texte = [sel.join(' · '), comment.trim()].filter(Boolean).join(' — ');
        await setRideRating(rideId, note, tip, texte);
      }
      toast('Merci pour ton avis !');
    } catch {
      // On n'empêche pas l'utilisateur de partir, mais on l'informe que l'avis n'a pas été enregistré.
      toast("Ton avis n'a pas pu être enregistré. Vérifie ta connexion.");
    } finally {
      setSaving(false);
      router.replace('/(tabs)');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.top}>
        <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={8} style={st.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Pressable onPress={() => router.replace('/(tabs)')}><Text style={st.skip}>Passer</Text></Pressable>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* « Course » partout dans l'app (jamais « trajet ») : même mot du choix du véhicule à la notation. */}
        <Text style={st.title}>Comment s'est passée{'\n'}ta course ?</Text>

        <View style={st.driver}>
          <Avatar text={chauffeur.ini} size={64} tone="ink" uri={chauffeur.photo ?? undefined} />
          <Text style={st.with}>Avec {chauffeur.nom}</Text>
        </View>

        <View style={st.stars}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Pressable key={i} onPress={() => { setNote(i); setSel([]); }} hitSlop={6}>
              <Ionicons name={i <= note ? 'star' : 'star-outline'} size={42} color={i <= note ? colors.gold : colors.line2} />
            </Pressable>
          ))}
        </View>

        {note > 0 && (
          <>
            <Text style={st.label}>{labelForNote(note)}</Text>
            <View style={st.chips}>
              {tagsForNote(note).map((c) => (
                <Pressable key={c} style={[st.chip, sel.includes(c) && st.chipOn]} onPress={() => toggle(c)}>
                  <Text style={[st.chipText, sel.includes(c) && st.chipTextOn]}>{c}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={st.label}>Ajouter un pourboire</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {pourboires.map((p) => (
                <Pressable key={p} style={[st.tip, tip === p && st.tipOn]} onPress={() => setTip(p)}>
                  <Text style={[st.tipText, tip === p && st.tipTextOn]}>{p === 0 ? 'Aucun' : fcfa(p)}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={st.label}>Un commentaire ? (facultatif)</Text>
            <TextInput value={comment} onChangeText={setComment} placeholder="Écris ton avis…" placeholderTextColor={colors.inkMute} multiline style={st.comment} />
          </>
        )}

        <Btn label="Envoyer mon avis" onPress={envoyer} loading={saving} style={{ marginTop: 24 }} disabled={note === 0} />
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  skip: { fontSize: 15, fontWeight: '700', color: colors.inkSoft },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink, textAlign: 'center', marginTop: 8, lineHeight: 32 },
  driver: { alignItems: 'center', marginTop: 24, gap: 10 },
  with: { fontSize: 15, fontWeight: '700', color: colors.inkSoft },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 22 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 26, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.line2 },
  chipOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  chipText: { fontSize: 13.5, fontWeight: '700', color: colors.ink2 },
  chipTextOn: { color: colors.brand },
  tip: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.line },
  tipOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  tipText: { fontSize: 13, fontWeight: '800', color: colors.ink2 },
  tipTextOn: { color: colors.brand },
  comment: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, minHeight: 90, fontSize: 15, color: colors.ink, fontWeight: '600', borderWidth: 1, borderColor: colors.line, textAlignVertical: 'top' },
});
