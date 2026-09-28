import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type CartItem = {
  product_id: string;
  product_name: string;
  sku: string;
  variation: string; // "" if none
  quantity: number;
  unit: string;
  unit_price: number; // resolved at add-time
  image_url: string;
};

type CartCtx = {
  items: CartItem[];
  add: (item: CartItem) => void;
  remove: (product_id: string, variation: string) => void;
  updateQty: (product_id: string, variation: string, qty: number) => void;
  clear: () => void;
  total: number;
  itemCount: number;
};

const Ctx = createContext<CartCtx | null>(null);
const STORAGE_KEY = "ka_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => {
      if (v) {
        try { setItems(JSON.parse(v)); } catch {}
      }
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, ready]);

  const add = useCallback((item: CartItem) => {
    setItems(prev => {
      const idx = prev.findIndex(p => p.product_id === item.product_id && p.variation === item.variation);
      if (idx >= 0) {
        const clone = [...prev];
        clone[idx] = { ...clone[idx], quantity: clone[idx].quantity + item.quantity };
        return clone;
      }
      return [...prev, item];
    });
  }, []);

  const remove = useCallback((product_id: string, variation: string) => {
    setItems(prev => prev.filter(p => !(p.product_id === product_id && p.variation === variation)));
  }, []);

  const updateQty = useCallback((product_id: string, variation: string, qty: number) => {
    setItems(prev => prev.map(p =>
      p.product_id === product_id && p.variation === variation ? { ...p, quantity: Math.max(1, qty) } : p
    ));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const itemCount = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <Ctx.Provider value={{ items, add, remove, updateQty, clear, total, itemCount }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside provider");
  return c;
}
