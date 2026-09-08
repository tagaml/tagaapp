import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, space } from '../theme';
import { Header, Btn, Avatar, useToast } from '../components/ui';
import { getProfile, updateProfile, getMyPhoto, uploadDriverPhoto } from '../lib/db';

function initiales(prenom: string, nom: string): string {
  const a = prenom.trim()[0] ?? '';
  const b = nom.trim()[0] ?? '';
  return (a + b).toUpperCase() || '?';
}

export default function Profile() {
  const router = useRouter();
  const toast = useToast();
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [tel, setTel] = useState('');
  const [saving, setSaving] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busyPhoto, setBusyPhoto] = useState(false);

  useEffect(() => {
    getProfile().then((p) => {
      if (!p) return;
      setPrenom(p.prenom ?? '');
      setNom(p.nom ?? '');
      setTel(p.phone ?? '');
    }).catch(() => {});
    getMyPhoto().then(setPhoto).catch(() => {});
  }, []);

  const changePhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { toast('Autorise l\'accès aux photos pour changer ta photo', { tone: 'error' }); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true, mediaTypes: 'images', allowsEditing: true, aspect: [1, 1] });
      if (res.canceled || !res.assets?.[0]?.base64) return;
      setBusyPhoto(true);
      const url = await uploadDriverPhoto(res.assets[0].base64);
      setPhoto(url);
      toast('Photo mise à jour');
    } catch {
      // Pas de message technique brut à l'écran : on reste lisible pour l'utilisateur.
      toast("La photo n'a pas pu être envoyée. Réessaie.", { tone: 'error' });
    } finally {
      setBusyPhoto(false);
    }
  };

  const enregistrer = async () => {
    if (!prenom.trim() || !nom.trim()) {
      toast('Renseigne ton prénom et ton nom', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      await updateProfile({ prenom: prenom.trim(), nom: nom.trim(), phone: tel.trim() });
      toast('Profil enregistré');
      router.back();
    } catch {
      toast('Échec de l\'enregistrement', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Mon profil" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 30 }}>
        <View style={{ alignItems: 'center', marginVertical: 14 }}>
          <Pressable onPress={changePhoto} disabled={busyPhoto}>
            <Avatar text={initiales(prenom, nom)} size={84} tone="ink" uri={photo ?? undefined} />
            <View style={st.camBadge}>
              {busyPhoto ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons name="camera" size={15} color={colors.white} />}
            </View>
          </Pressable>
          <Text style={st.changeHint}>Touche pour changer ta photo</Text>
        </View>

        <Field label="Prénom" value={prenom} onChange={setPrenom} placeholder="Ton prénom" />
        <Field label="Nom" value={nom} onChange={setNom} placeholder="Ton nom" />
        <Field label="Téléphone" value={tel} onChange={setTel} keyboard="phone-pad" placeholder="Ton numéro" />

        <Btn label="Enregistrer" onPress={enregistrer} loading={saving} style={{ marginTop: 24 }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({ label, value, onChange, keyboard, placeholder }: { label: string; value: string; onChange: (s: string) => void; keyboard?: any; placeholder?: string }) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={st.label}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={keyboard} placeholder={placeholder} style={st.input} placeholderTextColor={colors.inkMute} />
    </View>
  );
}

const st = StyleSheet.create({
  camBadge: { position: 'absolute', right: -2, bottom: -2, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  changeHint: { fontSize: 12.5, fontWeight: '700', color: colors.inkSoft, marginTop: 10 },
  label: { fontSize: 13, fontWeight: '800', color: colors.inkSoft, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 16, height: 54, fontSize: 16, fontWeight: '700', color: colors.ink, borderWidth: 1, borderColor: colors.line },
});
