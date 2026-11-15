/**
 * The three Netlify Functions (D-51), as plain web Request -> Response handlers. The files in netlify/functions only
 * re-export these, so everything here is typechecked and tested with the rest of the server code.
 *
 *  - api:     the CRM's server part for signed-in people (api.ts).
 *  - enquiry: the website's enquiry link (contract v3), authenticated by the website key.
 *  - nightly: the scheduled clean-up (maintenance.ts).
 *
 * Until the key variable is set (admin.ts), each answers "not connected yet" instead of failing, so the site can be
 * deployed first and the key added afterwards.
 */
import { runtime, type Env } from "./admin";
import { handleApi, notConnected, MAX_BODY } from "./api";
import { cleanUp } from "./maintenance";
import { handleEnquiry } from "./setup";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** Reads at most `max` characters of the body, so an oversized request is refused without being held in memory. */
async function readBody(req: Request, max: number): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max * 4) return "x".repeat(max + 1);
  return req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
}

export async function apiFunction(req: Request, env: Env = process.env): Promise<Response> {
  const rt = runtime(env);
  if (!rt) { const out = notConnected(); return json(out.status, out.body); }
  const out = await handleApi(
    { method: req.method, authorization: req.headers.get("authorization") ?? "", appCheck: req.headers.get("x-firebase-appcheck") ?? "", body: await readBody(req, MAX_BODY) },
    { ...rt, origin: new URL(req.url).origin },
  );
  return json(out.status, out.body);
}

export async function enquiryFunction(req: Request, env: Env = process.env): Promise<Response> {
  const rt = runtime(env);
  if (!rt) return json(503, { error: "The CRM is not connected yet. Try again later." });
  try {
    let body: unknown = {};
    try { body = JSON.parse((await readBody(req, 64_000)) || "{}"); } catch { return json(400, { error: "The request could not be read." }); }
    const out = await handleEnquiry(rt.db, req.method, req.headers.get("authorization") ?? "", body);
    return json(out.status, out.body);
  } catch (e) {
    rt.log?.("enquiry failed", { message: e instanceof Error ? e.message : String(e) });
    return json(500, { error: "Something went wrong. Try again." });
  }
}

/** Called by Netlify's scheduler (no caller to answer); the result is written to system/maintenance for the Setup page. */
export async function nightlyFunction(_req?: Request, env: Env = process.env): Promise<Response> {
  const rt = runtime(env);
  if (!rt) return json(503, { error: "not connected" });
  try {
    return json(200, await cleanUp(rt.db));
  } catch (e) {
    rt.log?.("nightly clean-up failed", { message: e instanceof Error ? e.message : String(e) });
    return json(500, { error: "failed" });
  }
}
