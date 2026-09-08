import React from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Header } from '../../components/ui';
import { RideChat } from '../../components/RideChat';
import { colors, space } from '../../theme';

export default function DriverChat() {
  const { rideId, orderId, passager, client } = useLocalSearchParams<{ rideId?: string; orderId?: string; passager?: string; client?: string }>();

  // Conversation d'une livraison (client ↔ livreur).
  if (orderId) {
    const nm = client || 'Client';
    const ini = nm.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return <RideChat orderId={orderId} role="driver" peerName={nm} peerInitials={ini} />;
  }

  if (!rideId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Header title="Messages" />
        <Text style={{ textAlign: 'center', marginTop: 40, paddingHorizontal: space.lg, color: colors.inkSoft, fontWeight: '600' }}>
          La messagerie s'ouvre pendant une course.
        </Text>
      </View>
    );
  }

  const nm = passager || 'Passager';
  const ini = nm.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return <RideChat rideId={rideId} role="driver" peerName={nm} peerInitials={ini} />;
}
