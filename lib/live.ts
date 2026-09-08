/**
 * Mise à jour à l'instant, partout.
 *
 * Le problème que ça règle : la plupart des écrans lisaient la base UNE SEULE FOIS au montage.
 * L'admin valide les documents, active l'abonnement, confirme un paiement… et le chauffeur voyait
 * encore l'ancien état jusqu'à ce qu'il ferme et rouvre l'application. D'où l'impression de « bugs ».
 *
 * `useLive` recharge automatiquement dans QUATRE situations, sans que l'écran ait à y penser :
 *   1. une ligne change en base (temps réel Supabase, filtré sur MES lignes) ;
 *   2. l'écran revient au premier plan (retour de navigation) ;
 *   3. l'application sort de l'arrière-plan ;
 *   4. le réseau revient après une coupure (fréquent à Bamako).
 *
 * Un seul endroit à corriger, plus de copier-coller dans 20 écrans.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from './supabase';

/** Une table à écouter, éventuellement filtrée (ex. { table: 'driver_kyc', filter: 'driver_id=eq.<uid>' }). */
export type LiveSource = { table: string; filter?: string };

export type LiveState<T> = {
  data: T | null;
  loading: boolean;   // vrai UNIQUEMENT au tout premier chargement (pas aux rafraîchissements)
  error: boolean;
  refresh: () => void; // rechargement manuel (tirer pour rafraîchir)
};

/** Identifiant de canal unique : deux écrans qui écoutent la même table ne se marchent pas dessus. */
let compteur = 0;
const idCanal = () => `live${++compteur}_${Date.now().toString(36)}`;

/**
 * @param charger  la fonction qui lit les données (ex. () => getKyc())
 * @param sources  les tables dont un changement doit provoquer un rechargement
 * @param actif    passe à false pour suspendre (ex. utilisateur non connecté)
 */
export function useLive<T>(
  charger: () => Promise<T>,
  sources: LiveSource[] = [],
  actif = true,
): LiveState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const chargerRef = useRef(charger);
  chargerRef.current = charger; // toujours la dernière closure, sans relancer les abonnements
  const monte = useRef(true);
  const dejaCharge = useRef(false);
  const enCours = useRef(false);

  const relire = useCallback(async () => {
    if (!actif || enCours.current) return; // pas deux lectures en parallèle (rafales de realtime)
    enCours.current = true;
    try {
      const d = await chargerRef.current();
      if (!monte.current) return;
      setData(d);
      setError(false);
      dejaCharge.current = true;
    } catch {
      if (monte.current && !dejaCharge.current) setError(true);
      // Déjà des données à l'écran ? On garde l'ancien état plutôt que d'afficher une erreur :
      // une coupure réseau ne doit pas vider l'écran.
    } finally {
      enCours.current = false;
      if (monte.current) setLoading(false);
    }
  }, [actif]);

  useEffect(() => {
    monte.current = true;
    return () => { monte.current = false; };
  }, []);

  // 1) Temps réel : la base pousse le changement, on relit.
  // 4) Réseau : le canal Supabase se reconnecte seul après une coupure (fréquent à Bamako).
  //    On se greffe sur SA reconnexion — pas besoin d'une dépendance native supplémentaire.
  const cle = JSON.stringify(sources);
  useEffect(() => {
    if (!actif || !sources.length) return;
    let dejaConnecte = false;
    const canal = supabase.channel(`live:${idCanal()}`);
    sources.forEach(({ table, filter }) => {
      canal.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => { relire(); },
      );
    });
    canal.subscribe((statut) => {
      if (statut === 'SUBSCRIBED') {
        // Re-souscription après une coupure : on a pu manquer des évènements → on relit.
        if (dejaConnecte) relire();
        dejaConnecte = true;
      }
    });
    return () => { supabase.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, actif, relire]);

  // 2) Retour sur l'écran → on relit (le temps réel a pu manquer un évènement pendant l'absence).
  useFocusEffect(useCallback(() => { relire(); }, [relire]));

  // 3) L'app revient de l'arrière-plan → on relit (les canaux ont pu être coupés par l'OS).
  useEffect(() => {
    if (!actif) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') relire();
    });
    return () => sub.remove();
  }, [actif, relire]);

  return { data, loading, error, refresh: relire };
}

