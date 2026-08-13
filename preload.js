const { contextBridge, ipcRenderer } = require("electron");

// Nothing else in FieldScan Pro's renderer code needs real Node/OS access
// (no child processes) — it's mostly a plain browser app that talks to
// Google Apps Script over fetch(), including Photos (see photos.js), which
// syncs via the same Apps Script backend rather than a local server. The
// exceptions this bridge exposes are:
// - a flag the app can use to know it's running in the desktop shell (see
//   the service-worker/install-prompt guard in app.js),
// - a way to receive keyboard-shortcut/menu actions (New Project, Find,
//   Refresh Data) forwarded from the native app menu in main.js, and
// - a small file-attachments API (desktop-only project attachments, stored
//   as real files on disk, one folder per project) backed by ipcMain
//   handlers in main.js that validate every path before touching disk.
//   documents.js uses this (subfolder "Documents") for actual file
//   storage — only a filename+size list ever goes to the cloud sheet, for
//   mobile visibility.
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  onMenuAction: (callback) => {
    ipcRenderer.on("menu-action", (_event, action) => callback(action));
  },
  attachments: {
    list: (projectId, subfolder) =>
      ipcRenderer.invoke("attachments:list", projectId, subfolder),
    add: (projectId, subfolder, renameTo) =>
      ipcRenderer.invoke("attachments:add", projectId, subfolder, renameTo),
    addFromData: (projectId, subfolder, fileName, data) =>
      ipcRenderer.invoke("attachments:addFromData", projectId, subfolder, fileName, data),
    open: (filePath) => ipcRenderer.invoke("attachments:open", filePath),
    remove: (filePath) => ipcRenderer.invoke("attachments:remove", filePath),
    openFolder: (projectId, subfolder) =>
      ipcRenderer.invoke("attachments:openFolder", projectId, subfolder),
    // Fire-and-forget by design (not invoke) — this has to fire
    // synchronously from the renderer's dragstart handler for the OS drag
    // gesture to register correctly; the actual native drag then happens
    // in the main process via webContents.startDrag.
    startDrag: (filePath) => ipcRenderer.send("attachments:startDrag", filePath),
    revealInFolder: (filePath) => ipcRenderer.invoke("attachments:revealInFolder", filePath),
    shareViaEmail: (filePath, fileName) =>
      ipcRenderer.invoke("attachments:shareViaEmail", filePath, fileName),
    shareViaWhatsApp: (filePath, fileName) =>
      ipcRenderer.invoke("attachments:shareViaWhatsApp", filePath, fileName),
    readFileBytes: (filePath) => ipcRenderer.invoke("attachments:readFileBytes", filePath),
  },
  printReport: (html) => ipcRenderer.invoke("report:print", html),
});

// ---- Session token storage (email + password auth, replacing the old
// Google Sign-In loopback flow) ----
// The actual login HTTP request happens in the renderer (api.js) --
// these three just persist/retrieve/clear the resulting token via
// main.js's OS-keychain-backed safeStorage.
contextBridge.exposeInMainWorld("electronAuth", {
  // Called by the renderer right after a successful POST to /api/login.
  saveToken: (token) => ipcRenderer.invoke("auth:saveToken", token),

  // Returns { success, token } -- token is null if there's no saved
  // session, meaning the caller should show the sign-in form.
  getToken: () => ipcRenderer.invoke("auth:getToken"),

  // Clears the saved token (e.g. for a "Sign out" button).
  signOut: () => ipcRenderer.invoke("auth:signOut"),
});
