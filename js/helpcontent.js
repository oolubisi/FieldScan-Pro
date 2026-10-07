// ===== Help content, shared by the desktop app and the phone app =====
// Each guide is a list of sections: { id, title, body (HTML) }.

const HELP_GUIDES = {
  start: [
    { id: "overview", title: "What FieldScan Pro is", body: `
      <p>FieldScan Pro is two apps that work as one:</p>
      <ul><li><b>The desktop app (on your Mac)</b> is the office. It holds one <b>company file</b> with your projects, estimates, change orders, payments, clients and vendors, and it prints estimates and reports.</li>
      <li><b>The phone app (Chrome on Android)</b> is the site companion. It captures take-offs, tasks, inspections and site diary entries with photos, and works with no signal.</li></ul>
      <p>The two exchange small files through one shared folder kept in step by Syncthing. Nothing goes through a server, and nothing is lost if one side is offline: each record waits until the other side confirms it arrived.</p>` },
    { id: "setup", title: "First-time setup", body: `
      <ol><li><b>Desktop:</b> click the company name at the top of the menu, choose <b>New Company</b>, and save the file somewhere safe. Fill in <b>Settings → Company Details</b> (name, logo, address, phones, email) so printouts carry your letterhead.</li>
      <li><b>Both:</b> install <b>Syncthing</b> on the Mac and on the phone and share one folder between them, for example <b>FieldScanPro Sync</b>.</li>
      <li><b>Desktop:</b> open <b>Sync</b>, press <b>Choose folder</b> and pick that folder, then <b>Write project list</b>.</li>
      <li><b>Phone:</b> open the app in Chrome, use the menu to <b>Install app</b>, open it from the home screen, go to the <b>Sync</b> tab and choose the same folder. Press <b>Sync now</b>.</li>
      <li>The phone now knows your projects. Add a task on the phone and press Sync now on both sides to see it arrive on the desktop.</li></ol>` },
    { id: "how-sync", title: "How the two apps stay in step", body: `
      <ul><li>Every task, inspection, take-off, diary entry and photo is a <b>record</b> with a version. Both apps keep the newest version.</li>
      <li>A record shows <b>Waiting for the phone</b> (or desktop) until the other side confirms it has it, then <b>Delivered</b>.</li>
      <li>Deleting is also synced, and can be undone from <b>Backup &amp; History</b> on the desktop or <b>Backup, storage, lock &amp; history</b> on the phone.</li>
      <li>Both sides sync automatically while the app is open, and you can press <b>Sync now</b> at any time.</li></ul>` },
  ],

  desktop: [
    { id: "d-companies", title: "Companies and windows", body: `
      <p>Each company is one <b>.fspdb file</b>. Click the <b>company name</b> at the top of the menu to open the dropdown:</p>
      <ul><li><b>Open Company</b> shows companies you opened before, with a Browse option for any other file.</li><li><b>New Company</b> creates a new file.</li><li><b>Open 2nd Window</b> opens another window so you can work in a different company at the same time.</li></ul>
      <p>The last company opens automatically when you start the app. Closing a window syncs that company one last time first.</p>` },
    { id: "d-home", title: "Home", body: `<p>A summary of where things stand: whether everything is synced with the phone, open tasks (with overdue and due-today alerts), this week's diary entries, a progress card for each project, and a feed of recent activity that shows what came from the phone. Click any tile, alert or feed row to jump to it. The <b>✎ Company details</b> chip opens your letterhead form.</p>` },
    { id: "d-search", title: "Search", body: `<p>Type one or more words; every word must match. Search covers tasks, inspections, take-offs, diary entries and more, and clicking a result opens it.</p>` },
    { id: "d-projects", title: "Projects", body: `
      <ul><li><b>New project</b> takes a number (for example PRJ/26/001), client, site and contract value. A project can also be created from an <b>Accepted estimate</b>.</li>
      <li>Open a project to see its <b>financial summary</b>, <b>change orders</b> and <b>payments</b>.</li>
      <li><b>Change orders</b> have line items (description, quantity, rate), VAT and a status. Once approved, treat them as the signed-off record. <b>Print</b> a change order from its row.</li>
      <li><b>Payments</b> are grouped: <b>Client Receipt</b> (money in) and payments out to vendors or small expenses. A group has staged payments, shows paid to date and balance, and has its own <b>Print</b> statement.</li>
      <li>Trash a project from its row. It goes to <b>Settings → Project Trash</b>, where you can restore it or erase it forever.</li>
      <li><b>Print list</b>, <b>Status report</b> and <b>Financial report</b> buttons are at the top of the list.</li></ul>` },
    { id: "d-estimates", title: "Estimates", body: `
      <ul><li>Each estimate has a client, address, date, valid-until date, an optional header line, line items, notes and conditions.</li>
      <li>Line items can be <b>items</b>, <b>indented</b> sub-items, <b>headers</b> and <b>groups</b>. Save a group to the <b>BOQ Library</b> to reuse it on other estimates.</li>
      <li>Totals show Subtotal, an optional <b>discount</b> (printed only when it applies), VAT (7.5%) and Total, all in naira.</li>
      <li><b>Show account details</b> prints your bank box on that estimate.</li>
      <li>Status moves from Draft to Sent, Accepted or Declined. An accepted estimate can be turned into a project.</li>
      <li><b>Print</b> an estimate from its row. The printout uses your letterhead, signature and the "Please Note" conditions list.</li></ul>` },
    { id: "d-clients", title: "Clients and Vendors", body: `<p>Keep contact details for the people you work for and the vendors you pay. They are <b>archived</b>, not deleted, so history stays intact. Vendors have a role (for example Piling Contractor) and are used as payees in project payments.</p>` },
    { id: "d-calc", title: "Calculators", body: `<p>Seven quantity calculators: <b>Concrete</b>, <b>Blockwork</b> (6" and 9"), <b>Plastering</b>, <b>Bathroom Piping</b>, <b>Low Voltage Electrical</b>, <b>Fire Alarm</b> and <b>Rebar Weight Converter</b>. Add elements, enter dimensions, and read the totals. <b>Constants</b> lets you change the factors they use, and results can be copied. The phone has the same calculators.</p>` },
    { id: "d-takeoff", title: "Take-Off", body: `
      <p>Take-offs are organised as <b>project → group → take-off card</b>. A card has a sector (for example Tiling / Flooring), a date, notes and line items (description, quantity, unit, notes) with headings between them. Photos attach to a card.</p>
      <p>Cards and groups sync with the phone. If both sides changed the same card you are shown both versions and choose which to keep. <b>Print</b> a card, a group, or the groups list.</p>` },
    { id: "d-tasks", title: "Tasks", body: `
      <ul><li>Type in the quick box and press Add. Separate several tasks with <b>;</b> to add them at once.</li>
      <li>Give a task a project, group, due date and notes. Tick the box to complete it. <b>Show done</b> reveals finished tasks.</li>
      <li>Filter by project or overdue. <b>Groups</b> lets you create and rename task groups.</li>
      <li><b>Print</b> the list or run the <b>Task report</b>.</li></ul>` },
    { id: "d-inspections", title: "Inspections", body: `
      <ul><li>An inspection has a title, project, date, inspector, location, introduction and observations.</li>
      <li><b>Checklists</b> start from a template (Foundation, Slab pour, Blockwork, Roofing, Plumbing first fix, Electrical first fix, Handover / snag list) or your own items. Mark each Pass, Fail or N/A with a note. A failed item can create a <b>task</b> automatically.</li>
      <li>Add <b>photos</b> with captions. You can rotate, crop and draw on them.</li>
      <li><b>Print</b> an inspection report, or run the <b>Inspection summary</b>.</li></ul>` },
    { id: "d-diary", title: "Site Diary", body: `<p>One entry per day per project: date, weather, labour on site, deliveries, instructions, progress and notes, plus photos. <b>Print</b> an entry or use <b>Progress report</b> for a date range.</p>` },
    { id: "d-photos", title: "Photos", body: `<p>Photos come from the phone camera or can be added on the desktop. Open one to <b>rotate</b>, <b>crop</b>, <b>draw</b> arrows, boxes and text, edit the <b>caption</b> (printed in reports) or download it. Photos shrink to save space but keep their version, so syncing never loops.</p>` },
    { id: "d-sync", title: "Sync screen", body: `
      <ol><li><b>Sync folder:</b> choose the folder shared with the phone.</li><li><b>Sync now:</b> sends and receives immediately.</li><li><b>Project list for the phone:</b> rewrite it after you add or change projects.</li><li><b>Files from the phone:</b> shows what has been received.</li><li><b>Check the connection:</b> sends a test note so you can confirm the phone sees it.</li></ol>
      <p>Anything changed on both sides appears under <b>Needs your decision</b>; open it and choose which version to keep.</p>` },
    { id: "d-backup", title: "Backup & History", body: `<p><b>Back up now</b> saves every synced record into one file. <b>Restore</b> never overwrites newer work. <b>Change history</b> lists changes that came from the phone and edits or deletions made here, each with an <b>Undo</b> that also sends the restored version to the phone.</p>` },
    { id: "d-reports", title: "Reports and printing", body: `
      <p><b>Reports</b> in the menu lists five reports: <b>Project status</b>, <b>Financial summary</b> (original contract, change orders, VAT, withholding tax, net receivable, received, balance, paid out), <b>Tasks</b>, <b>Inspections</b> and <b>Site progress</b>. Choose filters, check the preview, press <b>Print</b>.</p>
      <p>Estimates, change orders, payment statements and lists have their own Print buttons. Every printout carries your letterhead, the print date and page numbers. In the print dialog you can choose <b>Save as PDF</b>.</p>` },
    { id: "d-settings", title: "Settings", body: `
      <ul><li><b>Appearance:</b> Automatic, Light or Dark.</li><li><b>Data / Backup Manager:</b> export and restore.</li>
      <li><b>Company Details:</b> logo (and size), name, slogan, address, two phones, email, TIN, VAT and registration numbers.</li>
      <li><b>Payment Details:</b> bank, account name and number, shown on estimates. Press Edit to change.</li>
      <li><b>My Signature:</b> printed name and signature image.</li><li><b>Project Trash:</b> restore or erase projects.</li></ul>` },
  ],

  phone: [
    { id: "p-install", title: "Installing and opening the app", body: `
      <ol><li>Open the app address in <b>Chrome</b> on the phone while you have signal.</li><li>Chrome menu → <b>Install app</b> (or Add to Home screen).</li><li>Open it from the home screen icon. After the first load it works with no signal.</li></ol>
      <p>When a new version is available the app says so; close and reopen it to use it.</p>` },
    { id: "p-tabs", title: "Finding your way around", body: `<p>The bar at the bottom has six tabs: <b>Home</b>, <b>Take-Off</b>, <b>Tasks</b>, <b>Inspect</b>, <b>Calculators</b> and <b>Sync</b>. Site Diary, Search and the backup &amp; security screen are reached from Home and Sync.</p>` },
    { id: "p-home", title: "Home", body: `<p>Shows your open tasks and projects, a <b>Quick add</b> row (Task, Inspection, Take-off, Diary), a search link and <b>Recent activity</b>. If it says there is no project list yet, open <b>Sync</b> to receive it from the desktop.</p>` },
    { id: "p-takeoff", title: "Take-Off", body: `
      <ol><li>Choose a project, then <b>New group</b> (for example Ground floor finishes).</li><li>Open the group and <b>Add take-off</b> with a sector, such as Tiling / Flooring.</li><li>Use <b>Add item</b> for description, quantity, unit and notes, and <b>Add heading</b> to separate sections.</li><li>Add photos once the take-off has been saved.</li></ol>
      <p>Group names can be changed with <b>Rename</b>.</p>` },
    { id: "p-tasks", title: "Tasks", body: `
      <ul><li>Type in the box at the top; separate several tasks with <b>;</b> (for example "Order cement; Call surveyor").</li>
      <li>Open a task to set a <b>project</b>, <b>group</b>, <b>due date</b> and notes. Tick it to complete.</li>
      <li>Due dates show as chips: <b>overdue</b>, <b>today</b> or <b>soon</b> (within 3 days). Filter by project, or show overdue only.</li></ul>` },
    { id: "p-inspections", title: "Inspections", body: `
      <ul><li>Enter title, project, inspector, location, introduction and observations.</li>
      <li><b>Checklist:</b> choose "Add a checklist from a template…" (Foundation / strip footing, Slab pour, Blockwork, Roofing, Plumbing first fix, Electrical first fix, Handover / snag list) or add your own item. Mark each Pass, Fail or N/A and note what is wrong. A failed item can ask for a <b>task</b>, which is created when you save.</li>
      <li><b>Photos:</b> save the inspection first, then add photos from the camera or gallery. Tap a photo to view, rotate, <b>crop / draw</b> on it (arrows, boxes, text), add a caption, or delete it. <b>Download selected</b> saves photos to the phone.</li>
      <li><b>Report (PDF):</b> opens a printable report with photos; choose Save as PDF.</li></ul>` },
    { id: "p-diary", title: "Site diary", body: `<p>Add a <b>New entry</b> for the day: date, weather, labour, deliveries, instructions, progress and notes, with photos. <b>Report (PDF)</b> prints one entry and <b>Weekly report (last 7 days, PDF)</b> prints the week.</p>` },
    { id: "p-dictation", title: "Dictation", body: `<p>Long text fields have a microphone button. Tap it, speak, and your words are typed in. It uses the phone's own speech recognition, so it needs the phone's keyboard voice service and may need a signal on some phones.</p>` },
    { id: "p-calc", title: "Calculators", body: `<p>The same seven calculators as the desktop: Concrete, Blockwork, Plastering, Bathroom Piping, Low Voltage Electrical, Fire Alarm and Rebar. Pick a calculator, add elements, enter sizes and tap Calculate. Use <b>Constants</b> to change factors and copy the result to share it.</p>` },
    { id: "p-search", title: "Search", body: `<p>From Home, open Search and type a word or two. Every word must match. Results cover tasks, inspections, take-offs and diary entries.</p>` },
    { id: "p-sync", title: "Sync tab", body: `
      <ul><li><b>Choose folder</b> once, picking the Syncthing folder shared with the Mac. Chrome may ask again after a long time; allow it.</li>
      <li><b>Sync now</b> reads what the desktop sent and writes what you changed. The phone also syncs by itself when the app opens, every 10 minutes while it is open, and when you close it.</li>
      <li>A banner appears if a record changed on both devices. <b>Decide now</b> shows both versions; choose one.</li>
      <li><b>Device check</b> tests that the phone can save records and use the folder.</li></ul>` },
    { id: "p-safety", title: "Backup, lock & history", body: `
      <ul><li><b>Back up now</b> saves all records to a file; <b>Restore from a backup file</b> brings them back without overwriting newer work.</li>
      <li><b>App lock:</b> set a 4–12 digit PIN, and turn on fingerprint / face unlock if your phone supports it. <b>Change PIN</b> and <b>Turn lock off</b> ask for the PIN.</li>
      <li><b>Storage:</b> shows how much space photos use. <b>Shrink photos the desktop already has</b> frees space safely.</li>
      <li><b>Change history</b> lists changes made on the phone and received from the desktop, each with <b>Undo</b>.</li></ul>` },
    { id: "p-offline", title: "Working offline", body: `<p>Everything above works with no signal. Records are kept on the phone and marked <b>Waiting for desktop</b> until a sync completes and the desktop confirms receipt. Keep the app installed and don't clear Chrome's site data, or unsynced records could be lost; use <b>Back up now</b> before clearing anything.</p>` },
  ],

  trouble: [
    { id: "t-nolist", title: "The phone says No project list yet", body: `<p>On the desktop open <b>Sync</b> and press <b>Write project list</b>. Wait for Syncthing to finish, then on the phone press <b>Sync now</b>.</p>` },
    { id: "t-waiting", title: "A record stays Waiting for desktop or Waiting for the phone", body: `<ul><li>Check that Syncthing shows the folder as <b>Up to Date</b> on both devices.</li><li>Press <b>Sync now</b> on the device that made the change, then on the other one.</li><li>On the desktop, <b>Check the connection</b> sends a test note; confirm it reaches the phone.</li></ul>` },
    { id: "t-folder", title: "The phone has forgotten the folder", body: `<p>Chrome sometimes drops access to a folder. The Sync tab says so and pauses automatic sync. Choose the folder again and allow access.</p>` },
    { id: "t-conflict", title: "Needs your decision", body: `<p>The same record was changed on both devices before they synced. Nothing is overwritten. Open the decision, read both versions and keep the phone's or the desktop's. The choice covers both.</p>` },
    { id: "t-mistake", title: "I deleted or changed something by mistake", body: `<p>Open <b>Backup &amp; History</b> (desktop) or <b>Backup, storage, lock &amp; history</b> (phone), find the change and press <b>Undo</b>. Photos of a deleted record are not restored. A project deleted on the desktop is in <b>Settings → Project Trash</b>.</p>` },
    { id: "t-print", title: "Printing and PDFs", body: `<p>On the desktop use the Print button, then in the print dialog choose your printer or <b>Save as PDF</b>. On the phone use <b>Report (PDF)</b>, then Chrome's <b>Save as PDF</b>. If your logo prints too small or large, change <b>Logo size ×</b> in Company Details.</p>` },
    { id: "t-forgot-pin", title: "Forgot the phone PIN", body: `<p>The lock protects the app on that phone. If you cannot unlock it, clear the app's data in Chrome settings and then restore from your backup file or let the desktop send everything again. Make a backup regularly so this is painless.</p>` },
  ],
};

