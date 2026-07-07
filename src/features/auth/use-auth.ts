import { authClient } from "@/lib/auth-client";
import { isApiConfigured } from "@/lib/api";

export type SessionUser = {
  id: string;
  email: string | null;
  name?: string | null;
  image?: string | null;
  user_metadata?: { full_name?: string; name?: string; avatar_url?: string };
};

type AuthState = {
  configured: boolean;
  loading: boolean;
  session: unknown;
  user: SessionUser | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function useAuth(): AuthState {
  const { data: session, isPending } = authClient.useSession();
  const sessionUser = session?.user
    ? {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
      image: session.user.image ?? null,
      // Keep the shape App.tsx already reads for display names/avatars.
      user_metadata: {
        full_name: session.user.name ?? undefined,
        name: session.user.name ?? undefined,
        avatar_url: session.user.image ?? undefined,
      },
    }
    : null;

  return {
    configured: isApiConfigured,
    loading: isPending,
    session: session ?? null,
    user: sessionUser,
    signInWithGoogle: async () => {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
    },
    signOut: async () => {
      await authClient.signOut();
    },
  };
}
