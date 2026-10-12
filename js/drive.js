/**
 * Google Drive as the sync folder.
 *
 * Chrome on Android forgets its permission to use a local folder after a few minutes in the background. Google Drive
 * has no such limit, so here the phone talks to a Drive folder directly and the desktop reads the same folder through
 * Google Drive for desktop. Nothing else about syncing changes: this module only looks like a folder (the same few
 * calls as Chrome's folder handle), and foldersync.js runs on top of it unchanged.
 *
 * Sign-in is Google's standard "authorization code with PKCE" flow. The person creates their own Google client once
 * (Sync screen explains how), so no key of mine is built into the app and nothing passes through any other server.
 * The sign-in lasts: a refresh token renews the short-lived access token quietly, with no tap.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FSPDrive = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CFG_KEY = "driveConfig";
  const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const TOKEN_URL = "https://oauth2.googleapis.com/token";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const SCOPE = "https://www.googleapis.com/auth/drive";
  const DEFAULT_FOLDER = "FieldScanPro Sync";

  const b64url = (bytes) => {
    let s = ""; bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const form = (o) => Object.keys(o).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(o[k])}`).join("&");
  const qEsc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  function driveError(res, what) {
    const e = new Error(`Google Drive ${what} (${res.status}${res.statusText ? " " + res.statusText : ""})`);
    e.name = res.status === 404 ? "NotFoundError" : "DriveError";
    e.status = res.status;
    return e;
  }

  /**
   * Sign-in and tokens. `kv` is the app's small key/value store; `fetchImpl`, `cryptoImpl` and `now` can be replaced for tests.
   */
  function createDriveAuth({ kv, fetchImpl, cryptoImpl, now, redirectUri }) {
    const doFetch = (...a) => (fetchImpl || fetch)(...a);
    const cr = cryptoImpl || (typeof crypto !== "undefined" ? crypto : null);
    const clock = now || (() => Date.now());
    let access = null; // { token, expiresAt }
    let refreshing = null;

    const load = async () => (await kv.get(CFG_KEY, null)) || {};
    const save = (c) => kv.set(CFG_KEY, c);

    async function status() {
      const c = await load();
      return {
        clientId: c.clientId || "", clientSecret: c.clientSecret || "", folderName: c.folderName || DEFAULT_FOLDER,
        configured: !!(c.clientId && c.clientSecret), connected: !!c.refreshToken, active: !!c.useDrive, email: c.email || "", redirectUri: redirectUri(),
      };
    }

    /** Saves the three settings the person types in. */
    async function saveSettings({ clientId, clientSecret, folderName }) {
      const c = await load();
      const changed = (clientId || "").trim() !== (c.clientId || "");
      c.clientId = (clientId || "").trim(); c.clientSecret = (clientSecret || "").trim();
      c.folderName = (folderName || "").trim() || DEFAULT_FOLDER;
      if (changed) { delete c.refreshToken; access = null; }
      await save(c);
    }

    /** The Google sign-in address to go to. The one-time secrets for this attempt are kept for when Google sends the person back. */
    async function beginConnect() {
      const c = await load();
      if (!c.clientId || !c.clientSecret) throw new Error("Enter the Client ID and Client secret first.");
      const rnd = new Uint8Array(48); cr.getRandomValues(rnd);
      const verifier = b64url(rnd);
      const state = b64url(cr.getRandomValues(new Uint8Array(16)));
      const challenge = b64url(new Uint8Array(await cr.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      c.pending = { verifier, state, at: clock() };
      await save(c);
      return `${AUTH_URL}?${form({
        client_id: c.clientId, redirect_uri: redirectUri(), response_type: "code", scope: SCOPE,
        access_type: "offline", prompt: "consent", include_granted_scopes: "true",
        code_challenge: challenge, code_challenge_method: "S256", state,
      })}`;
    }

    async function tokenCall(body) {
      const res = await doFetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(body) });
      let json = {};
      try { json = await res.json(); } catch (e) { /* not JSON */ }
      return { ok: res.ok, status: res.status, json };
    }

    /** Called when Google sends the person back to the app with ?code=...&state=... */
    async function completeFromQuery(search) {
      const q = new URLSearchParams(search || "");
      if (!q.get("state") && !q.get("code") && !q.get("error")) return { handled: false };
      const c = await load();
      const pend = c.pending;
      if (!pend || q.get("state") !== pend.state) return { handled: false };
      delete c.pending; await save(c);
      if (q.get("error")) return { handled: true, ok: false, error: q.get("error") === "access_denied" ? "Google sign-in was cancelled." : `Google refused the sign-in (${q.get("error")}).` };
      const r = await tokenCall({
        code: q.get("code"), client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(),
        grant_type: "authorization_code", code_verifier: pend.verifier,
      });
      if (!r.ok || !r.json.access_token) return { handled: true, ok: false, error: `Google would not finish the sign-in (${r.json.error_description || r.json.error || r.status}). Check the Client ID, Client secret and redirect address.` };
      if (!r.json.refresh_token) return { handled: true, ok: false, error: "Google did not give lasting access. Remove the app at myaccount.google.com/permissions and connect again." };
      const c2 = await load();
      c2.refreshToken = r.json.refresh_token; c2.useDrive = true;
      await save(c2);
      access = { token: r.json.access_token, expiresAt: clock() + (r.json.expires_in || 3600) * 1000 };
      return { handled: true, ok: true };
    }

    /** A valid access token, renewed quietly when it is about to run out. */
    async function getToken() {
      if (access && access.expiresAt - clock() > 60 * 1000) return access.token;
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const c = await load();
        if (!c.refreshToken) { const e = new Error("Google Drive is not connected."); e.name = "NotConnected"; throw e; }
        const r = await tokenCall({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" });
        if (!r.ok || !r.json.access_token) {
          if (r.json.error === "invalid_grant") { // revoked, or Google's test-mode seven-day limit
            const c2 = await load(); delete c2.refreshToken; await save(c2); access = null;
            const e = new Error("Google Drive needs you to sign in again."); e.name = "NotConnected"; throw e;
          }
          const e = new Error(`Could not reach Google to renew the sign-in (${r.json.error || r.status}).`); e.name = "NetworkError"; throw e;
        }
        access = { token: r.json.access_token, expiresAt: clock() + (r.json.expires_in || 3600) * 1000 };
        return access.token;
      })().finally(() => { refreshing = null; });
      return refreshing;
    }

    async function disconnect() {
      const c = await load();
      const t = c.refreshToken;
      delete c.refreshToken; delete c.pending; delete c.folderId; c.useDrive = false; access = null;
      await save(c);
      if (t) { try { await doFetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }); } catch (e) { /* signing out locally is what matters */ } }
    }

    return { status, saveSettings, beginConnect, completeFromQuery, getToken, disconnect, load, save };
  }

  /**
   * A Drive folder that behaves like the folder handle foldersync.js expects: entries(), getFileHandle(), removeEntry(),
   * queryPermission(), requestPermission(). `onNeedSignIn` is called if Google must be visited again (it navigates away).
   */
  function createDriveFolder({ auth, fetchImpl, onNeedSignIn }) {
    const doFetch = (...a) => (fetchImpl || fetch)(...a);
    let folderId = null, folderName = DEFAULT_FOLDER;

    async function call(url, init, what) {
      const token = await auth.getToken();
      const res = await doFetch(url, { ...(init || {}), headers: { ...((init && init.headers) || {}), Authorization: `Bearer ${token}` } });
      if (!res.ok) throw driveError(res, what);
      return res;
    }

    /** Finds the folder by name in My Drive, or makes it. */
    async function ensureFolder() {
      const c = await auth.load();
      folderName = c.folderName || DEFAULT_FOLDER;
      if (c.folderId && c.folderIdName === folderName) { folderId = c.folderId; return folderId; }
      const q = `name='${qEsc(folderName)}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
      const found = await (await call(`${API}/files?${form({ q, fields: "files(id,name)", pageSize: 10 })}`, null, "could not look for the folder")).json();
      let id = found.files && found.files[0] && found.files[0].id;
      if (!id) {
        const made = await (await call(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder" }) }, "could not create the folder")).json();
        id = made.id;
      }
      const c2 = await auth.load(); c2.folderId = id; c2.folderIdName = folderName; await auth.save(c2);
      folderId = id;
      return id;
    }

    async function listAll() {
      const id = await ensureFolder();
      const out = []; let pageToken = "";
      do {
        const q = `'${id}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
        const j = await (await call(`${API}/files?${form({ q, fields: "nextPageToken,files(id,name,size,modifiedTime)", pageSize: 1000, ...(pageToken ? { pageToken } : {}) })}`, null, "could not list the folder")).json();
        out.push(...(j.files || []));
        pageToken = j.nextPageToken || "";
      } while (pageToken);
      return out;
    }

    async function findByName(name) {
      const id = await ensureFolder();
      const q = `name='${qEsc(name)}' and '${id}' in parents and trashed=false`;
      const j = await (await call(`${API}/files?${form({ q, fields: "files(id,name,size,modifiedTime)", pageSize: 10 })}`, null, "could not look for a file")).json();
      return j.files || [];
    }

    const fileObject = (meta) => ({
      name: meta.name, size: Number(meta.size || 0), lastModified: Date.parse(meta.modifiedTime) || 0,
      text: async () => (await call(`${API}/files/${meta.id}?alt=media`, null, `could not read ${meta.name}`)).text(),
    });

    const entryFor = (meta) => ({ kind: "file", name: meta.name, getFile: async () => fileObject(meta) });

    async function upload(name, text) {
      const id = await ensureFolder();
      const existing = (await findByName(name))[0];
      const boundary = "fsp" + Math.random().toString(36).slice(2);
      const metaPart = existing ? { name } : { name, parents: [id] };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metaPart)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
      const url = existing ? `${UPLOAD}/files/${existing.id}?uploadType=multipart&fields=id,name,size,modifiedTime` : `${UPLOAD}/files?uploadType=multipart&fields=id,name,size,modifiedTime`;
      const res = await call(url, { method: existing ? "PATCH" : "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body }, `could not save ${name}`);
      return res.json();
    }

    const handle = {
      get name() { return folderName; },
      kind: "directory",
      isDrive: true,
      /** "granted" while the sign-in can be renewed; "prompt" when Google must be visited again. */
      queryPermission: async () => {
        const s = await auth.status();
        if (!s.connected) return "prompt";
        try { await auth.getToken(); return "granted"; }
        catch (e) { return e.name === "NotConnected" ? "prompt" : "granted"; } // offline is not a lost sign-in; the sync itself will report it
      },
      requestPermission: async () => { if (onNeedSignIn) await onNeedSignIn(); return "prompt"; },
      entries: async function* () { for (const m of await listAll()) yield [m.name, entryFor(m)]; },
      getFileHandle: async (name, opts) => {
        let found = (await findByName(name))[0];
        if (!found && !(opts && opts.create)) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
        return {
          getFile: async () => {
            const m = (await findByName(name))[0] || found;
            if (!m) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
            return fileObject(m);
          },
          createWritable: async () => {
            let buf = "";
            return { write: async (t) => { buf += t; }, close: async () => { found = await upload(name, buf); } };
          },
        };
      },
      removeEntry: async (name) => {
        const all = await findByName(name);
        if (!all.length) throw Object.assign(new Error("not found"), { name: "NotFoundError" });
        for (const m of all) await call(`${API}/files/${m.id}`, { method: "DELETE" }, `could not remove ${name}`);
      },
    };
    return handle;
  }

  return { createDriveAuth, createDriveFolder, CFG_KEY, DEFAULT_FOLDER, SCOPE, AUTH_URL, TOKEN_URL };
});
