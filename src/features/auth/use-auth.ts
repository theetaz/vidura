import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";

const devAuthEmail = "vidura-dev@local.test";
const devAuthPassword = "vidura-dev-password-2026";
const devAuthEnabled = import.meta.env.DEV &&
  import.meta.env.VITE_DISABLE_DEV_AUTH !== "true";

type AuthState = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const client = supabase;
    let mounted = true;

    client.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }

      if (devAuthEnabled && !data.session) {
        void client.auth
          .signInWithPassword({
            email: devAuthEmail,
            password: devAuthPassword,
          })
          .then(({ data: signInData, error }) => {
            if (!mounted) {
              return;
            }

            if (error) {
              console.error("Dev auto sign-in failed", error.message);
              setSession(null);
              setLoading(false);
              return;
            }

            setSession(signInData.session);
            setLoading(false);
          });
        return;
      }

      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    configured: hasSupabaseConfig,
    loading,
    session,
    user: session?.user ?? null,
    signInWithEmail: async (email: string) => {
      if (!supabase) {
        throw new Error("Supabase is not configured.");
      }

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        throw error;
      }
    },
    signOut: async () => {
      if (!supabase) {
        return;
      }

      await supabase.auth.signOut();
    },
  };
}
