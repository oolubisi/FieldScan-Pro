// Run: node tests/calculators.test.js  (the same formula checks the desktop app runs, against the phone's copy)
const { JSDOM } = require("jsdom");
const fs = require("fs");

function assert(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }

const dom = new JSDOM(`<!DOCTYPE html><html><body>
  <div id="main"></div>
  <div class="modal-overlay" id="modalOverlay"><div class="modal-box" id="modalBox"></div></div>
</body></html>`, { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.navigator = dom.window.navigator;

// Minimal stand-ins for the two helpers.js functions calculators.js calls
global.showStatus = () => {};
global.escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
global.openModal = () => {};
global.closeModal = () => {};
// jsdom has no real layout engine, so scrollIntoView isn't implemented --
// this is a test-environment gap only; real Electron/Chromium supports it.
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const code = fs.readFileSync(require("path").join(__dirname, "..", "js", "calculators.js"), "utf8");
dom.window.eval(code);
// Pull every function the eval'd code defined into globals so this script can call them directly
Object.getOwnPropertyNames(dom.window).forEach((k) => { if (typeof dom.window[k] === "function" && !(k in global)) global[k] = dom.window[k]; });

console.log("=== Concrete: rectangular slab, hand-calculated expected values ===");
renderCalculatorsSection();
switchCalculator("concrete");
const row = document.querySelector("#concrete-elements-container .calc-card-row");
row.querySelector(".ce-l").value = "4";
row.querySelector(".ce-w").value = "3";
row.querySelector(".ce-h-rect").value = "150";
row.querySelector(".ce-mix").value = "1:2:4";
row.querySelector(".ce-rebar").value = "single";
calculateConcrete();
const output = document.getElementById("calc-output").value;
console.log(output);

assert(output.includes("1.800 m³") || output.includes("1.8 m³"), "Volume should be 1.8 m³ (4 x 3 x 0.15)");
assert(output.includes("12 bags"), "Cement should round up to 12 bags (11.3952 -> ceil)");
assert(output.includes("1.27") , "Sand should be ~1.27 tons");
assert(output.includes("2.46") || output.includes("2.455"), "Aggregate should be ~2.46 tons");
assert(output.includes("180") && output.includes("kg rebar"), "Rebar should be 180 kg (1.8 m³ x 100 kg/m³)");
console.log("✅ Concrete formula verified against independently hand-calculated values\n");

console.log("=== Rebar: Y12, 5 rods, default 12m stock length ===");
switchCalculator("rebar");
const rbRow = document.querySelector("#rebar-elements-container .calc-card-row");
rbRow.querySelector(".rb-diameter").value = "12";
rbRow.querySelector(".rb-quantity").value = "5";
calculateRebar();
const rebarOutput = document.getElementById("calc-output").value;
console.log(rebarOutput);

// kg/m = 12*12/162 = 0.8888..., total length = 60m, total kg = 53.33...
assert(rebarOutput.includes("0.889 kg/m"), `expected 0.889 kg/m (144/162), got: ${rebarOutput}`);
assert(rebarOutput.includes("53.3 kg"), `expected 53.3 kg total (60m x 0.8889), got: ${rebarOutput}`);
console.log("✅ Rebar formula verified against independently hand-calculated values\n");

console.log("=== Blockwork: two walls, tests the shared add/remove card infrastructure ===");
switchCalculator("blockwork");
assert(document.querySelectorAll("#blockwork-elements-container .calc-card-row").length === 1, "should start with exactly 1 wall card");
addBlockworkElement();
assert(document.querySelectorAll("#blockwork-elements-container .calc-card-row").length === 2, "addBlockworkElement should add a second card");

const bwRows = document.querySelectorAll("#blockwork-elements-container .calc-card-row");
bwRows[0].querySelector(".bw-l").value = "10";
bwRows[0].querySelector(".bw-h").value = "3";
bwRows[0].querySelector(".bw-type").value = "9";
bwRows[1].querySelector(".bw-l").value = "5";
bwRows[1].querySelector(".bw-h").value = "3";
bwRows[1].querySelector(".bw-openings").value = "2";
bwRows[1].querySelector(".bw-type").value = "6";
calculateBlockwork();
const bwOutput = document.getElementById("calc-output").value;
console.log(bwOutput);

// Wall 1: 10x3=30m², 9" blocks: 30*10=300 blocks
// Wall 2: 5x3=15m² - 2m² openings = 13m², 6" blocks: 13*10=130 blocks
// Total blocks = 430
assert(bwOutput.includes("430 pcs"), `expected 430 total blocks (300+130), got: ${bwOutput}`);
assert(bwOutput.includes("43.00 m²") || bwOutput.includes("43 m²"), `expected 43 m² total surface (30+13), got: ${bwOutput}`);
console.log("✅ Blockwork formula + multi-card add/remove infrastructure verified\n");

console.log("=== Removing a card correctly updates the DOM ===");
removeCalcCard("blockwork-elements-container", bwRows[1].dataset.cardId);
assert(document.querySelectorAll("#blockwork-elements-container .calc-card-row").length === 1, "should be back to 1 card after removal");
console.log("✅ Card removal verified\n");

console.log("✅ ALL CALCULATOR FORMULA VERIFICATION TESTS PASSED");
