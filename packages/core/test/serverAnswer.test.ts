// The browser's reading of the server part's answers (D-51). IDs SA-1x are cited in docs/prd-traceability.md.
import { describe, expect, it } from "vitest";
import { readAnswer, ServerError, serverState } from "../src";

const caught = (fn: () => unknown): ServerError => { try { fn(); } catch (e) { return e as ServerError; } throw new Error("did not throw"); };

describe("answers from the server part", () => {
  it("SA-10 a 200 with a result is the result, including null and false", () => {
    expect(readAnswer(200, { result: { result: "exp_1" } })).toEqual({ result: "exp_1" });
    expect(readAnswer(200, { result: null })).toBeNull();
    expect(readAnswer(200, { result: false })).toBe(false);
  });

  it("SA-11 a refusal keeps its code, plain words, field messages and the sign-in-again flag", () => {
    const e = caught(() => readAnswer(400, { error: { code: "failed-precondition", message: "Enter an amount.", details: { fields: { amount: "Enter an amount above zero." } } } }));
    expect(e).toBeInstanceOf(ServerError);
    expect(e).toMatchObject({ code: "failed-precondition", message: "Enter an amount.", details: { fields: { amount: "Enter an amount above zero." } } });
    expect(caught(() => readAnswer(400, { error: { code: "failed-precondition", message: "Sign in again.", details: { reauth: true } } })).details?.reauth).toBe(true);
    expect(caught(() => readAnswer(401, { error: { code: "unauthenticated", message: "Sign in first." } })).code).toBe("unauthenticated");
  });

  it("SA-12 'no key yet' and 'not deployed' both read as not-found, which the screens show as 'not connected yet'", () => {
    expect(caught(() => readAnswer(503, { error: { code: "not-connected", message: "x" } })).code).toBe("not-found");
    expect(caught(() => readAnswer(404, null)).code).toBe("not-found");
  });

  it("SA-13 an answer that is not ours (a host error page, a time-out) is 'unavailable', never a silent success", () => {
    expect(caught(() => readAnswer(502, null)).code).toBe("unavailable");
    expect(caught(() => readAnswer(504, "<html>")).code).toBe("unavailable");
    expect(caught(() => readAnswer(200, { ok: true })).code).toBe("internal");
    expect(caught(() => readAnswer(200, null)).code).toBe("internal");
    expect(caught(() => readAnswer(403, null)).code).toBe("permission-denied");
  });

  it("SA-14 an unsigned check tells connected, no key yet, and not deployed apart", () => {
    expect(serverState(401, { error: { code: "unauthenticated", message: "Sign in first." } })).toBe("connected");
    expect(serverState(503, { error: { code: "not-connected", message: "x" } })).toBe("noKey");
    expect(serverState(404, null)).toBe("notDeployed");
    expect(serverState(200, null)).toBe("notDeployed");
    expect(serverState(null, null)).toBe("unknown");
    expect(serverState(502, null)).toBe("unknown");
  });
});
