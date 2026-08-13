const {
  app,
  BrowserWindow,
  shell,
  Menu,
  session,
  ipcMain,
  dialog,
  nativeImage,
  safeStorage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

// Avoid noisy Chromium/EGL GPU warnings on some macOS setups and use a
// steadier software rendering path for this UI.
app.disableHardwareAcceleration();

// ---- Project attachments (desktop-only) ----
// Files live under Documents/FieldScan Pro Attachments/<projectId>/, one
// real folder per project, so users can find/back them up themselves
// outside the app if they want to.
function getAttachmentsRoot() {
  return path.join(app.getPath("documents"), "FieldScan Pro Attachments");
}

function getProjectAttachmentsDir(projectId, subfolder) {
  // Project IDs look like "PRJ/25/003" — flatten to a single safe folder
  // name instead of letting "/" create nested directories.
  const safeId = String(projectId).replace(/[\\/:*?"<>|]+/g, "-");
  if (subfolder) {
    const safeSubfolder = String(subfolder).replace(/[\\/:*?"<>|]+/g, "-");
    return path.join(getAttachmentsRoot(), safeId, safeSubfolder);
  }
  return path.join(getAttachmentsRoot(), safeId);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---- Session auth (email + password, replacing the old Google Sign-In
// loopback flow) ----
//
// The session token is a bearer credential (same sensitivity as the old
// Google refresh token), so it's encrypted at rest via Electron's
// OS-keychain-backed safeStorage, same pattern as before -- just a lot
// less code, since there's no exchange/refresh dance anymore. The token
// itself is valid for 30 days (see the backend's SESSION_TTL_SECONDS);
// there's no silent-refresh path needed, the user just signs in again
// after it expires (or on every launch, per clearStoredToken() below).
//
// The actual login HTTP request happens in the RENDERER (api.js), not
// here -- config.js's GAS_URL and fetch/localStorage are browser-only,
// not available in the main process without duplicating config.js's
// logic. main.js's only job is securely storing whatever token the
// renderer already obtained.
function tokenPath() {
  return path.join(app.getPath("userData"), "session_token.enc");
}
function saveToken(token) {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("safeStorage encryption unavailable on this OS -- session not persisted; user will need to sign in again next launch.");
    return;
  }
  fs.writeFileSync(tokenPath(), safeStorage.encryptString(token));
}
function loadToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(tokenPath());
    return safeStorage.decryptString(encrypted);
  } catch (e) {
    return null; // no token saved yet, or couldn't decrypt (e.g. moved to a different machine)
  }
}
function clearStoredToken() {
  try { fs.unlinkSync(tokenPath()); } catch (e) {}
}

// Guard against a compromised renderer asking us to open/delete an
// arbitrary path — only ever act on paths inside our own attachments root.
function isSafeAttachmentPath(filePath) {
  const root = path.resolve(getAttachmentsRoot()) + path.sep;
  const resolved = path.resolve(filePath) + path.sep;
  return resolved.startsWith(root);
}

function buildPrintableReportHtml(reportHtml) {
  const stylePath = path.join(__dirname, "style.css");
  let css = "";
  try {
    css = fs.readFileSync(stylePath, "utf8");
  } catch (e) {
    console.warn("Could not read print CSS", e);
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="file://${__dirname.replace(/\\/g, "/")}/">
  <title>FieldScan Report</title>
  <style>
    ${css}
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #000;
      font-family: Arial, sans-serif;
    }
    #report-print-container {
      display: block !important;
      width: 100%;
      background: #fff;
    }
    body * {
      visibility: visible !important;
    }
  </style>
</head>
<body>
  <div id="report-print-container">${reportHtml || ""}</div>
</body>
</html>`;
}

// Keep global references so the windows aren't garbage-collected.
let mainWindow;
let splashWindow;

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 360,
    height: 420,
    frame: false,
    resizable: false,
    movable: true,
    show: true,
    center: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile("splash.html");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    // Now that the desktop shell has a real sidebar + multi-column grid
    // layout (see the .electron-app styles in style.css and buildDesktopShell
    // in app.js), the window can go back to a normal desktop size.
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon: path.join(__dirname, "icon-512.png"),
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile("index.html");

  // Swap the splash screen for the real window once content has actually
  // rendered, not just once Electron created the window.
  mainWindow.webContents.once("did-finish-load", () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  // The app's <base target="_blank"> makes normal links (and window.open
  // calls) try to open a new browser window. Send those to the user's
  // real default browser instead of spawning a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Same idea for in-page navigations to an external origin (e.g. clicking
  // a plain <a href="https://..."> without target="_blank").
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isLocalFile = url.startsWith("file://");
    if (!isLocalFile) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// A simple menu — the default Electron menu shows a lot of dev-oriented
// items (Reload, Toggle DevTools, etc). Trim it down for a production feel.
function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Project",
          accelerator: "CmdOrCtrl+N",
          click: () =>
            mainWindow &&
            mainWindow.webContents.send("menu-action", "new-project"),
        },
        { type: "separator" },
        {
          label: "Find",
          accelerator: "CmdOrCtrl+F",
          click: () =>
            mainWindow &&
            mainWindow.webContents.send("menu-action", "focus-search"),
        },
        {
          label: "Refresh Data",
          accelerator: "CmdOrCtrl+R",
          click: () =>
            mainWindow &&
            mainWindow.webContents.send("menu-action", "refresh"),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        // Plain "reload" (Cmd+R) is intentionally not here — that shortcut
        // now triggers the app's own Refresh Data action above instead.
        // Hard reload is still available for debugging under Cmd+Shift+R.
        { role: "forceReload", label: "Reload Window" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Toggle Developer Tools" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Email auto-attach (macOS Mail.app / Windows Outlook) ----
// Neither platform has a public URL scheme for this (mailto: intentionally
// doesn't support attachments — a webpage silently attaching arbitrary
// files to an outgoing email would be a real security problem). What DOES
// exist: macOS Mail can be driven via AppleScript (built into every Mac),
// and Windows Outlook can be driven via COM automation (only works if
// classic Outlook is installed and configured as the default). Both open
// a compose window ready to send, they don't send anything themselves.
// Anywhere else (Linux, no Outlook, automation fails for any reason) falls
// back to the older reveal-in-folder + mailto: approach.

function escapeAppleScriptString(str) {
  return String(str || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shareEmailViaAppleScript(filePaths, subject, body) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  return new Promise((resolve) => {
    const attachLines = paths
      .map((p) => `make new attachment with properties {file name:POSIX file "${escapeAppleScriptString(p)}"} at after the last paragraph`)
      .join("\n          ");
    const script = `
      tell application "Mail"
        set newMessage to make new outgoing message with properties {subject:"${escapeAppleScriptString(subject)}", content:"${escapeAppleScriptString(body)}", visible:true}
        tell newMessage
          ${attachLines}
        end tell
        activate
      end tell
    `;
    execFile("osascript", ["-e", script], (error) => {
      resolve(!error);
    });
  });
}

let outlookScriptPath = null;
function getOutlookScriptPath() {
  if (!outlookScriptPath) {
    outlookScriptPath = path.join(os.tmpdir(), "fieldscan-outlook-attach.ps1");
    const script = `
param([string[]]$FilePaths, [string]$Subject, [string]$Body)
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.Subject = $Subject
$mail.Body = $Body
foreach ($f in $FilePaths) {
  $mail.Attachments.Add($f)
}
$mail.Display()
`;
    try {
      fs.writeFileSync(outlookScriptPath, script, "utf8");
    } catch (e) {
      console.error("Could not write Outlook automation script", e);
      outlookScriptPath = null;
    }
  }
  return outlookScriptPath;
}

function shareEmailViaOutlook(filePaths, subject, body) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  return new Promise((resolve) => {
    const scriptPath = getOutlookScriptPath();
    if (!scriptPath) return resolve(false);
    const args = [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
      "-FilePaths", ...paths.flatMap((p) => [p]), // PowerShell array param: space-separated values
      "-Subject", subject, "-Body", body,
    ];
    execFile("powershell.exe", args, { timeout: 15000 }, (error) => resolve(!error));
  });
}

async function shareEmailWithAttachment(filePaths, fileNames) {
  const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
  const names = Array.isArray(fileNames) ? fileNames : [fileNames];
  const subject = names.length > 1 ? `${names.length} files` : (names[0] || "Document");
  const body = names.length > 1
    ? `Please find the following ${names.length} files attached:\n${names.map((n) => `• ${n}`).join("\n")}`
    : `Please find "${names[0]}" attached.`;
  let attached = false;
  if (process.platform === "darwin") {
    attached = await shareEmailViaAppleScript(paths, subject, body);
  } else if (process.platform === "win32") {
    attached = await shareEmailViaOutlook(paths, subject, body);
  }
  if (!attached) {
    // Fallback: reveal the first file and open a blank compose window —
    // multiple files can't all be "revealed" at once in Finder/Explorer,
    // so this covers the single-file case cleanly and still gets a
    // multi-file share unstuck (the folder itself gets revealed instead).
    if (paths.length === 1) shell.showItemInFolder(paths[0]);
    else shell.showItemInFolder(paths[0]); // selects it, but the folder itself now has every file visible
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(`${body}\n\n(The file location has been revealed in your file explorer — drag the file(s) in to attach them.)`);
    shell.openExternal(`mailto:?subject=${encodedSubject}&body=${encodedBody}`);
  }
  return attached;
}

app.whenReady().then(() => {
  // By design: sign-in is required every time the app is launched, not
  // silently reused across restarts via the saved session token. Clearing
  // it here (rather than never saving one at all) still lets a single
  // running session stay signed in without re-prompting mid-use -- it
  // only resets at the START of each new launch.
  clearStoredToken();

  buildMenu();

  ipcMain.handle("report:print", async (event, reportHtml) => {
    if (!reportHtml || !String(reportHtml).trim()) {
      return { success: false, error: "No report content to print." };
    }
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const printWindow = new BrowserWindow({
      width: 900,
      height: 1100,
      show: false,
      parent: parent || undefined,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    try {
      const html = buildPrintableReportHtml(String(reportHtml));
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
      const result = await new Promise((resolve) => {
        printWindow.webContents.print(
          {},
          (success, failureReason) => resolve({ success, error: failureReason || "" }),
        );
      });
      return result;
    } catch (e) {
      console.error("report:print failed", e);
      return { success: false, error: e.message || "Print failed." };
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close();
    }
  });

  let dragIcon = null;
  function getDragIcon() {
    // startDrag requires an icon; reuse the app icon at a small size
    // rather than shipping a separate drag-specific asset. Falls back to
    // an empty image if it can't load for some reason, rather than
    // throwing and breaking the drag.
    if (!dragIcon) {
      try {
        dragIcon = nativeImage
          .createFromPath(path.join(__dirname, "icon-512.png"))
          .resize({ width: 32, height: 32 });
      } catch (e) {
        console.error("Could not load drag icon", e);
        dragIcon = nativeImage.createEmpty();
      }
    }
    return dragIcon;
  }

  // Native OS drag-out — lets a document card be dragged from the app
  // window onto Finder/Explorer, an email client, Slack, etc. This has to
  // happen in the main process (webContents.startDrag), not the renderer;
  // the renderer just tells us a drag started (see documents.js's
  // ondragstart handler) and which local file it was for.
  ipcMain.on("attachments:startDrag", (event, filePath) => {
    if (!isSafeAttachmentPath(filePath)) return;
    try {
      event.sender.startDrag({ file: filePath, icon: getDragIcon() });
    } catch (e) {
      console.error("attachments:startDrag failed", e);
    }
  });

  // Neither WhatsApp nor email has a public URL-scheme API for attaching
  // a local file — every app (native ones included) requires a person to
  // drag the file in themselves. So "sharing" here means: prefill the
  // app with a message, and reveal the file in Finder/Explorer (already
  // selected/highlighted) so attaching it is one drag away, not a search.
  ipcMain.handle("attachments:readFileBytes", (event, filePath) => {
    if (!isSafeAttachmentPath(filePath)) return null;
    try {
      return fs.readFileSync(filePath).toString("base64");
    } catch (e) {
      console.error("attachments:readFileBytes error", e);
      return null;
    }
  });

  ipcMain.handle("attachments:revealInFolder", (event, filePath) => {
    if (!isSafeAttachmentPath(filePath)) return false;
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("attachments:shareViaEmail", async (event, filePathOrPaths, fileNameOrNames) => {
    const paths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    if (!paths.length || !paths.every(isSafeAttachmentPath)) return false;
    const attached = await shareEmailWithAttachment(filePathOrPaths, fileNameOrNames);
    return { success: true, attached };
  });

  ipcMain.handle("attachments:shareViaWhatsApp", (event, filePathOrPaths, fileNameOrNames) => {
    const paths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    const names = Array.isArray(fileNameOrNames) ? fileNameOrNames : [fileNameOrNames];
    if (!paths.length || !paths.every(isSafeAttachmentPath)) return false;
    shell.showItemInFolder(paths[0]);
    const text = encodeURIComponent(
      names.length > 1
        ? `Sharing ${names.length} files — they've been revealed in your file explorer, drag them into the chat to attach them.`
        : `Sharing "${names[0]}" — it's been revealed in your file explorer, drag it into the chat to attach it.`,
    );
    shell.openExternal(`https://wa.me/?text=${text}`);
    return true;
  });

  ipcMain.handle("attachments:list", (event, projectId, subfolder) => {
    try {
      const dir = getProjectAttachmentsDir(projectId, subfolder);
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((name) => !name.startsWith("."))
        .map((name) => {
          const full = path.join(dir, name);
          const stat = fs.statSync(full);
          return { name, path: full, size: stat.size, modified: stat.mtimeMs, isFile: stat.isFile() };
        })
        .filter((entry) => entry.isFile)
        .map(({ isFile, ...rest }) => rest)
        .sort((a, b) => b.modified - a.modified);
    } catch (e) {
      console.error("attachments:list error", e);
      return [];
    }
  });

  ipcMain.handle("attachments:add", async (event, projectId, subfolder, renameTo) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      title: "Select files to attach",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths.length) return [];

    const dir = getProjectAttachmentsDir(projectId, subfolder);
    ensureDir(dir);
    const added = [];
    const safeRename = renameTo
      ? String(renameTo).replace(/[\\/:*?"<>|]+/g, "-")
      : null;
    result.filePaths.forEach((src, idx) => {
      const ext = path.extname(src);
      // Force-rename to the given base name (e.g. a payment number) when
      // provided; otherwise keep the original filename. Either way, avoid
      // clobbering an existing file with the same name.
      const base = safeRename
        ? result.filePaths.length > 1
          ? `${safeRename} (${idx + 1})`
          : safeRename
        : path.basename(src, ext);
      let dest = path.join(dir, base + ext);
      let counter = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(dir, `${base} (${counter})${ext}`);
        counter++;
      }
      try {
        fs.copyFileSync(src, dest);
        added.push(path.basename(dest));
      } catch (e) {
        console.error("attachments:add copy error", e);
      }
    });
    return added;
  });

  ipcMain.handle("attachments:addFromData", (event, projectId, subfolder, fileName, data) => {
    // Counterpart to attachments:add for drag-and-drop: the renderer already
    // has the file's bytes (from a dropped File object) rather than a path
    // Electron's own dialog gave us, so this writes them directly instead
    // of re-opening a picker.
    try {
      const dir = getProjectAttachmentsDir(projectId, subfolder);
      ensureDir(dir);
      const safeName = String(fileName || "file").replace(/[\\/:*?"<>|]+/g, "-");
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      let dest = path.join(dir, safeName);
      let counter = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(dir, `${base} (${counter})${ext}`);
        counter++;
      }
      fs.writeFileSync(dest, Buffer.from(data));
      return path.basename(dest);
    } catch (e) {
      console.error("attachments:addFromData error", e);
      return null;
    }
  });

  ipcMain.handle("attachments:open", (event, filePath) => {
    if (!isSafeAttachmentPath(filePath)) return "Blocked: invalid path";
    return shell.openPath(filePath);
  });

  ipcMain.handle("attachments:remove", async (event, filePath) => {
    if (!isSafeAttachmentPath(filePath)) return false;
    try {
      // Trash rather than unlink — documents now live only on this
      // machine (no cloud copy), so deletion should be recoverable via
      // the OS's own trash/recycle bin rather than permanent by default.
      await shell.trashItem(filePath);
      return true;
    } catch (e) {
      console.error("attachments:remove trash error, falling back to permanent delete", e);
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (e2) {
        console.error("attachments:remove error", e2);
        return false;
      }
    }
  });

  ipcMain.handle("attachments:openFolder", (event, projectId, subfolder) => {
    const dir = getProjectAttachmentsDir(projectId, subfolder);
    ensureDir(dir);
    shell.openPath(dir);
  });

  // ---- Session token storage (the actual login HTTP request happens
  // in the renderer via api.js -- these three handlers only ever touch
  // the encrypted-at-rest token file) ----
  ipcMain.handle("auth:saveToken", (event, token) => {
    saveToken(token);
    return { success: true };
  });
  ipcMain.handle("auth:getToken", () => {
    const token = loadToken();
    return { success: true, token };
  });
  ipcMain.handle("auth:signOut", () => {
    clearStoredToken();
    return { success: true };
  });

  // The app generates PDFs (letterhead, reports) via jsPDF/pdf-lib, which
  // triggers a normal browser-style download. Without this, Electron just
  // silently saves straight to ~/Downloads. This makes every such download
  // prompt a native Save As dialog instead, like a real desktop app.
  session.defaultSession.on("will-download", (event, item) => {
    item.setSaveDialogOptions({
      title: "Save File",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
    });
  });

  createSplash();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
