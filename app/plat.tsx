import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, space } from '../theme';
import { Header, Btn, CtaBar, useToast, FoodImage } from '../components/ui';
import { fcfa } from '../data/mock';
import { useCart } from '../components/cart';
import type { VarGroup } from '../lib/db';

export default function Plat() {
  const router = useRouter();
  const toast = useToast();
  const { add } = useCart();
  const params = useLocalSearchParams<{
    id?: string; nom?: string; desc?: string; prix?: string; img?: string; emoji?: string;
    restoId?: string; restoNom?: string; eta?: string; variantes?: string;
  }>();

  const nom = params.nom ?? '';
  const desc = params.desc ?? '';
  const img = params.img ?? '';
  const emoji = params.emoji ?? '';
  const prixBase = Number(params.prix);
  const prix = Number.isNaN(prixBase) ? 0 : prixBase;

  // Vraies variantes du plat (définies par le marchand), transmises en JSON.
  const groups: VarGroup[] = useMemo(() => {
    try { const v = JSON.parse(params.variantes || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  }, [params.variantes]);

  // Sélection : groupe requis = choix unique (pré-sélectionné) ; optionnel = multi.
  const [sel, setSel] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    groups.forEach((g) => { if (g.req && g.opts[0]) init[g.g] = [g.opts[0].n]; });
    return init;
  });
  const [qte, setQte] = useState(1);

  const pick = (g: VarGroup, optName: string) => {
    setSel((prev) => {
      const cur = prev[g.g] ?? [];
      if (g.req) return { ...prev, [g.g]: [optName] };                 // choix unique
      return { ...prev, [g.g]: cur.includes(optName) ? cur.filter((x) => x !== optName) : [...cur, optName] };
    });
  };

  const deltaOf = (g: VarGroup, optName: string) => g.opts.find((o) => o.n === optName)?.d ?? 0;
  const supTotal = groups.reduce((s, g) => s + (sel[g.g] ?? []).reduce((ss, n) => ss + deltaOf(g, n), 0), 0);
  const perUnit = prix + supTotal;
  const total = perUnit * qte;

  const ajouter = () => {
    // Tous les groupes requis doivent avoir un choix.
    const manquant = groups.find((g) => g.req && (sel[g.g] ?? []).length === 0);
    if (manquant) { toast(`Choisis : ${manquant.g}`, { tone: 'info' }); return; }

    const options: { g: string; n: string }[] = [];
    groups.forEach((g) => (sel[g.g] ?? []).forEach((n) => options.push({ g: g.g, n })));
    const extras = options.map((o) => o.n);
    const label = extras.length ? `${nom} (${extras.join(', ')})` : nom;
    const sig = options.map((o) => `${o.g}:${o.n}`).sort().join(',');
    const lineId = `${params.id ?? nom}|${sig}`;

    add(
      { id: params.restoId || null, nom: params.restoNom ?? nom, eta: params.eta || null },
      { id: lineId, menuItemId: params.id, nom: label, prix: perUnit, qte, options: options.length ? options : undefined },
    );
    toast('Ajouté au panier', { tone: 'success' });
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Personnaliser" />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <FoodImage uri={img} emoji={emoji || '🍽️'} emojiSize={80} style={st.hero} />

        <View style={st.head}>
          <Text style={st.name}>{nom}</Text>
          {desc ? <Text style={st.desc}>{desc}</Text> : null}
          <Text style={st.prix}>{fcfa(prix)}</Text>
        </View>

        {groups.map((g) => (
          <View key={g.g} style={st.section}>
            <View style={st.secHead}>
              <Text style={st.secTitle}>{g.g}</Text>
              {g.req
                ? <View style={st.req}><Text style={st.reqText}>Requis</Text></View>
                : <Text style={st.optionnel}>Facultatif</Text>}
            </View>
            <View style={st.group}>
              {g.opts.map((o, i) => {
                const on = (sel[g.g] ?? []).includes(o.n);
                return (
                  <Pressable key={o.n} style={[st.opt, i < g.opts.length - 1 && st.optBorder]} onPress={() => pick(g, o.n)}>
                    {g.req ? (
                      <View style={[st.radio, on && st.radioOn]}>{on && <View style={st.radioDot} />}</View>
                    ) : (
                      <View style={[st.check, on && st.checkOn]}>{on && <Ionicons name="checkmark" size={15} color={colors.white} />}</View>
                    )}
                    <Text style={st.optName}>{o.n}</Text>
                    <Text style={st.optPrix}>{o.d > 0 ? `+${fcfa(o.d)}` : 'Inclus'}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <View style={st.section}>
          <Text style={st.secTitle}>Quantité</Text>
          <View style={st.stepper}>
            <Pressable style={[st.stepBtn, qte <= 1 && st.stepBtnOff]} disabled={qte <= 1} onPress={() => setQte((q) => Math.max(1, q - 1))}>
              <Ionicons name="remove" size={22} color={qte <= 1 ? colors.inkMute : colors.ink} />
            </Pressable>
            <Text style={st.qte}>{qte}</Text>
            <Pressable style={st.stepBtn} onPress={() => setQte((q) => q + 1)}>
              <Ionicons name="add" size={22} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <CtaBar>
        <Btn label={`Ajouter · ${fcfa(total)}`} onPress={ajouter} />
      </CtaBar>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { height: 210, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  head: { paddingHorizontal: space.lg, paddingTop: 22, backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, marginTop: -22 },
  name: { fontSize: 25, fontWeight: '800', color: colors.ink },
  desc: { fontSize: 14, color: colors.inkSoft, fontWeight: '600', marginTop: 6, lineHeight: 20 },
  prix: { fontSize: 20, fontWeight: '800', color: colors.brand, marginTop: 12 },
  section: { paddingHorizontal: space.lg, marginTop: 24 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  secTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  req: { backgroundColor: colors.brandSoft, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  reqText: { fontSize: 11.5, fontWeight: '800', color: colors.brandDeep },
  optionnel: { fontSize: 13, fontWeight: '600', color: colors.inkMute },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow.card },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 15, paddingVertical: 15 },
  optBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.brand },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.line2, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  optName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  optPrix: { fontSize: 14, fontWeight: '700', color: colors.inkSoft },
  stepper: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 20, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 8, ...shadow.card },
  stepBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepBtnOff: { opacity: 0.6 },
  qte: { fontSize: 19, fontWeight: '800', color: colors.ink, minWidth: 24, textAlign: 'center' },
});