/**
 * Version « je garde mon écran tel quel ».
 * L'écran garde son propre `charger()` et ses propres états ; on lui ajoute juste les 3 déclencheurs :
 * changement en base (temps réel), retour sur l'écran, et réveil de l'application.
 *
 *   useLiveRefresh(charger, srcKyc);   // srcKyc reçoit mon identifiant automatiquement
 *
 * C'est le plus simple à brancher sur un écran existant — aucune restructuration.
 */
export function useLiveRefresh(
  charger: () => void | Promise<unknown>,
  sources: (uid: string) => LiveSource[],
  actif = true,
): void {
  const chargerRef = useRef(charger);
  chargerRef.current = charger;
  const srcRef = useRef(sources);
  srcRef.current = sources;

  const relire = useCallback(() => { void chargerRef.current(); }, []);

  // Temps réel sur MES lignes (+ relecture à la reconnexion du canal).
  useEffect(() => {
    if (!actif) return;
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let vivant = true;
    let dejaConnecte = false;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id;
      if (!uid || !vivant) return;
      const srcs = srcRef.current(uid);
      if (!srcs.length) return;
      canal = supabase.channel(`live:${uid}:${idCanal()}`);
      srcs.forEach(({ table, filter }) => {
        canal!.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
          () => relire(),
        );
      });
      canal.subscribe((statut) => {
        if (statut === 'SUBSCRIBED') {
          if (dejaConnecte) relire(); // reconnexion après coupure : on a pu manquer un évènement
          dejaConnecte = true;
        }
      });
    }).catch(() => {});

    return () => { vivant = false; if (canal) supabase.removeChannel(canal); };
  }, [actif, relire]);

  // Retour sur l'écran.
  useFocusEffect(useCallback(() => { relire(); }, [relire]));

  // Réveil de l'application (l'OS coupe les canaux en arrière-plan).
  useEffect(() => {
    if (!actif) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') relire();
    });
    return () => sub.remove();
  }, [actif, relire]);
}

/* ---------- Raccourcis prêts à l'emploi (les cas qui posaient problème) ---------- */

/** Documents (KYC) : l'admin valide ou refuse → le chauffeur le voit à l'instant. */
export const srcKyc = (uid: string): LiveSource[] => [
  { table: 'driver_kyc', filter: `driver_id=eq.${uid}` },
];

/** Véhicule / services / demande de changement : l'admin approuve → le chauffeur le voit. */
export const srcVehicule = (uid: string): LiveSource[] => [
  { table: 'driver_profiles', filter: `driver_id=eq.${uid}` },
  { table: 'driver_vehicle_requests', filter: `driver_id=eq.${uid}` },
];

/** Abonnement : l'admin encaisse et active → le chauffeur roule tout de suite. */
export const srcAbonnement = (uid: string): LiveSource[] => [
  { table: 'driver_subscriptions', filter: `driver_id=eq.${uid}` },
];

/** Retraits : la Finance paie ou refuse → le chauffeur le voit dans ses gains. */
export const srcPayouts = (uid: string): LiveSource[] => [
  { table: 'payouts', filter: `driver_id=eq.${uid}` },
];

/** Argent du client : crédits accordés par l'admin. */
export const srcCredits = (uid: string): LiveSource[] => [
  { table: 'wallet_credits', filter: `user_id=eq.${uid}` },
];

/** Déménagement : l'admin envoie le devis / confirme le paiement → le client le voit. */
export const srcDemenagement = (uid: string): LiveSource[] => [
  { table: 'moving_requests', filter: `user_id=eq.${uid}` },
];

/** Notifications (cloche, badges). */
export const srcNotifications = (uid: string): LiveSource[] => [
  { table: 'notifications', filter: `user_id=eq.${uid}` },
];
