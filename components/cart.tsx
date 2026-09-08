import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

// `id` = identifiant de LIGNE (plat + options choisies) → deux variantes du même plat
// sont des lignes distinctes. `menuItemId` = vrai id du plat. `prix` = prix unitaire (base + suppléments).
export type CartItem = { id: string; menuItemId?: string; nom: string; prix: number; qte: number; options?: { g: string; n: string }[] };
export type CartResto = { id?: string | null; nom: string; eta?: string | null };

type CartState = {
  restaurant: CartResto | null;
  items: CartItem[];
  add: (resto: CartResto, item: CartItem) => void;
  setQty: (id: string, delta: number) => void;
  clear: () => void;
  sousTotal: number;
  count: number;
};

const Ctx = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [restaurant, setRestaurant] = useState<CartResto | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);

  const add = useCallback((resto: CartResto, item: CartItem) => {
    setItems((prev) => {
      // Changement de restaurant → on repart d'un panier vide.
      const sameResto = restaurant && restaurant.nom === resto.nom;
      const base = sameResto ? prev : [];
      const idx = base.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const copy = [...base];
        copy[idx] = { ...copy[idx], qte: copy[idx].qte + item.qte };
        return copy;
      }
      return [...base, item];
    });
    setRestaurant((curr) => (curr && curr.nom === resto.nom ? curr : resto));
  }, [restaurant]);

  const setQty = useCallback((id: string, delta: number) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, qte: Math.max(0, i.qte + delta) } : i)).filter((i) => i.qte > 0));
  }, []);

  const clear = useCallback(() => { setItems([]); setRestaurant(null); }, []);

  const sousTotal = useMemo(() => items.reduce((s, i) => s + i.prix * i.qte, 0), [items]);
  const count = useMemo(() => items.reduce((s, i) => s + i.qte, 0), [items]);

  return (
    <Ctx.Provider value={{ restaurant, items, add, setQty, clear, sousTotal, count }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart(): CartState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart doit être utilisé dans un CartProvider');
  return c;
}
