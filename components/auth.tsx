import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, phoneToEmail } from '../lib/supabase';
import { clearPushToken } from '../lib/notify';
import { setDriverOffline } from '../lib/db';
import { stopBackgroundPresence } from '../lib/backgroundPresence';

export type User = { id: string; prenom: string; nom: string; phone: string };

type AuthContextType = {
  user: User | null;
  loading: boolean;
  signIn: (phone: string, password: string) => Promise<void>;
  signUp: (data: { prenom: string; nom: string; phone: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// Traduit les erreurs Supabase en messages clairs (français).
function frError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Numéro ou mot de passe incorrect.';
  if (m.includes('email not confirmed')) return "Ton compte n'est pas encore activé. Contacte le support.";
  if (m.includes('user already registered') || m.includes('already been registered')) return 'Un compte existe déjà avec ce numéro.';
  if (m.includes('password should be at least')) return 'Le mot de passe est trop court (6 caractères minimum).';
  if (m.includes('network')) return 'Pas de connexion. Vérifie ton réseau.';
  return 'Une erreur est survenue. Réessaie.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (id: string, fallback?: Partial<User>) => {
    const { data } = await supabase.from('profiles').select('prenom, nom, phone').eq('id', id).maybeSingle();
    setUser({
      id,
      prenom: data?.prenom ?? fallback?.prenom ?? '',
      nom: data?.nom ?? fallback?.nom ?? '',
      phone: data?.phone ?? fallback?.phone ?? '',
    });
  };

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) await loadProfile(data.session.user.id);
      } catch { /* session illisible : on reste déconnecté sans crasher */ }
      finally { setLoading(false); }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id);
      else setUser(null);
    });

    // Rafraîchissement de session propre : on n'auto-refresh QUE quand l'app est au premier plan.
    // Sinon le refresh token peut tourner en arrière-plan et être invalidé si l'app est tuée
    // en plein rafraîchissement → l'utilisateur se retrouve déconnecté au prochain lancement.
    if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => { sub.subscription.unsubscribe(); appSub.remove(); };
  }, []);

  const signIn = async (phone: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: phoneToEmail(phone), password });
    if (error) throw new Error(frError(error.message));
  };

  const signUp = async (data: { prenom: string; nom: string; phone: string; password: string }) => {
    const { data: res, error } = await supabase.auth.signUp({
      email: phoneToEmail(data.phone),
      password: data.password,
      options: { data: { prenom: data.prenom, nom: data.nom, phone: data.phone } },
    });
    if (error) throw new Error(frError(error.message));
    // Si la confirmation e-mail est activée, aucune session n'est créée.
    if (!res.session) {
      throw new Error('Inscription impossible pour le moment. Réessaie ou contacte le support.');
    }
  };

  const signOut = async () => {
    await clearPushToken().catch(() => {}); // l'appareil ne reçoit plus les notifs de ce compte
    await setDriverOffline().catch(() => {}); // sort de la file de dispatch
    await stopBackgroundPresence().catch(() => {}); // stoppe le suivi de présence en arrière-plan
    await AsyncStorage.setItem('taga.driver.online', '0').catch(() => {}); // ne pas reprendre en ligne au prochain lancement
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
