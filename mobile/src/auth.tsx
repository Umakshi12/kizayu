import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { get, post, setToken, setUnauthorizedHandler } from "./api";
import { secure } from "./secure";
import type { Me } from "./types";

const KEY = "kizayu.token";
type Session = { token: string; user: Me };

interface AuthState {
  user: Me | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (b: { name: string; username: string; email: string; password: string }) => Promise<void>;
  /** Accept a session returned by any sign-in flow (phone OTP, Google, password reset). */
  accept: (s: Session) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside <AuthProvider>");
  return c;
};

let beforeSignOut: (() => Promise<void>) | null = null;
/** Lets the push module unregister this device's token before the session ends. */
export const setBeforeSignOut = (fn: (() => Promise<void>) | null) => { beforeSignOut = fn; };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(async () => { setToken(null); setUser(null); await secure.del(KEY); }, []);
  const signOut = useCallback(async () => { await beforeSignOut?.().catch(() => undefined); await clear(); }, [clear]);

  useEffect(() => { setUnauthorizedHandler(() => { void clear(); }); }, [clear]);

  useEffect(() => {
    (async () => {
      try {
        const t = await secure.get(KEY);
        if (t) { setToken(t); setUser(await get<Me>("/me")); }
      } catch { setToken(null); }
      finally { setLoading(false); }
    })();
  }, []);

  const accept = useCallback(async (r: Session) => {
    setToken(r.token);
    await secure.set(KEY, r.token);
    setUser(r.user);
  }, []);

  const value = useMemo<AuthState>(() => ({
    user, loading, signOut, accept,
    signIn: async (email, password) => accept(await post<Session>("/auth/login", { email, password })),
    signUp: async b => accept(await post<Session>("/auth/signup", b)),
    refresh: async () => setUser(await get<Me>("/me")),
  }), [user, loading, signOut, accept]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
