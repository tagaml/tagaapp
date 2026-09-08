import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Share, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, useToast } from '../components/ui';
import { fcfa } from '../data/mock';
import { getReferralInfo, applyReferral } from '../lib/db';

const RAISON: Record<string, string> = {
  vide: 'Entre un code.',
  deja: 'Tu as déjà utilisé un code parrain.',
  introuvable: 'Ce code parrain n\'existe pas. Vérifie et réessaie.',
  soi_meme: 'Tu ne peux pas utiliser ton propre code.',
  network: 'Connexion instable. Réessaie.',
};

export default function Referral() {
  const toast = useToast();
  const [code, setCode] = useState('TAGA');
  const [bonus, setBonus] = useState(2000);
  const [alreadyReferred, setAlreadyReferred] = useState(false);
  const [entry, setEntry] = useState('');
  const [busy, setBusy] = useState(false);

  const charger = () => getReferralInfo().then((r) => { setCode(r.code); setBonus(r.bonus); setAlreadyReferred(r.alreadyReferred); }).catch(() => {});
  useEffect(() => { charger(); }, []);

  const bonusTxt = fcfa(bonus);
  const steps = [
    { icon: 'share-social', titre: 'Partage ton code', desc: `Envoie ${code} à tes amis` },
    { icon: 'cart', titre: 'Ton ami commande', desc: 'Il entre ton code puis fait sa première course' },
    { icon: 'gift', titre: `Vous gagnez chacun ${bonusTxt}`, desc: 'Crédités sur vos comptes Taga' },
  ];

  const valider = async () => {
    const c = entry.trim();
    if (!c) { toast('Entre un code parrain.', { tone: 'error' }); return; }
    setBusy(true);
    try {
      const res = await applyReferral(c);
      if (res.ok) {
        toast('Code parrain validé ! Ton bonus arrive à ta première course.');
        setEntry('');
        charger();
      } else {
        toast(RAISON[res.reason ?? ''] ?? 'Code invalide.', { tone: 'error' });
      }
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Parrainage" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        <View style={st.hero}>
          <View style={st.heroDots} />
          <Text style={{ fontSize: 44 }}>🎁</Text>
          <Text style={st.heroTitle}>{bonusTxt} offerts</Text>
          <Text style={st.heroSub}>Pour toi et ton ami à sa première course Taga. Invite autant d'amis que tu veux !</Text>
        </View>

        <Text style={st.label}>Ton code</Text>
        <View style={st.codeBox}>
          <Text style={st.code}>{code}</Text>
          <Pressable style={st.copyBtn} onPress={() => Share.share({ message: `Rejoins Taga avec mon code ${code} et gagne ${bonusTxt} !` })}>
            <Ionicons name="share-social-outline" size={16} color={colors.white} />
            <Text style={st.copyText}>Partager</Text>
          </Pressable>
        </View>

        {/* Saisie d'un code parrain reçu (tolérante aux fautes de frappe) */}
        {!alreadyReferred ? (
          <>
            <Text style={st.label}>Tu as un code parrain ?</Text>
            <View style={st.entryBox}>
              <TextInput
                style={st.entryInput}
                value={entry}
                onChangeText={(t) => setEntry(t.toUpperCase())}
                placeholder="Ex : AMI1234"
                placeholderTextColor={colors.inkMute}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Pressable style={[st.entryBtn, busy && { opacity: 0.6 }]} disabled={busy} onPress={valider}>
                <Text style={st.entryBtnText}>{busy ? '…' : 'Valider'}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={st.doneRow}>
            <Ionicons name="checkmark-circle" size={18} color={colors.green} />
            <Text style={st.doneText}>Tu as déjà un parrain. Ton bonus arrive à ta première course.</Text>
          </View>
        )}

        <Text style={st.label}>Comment ça marche</Text>
        {steps.map((s, i) => (
          <View key={i} style={st.step}>
            <View style={st.stepIcon}><Ionicons name={s.icon as any} size={20} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={st.stepTitle}>{s.titre}</Text>
              <Text style={st.stepDesc}>{s.desc}</Text>
            </View>
          </View>
        ))}

        <Btn label="Partager mon code" onPress={() => Share.share({ message: `Rejoins Taga avec mon code ${code} et gagne ${bonusTxt} !` })} style={{ marginTop: 20 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.xl, padding: 28, overflow: 'hidden', marginTop: 6, ...shadow.pop },
  heroDots: { position: 'absolute', right: -30, top: -30, width: 130, height: 130, borderRadius: 65, backgroundColor: 'rgba(232,75,31,0.25)' },
  heroTitle: { color: colors.white, fontSize: 26, fontWeight: '800', marginTop: 12 },
  heroSub: { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '500', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 10 },
  codeBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: 10, paddingLeft: 20, borderWidth: 2, borderColor: colors.brandSoft, borderStyle: 'dashed' },
  code: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: 2 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.brand, paddingHorizontal: 16, height: 44, borderRadius: radius.md },
  copyText: { color: colors.white, fontWeight: '800', fontSize: 14 },
  entryBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  entryInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line2, paddingHorizontal: 16, height: 50, fontSize: 16, fontWeight: '800', color: colors.ink, letterSpacing: 1.5 },
  entryBtn: { backgroundColor: colors.brand, paddingHorizontal: 20, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  entryBtnText: { color: colors.white, fontWeight: '800', fontSize: 15 },
  entryHint: { fontSize: 12, color: colors.inkSoft, fontWeight: '600', marginTop: 8 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.greenSoft, borderRadius: radius.md, padding: 13, marginTop: 4 },
  doneText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.ink2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line },
  stepIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontSize: 15, fontWeight: '800', color: colors.ink },
  stepDesc: { fontSize: 13, color: colors.inkSoft, fontWeight: '600', marginTop: 2 },
});
