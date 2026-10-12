// Run: node tests/drive.test.js
// Google Drive as the sync folder, tested against a pretend Google (sign-in, tokens and Drive files).
const nodeCrypto = require("crypto");
const { IDBFactory } = require("fake-indexeddb");
const P = require("../js/protocol.js");
const FSPDb = require("../js/db.js");
const { createSync } = require("../js/sync.js");
const { createFolderSync } = require("../js/foldersync.js");
const D = require("../js/drive.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");
const DT = "dt-bbbbbb";
const T0 = Date.UTC(2026, 9, 12, 10, 0, 0);
let tick = 0;
const REDIRECT = "https://example.github.io/FieldScan-Pro/";

// ---- a pretend Google ----
function fakeGoogle() {
  const g = {
    files: [], nextId: 1, calls: [], codes: {}, refreshOk: true, expiresIn: 3600, offline: false,
    tokensIssued: 0, folderCreates: 0, validAccess: new Set(),
    mtime: () => new Date(T0 + 1000 * ++tick).toISOString(),
    put(name, text, parent) { const f = { id: "f" + g.nextId++, name, text, parent: parent || g.folderId, mime: "text/plain", modifiedTime: g.mtime() }; g.files.push(f); return f; },
  };
  const json = (o, status = 200) => ({ ok: status < 400, status, statusText: "", json: async () => o, text: async () => JSON.stringify(o) });
  g.fetch = async (url, init = {}) => {
    if (g.offline) throw new TypeError("Failed to fetch");
    url = String(url); g.calls.push((init.method || "GET") + " " + url.split("?")[0]);
    const u = new URL(url);
    if (u.origin + u.pathname === D.TOKEN_URL) {
      const b = new URLSearchParams(init.body);
      if (b.get("client_id") !== "cid" || b.get("client_secret") !== "sec") return json({ error: "invalid_client" }, 401);
      if (b.get("grant_type") === "authorization_code") {
        const issued = g.codes[b.get("code")];
        if (!issued) return json({ error: "invalid_grant" }, 400);
        const challenge = nodeCrypto.createHash("sha256").update(b.get("code_verifier")).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        if (challenge !== issued.challenge) return json({ error: "invalid_grant", error_description: "bad verifier" }, 400);
        if (b.get("redirect_uri") !== REDIRECT) return json({ error: "redirect_uri_mismatch" }, 400);
      } else if (b.get("grant_type") === "refresh_token") {
        if (!g.refreshOk || b.get("refresh_token") !== "refresh-1") return json({ error: "invalid_grant" }, 400);
      }
      g.tokensIssued++;
      const tok = "access-" + g.tokensIssued; g.validAccess.add(tok);
      return json({ access_token: tok, expires_in: g.expiresIn, ...(b.get("grant_type") === "authorization_code" ? { refresh_token: "refresh-1" } : {}) });
    }
    if (u.origin + u.pathname === "https://oauth2.googleapis.com/revoke") { g.revoked = true; return json({}); }
    const auth = (init.headers || {}).Authorization || "";
    if (!g.validAccess.has(auth.replace("Bearer ", ""))) return json({ error: "unauthorized" }, 401);
    const path = u.pathname;
    if (path === "/drive/v3/files" && (init.method || "GET") === "GET") {
      const q = u.searchParams.get("q");
      let list = g.files;
      let m;
      if ((m = /^name='(.*)' and mimeType='application\/vnd.google-apps.folder' and 'root' in parents/.exec(q))) list = g.files.filter((f) => f.mime === "folder" && f.name === m[1].replace(/\\'/g, "'"));
      else if ((m = /^'(.*)' in parents and trashed=false and mimeType!=/.exec(q)) ) list = g.files.filter((f) => f.parent === m[1] && f.mime !== "folder");
      else if ((m = /^name='(.*)' and '(.*)' in parents/.exec(q))) list = g.files.filter((f) => f.name === m[1].replace(/\\'/g, "'") && f.parent === m[2]);
      return json({ files: list.map((f) => ({ id: f.id, name: f.name, size: String(Buffer.byteLength(f.text || "")), modifiedTime: f.modifiedTime })) });
    }
    if (path === "/drive/v3/files" && init.method === "POST") {
      const body = JSON.parse(init.body); g.folderCreates++;
      const f = { id: "f" + g.nextId++, name: body.name, mime: "folder", parent: "root", text: "", modifiedTime: g.mtime() }; g.files.push(f); g.folderId = f.id;
      return json({ id: f.id });
    }
    let m;
    if ((m = /^\/drive\/v3\/files\/(.+)$/.exec(path))) {
      const f = g.files.find((x) => x.id === m[1]);
      if (!f) return json({ error: "nf" }, 404);
      if (init.method === "DELETE") { g.files = g.files.filter((x) => x !== f); return json({}, 204); }
      if (u.searchParams.get("alt") === "media") return { ok: true, status: 200, statusText: "", text: async () => f.text };
    }
    if ((m = /^\/upload\/drive\/v3\/files(?:\/(.+))?$/.exec(path))) {
      const parts = init.body.split(/--fsp[a-z0-9]+/).filter((p) => /Content-Type/.test(p));
      const meta = JSON.parse(parts[0].split("\r\n\r\n")[1].replace(/\r\n$/, ""));
      const text = parts[1].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
      if (m[1]) { const f = g.files.find((x) => x.id === m[1]); f.text = text; f.modifiedTime = g.mtime(); return json({ id: f.id, name: f.name, size: String(text.length), modifiedTime: f.modifiedTime }); }
      const f = g.put(meta.name, text, meta.parents[0]);
      return json({ id: f.id, name: f.name, size: String(text.length), modifiedTime: f.modifiedTime });
    }
    return json({ error: "unhandled " + url }, 500);
  };
  return g;
}

async function setup(g) {
  const db = await FSPDb.open(new IDBFactory());
  const sync = createSync({ db, protocol: P, download: async () => {}, now: () => new Date(T0 + 1000 * ++tick), uuid: () => "rec-" + ++tick });
  let navigatedTo = null;
  const auth = D.createDriveAuth({ kv: { get: db.kvGet, set: db.kvSet }, fetchImpl: g.fetch, cryptoImpl: nodeCrypto.webcrypto, now: () => Date.now() + (setup.skew || 0), redirectUri: () => REDIRECT });
  const handle = D.createDriveFolder({ auth, fetchImpl: g.fetch, onNeedSignIn: async () => { navigatedTo = await auth.beginConnect(); } });
  const fs = createFolderSync({ sync, db, protocol: P, now: () => new Date(T0 + 1000 * ++tick), metaKey: "driveSyncMeta", handleStore: { get: async () => ((await auth.status()).active ? handle : null), set: async () => {}, clear: async () => {} } });
  return { db, sync, auth, handle, fs, nav: () => navigatedTo };
}

// the sign-in, played through as Google would
async function signIn(g, a) {
  await a.auth.saveSettings({ clientId: "cid", clientSecret: "sec", folderName: "" });
  const url = new URL(await a.auth.beginConnect());
  const code = "code-" + (++tick);
  g.codes[code] = { challenge: url.searchParams.get("code_challenge") };
  return { url, code, state: url.searchParams.get("state") };
}

(async () => {
  section("Sign-in");
  const g = fakeGoogle();
  const a = await setup(g);
  {
    let s = await a.auth.status();
    check(!s.configured && !s.connected && !s.active && s.folderName === "FieldScanPro Sync", "starts unconfigured with the default folder name");
    let threw = false; try { await a.auth.beginConnect(); } catch (e) { threw = /Client ID/.test(e.message); }
    check(threw, "connecting without a Client ID is refused with a clear message");
    const { url, code, state } = await signIn(g, a);
    check(url.origin + url.pathname === D.AUTH_URL, "goes to Google's sign-in address");
    check(url.searchParams.get("client_id") === "cid" && url.searchParams.get("redirect_uri") === REDIRECT, "carries the client and the app's own address");
    check(url.searchParams.get("scope") === D.SCOPE && url.searchParams.get("access_type") === "offline" && url.searchParams.get("prompt") === "consent", "asks for Drive and lasting access");
    check(url.searchParams.get("code_challenge_method") === "S256" && url.searchParams.get("response_type") === "code", "uses PKCE with a code");
    let r = await a.auth.completeFromQuery("?foo=1");
    check(r.handled === false, "an unrelated address is ignored");
    r = await a.auth.completeFromQuery(`?code=${code}&state=WRONG`);
    check(r.handled === false && !(await a.auth.status()).connected, "a return with the wrong state is ignored");
    r = await a.auth.completeFromQuery(`?code=${code}&state=${state}`);
    check(r.handled && r.ok, "the right return completes: " + JSON.stringify(r));
    s = await a.auth.status();
    check(s.connected && s.active && s.configured, "connected and active");
    check((await a.auth.load()).pending === undefined, "the one-time secrets are discarded");
    const b = await signIn(g, a);
    r = await a.auth.completeFromQuery(`?error=access_denied&state=${b.state}`);
    check(r.handled && !r.ok && /cancelled/.test(r.error), "cancelling at Google is explained");
    console.log("Confirmed: PKCE sign-in, wrong state ignored, cancel explained");
  }

  section("Tokens renew quietly");
  {
    const t1 = await a.auth.getToken();
    const issued = g.tokensIssued;
    check(await a.auth.getToken() === t1 && g.tokensIssued === issued, "a fresh token is reused");
    setup.skew = 3600 * 1000; // an hour later
    const t2 = await a.auth.getToken();
    check(t2 !== t1 && g.tokensIssued === issued + 1, "an expired token is renewed without asking the person");
    check((await a.handle.queryPermission()) === "granted", "permission reads as granted");
    g.offline = true; setup.skew = 7200 * 1000;
    check((await a.handle.queryPermission()) === "granted", "being offline is not a lost sign-in");
    g.offline = false;
    g.refreshOk = false; setup.skew = 10800 * 1000;
    check((await a.handle.queryPermission()) === "prompt", "a revoked sign-in is noticed");
    check(!(await a.auth.status()).connected && (await a.auth.status()).active, "and it needs a new sign-in but stays on Drive");
    await a.handle.requestPermission();
    check(a.nav() && /accounts\.google\.com/.test(a.nav()), "asking again sends the person to Google's sign-in");
    g.refreshOk = true; setup.skew = 0;
    const b = await signIn(g, a); await a.auth.completeFromQuery(`?code=${b.code}&state=${b.state}`);
    check((await a.handle.queryPermission()) === "granted", "signing in again restores it");
    console.log("Confirmed: silent renewal, offline tolerated, revoked sign-in handled");
  }

  section("The Drive folder");
  {
    const files = []; for await (const [n] of a.handle.entries()) files.push(n);
    check(files.length === 0 && g.folderCreates === 1, "the folder is created in My Drive once");
    for await (const x of a.handle.entries()) void x;
    check(g.folderCreates === 1, "and found again, not created twice");
    console.log("Confirmed: folder found or created");
  }

  section("A full sync through Drive");
  {
    const rec = await a.sync.createRecord({ type: "ping", data: { note: "from phone" } });
    const env = { fsp: 1, type: "ping", id: "rec-d1", vv: { [DT]: 1 }, updatedAt: "2026-10-12T11:00:00.000Z", deleted: false, origin: DT, data: { note: "hi" } };
    g.put("fsp-bundle-" + DT + "-20261012-aaaa.json", JSON.stringify(P.makeBundle({ origin: DT, envelopes: [env], acks: [], now: new Date(T0) })));
    g.put("notes.txt", "not ours");
    let st = await a.fs.status();
    check(st.state === "granted" && st.name === "FieldScanPro Sync", "status shows Drive ready");
    const r = await a.fs.syncNow({ auto: true });
    check(r.ok && r.applied === 1, "the desktop's record arrives through Drive: " + JSON.stringify(r));
    check(r.sent === 1 && r.filename, "the phone's record is written to Drive");
    const dev = await a.sync.getDeviceId();
    const mine = g.files.filter((f) => f.name.indexOf("fsp-bundle-" + dev) === 0);
    check(mine.length === 1 && JSON.parse(mine[0].text).envelopes.length === 1, "one bundle of ours in the Drive folder, carrying the record");
    check(g.files.some((f) => f.name === "notes.txt"), "other files are left alone");
    check(a.sync.recordState(await a.db.get("records", rec.id)) === "sent", "marked sent");
    const before = g.files.length;
    const r2 = await a.fs.syncNow({ auto: true });
    check(r2.ok && r2.read === 0 && r2.skippedUnchanged >= 1 && r2.sent === 0 && g.files.length === before, "a second sync reads and writes nothing: " + JSON.stringify(r2));
    // the desktop confirms; the phone tidies its file away
    g.put("fsp-bundle-" + DT + "-20261012-bbbb.json", JSON.stringify(P.makeBundle({ origin: DT, envelopes: [], acks: [{ id: rec.id, vv: (await a.db.get("records", rec.id)).vv }], now: new Date(T0) })));
    const r3 = await a.fs.syncNow({ auto: true });
    check(r3.ok && r3.acked === 1, "the desktop's confirmation arrives");
    check(a.sync.recordState(await a.db.get("records", rec.id)) === "delivered", "delivered");
    check(!g.files.some((f) => f.name.indexOf("fsp-bundle-" + dev) === 0 && JSON.parse(f.text).envelopes.length), "the phone's confirmed file is removed from Drive");
    console.log("Confirmed: receive, send, skip unchanged, confirm, tidy up - all through Drive");
  }

  section("Problems are reported plainly");
  {
    g.offline = true;
    const r = await a.fs.syncNow({ auto: true });
    check(!r.ok && r.error, "offline: a clear failure, nothing lost: " + JSON.stringify(r));
    g.offline = false;
    const ok = await a.fs.syncNow({ auto: true });
    check(ok.ok, "and it works again afterwards");
    console.log("Confirmed: offline fails safely and recovers");
  }

  section("Disconnecting");
  {
    await a.auth.disconnect();
    const s = await a.auth.status();
    check(!s.connected && !s.active && g.revoked, "signed out and access revoked at Google");
    check((await a.fs.status()).state === "none", "the sync engine no longer uses Drive");
    check(s.clientId === "cid", "the Client ID is kept for reconnecting");
    console.log("Confirmed: disconnect");
  }

  console.log("\n✅ ALL GOOGLE DRIVE TESTS PASSED");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
