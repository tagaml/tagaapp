import { Alert, Linking } from 'react-native';

// Nettoie un numéro pour WhatsApp (wa.me attend les chiffres avec indicatif, sans +).
// Ex : « +223 76 00 00 12 » → « 22376000012 ». Si pas d'indicatif, on préfixe le Mali (223).
function waNumber(raw: string): string {
  let d = (raw || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '223' + d; // numéro local malien sans indicatif
  return d;
}

/**
 * Contacte l'autre partie (chauffeur ↔ client) : propose Appel direct ou WhatsApp.
 * Le numéro est révélé par le serveur (RPC ride_contact_phone) uniquement pendant la course.
 * L'appel passe par le réseau téléphonique (cellulaire) ; WhatsApp ouvre le chat/appel WhatsApp.
 */
export function contactParty(tel: string | null | undefined, who = 'contact'): void {
  if (!tel) {
    Alert.alert('Contact indisponible', `Le numéro n'est pas encore disponible. Utilise le message en attendant.`);
    return;
  }
  const wa = waNumber(tel);
  Alert.alert(
    `Contacter ${who}`,
    tel,
    [
      { text: 'Appeler', onPress: () => Linking.openURL(`tel:${tel}`).catch(() => Alert.alert('Appel impossible', "Impossible de lancer l'appel sur cet appareil.")) },
      {
        text: 'WhatsApp',
        onPress: () =>
          Linking.openURL(`whatsapp://send?phone=${wa}`).catch(() =>
            Linking.openURL(`https://wa.me/${wa}`).catch(() => Alert.alert('WhatsApp indisponible', "WhatsApp n'est pas installé sur cet appareil.")),
          ),
      },
      { text: 'Annuler', style: 'cancel' },
    ],
  );
}