const HELP_TABS = [
  ["start", "Getting started"],
  ["desktop", "Desktop guide"],
  ["phone", "Phone guide"],
  ["trouble", "Troubleshooting"],
];

/** The Help screen: tabs, a search box, and collapsible sections. `main` is the element to fill. */
function helpRender(main, escape) {
  const state = { tab: "start", q: "" };
  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const text = (html) => html.replace(/<[^>]+>/g, " ").toLowerCase();
    const sections = (q ? Object.values(HELP_GUIDES).flat() : HELP_GUIDES[state.tab])
      .filter((s) => !q || (s.title + " " + text(s.body)).toLowerCase().includes(q));
    main.innerHTML = `<h2>Help</h2>
      <input id="hpSearch" class="hp-search" type="search" placeholder="Search help…" value="${escape(state.q)}">
      ${q ? "" : `<div class="hp-tabs">${HELP_TABS.map(([k, l]) => `<button class="hp-tab${k === state.tab ? " on" : ""}" data-tab="${k}">${escape(l)}</button>`).join("")}</div>`}
      ${sections.length ? sections.map((s, i) => `<details class="hp-sec" ${i === 0 && !q ? "open" : ""} ${q ? "open" : ""}><summary>${escape(s.title)}</summary><div class="hp-body">${s.body}</div></details>`).join("") : `<p class="muted">Nothing found. Try a shorter word.</p>`}
      <style>
        .hp-search { width:100%; box-sizing:border-box; margin-bottom:10px; padding:11px 14px; font-size:16px; border:1.5px solid var(--input-line, #ccc); border-radius:12px; background:var(--input-bg, var(--card, #fff)); color:inherit; }
        .hp-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
        .hp-tab { padding:8px 14px; border-radius:999px; border:1.5px solid var(--line, #ccc); background:transparent; color:inherit; font-weight:700; cursor:pointer; }
        .hp-tab.on { background:var(--btnp, var(--accent, #111)); color:#fff; border-color:transparent; }
        .hp-sec { border:1px solid var(--line, #ddd); border-radius:14px; padding:2px 16px; margin-bottom:8px; background:var(--card, #fff); }
        .hp-sec summary { cursor:pointer; padding:12px 0; font-weight:800; }
        .hp-body { padding:0 0 12px; line-height:1.55; } .hp-body ul, .hp-body ol { padding-left:20px; margin:6px 0; } .hp-body li { margin:4px 0; } .hp-body p { margin:6px 0; }
      </style>`;
    const box = main.querySelector("#hpSearch");
    box.oninput = () => { state.q = box.value; draw(); const b = main.querySelector("#hpSearch"); b.focus(); b.setSelectionRange(b.value.length, b.value.length); };
    main.querySelectorAll(".hp-tab").forEach((b) => { b.onclick = () => { state.tab = b.dataset.tab; draw(); }; });
  };
  draw();
}
