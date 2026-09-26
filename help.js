// ===== help.js =====
// Static reference content. Deliberately only documents things that
// actually exist right now -- no point explaining a feature (like
// keyboard shortcuts) before it's actually built.

function renderHelpPage() {
  const container = document.getElementById("help-content");
  if (!container) return;
  container.innerHTML = helpAboutSectionHtml() + HELP_SECTIONS.map(helpSectionHtml).join("");
}
window.renderHelpPage = renderHelpPage;

function helpAboutSectionHtml() {
  return (
    '<div class="card">' +
    '<h3 style="margin:0 0 10px;"><i class="fas fa-star" style="color:var(--primary); margin-right:8px;"></i>About FieldScan Pro</h3>' +
    '<p style="font-size:13px; line-height:1.6; color:var(--text); margin-bottom:12px;">' +
    'FieldScan Pro connects what happens on-site with what happens at the desk. Capture it in the field on your phone; review, refine, and report on it from your desktop — with everything staying in sync automatically, even when the site has no signal.' +
    '</p>' +

    '<h4 style="font-size:13px; margin:14px 0 6px;">Project & Financial Management</h4>' +
    '<ul style="font-size:13px; color:var(--muted); line-height:1.6; margin:0 0 4px 18px; padding:0;">' +
    '<li>Projects move through a simple lifecycle: Active → Handed Over → Abandoned.</li>' +
    '<li>Estimates are where projects begin — mix plain line items, section headers, indented sub-items, and named groups (with their own subtotal), and save any group to a reusable BOQ Library.</li>' +
    '<li>One-click invoicing: an accepted estimate becomes a project, and generating an invoice auto-attaches a formatted PDF to that project\'s Documents.</li>' +
    '<li>Accounts & Payments track every naira in and out, with CSV export for anything you need outside the app.</li>' +
    '<li>Change Orders keep scope changes documented and reflected in the running financial picture — once Approved, a change order\'s details lock automatically to protect the signed-off record.</li>' +
    '</ul>' +

    '<h4 style="font-size:13px; margin:14px 0 6px;">Field Documentation</h4>' +
    '<ul style="font-size:13px; color:var(--muted); line-height:1.6; margin:0 0 4px 18px; padding:0;">' +
    '<li>Take-Off, organized into groups you control and assign to a project.</li>' +
    '<li>Inspections with full narrative detail, photo attachments, and project linkage.</li>' +
    '<li>Progress Logs track completion by trade category for an accurate, live picture of how far along a project is.</li>' +
    '<li>Snags (defects) logged with photos and tracked to resolution.</li>' +
    '<li>Photos attach directly to any record, with a quick-capture button to snap first, organize after.</li>' +
    '</ul>' +

    '<h4 style="font-size:13px; margin:14px 0 6px;">Team & Vendor Management</h4>' +
    '<ul style="font-size:13px; color:var(--muted); line-height:1.6; margin:0 0 4px 18px; padding:0;">' +
    '<li>Vendors and Clients are never truly deleted — they\'re archived instead, fully recoverable with their history intact.</li>' +
    '<li>Work Orders assign scoped work to vendors, tracked from Draft through Approved.</li>' +
    '<li>Bulk actions where they matter: approve multiple Work Orders, export multiple Payments at once.</li>' +
    '</ul>' +

    '<h4 style="font-size:13px; margin:14px 0 6px;">Tasks, Documents & Reporting</h4>' +
    '<ul style="font-size:13px; color:var(--muted); line-height:1.6; margin:0 0 4px 18px; padding:0;">' +
    '<li>Jot down tasks in seconds (even several at once), group related ones, drag to reprioritize, swipe to delete with a real Undo.</li>' +
    '<li>Select multiple documents and combine them into a single PDF, or share several at once via email or WhatsApp.</li>' +
    '<li>Generate a Project Completion Report or a Payment Request document with your bank details filled in automatically.</li>' +
    '<li>Custom Print Layouts let you define your own header, footer, and signature styling once, applied across every report.</li>' +
    '</ul>' +

    '<h4 style="font-size:13px; margin:14px 0 6px;">Built to Be Trusted</h4>' +
    '<ul style="font-size:13px; color:var(--muted); line-height:1.6; margin:0 0 4px 18px; padding:0;">' +
    '<li>Offline-first — every action works immediately, with a visible sync queue you can retry or clear.</li>' +
    '<li>Undo everywhere it counts, so a delete is never a scary, irreversible action.</li>' +
    '<li>Deleting a whole project moves it to a Project Trash first — recoverable until you explicitly choose to erase it forever.</li>' +
    '<li>Keyboard shortcuts for desktop power users.</li>' +
    '</ul>' +

    '<p style="font-size:12px; color:var(--muted); margin-top:12px; font-style:italic;">Same data. Same projects. Same truth. Wherever you\'re standing.</p>' +
    '</div>'
  );
}

