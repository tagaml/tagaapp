import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, radius, space } from '../theme';
import { useKeyboardHeight } from '../lib/keyboard';

// Rouge « erreur » dédié (le thème n'a pas de couleur danger) : un code refusé doit se lire comme une erreur,
// pas comme la couleur de marque.
const DANGER = '#D8261C';

/**
 * Modal de confirmation par code de remise (4 chiffres).
 * `onConfirm(code)` doit renvoyer true si le code est bon (livraison confirmée), false sinon.
 */
export function CodeConfirm({ open, title, subtitle, onConfirm, onClose }: {
  open: boolean;
  title: string;
  subtitle: string;
  onConfirm: (code: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const kbHeight = useKeyboardHeight(); // remonte la feuille du clavier (voir lib/keyboard.ts)

  useEffect(() => {
    if (open) { setCode(''); setErr(false); setBusy(false); setTimeout(() => inputRef.current?.focus(), 250); }
  }, [open]);

  const valider = async () => {
    if (code.trim().length < 4 || busy) return;
    setBusy(true); setErr(false);
    try {
      const ok = await onConfirm(code.trim());
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        setErr(true);
        setCode('');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      {/* PAS de KeyboardAvoidingView ici : il est SANS EFFET dans un Modal sur Android (un Modal
          est une fenêtre séparée, le `adjustResize` du manifeste ne s'y applique pas). C'est ce
          qui laissait le clavier recouvrir la saisie du code de remise. On remonte la feuille
          nous-mêmes, avec la hauteur RÉELLE du clavier. */}
      <View style={st.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={[st.sheet, { paddingBottom: kbHeight }]}>
          <View style={st.handle} />
          <View style={st.head}>
            <View style={st.icon}><Ionicons name="keypad" size={22} color={colors.brand} /></View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
          </View>
          <Text style={st.title}>{title}</Text>
          <Text style={st.sub}>{subtitle}</Text>

          <TextInput
            ref={inputRef}
            style={[st.input, err && st.inputErr]}
            value={code}
            onChangeText={(t) => { setCode(t.replace(/[^0-9]/g, '').slice(0, 4)); setErr(false); }}
            placeholder="••••"
            placeholderTextColor={colors.inkMute}
            keyboardType="number-pad"
            maxLength={4}
            onSubmitEditing={valider}
          />
          {err ? <Text style={st.errText}>Code incorrect. Demande le bon code au client.</Text> : null}

          <Pressable style={[st.btn, (code.length < 4 || busy) && { opacity: 0.5 }]} disabled={code.length < 4 || busy} onPress={valider}>
            <Text style={st.btnText}>{busy ? 'Vérification…' : 'Confirmer la livraison'}</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: space.lg, paddingTop: 10, paddingBottom: 16 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line2, alignSelf: 'center', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTint, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink, marginTop: 12 },
  sub: { fontSize: 14, fontWeight: '600', color: colors.inkSoft, marginTop: 4, lineHeight: 20 },
  input: { marginTop: 18, height: 66, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.line2, backgroundColor: colors.surface, textAlign: 'center', fontSize: 30, fontWeight: '800', letterSpacing: 14, color: colors.ink },
  inputErr: { borderColor: DANGER },
  errText: { fontSize: 13, fontWeight: '700', color: DANGER, marginTop: 10, textAlign: 'center' },
  btn: { marginTop: 18, height: 54, borderRadius: radius.lg, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '800', color: colors.white },
});
