import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { colors, space } from '../theme';
import { Header } from '../components/ui';

export default function Conditions() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Header title="Conditions & confidentialité" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 40 }}>
        <Text style={st.updated}>Dernière mise à jour : janvier 2026</Text>

        {/* ---- Conditions d'utilisation ---- */}
        <Text style={st.h1}>Conditions d'utilisation</Text>
        <Text style={st.p}>
          Bienvenue sur Taga. En utilisant notre application, tu acceptes les présentes conditions.
          Taga met en relation des utilisateurs avec des chauffeurs, livreurs et restaurants partenaires
          à Bamako et dans ses environs. Nous t'invitons à les lire attentivement.
        </Text>

        <Text style={st.h2}>Usage du service</Text>
        <Text style={st.p}>
          Taga te permet de commander des courses, des livraisons de colis et des repas. Tu t'engages à
          utiliser l'application de bonne foi, à respecter les chauffeurs et partenaires, et à ne pas
          détourner le service à des fins illégales. Taga peut suspendre un compte en cas d'abus.
        </Text>

        <Text style={st.h2}>Comptes</Text>
        <Text style={st.p}>
          Pour utiliser Taga, tu dois créer un compte avec un numéro de téléphone valide et avoir au moins
          18 ans. Tu es responsable de la confidentialité de tes identifiants et de toute activité réalisée
          depuis ton compte. Préviens-nous immédiatement en cas d'utilisation non autorisée.
        </Text>

        <Text style={st.h2}>Paiements</Text>
        <Text style={st.p}>
          Les tarifs sont affichés avant chaque commande. Le paiement s'effectue par Orange Money, Moov Money,
          carte bancaire ou en espèces selon le service. Les prix peuvent varier en fonction de la distance,
          de la demande et des frais applicables. Tout paiement validé est dû.
        </Text>

        <Text style={st.h2}>Annulations</Text>
        <Text style={st.p}>
          Tu peux annuler une commande sans frais tant que le chauffeur n'est pas en route ou que le restaurant
          n'a pas lancé la préparation. Au-delà, des frais d'annulation peuvent s'appliquer pour couvrir le
          déplacement ou les denrées engagées. Les conditions précises sont rappelées au moment de l'annulation.
        </Text>

        {/* ---- Confidentialité ---- */}
        <Text style={st.h1}>Confidentialité</Text>
        <Text style={st.p}>
          Ta vie privée compte pour nous. Cette section explique quelles données Taga collecte et comment
          nous les utilisons pour te fournir un service fiable et sécurisé.
        </Text>

        <Text style={st.h2}>Données collectées</Text>
        <Text style={st.p}>
          Nous collectons les informations que tu nous fournis (nom, numéro de téléphone, adresses enregistrées)
          ainsi que des données d'usage (commandes, trajets, moyens de paiement). Ces données nous permettent
          de traiter tes demandes et d'améliorer l'expérience Taga.
        </Text>

        <Text style={st.h2}>Géolocalisation</Text>
        <Text style={st.p}>
          Taga utilise ta position pour te localiser, estimer les tarifs, attribuer un chauffeur proche et suivre
          ta course en temps réel. Tu peux désactiver la localisation depuis les réglages de ton téléphone, mais
          certaines fonctionnalités ne seront alors plus disponibles.
        </Text>

        <Text style={st.h2}>Partage des données</Text>
        <Text style={st.p}>
          Nous partageons uniquement les informations nécessaires à la réalisation de ta commande : ton point de
          rendez-vous et ton prénom sont communiqués au chauffeur ou au livreur concerné. Taga ne vend jamais tes
          données personnelles à des tiers à des fins publicitaires.
        </Text>

        <Text style={st.h2}>Tes droits</Text>
        <Text style={st.p}>
          Tu peux à tout moment consulter, corriger ou demander la suppression de tes données personnelles. Pour
          exercer ces droits, contacte notre support depuis l'écran « Aide & sécurité ». Nous traitons chaque
          demande dans les meilleurs délais, conformément à la réglementation en vigueur au Mali.
        </Text>

        <Text style={st.h2}>Suppression de ton compte</Text>
        <Text style={st.p}>
          Tu peux supprimer ton compte directement depuis l'écran « Compte » → « Supprimer mon compte ». La
          suppression est définitive : ton profil et tes données associées (courses, commandes, adresses, moyens
          de paiement) sont effacés. Certaines données peuvent être conservées de façon anonymisée lorsque la loi
          l'exige (obligations comptables, prévention de la fraude).
        </Text>

        <Text style={st.h2}>Notifications</Text>
        <Text style={st.p}>
          Avec ton accord, Taga t'envoie des notifications (push et/ou SMS) liées à tes courses, livraisons et à
          la sécurité de ton compte. Tu peux les désactiver depuis les réglages de notifications ou de ton
          téléphone ; certains messages essentiels au suivi d'une commande peuvent toutefois subsister.
        </Text>

        <Text style={st.h2}>Sécurité &amp; conservation</Text>
        <Text style={st.p}>
          Nous mettons en œuvre des mesures techniques et organisationnelles pour protéger tes données
          (chiffrement des échanges, contrôle d'accès). Nous conservons tes données aussi longtemps que ton
          compte est actif, puis pendant la durée nécessaire au respect de nos obligations légales.
        </Text>

        <Text style={st.h2}>Prestataires</Text>
        <Text style={st.p}>
          Taga s'appuie sur des prestataires techniques pour fonctionner : hébergement et base de données,
          cartographie, services de paiement mobile (Orange Money, Moov Money) et envoi de notifications. Ces
          prestataires n'accèdent qu'aux données strictement nécessaires à leur service.
        </Text>

        <Text style={st.h2}>Mineurs</Text>
        <Text style={st.p}>
          Taga est réservé aux personnes âgées d'au moins 18 ans. Nous ne collectons pas sciemment de données
          concernant des mineurs. Si tu penses qu'un mineur utilise Taga, contacte-nous pour que nous prenions
          les mesures appropriées.
        </Text>

        <Text style={st.h2}>Responsabilité</Text>
        <Text style={st.p}>
          Taga est une plateforme de mise en relation. Les chauffeurs, livreurs et restaurants sont des partenaires
          indépendants. Taga met tout en œuvre pour assurer un service fiable mais ne saurait être tenu responsable
          des actes des partenaires ou d'un cas de force majeure.
        </Text>

        <Text style={st.h2}>Modifications</Text>
        <Text style={st.p}>
          Nous pouvons faire évoluer ces conditions. En cas de changement important, tu en seras informé dans
          l'application. L'usage continu du service après mise à jour vaut acceptation des nouvelles conditions.
        </Text>

        <Text style={st.h2}>Loi applicable &amp; contact</Text>
        <Text style={st.p}>
          Les présentes conditions sont régies par le droit malien. Pour toute question relative aux conditions ou
          à tes données, écris-nous à contact@taga.ml.
        </Text>

        <Text style={st.footer}>Taga — Bamako, Mali · contact@taga.ml</Text>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  updated: { fontSize: 13, color: colors.inkMute, fontWeight: '700', marginTop: 8 },
  h1: { fontSize: 20, fontWeight: '800', color: colors.ink, marginTop: 26, marginBottom: 6 },
  h2: { fontSize: 16, fontWeight: '800', color: colors.ink2, marginTop: 20, marginBottom: 6 },
  p: { fontSize: 14.5, color: colors.inkSoft, fontWeight: '500', lineHeight: 23 },
  footer: { fontSize: 13, color: colors.inkMute, fontWeight: '700', marginTop: 30, textAlign: 'center' },
});
