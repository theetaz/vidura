import type { Context, Next } from "hono";
import { auth } from "../auth.ts";

export type AuthUser = { id: string; email: string | null };

export type AppEnv = { Variables: { user: AuthUser } };

// Rejects unauthenticated requests and attaches the better-auth user to the
// context. Every data route derives ownership from c.get("user").id.
export async function requireUser(c: Context<AppEnv>, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session?.user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("user", {
    id: session.user.id,
    email: session.user.email ?? null,
  });

  await next();
}
