// Run: node tests/help.test.js
// The Help guides (same file as the desktop app uses).
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
function check(c, m) { if (!c) throw new Error("FAIL: " + m); }
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "js/helpcontent.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");

const w = new JSDOM('<!DOCTYPE html><body><div id="main"></div></body>', { runScripts: "outside-only" }).window;
w.eval(src + "; window.HELP_GUIDES = HELP_GUIDES; window.HELP_TABS = HELP_TABS; window.helpRender = helpRender;");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s) => w.document.querySelector(s), $$ = (s) => [...w.document.querySelectorAll(s)];

// wired in
check(/js\/helpcontent\.js/.test(html) && /"js\/helpcontent\.js"/.test(sw), "help file is loaded and cached for offline use");
check(/help: \{ tab: "sync"/.test(appSrc) && /href="#\/help"/.test(appSrc), "Help route and a link to it exist");

// content sanity
const guides = w.HELP_GUIDES;
check(["start", "desktop", "phone", "trouble"].every((k) => guides[k] && guides[k].length >= 3), "all four guides have content");
const ids = Object.values(guides).flat().map((s) => s.id);
check(new Set(ids).size === ids.length, "section ids are unique");
check(Object.values(guides).flat().every((s) => s.title && s.body.length > 60), "every section has a title and a real body");
const all = Object.values(guides).flat().map((s) => s.title).join("|");
for (const topic of ["Companies and windows", "Estimates", "Reports and printing", "Settings", "Take-Off", "Inspections", "Dictation", "Calculators", "Backup, lock", "Working offline", "Sync tab", "Phone expenses", "Financial audit trail", "Quick expenses", "Photo stamp", "Sharing reports as PDF", "The sync chip", "Projects"]) {
  check(all.includes(topic), "covers " + topic);
}

// screen
w.helpRender($("#main"), esc);
check($$(".hp-tab").length === 4 && $(".hp-tab.on").dataset.tab === "start", "four tabs, starting on Getting started");
check($$("details.hp-sec").length === guides.start.length && $("details.hp-sec").open, "first section open");
$$(".hp-tab")[1].click();
check($$("details.hp-sec").length === guides.desktop.length && /Companies and windows/.test($("#main").textContent), "Desktop guide tab");
$$(".hp-tab")[2].click();
check(/Install app/.test($("#main").textContent) && /Dictation/.test($("#main").textContent), "Phone guide tab");
const box = $("#hpSearch"); box.value = "PIN"; box.dispatchEvent(new w.Event("input"));
check($$(".hp-tab").length === 0 && /Backup, lock/.test($("#main").textContent) && !/Companies and windows/.test($("#main").textContent), "search spans all guides and hides the tabs");
$("#hpSearch").value = "zzzzqq"; $("#hpSearch").dispatchEvent(new w.Event("input"));
check(/Nothing found/.test($("#main").textContent), "no-match message");
console.log("✅ ALL HELP TESTS PASSED");
