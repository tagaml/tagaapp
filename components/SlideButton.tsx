import React, { useRef, useState } from 'react';
import { View, StyleSheet, PanResponder, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

const THUMB = 52;
const PAD = 4;
const TRACK_H = 60;
const GAP = 10; // marge entre le curseur et le texte

/** Bouton glissant : glisse le pouce orange jusqu'au bout pour valider.
 *  `disabled` verrouille le bouton (ex : le chauffeur n'est pas encore sur place). */
export function SlideButton({ label, onComplete, disabled = false, disabledLabel }: { label: string; onComplete: () => void; disabled?: boolean; disabledLabel?: string }) {
  const [trackW, setTrackW] = useState(0);
  const pan = useRef(new Animated.Value(0)).current;
  const trackWRef = useRef(0);
  const doneRef = useRef(false);

  // Toujours appeler la dernière version de onComplete (le PanResponder est créé une seule fois).
  const cbRef = useRef(onComplete);
  cbRef.current = onComplete;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const maxX = Math.max(0, trackW - THUMB - PAD * 2);

  const reset = () => {
    Animated.spring(pan, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderMove: (_e, g) => {
        const tw = trackWRef.current;
        const max = Math.max(0, tw - THUMB - PAD * 2);
        const x = Math.min(Math.max(0, g.dx), max);
        pan.setValue(x);
      },
      onPanResponderRelease: (_e, g) => {
        const tw = trackWRef.current;
        const max = Math.max(0, tw - THUMB - PAD * 2);
        if (max > 0 && g.dx >= max * 0.75) {
          if (!doneRef.current) {
            doneRef.current = true;
            Animated.timing(pan, { toValue: max, duration: 120, useNativeDriver: false }).start(() => {
              cbRef.current();
              doneRef.current = false;
              reset();
            });
          }
        } else {
          reset();
        }
      },
      onPanResponderTerminate: () => reset(),
    })
  ).current;

  // Le texte s'efface avant que le curseur ne l'atteigne : il reste lisible pendant tout le glissement.
  const labelOpacity = pan.interpolate({
    inputRange: [0, Math.max(1, maxX * 0.45)],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[st.track, disabled && st.trackOff]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setTrackW(w);
        trackWRef.current = w;
      }}
    >
      <Animated.Text
        style={[st.label, disabled && st.labelOff, { opacity: disabled ? 1 : labelOpacity }]}
        numberOfLines={1}
        adjustsFontSizeToFit           // sur petit écran le texte rétrécit plutôt que d'être tronqué
        minimumFontScale={0.85}
      >
        {disabled ? (disabledLabel ?? label) : label}
      </Animated.Text>
      <Animated.View style={[st.thumb, disabled && st.thumbOff, { transform: [{ translateX: pan }] }]} {...responder.panHandlers}>
        <Ionicons name={disabled ? 'lock-closed' : 'chevron-forward'} size={disabled ? 20 : 26} color={colors.white} />
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  track: {
    height: TRACK_H,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    justifyContent: 'center',
    paddingHorizontal: PAD,
    overflow: 'hidden',
  },
  label: {
    position: 'absolute',
    // Le texte commence après le curseur et se centre dans l'espace restant : au repos,
    // le pouce ne recouvre jamais le début du libellé (« Glissez… »).
    left: PAD + THUMB + GAP,
    right: PAD + GAP,
    textAlign: 'center',
    fontSize: 15.5,
    fontWeight: '800',
    color: colors.white,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackOff: { backgroundColor: colors.line2 },
  thumbOff: { backgroundColor: colors.inkMute },
  labelOff: { color: colors.ink2, fontSize: 14 },
});