function helpSectionHtml(section) {
  return (
    '<div class="card">' +
    '<h3 style="margin:0 0 10px;"><i class="fas ' + section.icon + '" style="color:var(--primary); margin-right:8px;"></i>' + escapeHtml(section.title) + '</h3>' +
    section.items.map((item) =>
      '<div style="margin-bottom:12px;"><strong style="font-size:13px;">' + escapeHtml(item.q) + '</strong>' +
      '<div style="font-size:13px; color:var(--muted); margin-top:3px; line-height:1.5;">' + item.a + '</div></div>'
    ).join("") +
    '</div>'
  );
}

const HELP_SECTIONS = [
  {
    title: "Undo",
    icon: "fa-rotate-left",
    items: [
      {
        q: "I deleted something by accident — can I get it back?",
        a: 'Yes, briefly. Deleting a task, task group, or take-off shows an "Undo" toast at the bottom of the screen for about 6 seconds. Tap Undo before it disappears and the delete never actually happens — nothing is sent to the server until that window passes. Once the toast is gone, the delete is final.',
      },
      {
        q: "Why doesn't the app ask \"Are you sure?\" before deleting anymore?",
        a: "The Undo window replaces that — it's a faster way to catch a mistake than a confirmation dialog, without slowing down every delete with an extra tap.",
      },
      {
        q: "Is there a faster way to delete a task or take-off than opening it first?",
        a: "Swipe a card to the left (or click-drag it left on desktop) to delete it directly — the same Undo toast appears, so it's just as safe as deleting from the edit screen.",
      },
    ],
  },
  {
    title: "Offline & Syncing",
    icon: "fa-cloud-arrow-up",
    items: [
      {
        q: "What happens if I lose signal while working?",
        a: "Changes are saved locally right away and queued to sync once you're back online. You'll see a status indicator at the top showing how many changes are still pending.",
      },
      {
        q: "How do I see or clear pending sync items?",
        a: "Tap the sync status indicator in the header to open the Sync Queue. Each pending item can be retried or deleted individually, or use \"Clear All\" to discard everything queued at once.",
      },
    ],
  },
  {
    title: "Take-Off & Tasks Groups",
    icon: "fa-layer-group",
    items: [
      {
        q: "What's the difference between a Task and a Task Group?",
        a: "A task is a single reminder. Select 2 or more existing tasks and choose \"Group Selected\" to bundle them together — a group can be assigned to a project, renamed, or deleted as one unit.",
      },
      {
        q: "When does a group move to \"Done\"?",
        a: "Only once every task inside it is marked complete. If some tasks in a group are done and others aren't, the group stays visible in the open list.",
      },
      {
        q: "What happens if I delete a group?",
        a: "Every task inside it is deleted along with it — this is why Undo exists. If you delete a group by mistake, use the Undo toast right away.",
      },
    ],
  },
  {
    title: "Estimates & Invoicing",
    icon: "fa-file-invoice",
    items: [
      {
        q: "How do I create a new project?",
        a: 'Projects are created from an Accepted estimate, not from a blank form. Build or accept an estimate first, then use "Create Project" on it.',
      },
      {
        q: "How do I invoice a project?",
        a: 'Open the project\'s Profile tab and use "Generate Invoice" — it turns the estimate the project was created from into an invoice PDF and saves it into that project\'s Documents automatically. This can only be done once per project.',
      },
      {
        q: "What types of line items can I add to an estimate?",
        a: 'Click the single "+ Add" button in Line Items to choose: a plain Line Item, an Indented Line (a normal item nested visually under a heading), a Header (a description-only row with no qty or price, for breaking the list into sections), or a Group.',
      },
      {
        q: "What's the difference between a Header and a Group?",
        a: "A Header is purely visual — just a section title with nothing to total. A Group is a named set of items with its own subtotal shown after its last item, and can be saved to your BOQ Library for reuse in future estimates.",
      },
      {
        q: "How do I save a group of items for reuse in future estimates?",
        a: 'Build the group in an estimate first (using "+ Add" → Add Blank Group, then adding items under it). Then click the small cloud-upload icon next to the group\'s name — it saves that group, with its current items and prices, to your BOQ Library. Saving under a name that already exists in the Library asks whether to update it instead.',
      },
      {
        q: "How do I reuse a saved group from the BOQ Library?",
        a: 'Use "+ Add" → Add Group Block, and pick from your saved templates — this bulk-inserts the whole priced group at once, rather than adding each item by hand.',
      },
    ],
  },
  {
    title: "Change Orders",
    icon: "fa-file-signature",
    items: [
      {
        q: "What happens when I approve a change order?",
        a: "Its subtotal (before VAT) is added to the project's contract value, and the change order itself locks — its line items, title, and date can no longer be edited, since it's now a formally signed-off record.",
      },
      {
        q: "I approved a change order by mistake — how do I fix it?",
        a: 'Open it and change its Status back from Approved to something else (Draft, Submitted, or Rejected) — that\'s the only field that stays editable while it\'s locked. This reverses its contribution to the project\'s contract value and unlocks everything else for editing again.',
      },
      {
        q: "Can I still add line items or groups to a change order?",
        a: 'Yes — the same "+ Add" menu as Estimates: Line Item, Indented Line, Header, or Group, each with a running subtotal for the whole change order (and, for groups, their own subtotal too). This only works while the change order isn\'t Approved yet.',
      },
    ],
  },
  {
    title: "Keyboard Shortcuts",
    icon: "fa-keyboard",
    items: [
      {
        q: "Esc",
        a: "Closes whatever's currently open — an editor panel, a form, or the mobile menu — closing the topmost one first if more than one thing happens to be open.",
      },
      {
        q: "Cmd/Ctrl + K",
        a: "Opens Global Search from anywhere in the app, regardless of what page you're on.",
      },
    ],
  },
  {
    title: "Project Trash",
    icon: "fa-box-archive",
    items: [
      {
        q: "How do I delete a project?",
        a: 'Open the project\'s Profile tab and use "Delete Project" (desktop only). It disappears from your dashboard immediately and moves to Project Trash — the actual removal finishes in the background, visible as a pending item in the sync indicator, so you don\'t have to wait for it.',
      },
      {
        q: "Where do deleted projects go, and can I get one back?",
        a: 'Settings → Project Trash lists every deleted project. "Restore" brings it back exactly as it was, fully intact.',
      },
      {
        q: "How do I permanently erase a project?",
        a: 'From Project Trash, use "Erase Forever" and type the project\'s ID to confirm. Like the delete step above, it disappears from the list right away and the actual cascade — removing every Estimate, Snag, Payment, Inspection, Change Order, Work Order, Progress Log, Task, Take-Off, Document, and Photo linked to it — continues in the background. There is no undo for this step, which is why it asks you to type the ID rather than just click a button.',
      },
      {
        q: "How do I export a project?",
        a: 'Open the project\'s Profile tab and use "Export Project" (desktop only). It packages every linked record, every local document, and every photo into a single .zip file, with a progress bar showing exactly what\'s happening — this can take a little while for a project with a lot of photos.',
      },
    ],
  },
  {
    title: "Client & Vendor Archive",
    icon: "fa-user-slash",
    items: [
      {
        q: "Why can't I delete a client or vendor?",
        a: 'They\'re archived instead of deleted, so their history — every payment, work order, and estimate linked to them — always stays intact. Open their record and use "Archive" (or "Unarchive" to bring them back).',
      },
      {
        q: "Where did an archived client or vendor go?",
        a: 'They drop out of the main list and collapse into an "Archived" section at the bottom, closed by default. Click it to expand and find them.',
      },
    ],
  },
  {
    title: "Payments",
    icon: "fa-money-check-dollar",
    items: [
      {
        q: "How are payment cards ordered?",
        a: "Cards with an outstanding balance show first, followed by fully paid ones — and within each group, the most recently active card shows first.",
      },
      {
        q: "Can I delete a payment?",
        a: 'Yes, two ways: open a specific payment stage and use "Delete This Stage" to remove just that one, or use the trash icon on the card itself to delete every stage under that payee at once. Both use the same Undo toast as everywhere else — nothing is final until it disappears.',
      },
      {
        q: "Does renaming a vendor break their payment history?",
        a: 'No — payment totals and grouping stay intact regardless of a rename. Settings → "Payment ↔ Vendor Links" can link older payments to their vendor by ID (not just by name), which keeps vendor-specific reports accurate even after a rename. It only works for vendors that haven\'t already been renamed before you run it.',
      },
    ],
  },
];
