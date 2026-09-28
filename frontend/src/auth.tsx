import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, tokenStore, User } from "./api";

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (body: { email: string; password: string; name: string; company?: string; phone?: string; address?: string; delivery_instructions?: string }) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (u: Partial<User>) => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await tokenStore.get();
      if (!token) { setUser(null); return; }
      const me = await api.me();
      setUser(me);
    } catch {
      await tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    await tokenStore.set(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const register = async (body: { email: string; password: string; name: string; company?: string; phone?: string; address?: string; delivery_instructions?: string }) => {
    const res = await api.register(body);
    await tokenStore.set(res.access_token);
    setUser(res.user);
    return res.user;
  };

  const logout = async () => {
    await tokenStore.clear();
    setUser(null);
  };

  const updateUser = async (u: Partial<User>) => {
    const updated = await api.updateMe(u);
    setUser(updated);
  };

  return (
    <Ctx.Provider value={{ user, loading, login, register, logout, refresh, updateUser }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
