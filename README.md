# FieldScan Pro: Field Companion (Phase 1)

A phone app that works on its own, with no signal, and swaps small files with the desktop app through a Google Drive folder. It never signs in to Google: it only saves and reads ordinary files.

**In this phase:** the Calculators (the same code as the desktop), the sync plumbing, and two diagnostic screens that prove the whole path works on *your* phone before real records depend on it. Take-Off, Tasks and Inspections come in the next phases.

## How it fits together

```
Phone app --saves--> phone Downloads --folder-sync app--> Google Drive folder
                                                               |  (Google Drive for desktop)
Desktop app <------------------ reads/writes ------------- the same folder on your Mac
```

The desktop writes the **project list** and its replies into the same folder; the phone's sync app brings them down, and you pick them in the app (Sync tab, Choose files to import).

Delivery is *confirmed*, never assumed: the desktop's files carry receipts. A record stays "Sent, waiting for desktop" until a receipt arrives, and goes out again with every export until then. A file that never uploads can't silently lose data.

---

## 1. Put the app online (GitHub Pages)

A phone app has to be served from a secure web address.

1. On GitHub, create a new repository (for example `fieldscan-mobile`).
2. Upload the **contents** of this folder (index.html, sw.js, manifest.webmanifest, and the css, js, icons folders). Upload the files inside the folder, not the folder itself.
3. In the repository: **Settings -> Pages -> Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
4. After a minute or two the address appears: `https://<your-name>.github.io/fieldscan-mobile/`.

## 2. Install it on the phone

1. Open that address in **Chrome on the phone**, while you have signal.
2. Chrome menu (three dots) -> **Install app** (or **Add to Home screen**).
3. Open it from the new home-screen icon.
4. Prove it works offline: switch on airplane mode, close the app, open it again. The Calculators should still work.

## 3. Set up the sync folder on the Mac

1. Install **Google Drive for desktop** and sign in. Google Drive now appears in Finder.
2. In My Drive, create a folder named **FieldScanPro Sync**.
3. In the desktop app: **Sync** (sidebar) -> **Choose folder** -> pick that folder. The badge should say **Found**.

## 4. Set up a folder-sync app on the phone

The phone app saves its files to the phone's **Downloads** folder. A folder-sync app (from the Play Store) moves them to Drive for you. I haven't tested any specific app, so choose one that can do all of this:

- **Upload:** watch the **Download** folder and upload to Drive's **FieldScanPro Sync** folder, **only files whose names start with `fsp-` and end in `.json`**. (The filter matters: otherwise every download you make gets uploaded.) Ignore files ending in `.crdownload`.
- **Download:** bring the contents of Drive's **FieldScanPro Sync** folder down to a folder on the phone, for example `FieldScanPro-inbox`.
- Let it run automatically in the background.

## 5. Test the whole path (about 10 minutes)

Do these in order. Each one shows exactly where a problem is if something fails.

1. **Device check** (phone: Sync tab -> Device check). Run the three tests, then **Copy report**. See "What to send back" below.
2. **Download reaches Drive.** In the Device check press **Save a test file**. Look in the phone's Downloads for a file starting `fsp-probe-`. Wait for your sync app, then look for it in Drive and in Finder.
3. **Desktop sees it.** Desktop: Sync -> **Check for files from the phone**. You should see "Connection test file from ph-...". That proves phone to Drive to Mac works.
4. **Project list reaches the phone.** Desktop: open a company, Sync -> **Write project list**. Wait for it to reach the phone's inbox folder. Phone: Sync -> **Choose files to import** -> pick the `fsp-projects-...` file(s). You should see your companies and project counts. Do this for each company.
5. **Round trip.** Phone: Sync -> type a note -> **Create test note** -> **Save file for the desktop**. Wait, then desktop: **Check for files from the phone**. The note appears. Desktop: **Send test reply to phone**, then **Write project list** (it carries the receipt too). Wait, then phone: import the new files from the inbox. The note changes to **Delivered** and the desktop's reply appears.

If step 5 works, the connection is proven in both directions.

## 6. What to send back

- The **Device check report** (it tells me what your phone and browser really support, which decides how automatic the next phases can be).
- Which folder-sync app you used, and whether its filename filter worked.
- Anything that didn't happen at steps 2 to 5, and which step.

## Updating the app

When I send updated files: upload them over the old ones in the GitHub repository (same names). Open the app once (it downloads the update in the background), then close and reopen it. A message says "App updated" when the new version takes over. The **Device check** report shows the installed build.

## For developers

```
npm install        # test tools only; the app itself has no dependencies and no build step
npm test           # all test suites
npm run stamp      # REQUIRED after changing any app file (see below)
```

`sw.js` carries a hash of every file it caches (`BUILD`). A release is cached as one complete set under that name, so phones never run a mix of old and new files. Change any file, run `npm run stamp`, or `npm test` will fail on purpose. If you add a file, add it to the `PRECACHE` list in `sw.js` first; the tests check that nothing the page uses is missing from it.

## Not in Phase 1

Take-Off, Tasks, Inspections and photos. The desktop screens for them. The screen for choosing between two versions of a record edited on both sides (the logic is built and tested; the screen arrives with Take-Off). Phone notes sent from the phone are only read by the desktop in this phase, not stored.

## Sync now (Syncthing folder)

1. On the phone, make one dedicated folder (e.g. `FieldScanPro Sync`) and share it with the Mac's sync folder in Syncthing. On both sides set Ignore Patterns to exactly these two lines: `!fsp-*.json` then `*`.
2. On the Mac, in FieldScan Pro's Sync screen, choose that same Mac folder.
3. On the phone, open Sync, tap **Choose sync folder** and pick the Android folder.
4. Tap **Sync now**. It reads new files from the desktop, sends anything the desktop hasn't confirmed, and removes this phone's own files once the desktop has confirmed them.

If Chrome asks for permission after the app was closed, tap Allow. The manual import/export cards remain as a fallback.

## Take-Off (first on-site feature)

- **Take-Off tab** (opens first): groups belong to a project; each group holds take-offs (a sector, date, notes and line items with quantity and unit; headings are supported).
- Everything saves on the phone first and works with no signal. **Sync now** (Sync tab) sends it to the desktop and brings back the desktop's edits.
- Records sent to the desktop show *Not sent* → *Sent* → *Delivered ✓*. *Delivered* appears only when the desktop's receipt arrives.
- **Decisions**: if the same record is edited on both the phone and the desktop before they sync, nothing is overwritten. A banner appears; open it to see both versions side by side and keep one. The choice goes to the other side on the next sync.
- Fields the desktop adds to a record that the phone doesn't show are kept when the phone edits it.

## Tasks

Open the **Tasks** tab. Type a task and tap Add (separate several with `;`). Tap the circle to mark done; tap a task to edit its notes, project, group or delete it. With several companies, pick the company first. Groups are created and renamed on the desktop; the phone can assign a task to an existing group. Tasks sync both ways with the desktop's **Tasks** section; if both sides edit the same task, the Sync tab shows a decision screen ("Keep the phone's / Keep the desktop's").
