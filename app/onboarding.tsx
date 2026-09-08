import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ImageBackground, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, shadow, space } from '../theme';
import { Btn } from '../components/ui';

export const ONBOARDED_KEY = 'taga_onboarded';

const SLIDES = [
  {
    img: require('../assets/services/onb1.jpg'),
    titre: 'Déplace-toi en un geste',
    sous: 'Taxi et moto-taxi partout dans Bamako, en quelques secondes.',
  },
  {
    img: require('../assets/services/onb2.jpg'),
    titre: 'Tes plats préférés, livrés',
    sous: 'Commande au resto et fais-toi livrer chaud, en ~30 min.',
  },
  {
    img: require('../assets/services/onb3.jpg'),
    titre: 'Envoie un colis facilement',
    sous: 'Un coursier récupère et livre tes colis dans tout Bamako.',
  },
];

const { width } = Dimensions.get('window');

export default function Onboarding() {
  const router = useRouter();
  const ref = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const dernier = index === SLIDES.length - 1;

  const finir = async () => {
    try { await AsyncStorage.setItem(ONBOARDED_KEY, '1'); } catch { /* ignore */ }
    router.replace('/login');
  };

  const suivant = () => {
    if (dernier) finir();
    else ref.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.ink }}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((s, i) => (
          <ImageBackground key={i} source={s.img} style={{ width, height: '100%' }} resizeMode="cover">
            <View style={st.shade} />
          </ImageBackground>
        ))}
      </ScrollView>

      {/* Bouton Passer */}
      <SafeAreaView edges={['top']} style={st.topSafe} pointerEvents="box-none">
        <Pressable onPress={finir} hitSlop={10} style={st.skip}>
          <Text style={st.skipText}>Passer</Text>
        </Pressable>
      </SafeAreaView>

      {/* Texte + contrôles en bas */}
      <SafeAreaView edges={['bottom']} style={st.bottom} pointerEvents="box-none">
        <Text style={st.titre}>{SLIDES[index].titre}</Text>
        <Text style={st.sous}>{SLIDES[index].sous}</Text>

        <View style={st.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[st.dot, i === index && st.dotOn]} />
          ))}
        </View>

        <Btn label={dernier ? 'Commencer' : 'Suivant'} onPress={suivant} style={{ marginTop: 18 }} />
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,8,6,0.38)' },
  topSafe: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: space.lg, alignItems: 'flex-end' },
  skip: { marginTop: 8, backgroundColor: 'rgba(0,0,0,0.35)', paddingHorizontal: 16, height: 38, borderRadius: 20, justifyContent: 'center' },
  skipText: { color: colors.white, fontSize: 14, fontWeight: '800' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, paddingBottom: 18 },
  titre: { color: colors.white, fontSize: 28, fontWeight: '800', lineHeight: 33, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 8 },
  sous: { color: 'rgba(255,255,255,0.92)', fontSize: 15.5, fontWeight: '600', lineHeight: 22, marginTop: 10, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 8 },
  dots: { flexDirection: 'row', gap: 7, marginTop: 22 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotOn: { width: 22, backgroundColor: colors.brand },
});
