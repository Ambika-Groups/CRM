/**
 * How the browser reads an answer from the CRM's server part (D-51: a Netlify Function; the format is set in
 * functions/src/api.ts). 200 with `{ result }` is the result; anything else becomes a ServerError with one of the
 * server's codes, so every screen maps refusals the same way.
 */

/**
 * `code`: failed-precondition (a plain-words refusal, with `details.fields` or `details.reauth`), unauthenticated,
 * permission-denied, invalid-argument, unavailable (no connection, or no answer in time), not-found (the server part is
 * not deployed, or has no key yet), internal.
 */
export class ServerError extends Error {
  constructor(readonly code: string, message: string, readonly details?: { fields?: Record<string, string>; reauth?: boolean }) { super(message); }
}

export function readAnswer<O>(status: number, body: unknown): O {
  const b = (body && typeof body === "object" ? body : null) as { result?: unknown; error?: { code?: unknown; message?: unknown; details?: ServerError["details"] } } | null;
  if (status >= 200 && status < 300 && b && "result" in b) return b.result as O;
  if (b?.error && typeof b.error.code === "string") {
    throw new ServerError(b.error.code === "not-connected" ? "not-found" : b.error.code, typeof b.error.message === "string" ? b.error.message : "", b.error.details);
  }
  // Not our JSON: the function is not there (the site's "not found" page), or the host itself failed or timed out.
  throw new ServerError(status === 404 ? "not-found" : status === 401 ? "unauthenticated" : status === 403 ? "permission-denied" : status >= 500 ? "unavailable" : "internal", "");
}

/** What an unsigned check of the server part's address tells us: is it deployed, and does it have its key? */
export type ServerState = "connected" | "noKey" | "notDeployed" | "unknown";
export function serverState(status: number | null, body: unknown): ServerState {
  if (status === null) return "unknown";
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  if (status === 401 && code === "unauthenticated") return "connected";
  if (status === 503 && code === "not-connected") return "noKey";
  if (status === 404 || typeof code !== "string") return status >= 500 ? "unknown" : "notDeployed";
  return "unknown";
}
