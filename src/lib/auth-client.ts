import { createAuthClient } from "better-auth/react";
import { apiBaseUrl } from "@/lib/api";

// better-auth client points at the API's /api/auth/* handler. The session
// cookie is set on the shared parent domain in production.
export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
});
