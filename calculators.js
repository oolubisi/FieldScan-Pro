// ===== calculators.js =====
// Construction quantity estimators (Concrete, Blockwork, Plastering, Bathroom
// Piping). All figures are rule-of-thumb site estimates — every coefficient
// used lives in CALC_DEFAULTS below and can be overridden by the user via
// the "Constants" editor, persisted locally (this is a personal calculation
// aid, not project data, so it's stored in localStorage rather than synced
// to the backend).

const CALC_CONSTANTS_STORAGE_KEY = "fieldscan_calculator_constants";

const CALC_DEFAULTS = {
  general: {
    cementBagWeightKg: 50,
    sandDensityKgM3: 1600,
    aggregateDensityKgM3: 1550,
  },
  concrete: {
    dryVolumeFactor: 1.54,
    cementDensityKgM3: 1440,
    rebarKgPerM3Single: 100,
    rebarKgPerM3Double: 150,
    formworkFactor: 1,
    bindingWireKgPerTonRebar: 10,
    nailsKgPerM2Formwork: 0.35,
  },
  blockwork: {
    blocksPerM2_6in: 10,
    blocksPerM2_9in: 10,
    mortarM3PerM2_6in: 0.0125,
    mortarM3PerM2_9in: 0.02,
    mortarCementRatio: 1,
    mortarSandRatio: 6,
    mortarDryVolumeFactor: 1.33,
  },
  plastering: {
    defaultThicknessMm: 12,
    dryVolumeFactor: 1.3,
  },
  piping: {
    supplyLen_wc: 2,
    supplyPoints_wc: 1,
    elbows_wc: 2,
    tees_wc: 0,
    drainLen_wc: 1.5,

    supplyLen_whb: 2,
    supplyPoints_whb: 2,
    elbows_whb: 3,
    tees_whb: 1,
    drainLen_whb: 1.5,

    supplyLen_shower: 3,
    supplyPoints_shower: 2,
    elbows_shower: 3,
    tees_shower: 1,
    drainLen_shower: 2,

    supplyLen_bathtub: 3,
    supplyPoints_bathtub: 2,
    elbows_bathtub: 3,
    tees_bathtub: 1,
    drainLen_bathtub: 2,

    supplyLen_geyser: 1.5,
    supplyPoints_geyser: 2,
    elbows_geyser: 2,
    tees_geyser: 0,
    drainLen_geyser: 1,

    drainLen_floorDrain: 1,
    drainElbowsPerFixture: 1,
    pipeWastageFactor: 1.1,
  },
  electrical: {
    cableSizeLightingMm2: 1.5,
    cableSizeSocketMm2: 2.5,
    cableSizeWaterHeaterMm2: 2.5,
    cableSizeCookerMm2: 6,
    cableSizePumpMm2: 2.5,
    conductorsPerCircuit: 2,
    circuitAllowanceM: 2,
    cableWastageFactor: 1.1,
    earthWireFactor: 1,
    conduitSizeMm: 20,
    conduitWastageFactor: 1.1,
    junctionBoxesPerLightPoint: 0.34,
    cableClipsPerMeter: 3,
  },
  firealarm: {
    cableSizeMm2: 1.5,
    circuitAllowanceM: 2,
    cableWastageFactor: 1.1,
    addressableDevicesPerLoop: 99,
    addressableIsolatorPerDevices: 10,
    conventionalZonesPerPanel: 8,
    deviceSparePercent: 0.05,
  },
  rebar: {
    stockLengthM: 12, // standard stock/market length per rod; varies by supplier/market, hence editable
    // Standard formula: weight per metre (kg/m) = diameter(mm)^2 / weightDivisor.
    // 162 is the widely-used construction-industry constant, derived from
    // mild steel density (~7850 kg/m^3) and a bar's circular cross-section
    // -- left editable in case a different steel grade/density is ever needed.
    weightDivisor: 162,
  },
};

const PIPING_FIXTURES = [
  { key: "wc", label: "WC (Toilet)" },
  { key: "whb", label: "Wash Hand Basin / Sink" },
  { key: "shower", label: "Shower" },
  { key: "bathtub", label: "Bathtub" },
  { key: "geyser", label: "Geyser (Water Heater)" },
];

const PIPING_SIZE_PRESETS = {
  small: { wc: 1, whb: 1, shower: 1, bathtub: 0, geyser: 0, floorDrain: 1 },
  medium: { wc: 1, whb: 1, shower: 1, bathtub: 1, geyser: 1, floorDrain: 1 },
  large: { wc: 1, whb: 2, shower: 1, bathtub: 1, geyser: 1, floorDrain: 1 },
};

function getCalcConstants() {
  let saved = {};
  try {
    saved = JSON.parse(
      localStorage.getItem(CALC_CONSTANTS_STORAGE_KEY) || "{}",
    );
  } catch (e) {
    saved = {};
  }
  // Deep-merge over defaults so new constants added in future updates
  // always have a value, even if the user saved an older set.
  const merged = {};
  Object.keys(CALC_DEFAULTS).forEach((group) => {
    merged[group] = Object.assign({}, CALC_DEFAULTS[group], saved[group] || {});
  });
  return merged;
}

function setCalcConstants(values) {
  localStorage.setItem(CALC_CONSTANTS_STORAGE_KEY, JSON.stringify(values));
}

function resetCalcConstants() {
  localStorage.removeItem(CALC_CONSTANTS_STORAGE_KEY);
}

function fmtNum(n, decimals = 2) {
  const v = Number(n);
  if (!isFinite(v)) return "0";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

// ===== Shared collapsible card-list helpers =====
// Used by any calculator that needs an "Add N" list (Concrete elements,
// Bathrooms, Fire Alarm zones). Each card is a name field (always visible)
// plus a collapsible body. Electrical's room list predates this helper and
// keeps its own dedicated functions to avoid touching working code.

const CALC_CARD_ADD_FNS = {};

function buildCardShellHtml(id, containerId, namePlaceholder, bodyHtml, extraHeaderHtml = "") {
  return `
    <div class="calc-card-row" data-card-id="${id}" style="border:1px solid var(--border); border-radius:10px; margin-bottom:10px; background:var(--card); overflow:hidden;">
      <div class="calc-card-header" style="display:flex; align-items:center; gap:8px; padding:12px; cursor:pointer;" onclick="window.toggleCalcCard('${id}')">
        <i class="fas fa-chevron-down calc-card-chevron" style="transition: transform 0.15s; flex:none;"></i>
        <input class="calc-card-name" placeholder="${namePlaceholder}" style="flex:1; font-weight:700; margin:0; min-width:0;" onclick="event.stopPropagation();">
        ${extraHeaderHtml}
        <span onclick="event.stopPropagation(); window.removeCalcCard('${containerId}','${id}')" style="color:var(--danger); font-size:18px; font-weight:800; padding:0 6px; flex:none;">&times;</span>
      </div>
      <div class="calc-card-body" style="padding: 0 12px 12px 12px;">
        ${bodyHtml}
      </div>
    </div>`;
}

function toggleCalcCard(id) {
  const row = document.querySelector(`.calc-card-row[data-card-id="${id}"]`);
  if (!row) return;
  const body = row.querySelector(".calc-card-body");
  const chevron = row.querySelector(".calc-card-chevron");
  const collapsing = body.style.display !== "none";
  body.style.display = collapsing ? "none" : "block";
  if (chevron) chevron.style.transform = collapsing ? "rotate(-90deg)" : "rotate(0deg)";
}
window.toggleCalcCard = toggleCalcCard;

function removeCalcCard(containerId, id) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const row = container.querySelector(`[data-card-id="${id}"]`);
  if (row) row.remove();
  if (!container.querySelector(".calc-card-row") && CALC_CARD_ADD_FNS[containerId]) {
    CALC_CARD_ADD_FNS[containerId]();
  }
}
window.removeCalcCard = removeCalcCard;

// ===== Page init / calculator switching =====

function initCalculatorsPage() {
  const select = document.getElementById("calc-type-select");
  const outputCard = document.getElementById("calc-output-card");
  if (outputCard) outputCard.style.display = "none";
  if (select && select.value) {
    switchCalculator(select.value);
  } else {
    const container = document.getElementById("calc-input-container");
    if (container) container.innerHTML = "";
  }
}

function switchCalculator(type) {
  const container = document.getElementById("calc-input-container");
  const outputCard = document.getElementById("calc-output-card");
  if (outputCard) outputCard.style.display = "none";
  if (!container) return;
  if (!type) {
    container.innerHTML = "";
    return;
  }
  const renderers = {
    concrete: renderConcreteCalculator,
    blockwork: renderBlockworkCalculator,
    plastering: renderPlasteringCalculator,
    piping: renderPipingCalculator,
    electrical: renderElectricalCalculator,
    firealarm: renderFireAlarmCalculator,
    rebar: renderRebarCalculator,
  };
  if (renderers[type]) renderers[type](container);
}

function showCalcOutput(text) {
  const outputCard = document.getElementById("calc-output-card");
  const output = document.getElementById("calc-output");
  if (output) output.value = text;
  if (outputCard) outputCard.style.display = "block";
  if (outputCard) outputCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function copyCalculatorOutput() {
  const output = document.getElementById("calc-output");
  if (!output || !output.value) return;
  const finish = () => {
    if (typeof showSyncToast === "function")
      showSyncToast("📋 Copied to clipboard");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(output.value).then(finish).catch(() => {
      output.select();
      document.execCommand("copy");
      finish();
    });
  } else {
    output.select();
    document.execCommand("copy");
    finish();
  }
}
window.copyCalculatorOutput = copyCalculatorOutput;
window.switchCalculator = switchCalculator;

// ===== CONCRETE =====

function renderConcreteCalculator(container) {
  container.innerHTML = `
    <div id="concrete-elements-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addConcreteElement()">
      <i class="fas fa-plus"></i> Add Element
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculateConcrete()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  CALC_CARD_ADD_FNS["concrete-elements-container"] = addConcreteElement;
  addConcreteElement();
}

function addConcreteElement() {
  const container = document.getElementById("concrete-elements-container");
  if (!container) return;
  const id = `concreteel${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const body = `
    <label style="display:block; font-weight:800; margin-bottom:4px;">Length (m)</label>
    <input type="number" class="ce-l" step="0.01" min="0" placeholder="e.g. 3.0">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Width (m)</label>
    <input type="number" class="ce-w" step="0.01" min="0" placeholder="e.g. 2.0">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Height / Thickness (m)</label>
    <input type="number" class="ce-h" step="0.01" min="0" placeholder="e.g. 0.15">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Concrete Mix Ratio</label>
    <select class="ce-mix">
      <option value="1:1.5:3">1 : 1.5 : 3 (high strength — columns/beams)</option>
      <option value="1:2:4" selected>1 : 2 : 4 (standard — slabs/general RC work)</option>
      <option value="1:3:6">1 : 3 : 6 (mass concrete/blinding)</option>
    </select>
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Reinforcement</label>
    <select class="ce-rebar">
      <option value="none">None</option>
      <option value="single" selected>Single layer</option>
      <option value="double">Double layer</option>
    </select>
  `;
  container.insertAdjacentHTML(
    "beforeend",
    buildCardShellHtml(
      id,
      "concrete-elements-container",
      "Element name (e.g. Foundation, Column, Beam, Lintel)",
      body,
      `<input type="number" class="ce-qty" min="1" step="1" value="1" placeholder="Qty" title="Quantity (e.g. number of identical columns)" style="width:25%; flex:none; text-align:center; margin:0;" onclick="event.stopPropagation();">`,
    ),
  );
}
window.addConcreteElement = addConcreteElement;

function calculateConcrete() {
  const rows = document.querySelectorAll("#concrete-elements-container .calc-card-row");
  if (!rows.length) {
    alert("Add at least one element");
    return;
  }
  const c = getCalcConstants();

  let grandCementBags = 0;
  let grandSandTons = 0;
  let grandAggregateTons = 0;
  let grandRebarKg = 0;
  let grandBindingWireKg = 0;
  let grandFormworkArea = 0;
  let grandNailsKg = 0;
  const elementLines = [];
  let anyEntered = false;

  rows.forEach((row, idx) => {
    const name = row.querySelector(".calc-card-name").value.trim() || `Element ${idx + 1}`;
    const qty = Math.max(1, Number(row.querySelector(".ce-qty").value) || 1);
    const L = Number(row.querySelector(".ce-l").value) || 0;
    const W = Number(row.querySelector(".ce-w").value) || 0;
    const H = Number(row.querySelector(".ce-h").value) || 0;
    if (L <= 0 || W <= 0 || H <= 0) return;
    anyEntered = true;

    const mix = row.querySelector(".ce-mix").value;
    const rebarChoice = row.querySelector(".ce-rebar").value;
    const parts = mix.split(":").map(Number);
    const sumParts = parts[0] + parts[1] + parts[2];

    const wetVolume = L * W * H;
    const dryVolume = wetVolume * c.concrete.dryVolumeFactor;
    const cementVolume = (dryVolume * parts[0]) / sumParts;
    const sandVolume = (dryVolume * parts[1]) / sumParts;
    const aggregateVolume = (dryVolume * parts[2]) / sumParts;

    let cementBags =
      (cementVolume * c.concrete.cementDensityKgM3) / c.general.cementBagWeightKg;
    let sandTons = (sandVolume * c.general.sandDensityKgM3) / 1000;
    let aggregateTons = (aggregateVolume * c.general.aggregateDensityKgM3) / 1000;

    let rebarKg = 0;
    if (rebarChoice === "single") rebarKg = wetVolume * c.concrete.rebarKgPerM3Single;
    if (rebarChoice === "double") rebarKg = wetVolume * c.concrete.rebarKgPerM3Double;
    let formworkArea = 2 * (L + W) * H * c.concrete.formworkFactor;
    let bindingWireKg = (rebarKg / 1000) * c.concrete.bindingWireKgPerTonRebar;
    let nailsKg = formworkArea * c.concrete.nailsKgPerM2Formwork;

    // Apply quantity (e.g. 8 identical columns) to every derived total
    cementBags *= qty;
    sandTons *= qty;
    aggregateTons *= qty;
    rebarKg *= qty;
    formworkArea *= qty;
    bindingWireKg *= qty;
    nailsKg *= qty;

    grandCementBags += cementBags;
    grandSandTons += sandTons;
    grandAggregateTons += aggregateTons;
    grandRebarKg += rebarKg;
    grandBindingWireKg += bindingWireKg;
    grandFormworkArea += formworkArea;
    grandNailsKg += nailsKg;

    const rebarLabel = rebarChoice === "none" ? "none" : rebarChoice;
    elementLines.push(
      `  ${name}${qty > 1 ? ` (×${qty})` : ""}: ${fmtNum(L)}x${fmtNum(W)}x${fmtNum(H)}m, mix ${mix}, rebar ${rebarLabel} → ${fmtNum(Math.ceil(cementBags), 0)} bags, ${fmtNum(sandTons, 2)}t sand, ${fmtNum(aggregateTons, 2)}t granite${rebarChoice !== "none" ? `, ${fmtNum(rebarKg, 1)}kg rebar` : ""}`,
    );
  });

  if (!anyEntered) {
    alert("Enter Length, Width and Height (all > 0) for at least one element");
    return;
  }

  const lines = [
    "CONCRETE CALCULATION",
    "",
    "Elements:",
    ...elementLines,
    "",
    "-- Totals (all elements) --",
    `Cement: ${fmtNum(Math.ceil(grandCementBags), 0)} bags (${c.general.cementBagWeightKg}kg)`,
    `Sand: ${fmtNum(grandSandTons, 2)} tons`,
    `Aggregate (Granite): ${fmtNum(grandAggregateTons, 2)} tons`,
    grandRebarKg > 0 ? `Reinforcement (Rebar): ${fmtNum(grandRebarKg, 1)} kg` : "",
    grandBindingWireKg > 0 ? `Binding Wire: ${fmtNum(grandBindingWireKg, 2)} kg` : "",
    `Formwork Area: ${fmtNum(grandFormworkArea, 2)} m²`,
    `Nails: ${fmtNum(grandNailsKg, 2)} kg`,
    "",
    "Note: Estimate only — confirm against project specification.",
  ].filter((l) => l !== "");

  showCalcOutput(lines.join("\n"));
}
window.calculateConcrete = calculateConcrete;

// ===== BLOCKWORK =====

function renderBlockworkCalculator(container) {
  container.innerHTML = `
    <div id="blockwork-elements-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addBlockworkElement()">
      <i class="fas fa-plus"></i> Add Wall
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculateBlockwork()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  CALC_CARD_ADD_FNS["blockwork-elements-container"] = addBlockworkElement;
  addBlockworkElement();
}

function addBlockworkElement() {
  const container = document.getElementById("blockwork-elements-container");
  if (!container) return;
  const id = `blockworkel${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const body = `
    <label style="display:block; font-weight:800; margin-bottom:4px;">Wall Length (m)</label>
    <input type="number" class="bw-l" step="0.01" min="0" placeholder="e.g. 10">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Wall Height (m)</label>
    <input type="number" class="bw-h" step="0.01" min="0" placeholder="e.g. 3">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Openings to Deduct (m², optional)</label>
    <input type="number" class="bw-openings" step="0.01" min="0" placeholder="e.g. 4.2 (doors/windows)">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Block Type</label>
    <select class="bw-type">
      <option value="6">6" Block</option>
      <option value="9" selected>9" Block</option>
    </select>
  `;
  container.insertAdjacentHTML(
    "beforeend",
    buildCardShellHtml(id, "blockwork-elements-container", "Wall name (e.g. Wall 1, Boundary Wall)", body),
  );
}
window.addBlockworkElement = addBlockworkElement;

function calculateBlockwork() {
  const rows = document.querySelectorAll("#blockwork-elements-container .calc-card-row");
  if (!rows.length) {
    alert("Add at least one wall");
    return;
  }
  const c = getCalcConstants();

  let grandBlocks = 0;
  let grandCementBags = 0;
  let grandSandTons = 0;
  const elementLines = [];
  let anyEntered = false;

  rows.forEach((row, idx) => {
    const name = row.querySelector(".calc-card-name").value.trim() || `Wall ${idx + 1}`;
    const L = Number(row.querySelector(".bw-l").value) || 0;
    const H = Number(row.querySelector(".bw-h").value) || 0;
    const openings = Number(row.querySelector(".bw-openings").value) || 0;
    if (L <= 0 || H <= 0) return;
    anyEntered = true;

    const type = row.querySelector(".bw-type").value;
    const grossArea = L * H;
    const netArea = Math.max(grossArea - openings, 0);

    const blocksPerM2 =
      type === "6" ? c.blockwork.blocksPerM2_6in : c.blockwork.blocksPerM2_9in;
    const mortarM3PerM2 =
      type === "6" ? c.blockwork.mortarM3PerM2_6in : c.blockwork.mortarM3PerM2_9in;

    const blocksNeeded = Math.ceil(netArea * blocksPerM2);
    const mortarWetVolume = netArea * mortarM3PerM2;
    const mortarDryVolume = mortarWetVolume * c.blockwork.mortarDryVolumeFactor;
    const sumParts = c.blockwork.mortarCementRatio + c.blockwork.mortarSandRatio;
    const cementVolume = (mortarDryVolume * c.blockwork.mortarCementRatio) / sumParts;
    const sandVolume = (mortarDryVolume * c.blockwork.mortarSandRatio) / sumParts;
    const cementBags =
      (cementVolume * c.concrete.cementDensityKgM3) / c.general.cementBagWeightKg;
    const sandTons = (sandVolume * c.general.sandDensityKgM3) / 1000;

    grandBlocks += blocksNeeded;
    grandCementBags += cementBags;
    grandSandTons += sandTons;

    elementLines.push(
      `  ${name}: ${fmtNum(L)}m x ${fmtNum(H)}m, ${type}" block${openings > 0 ? `, ${fmtNum(openings, 2)}m² openings deducted` : ""} → ${fmtNum(blocksNeeded, 0)} blocks, ${fmtNum(Math.ceil(cementBags), 0)} bags cement, ${fmtNum(sandTons, 2)}t sand`,
    );
  });

  if (!anyEntered) {
    alert("Enter Wall Length and Height (both > 0) for at least one wall");
    return;
  }

  const lines = [
    "BLOCKWORK CALCULATION",
    "",
    "Walls:",
    ...elementLines,
    "",
    "-- Totals (all walls) --",
    `Blocks Required: ${fmtNum(grandBlocks, 0)} pcs`,
    `Mortar Cement: ${fmtNum(Math.ceil(grandCementBags), 0)} bags (${c.general.cementBagWeightKg}kg)`,
    `Mortar Sand: ${fmtNum(grandSandTons, 2)} tons`,
    "",
    `(Mortar mix used: ${c.blockwork.mortarCementRatio}:${c.blockwork.mortarSandRatio} cement:sand — adjust in Constants)`,
    "Note: Estimate only — confirm against project specification.",
  ];

  showCalcOutput(lines.join("\n"));
}
window.calculateBlockwork = calculateBlockwork;

// ===== PLASTERING =====

function renderPlasteringCalculator(container) {
  container.innerHTML = `
    <div id="plastering-elements-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addPlasteringElement()">
      <i class="fas fa-plus"></i> Add Wall
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculatePlastering()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  CALC_CARD_ADD_FNS["plastering-elements-container"] = addPlasteringElement;
  addPlasteringElement();
}

function addPlasteringElement() {
  const container = document.getElementById("plastering-elements-container");
  if (!container) return;
  const c = getCalcConstants();
  const id = `plasterel${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const body = `
    <label style="display:block; font-weight:800; margin-bottom:4px;">Wall Length (m)</label>
    <input type="number" class="pl-l" step="0.01" min="0" placeholder="e.g. 10">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Wall Height (m)</label>
    <input type="number" class="pl-h" step="0.01" min="0" placeholder="e.g. 3">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Openings to Deduct (m², optional)</label>
    <input type="number" class="pl-openings" step="0.01" min="0" placeholder="e.g. 4.2">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Thickness (mm)</label>
    <input type="number" class="pl-thickness" step="1" min="0" value="${c.plastering.defaultThicknessMm}">
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Mix Ratio (Cement : Sand)</label>
    <select class="pl-mix">
      <option value="1:4">1 : 4 (external / dense finish)</option>
      <option value="1:6" selected>1 : 6 (standard internal)</option>
      <option value="1:8">1 : 8 (light finish)</option>
    </select>
  `;
  container.insertAdjacentHTML(
    "beforeend",
    buildCardShellHtml(id, "plastering-elements-container", "Wall name (e.g. Wall 1, Living Room)", body),
  );
}
window.addPlasteringElement = addPlasteringElement;

function calculatePlastering() {
  const rows = document.querySelectorAll("#plastering-elements-container .calc-card-row");
  if (!rows.length) {
    alert("Add at least one wall");
    return;
  }
  const c = getCalcConstants();

  let grandCementBags = 0;
  let grandSandTons = 0;
  const elementLines = [];
  let anyEntered = false;

  rows.forEach((row, idx) => {
    const name = row.querySelector(".calc-card-name").value.trim() || `Wall ${idx + 1}`;
    const L = Number(row.querySelector(".pl-l").value) || 0;
    const H = Number(row.querySelector(".pl-h").value) || 0;
    const openings = Number(row.querySelector(".pl-openings").value) || 0;
    const thicknessMm = Number(row.querySelector(".pl-thickness").value) || 0;
    if (L <= 0 || H <= 0 || thicknessMm <= 0) return;
    anyEntered = true;

    const mix = row.querySelector(".pl-mix").value;
    const parts = mix.split(":").map(Number);
    const sumParts = parts[0] + parts[1];

    const grossArea = L * H;
    const netArea = Math.max(grossArea - openings, 0);
    const wetVolume = netArea * (thicknessMm / 1000);
    const dryVolume = wetVolume * c.plastering.dryVolumeFactor;

    const cementVolume = (dryVolume * parts[0]) / sumParts;
    const sandVolume = (dryVolume * parts[1]) / sumParts;
    const cementBags =
      (cementVolume * c.concrete.cementDensityKgM3) / c.general.cementBagWeightKg;
    const sandTons = (sandVolume * c.general.sandDensityKgM3) / 1000;

    grandCementBags += cementBags;
    grandSandTons += sandTons;

    elementLines.push(
      `  ${name}: ${fmtNum(L)}m x ${fmtNum(H)}m, ${thicknessMm}mm, mix ${mix}${openings > 0 ? `, ${fmtNum(openings, 2)}m² openings deducted` : ""} → ${fmtNum(Math.ceil(cementBags), 0)} bags cement, ${fmtNum(sandTons, 2)}t sand`,
    );
  });

  if (!anyEntered) {
    alert("Enter Length, Height and Thickness (all > 0) for at least one wall");
    return;
  }

  const lines = [
    "PLASTERING CALCULATION",
    "",
    "Walls:",
    ...elementLines,
    "",
    "-- Totals (all walls) --",
    `Cement: ${fmtNum(Math.ceil(grandCementBags), 0)} bags (${c.general.cementBagWeightKg}kg)`,
    `Sand: ${fmtNum(grandSandTons, 2)} tons`,
    "",
    "Note: Estimate only — confirm against project specification.",
  ];

  showCalcOutput(lines.join("\n"));
}
window.calculatePlastering = calculatePlastering;

// ===== BATHROOM PIPING =====

function renderPipingCalculator(container) {
  container.innerHTML = `
    <div id="bathroom-elements-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addBathroomElement()">
      <i class="fas fa-plus"></i> Add Bathroom
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculatePiping()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  CALC_CARD_ADD_FNS["bathroom-elements-container"] = addBathroomElement;
  addBathroomElement();
}

function addBathroomElement() {
  const container = document.getElementById("bathroom-elements-container");
  if (!container) return;
  const id = `bathroomel${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const fixtureRows = PIPING_FIXTURES.map(
    (f) => `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
      <input type="number" class="pp-count-${f.key}" min="0" step="1" value="0" style="width:70px; flex:none;">
      <span style="font-weight:700; font-size:14px;">${f.label}</span>
    </div>`,
  ).join("");

  const body = `
    <label style="display:block; font-weight:800; margin-bottom:4px;">Calculate By</label>
    <select class="pp-mode" onchange="window.togglePipingMode('${id}')">
      <option value="fixtures">Fixtures (pick counts below)</option>
      <option value="size">Bathroom Size (auto-fills fixture counts)</option>
    </select>
    <div class="pp-size-row" style="display:none; margin-top:10px;">
      <label style="display:block; font-weight:800; margin-bottom:4px;">Bathroom Size</label>
      <select class="pp-size" onchange="window.applyPipingSizePreset('${id}')">
        <option value="small">Small (e.g. guest WC/shower)</option>
        <option value="medium">Medium (WC, WHB, Shower, Bathtub, Geyser)</option>
        <option value="large">Large (Master ensuite, 2x WHB)</option>
      </select>
    </div>

    <label style="display:block; font-weight:800; margin: 14px 0 6px;">Fixtures</label>
    ${fixtureRows}
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
      <input type="number" class="pp-count-floorDrain" min="0" step="1" value="1" style="width:70px; flex:none;">
      <span style="font-weight:700; font-size:14px;">Floor Drain(s)</span>
    </div>

    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Supply Pipe Material</label>
    <select class="pp-supply-material">
      <option value="PPR">PPR</option>
      <option value="PVC">PVC</option>
    </select>
    <label style="display:block; font-weight:800; margin: 10px 0 4px;">Water Drainage Pipe Size</label>
    <select class="pp-drain-size">
      <option value="2">2" PVC</option>
      <option value="3">3" PVC</option>
    </select>
    <div style="font-size:12px; color:var(--muted); margin-top:4px;">WC waste is always 4" PVC (fixed).</div>
  `;

  container.insertAdjacentHTML(
    "beforeend",
    buildCardShellHtml(id, "bathroom-elements-container", "Bathroom name (e.g. Bathroom 1)", body),
  );
}
window.addBathroomElement = addBathroomElement;

function togglePipingMode(id) {
  const row = document.querySelector(`.calc-card-row[data-card-id="${id}"]`);
  if (!row) return;
  const mode = row.querySelector(".pp-mode").value;
  const sizeRow = row.querySelector(".pp-size-row");
  if (sizeRow) sizeRow.style.display = mode === "size" ? "block" : "none";
  if (mode === "size") applyPipingSizePreset(id);
}
window.togglePipingMode = togglePipingMode;

function applyPipingSizePreset(id) {
  const row = document.querySelector(`.calc-card-row[data-card-id="${id}"]`);
  if (!row) return;
  const size = row.querySelector(".pp-size").value;
  const preset = PIPING_SIZE_PRESETS[size];
  if (!preset) return;
  Object.keys(preset).forEach((key) => {
    const input = row.querySelector(`.pp-count-${key}`);
    if (input) input.value = preset[key];
  });
}
window.applyPipingSizePreset = applyPipingSizePreset;

function calculatePiping() {
  const rows = document.querySelectorAll("#bathroom-elements-container .calc-card-row");
  if (!rows.length) {
    alert("Add at least one bathroom");
    return;
  }
  const c = getCalcConstants().piping;

  const supplyLenByMaterial = {};
  const branchDrainLenBySize = {};
  let totalElbows = 0;
  let totalTees = 0;
  let totalWasteDrainLen = 0;
  let totalDrainElbows = 0;
  const bathroomSummaries = [];
  let anyEntered = false;

  rows.forEach((row, idx) => {
    const name = row.querySelector(".calc-card-name").value.trim() || `Bathroom ${idx + 1}`;
    const counts = {};
    PIPING_FIXTURES.forEach((f) => {
      counts[f.key] = Number(row.querySelector(`.pp-count-${f.key}`).value) || 0;
    });
    counts.floorDrain = Number(row.querySelector(".pp-count-floorDrain").value) || 0;
    const totalFixtures = PIPING_FIXTURES.reduce((sum, f) => sum + counts[f.key], 0);
    if (totalFixtures === 0 && counts.floorDrain === 0) return;
    anyEntered = true;

    const supplyMaterial = row.querySelector(".pp-supply-material").value;
    const drainSize = row.querySelector(".pp-drain-size").value;

    let roomSupplyLen = 0;
    PIPING_FIXTURES.forEach((f) => {
      const n = counts[f.key];
      if (!n) return;
      roomSupplyLen += n * c[`supplyLen_${f.key}`] * c[`supplyPoints_${f.key}`];
      totalElbows += n * c[`elbows_${f.key}`];
      totalTees += n * c[`tees_${f.key}`];
      totalDrainElbows += n * c.drainElbowsPerFixture;
      if (f.key === "wc") {
        totalWasteDrainLen += n * c.drainLen_wc;
      } else {
        branchDrainLenBySize[drainSize] =
          (branchDrainLenBySize[drainSize] || 0) + n * c[`drainLen_${f.key}`];
      }
    });
    if (counts.floorDrain) {
      branchDrainLenBySize[drainSize] =
        (branchDrainLenBySize[drainSize] || 0) + counts.floorDrain * c.drainLen_floorDrain;
      totalDrainElbows += counts.floorDrain * c.drainElbowsPerFixture;
    }
    supplyLenByMaterial[supplyMaterial] =
      (supplyLenByMaterial[supplyMaterial] || 0) + roomSupplyLen;

    const fixtureSummary = PIPING_FIXTURES.filter((f) => counts[f.key] > 0)
      .map((f) => `${f.label}: ${counts[f.key]}`)
      .join(", ");
    bathroomSummaries.push(
      `  ${name}: ${fixtureSummary || "no fixtures"}${counts.floorDrain ? `, Floor Drain: ${counts.floorDrain}` : ""} (${supplyMaterial} supply, ${drainSize}" drain)`,
    );
  });

  if (!anyEntered) {
    alert("Enter at least one fixture in a bathroom");
    return;
  }

  const supplyLines = Object.keys(supplyLenByMaterial).map(
    (mat) => `${mat}: ${fmtNum(supplyLenByMaterial[mat] * c.pipeWastageFactor, 1)} m`,
  );
  const drainLines = Object.keys(branchDrainLenBySize).map(
    (size) => `${size}" PVC: ${fmtNum(branchDrainLenBySize[size] * c.pipeWastageFactor, 1)} m`,
  );

  const lines = [
    "BATHROOM PIPING CALCULATION",
    "",
    "Bathrooms:",
    ...bathroomSummaries,
    "",
    `-- Supply Pipe (incl. ${Math.round((c.pipeWastageFactor - 1) * 100)}% wastage) --`,
    ...supplyLines,
    `Supply Fittings: ${fmtNum(totalElbows, 0)} elbows, ${fmtNum(totalTees, 0)} tees`,
    "",
    "-- Drainage --",
    `WC Waste Pipe (4" PVC, fixed): ${fmtNum(totalWasteDrainLen * c.pipeWastageFactor, 1)} m`,
    ...drainLines,
    `Drainage Fittings: ${fmtNum(totalDrainElbows, 0)} elbows/junctions`,
    "",
    "Note: Estimate only — actual routing/rise & fall may add length. Confirm against project specification.",
  ];

  showCalcOutput(lines.join("\n"));
}
window.calculatePiping = calculatePiping;

// ===== LOW VOLTAGE ELECTRICAL =====
// Modeled per-room (add/remove rows) since, unlike bathrooms, the number of
// rooms varies per project. Each room is assumed to run its own lighting
// and socket circuit back to the DB (a conservative simplification — real
// designs sometimes share circuits across rooms); each dedicated appliance
// (AC/Water Heater/Cooker/Pump) gets its own home-run circuit, which is
// standard practice.

let elecRoomCounter = 0;

function renderElectricalCalculator(container) {
  elecRoomCounter = 0;
  container.innerHTML = `
    <div id="elec-rooms-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addElecRoom()">
      <i class="fas fa-plus"></i> Add Room
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculateElectrical()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  addElecRoom();
}

function addElecRoom() {
  const container = document.getElementById("elec-rooms-container");
  if (!container) return;
  elecRoomCounter++;
  const id = `elecroom${elecRoomCounter}`;
  const row = document.createElement("div");
  row.className = "elec-room-row";
  row.dataset.roomId = id;
  row.style.cssText =
    "border:1px solid var(--border); border-radius:10px; margin-bottom:10px; background:var(--card); overflow:hidden;";
  row.innerHTML = `
    <div class="elec-room-header" style="display:flex; align-items:center; gap:8px; padding:12px; cursor:pointer;" onclick="window.toggleElecRoom('${id}')">
      <i class="fas fa-chevron-down elec-room-chevron" style="transition: transform 0.15s; flex:none;"></i>
      <input class="elec-room-name" placeholder="Room name (e.g. Living Room)" style="flex:1; font-weight:700; margin:0;" onclick="event.stopPropagation();">
      <span onclick="event.stopPropagation(); window.removeElecRoom('${id}')" style="color:var(--danger); font-size:18px; font-weight:800; padding:0 6px; flex:none;">&times;</span>
    </div>
    <div class="elec-room-body" style="padding: 0 12px 12px 12px;">
      <label style="font-size:11px; font-weight:700; display:block; margin-bottom:4px;">Light Points</label>
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:6px; margin-bottom:8px;">
        <div><label style="font-size:11px; display:block;">Ceiling</label><input type="number" class="elec-light-ceiling elec-light-input" min="0" value="0"></div>
        <div><label style="font-size:11px; display:block;">Wall</label><input type="number" class="elec-light-wall elec-light-input" min="0" value="0"></div>
        <div><label style="font-size:11px; display:block;">Hanging</label><input type="number" class="elec-light-hanging elec-light-input" min="0" value="0"></div>
        <div><label style="font-size:11px; display:block;">Rope</label><input type="number" class="elec-light-rope elec-light-input" min="0" value="0"></div>
      </div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
        <div><label style="font-size:11px; font-weight:700; display:block;">Switch Points</label><input type="number" class="elec-switch-points" min="0" value="0"></div>
        <div><label style="font-size:11px; font-weight:700; display:block;">Switches (gangs)</label><input type="number" class="elec-switch-gangs" min="0" value="0"></div>
        <div><label style="font-size:11px; font-weight:700; display:block;">Socket Outlets</label><input type="number" class="elec-socket-outlets" min="0" value="0"></div>
        <div><label style="font-size:11px; font-weight:700; display:block;">Water Heater/Geyser Points</label><input type="number" class="elec-wh" min="0" value="0"></div>
        <div><label style="font-size:11px; font-weight:700; display:block;">Cooker Points</label><input type="number" class="elec-cooker" min="0" value="0"></div>
        <div><label style="font-size:11px; font-weight:700; display:block;">Water Pump Points</label><input type="number" class="elec-pump" min="0" value="0"></div>
      </div>

      <label style="font-size:11px; font-weight:700; display:block; margin-top:10px; margin-bottom:4px;">Kitchen Socket Outlet & Cable</label>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
        <input type="number" class="elec-kitchen-sockets" min="0" value="0" placeholder="Count">
        <select class="elec-kitchen-cable">
          <option value="2.5" selected>2.5mm</option>
          <option value="4">4mm</option>
        </select>
      </div>

      <label style="font-size:11px; font-weight:700; display:block; margin-top:10px; margin-bottom:4px;">A/C Socket & Cable</label>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
        <input type="number" class="elec-ac" min="0" value="0" placeholder="Count">
        <select class="elec-ac-cable">
          <option value="2.5" selected>2.5mm</option>
          <option value="4">4mm</option>
        </select>
      </div>

      <label style="font-size:11px; font-weight:700; display:block; margin-top:10px; margin-bottom:4px;">Special Outlet Point & Cable</label>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
        <input type="number" class="elec-special" min="0" value="0" placeholder="Count">
        <select class="elec-special-cable">
          <option value="4" selected>4mm</option>
          <option value="6">6mm</option>
          <option value="10">10mm</option>
        </select>
      </div>

      <label style="font-size:11px; font-weight:700; display:block; margin-top:10px;">Distance to DB (m)</label>
      <input type="number" class="elec-distance" min="0" step="0.1" value="0">
    </div>
  `;
  container.appendChild(row);
}
window.addElecRoom = addElecRoom;

function toggleElecRoom(id) {
  const row = document.querySelector(`.elec-room-row[data-room-id="${id}"]`);
  if (!row) return;
  const body = row.querySelector(".elec-room-body");
  const chevron = row.querySelector(".elec-room-chevron");
  const collapsing = body.style.display !== "none";
  body.style.display = collapsing ? "none" : "block";
  if (chevron) chevron.style.transform = collapsing ? "rotate(-90deg)" : "rotate(0deg)";
}
window.toggleElecRoom = toggleElecRoom;

function removeElecRoom(id) {
  const container = document.getElementById("elec-rooms-container");
  if (!container) return;
  const row = container.querySelector(`[data-room-id="${id}"]`);
  if (row) row.remove();
  if (!container.querySelector(".elec-room-row")) addElecRoom();
}
window.removeElecRoom = removeElecRoom;

function calculateElectrical() {
  const rows = document.querySelectorAll("#elec-rooms-container .elec-room-row");
  if (!rows.length) {
    alert("Add at least one room");
    return;
  }
  const c = getCalcConstants().electrical;

  // cable length totals keyed by mm² size, plus tallies for everything else
  const cableBySizeM = {};
  const addCable = (sizeMm2, lengthM) => {
    if (lengthM <= 0) return;
    cableBySizeM[sizeMm2] = (cableBySizeM[sizeMm2] || 0) + lengthM;
  };

  let totalConduitM = 0;
  let earthCableM = 0;
  let lightPointsTotal = 0;
  let ceilingTotal = 0;
  let wallTotal = 0;
  let hangingTotal = 0;
  let ropeTotal = 0;
  let switchPointsTotal = 0;
  let switchGangsTotal = 0;
  let socketOutletsTotal = 0;
  let kitchenSocketsTotal = 0;
  let acTotal = 0;
  let whTotal = 0;
  let cookerTotal = 0;
  let pumpTotal = 0;
  let specialTotal = 0;
  let circuitCount = 0;
  const roomSummaries = [];
  let anyRoomEntered = false;
  const conductors = c.conductorsPerCircuit;

  rows.forEach((row) => {
    const name = row.querySelector(".elec-room-name").value.trim() || "Room";
    const ceiling = Number(row.querySelector(".elec-light-ceiling").value) || 0;
    const wall = Number(row.querySelector(".elec-light-wall").value) || 0;
    const hanging = Number(row.querySelector(".elec-light-hanging").value) || 0;
    const rope = Number(row.querySelector(".elec-light-rope").value) || 0;
    const lightPoints = ceiling + wall + hanging + rope;
    const switchPoints = Number(row.querySelector(".elec-switch-points").value) || 0;
    const switchGangs = Number(row.querySelector(".elec-switch-gangs").value) || 0;
    const socketOutlets = Number(row.querySelector(".elec-socket-outlets").value) || 0;
    const kitchenSockets = Number(row.querySelector(".elec-kitchen-sockets").value) || 0;
    const kitchenCable = Number(row.querySelector(".elec-kitchen-cable").value);
    const ac = Number(row.querySelector(".elec-ac").value) || 0;
    const acCable = Number(row.querySelector(".elec-ac-cable").value);
    const wh = Number(row.querySelector(".elec-wh").value) || 0;
    const cooker = Number(row.querySelector(".elec-cooker").value) || 0;
    const pump = Number(row.querySelector(".elec-pump").value) || 0;
    const special = Number(row.querySelector(".elec-special").value) || 0;
    const specialCable = Number(row.querySelector(".elec-special-cable").value);
    const distance = Number(row.querySelector(".elec-distance").value) || 0;

    if (
      lightPoints === 0 &&
      switchPoints === 0 &&
      socketOutlets === 0 &&
      kitchenSockets === 0 &&
      ac === 0 &&
      wh === 0 &&
      cooker === 0 &&
      pump === 0 &&
      special === 0
    ) {
      return; // skip an empty/unused room row
    }
    anyRoomEntered = true;

    const runLen = distance + c.circuitAllowanceM;
    let roomCircuits = 0;

    if (lightPoints > 0) {
      addCable(c.cableSizeLightingMm2, runLen * conductors);
      totalConduitM += runLen;
      roomCircuits += 1;
    }
    if (socketOutlets > 0) {
      addCable(c.cableSizeSocketMm2, runLen * conductors);
      earthCableM += runLen * c.earthWireFactor;
      totalConduitM += runLen;
      roomCircuits += 1;
    }
    if (kitchenSockets > 0) {
      addCable(kitchenCable, runLen * conductors);
      earthCableM += runLen * c.earthWireFactor;
      totalConduitM += runLen;
      roomCircuits += 1;
    }
    if (ac > 0) {
      addCable(acCable, runLen * ac * conductors);
      earthCableM += runLen * ac * c.earthWireFactor;
      totalConduitM += runLen * ac;
      roomCircuits += ac;
    }
    if (wh > 0) {
      addCable(c.cableSizeWaterHeaterMm2, runLen * wh * conductors);
      earthCableM += runLen * wh * c.earthWireFactor;
      totalConduitM += runLen * wh;
      roomCircuits += wh;
    }
    if (cooker > 0) {
      addCable(c.cableSizeCookerMm2, runLen * cooker * conductors);
      earthCableM += runLen * cooker * c.earthWireFactor;
      totalConduitM += runLen * cooker;
      roomCircuits += cooker;
    }
    if (pump > 0) {
      addCable(c.cableSizePumpMm2, runLen * pump * conductors);
      earthCableM += runLen * pump * c.earthWireFactor;
      totalConduitM += runLen * pump;
      roomCircuits += pump;
    }
    if (special > 0) {
      addCable(specialCable, runLen * special * conductors);
      earthCableM += runLen * special * c.earthWireFactor;
      totalConduitM += runLen * special;
      roomCircuits += special;
    }

    lightPointsTotal += lightPoints;
    ceilingTotal += ceiling;
    wallTotal += wall;
    hangingTotal += hanging;
    ropeTotal += rope;
    switchPointsTotal += switchPoints;
    switchGangsTotal += switchGangs;
    socketOutletsTotal += socketOutlets;
    kitchenSocketsTotal += kitchenSockets;
    acTotal += ac;
    whTotal += wh;
    cookerTotal += cooker;
    pumpTotal += pump;
    specialTotal += special;
    circuitCount += roomCircuits;

    roomSummaries.push(
      `  ${name}: ${lightPoints} light, ${socketOutlets + kitchenSockets} socket${ac || wh || cooker || pump || special ? `, dedicated: ${[ac && `${ac} AC`, wh && `${wh} WH`, cooker && `${cooker} Cooker`, pump && `${pump} Pump`, special && `${special} Special`].filter(Boolean).join(", ")}` : ""} (${roomCircuits} circuit${roomCircuits === 1 ? "" : "s"}, ${fmtNum(distance, 1)}m to DB)`,
    );
  });

  if (!anyRoomEntered) {
    alert("Enter at least one point (light, socket, or dedicated circuit) in a room");
    return;
  }

  const cableLines = Object.keys(cableBySizeM)
    .map(Number)
    .sort((a, b) => a - b)
    .map((size) => `${size}mm²: ${fmtNum(cableBySizeM[size] * c.cableWastageFactor, 1)} m`);

  const junctionBoxes = Math.ceil(lightPointsTotal * c.junctionBoxesPerLightPoint);
  const totalCableLenAllSizes = Object.values(cableBySizeM).reduce((a, b) => a + b, 0);
  const cableClips = Math.ceil(
    (totalCableLenAllSizes + totalConduitM) * c.cableClipsPerMeter,
  );

  const lines = [
    "LOW VOLTAGE ELECTRICAL CALCULATION",
    "",
    "Rooms:",
    ...roomSummaries,
    "",
    "-- Cable (PVC insulated, by size) --",
    ...cableLines,
    `Earth Wire: ${fmtNum(earthCableM * c.cableWastageFactor, 1)} m`,
    "",
    "-- Conduit & Accessories --",
    `Conduit (${c.conduitSizeMm}mm): ${fmtNum(totalConduitM * c.conduitWastageFactor, 1)} m`,
    `Cable Clips/Saddles: ${fmtNum(cableClips, 0)} pcs`,
    `Junction Boxes: ${fmtNum(junctionBoxes, 0)} pcs`,
    "",
    "-- Points & Accessories --",
    `Light Points (total fittings): ${fmtNum(lightPointsTotal, 0)}`,
    ceilingTotal ? `  Ceiling: ${fmtNum(ceilingTotal, 0)}` : "",
    wallTotal ? `  Wall: ${fmtNum(wallTotal, 0)}` : "",
    hangingTotal ? `  Hanging: ${fmtNum(hangingTotal, 0)}` : "",
    ropeTotal ? `  Rope Light: ${fmtNum(ropeTotal, 0)} (counted as points/runs, not meters)` : "",
    `Switch Boxes: ${fmtNum(switchPointsTotal, 0)}`,
    `Switches (gang units): ${fmtNum(switchGangsTotal, 0)}`,
    `Socket Outlets (incl. boxes): ${fmtNum(socketOutletsTotal, 0)}`,
    kitchenSocketsTotal ? `Kitchen Socket Outlets: ${fmtNum(kitchenSocketsTotal, 0)}` : "",
    acTotal ? `AC/Split Unit Points: ${fmtNum(acTotal, 0)}` : "",
    whTotal ? `Water Heater/Geyser Points: ${fmtNum(whTotal, 0)}` : "",
    cookerTotal ? `Cooker Points: ${fmtNum(cookerTotal, 0)}` : "",
    pumpTotal ? `Water Pump Points: ${fmtNum(pumpTotal, 0)}` : "",
    specialTotal ? `Special Outlet Points: ${fmtNum(specialTotal, 0)}` : "",
    "",
    "-- Distribution Board (rough estimate, not a load calculation) --",
    `Circuits: ${fmtNum(circuitCount, 0)}`,
    `MCBs (1 per circuit): ${fmtNum(circuitCount, 0)}`,
    "Main Isolator/Incomer: 1 (size to be confirmed by electrician)",
    "",
    `Note: Cable is calculated as single-core (${conductors} live conductors per`,
    "circuit + separate earth wire, pulled through conduit) — not 3-core/",
    "multi-core sheathed cable. If you use 2-core-and-earth cable instead,",
    "set 'Conductors per circuit' to 1 in Constants. Estimate only. Assumes",
    "one circuit per room per type and one dedicated circuit per special",
    "appliance point. Confirm circuit design, cable sizing and DB/MCB",
    "ratings against project specification and applicable wiring regulations",
    "before ordering or installing.",
  ].filter((l) => l !== "");

  showCalcOutput(lines.join("\n"));
}
window.calculateElectrical = calculateElectrical;

// ===== FIRE ALARM =====
// System type (Addressable vs Conventional) is a single project-wide choice
// above the zone list. Addressable devices share loop cable and get isolator
// modules; Conventional zones each run their own cable back to the panel
// and get one zone card each. Cable length uses the same per-zone
// "distance to panel" approach as Electrical/Piping — a simplification,
// since real loop/zone routing order isn't modeled.

function renderFireAlarmCalculator(container) {
  container.innerHTML = `
    <label style="display:block; font-weight:800; margin-bottom:4px;">System Type</label>
    <select id="fa-system-type">
      <option value="addressable">Addressable</option>
      <option value="conventional">Conventional</option>
    </select>
    <label style="display:block; font-weight:800; margin: 14px 0 6px;">Zones / Rooms</label>
    <div id="firealarm-zones-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addFireAlarmZone()">
      <i class="fas fa-plus"></i> Add Zone
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculateFireAlarm()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  CALC_CARD_ADD_FNS["firealarm-zones-container"] = addFireAlarmZone;
  addFireAlarmZone();
}

function addFireAlarmZone() {
  const container = document.getElementById("firealarm-zones-container");
  if (!container) return;
  const id = `fazone${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const body = `
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
      <div><label style="font-size:11px; font-weight:700; display:block;">Smoke Detectors</label><input type="number" class="fa-smoke" min="0" value="0"></div>
      <div><label style="font-size:11px; font-weight:700; display:block;">Heat Detectors</label><input type="number" class="fa-heat" min="0" value="0"></div>
      <div><label style="font-size:11px; font-weight:700; display:block;">Call Points</label><input type="number" class="fa-callpoints" min="0" value="0"></div>
      <div><label style="font-size:11px; font-weight:700; display:block;">Sounders/Beacons</label><input type="number" class="fa-sounders" min="0" value="0"></div>
    </div>
    <label style="font-size:11px; font-weight:700; display:block; margin-top:8px;">Distance to Panel (m)</label>
    <input type="number" class="fa-distance" min="0" step="0.1" value="0">
  `;
  container.insertAdjacentHTML(
    "beforeend",
    buildCardShellHtml(id, "firealarm-zones-container", "Zone/room name (e.g. Zone 1, Reception)", body),
  );
}
window.addFireAlarmZone = addFireAlarmZone;

function calculateFireAlarm() {
  const rows = document.querySelectorAll("#firealarm-zones-container .calc-card-row");
  if (!rows.length) {
    alert("Add at least one zone");
    return;
  }
  const systemType = document.getElementById("fa-system-type").value;
  const c = getCalcConstants().firealarm;

  let totalCableM = 0;
  let smokeTotal = 0;
  let heatTotal = 0;
  let callPointsTotal = 0;
  let soundersTotal = 0;
  let zoneCount = 0;
  const zoneSummaries = [];
  let anyEntered = false;

  rows.forEach((row, idx) => {
    const name = row.querySelector(".calc-card-name").value.trim() || `Zone ${idx + 1}`;
    const smoke = Number(row.querySelector(".fa-smoke").value) || 0;
    const heat = Number(row.querySelector(".fa-heat").value) || 0;
    const callPoints = Number(row.querySelector(".fa-callpoints").value) || 0;
    const sounders = Number(row.querySelector(".fa-sounders").value) || 0;
    const distance = Number(row.querySelector(".fa-distance").value) || 0;
    const deviceCount = smoke + heat + callPoints + sounders;
    if (deviceCount === 0) return;
    anyEntered = true;

    const runLen = distance + c.circuitAllowanceM;
    totalCableM += runLen;
    zoneCount += 1;

    smokeTotal += smoke;
    heatTotal += heat;
    callPointsTotal += callPoints;
    soundersTotal += sounders;

    zoneSummaries.push(
      `  ${name}: ${smoke} smoke, ${heat} heat, ${callPoints} call point${callPoints === 1 ? "" : "s"}, ${sounders} sounder${sounders === 1 ? "" : "s"} (${fmtNum(distance, 1)}m to panel)`,
    );
  });

  if (!anyEntered) {
    alert("Enter at least one device in a zone");
    return;
  }

  const totalDevices = smokeTotal + heatTotal + callPointsTotal + soundersTotal;
  const spareSmoke = Math.ceil(smokeTotal * c.deviceSparePercent);
  const spareHeat = Math.ceil(heatTotal * c.deviceSparePercent);

  const lines = [
    "FIRE ALARM CALCULATION",
    `System Type: ${systemType === "addressable" ? "Addressable" : "Conventional"}`,
    "",
    "Zones:",
    ...zoneSummaries,
    "",
    "-- Cable --",
    `Fire-Rated Cable (${c.cableSizeMm2}mm², 2-core screened): ${fmtNum(totalCableM * c.cableWastageFactor, 1)} m (incl. ${Math.round((c.cableWastageFactor - 1) * 100)}% wastage)`,
    "",
    "-- Devices --",
    `Smoke Detectors: ${fmtNum(smokeTotal, 0)}${spareSmoke ? ` (+${spareSmoke} recommended spares)` : ""}`,
    `Heat Detectors: ${fmtNum(heatTotal, 0)}${spareHeat ? ` (+${spareHeat} recommended spares)` : ""}`,
    `Call Points: ${fmtNum(callPointsTotal, 0)}`,
    `Sounders/Beacons: ${fmtNum(soundersTotal, 0)}`,
    "",
    "-- Panel & Accessories --",
    "Fire Alarm Panel: 1",
    systemType === "addressable"
      ? `Loops Required: ${Math.ceil(totalDevices / c.addressableDevicesPerLoop)} (~${c.addressableDevicesPerLoop} devices/loop)`
      : `Zones Wired: ${zoneCount} (~${c.conventionalZonesPerPanel} zones/panel — ${Math.ceil(zoneCount / c.conventionalZonesPerPanel)} panel(s) suggested)`,
    systemType === "addressable"
      ? `Isolator Modules: ${Math.ceil(totalDevices / c.addressableIsolatorPerDevices)} (~1 per ${c.addressableIsolatorPerDevices} devices)`
      : `Zone Cards Required: ${zoneCount}`,
    "",
    "Note: Estimate only — not a full system design. Loop/zone routing,",
    "panel capacity, battery/PSU sizing and device spacing must be confirmed",
    "against the manufacturer's design manual and applicable fire codes.",
  ];

  showCalcOutput(lines.join("\n"));
}
window.calculateFireAlarm = calculateFireAlarm;

// ===== CONSTANTS EDITOR =====

const CALC_CONSTANTS_FIELD_LABELS = {
  general: {
    cementBagWeightKg: "Cement bag weight (kg)",
    sandDensityKgM3: "Sand density (kg/m³)",
    aggregateDensityKgM3: "Aggregate/granite density (kg/m³)",
  },
  concrete: {
    dryVolumeFactor: "Dry volume factor",
    cementDensityKgM3: "Cement density (kg/m³)",
    rebarKgPerM3Single: "Rebar — single layer (kg per m³ concrete)",
    rebarKgPerM3Double: "Rebar — double layer (kg per m³ concrete)",
    formworkFactor: "Formwork area factor",
    bindingWireKgPerTonRebar: "Binding wire (kg per ton rebar)",
    nailsKgPerM2Formwork: "Nails (kg per m² formwork)",
  },
  blockwork: {
    blocksPerM2_6in: "Blocks per m² — 6\" wall",
    blocksPerM2_9in: "Blocks per m² — 9\" wall",
    mortarM3PerM2_6in: "Mortar volume per m² — 6\" wall (m³)",
    mortarM3PerM2_9in: "Mortar volume per m² — 9\" wall (m³)",
    mortarCementRatio: "Mortar mix — cement parts",
    mortarSandRatio: "Mortar mix — sand parts",
    mortarDryVolumeFactor: "Mortar dry volume factor",
  },
  plastering: {
    defaultThicknessMm: "Default thickness (mm)",
    dryVolumeFactor: "Dry volume factor",
  },
  piping: {
    supplyLen_wc: "WC — supply length per point (m)",
    supplyPoints_wc: "WC — supply points",
    elbows_wc: "WC — elbows",
    tees_wc: "WC — tees",
    drainLen_wc: "WC — waste (4\") length (m)",

    supplyLen_whb: "Wash Basin — supply length per point (m)",
    supplyPoints_whb: "Wash Basin — supply points",
    elbows_whb: "Wash Basin — elbows",
    tees_whb: "Wash Basin — tees",
    drainLen_whb: "Wash Basin — drain length (m)",

    supplyLen_shower: "Shower — supply length per point (m)",
    supplyPoints_shower: "Shower — supply points",
    elbows_shower: "Shower — elbows",
    tees_shower: "Shower — tees",
    drainLen_shower: "Shower — drain length (m)",

    supplyLen_bathtub: "Bathtub — supply length per point (m)",
    supplyPoints_bathtub: "Bathtub — supply points",
    elbows_bathtub: "Bathtub — elbows",
    tees_bathtub: "Bathtub — tees",
    drainLen_bathtub: "Bathtub — drain length (m)",

    supplyLen_geyser: "Geyser — supply length per point (m)",
    supplyPoints_geyser: "Geyser — supply points",
    elbows_geyser: "Geyser — elbows",
    tees_geyser: "Geyser — tees",
    drainLen_geyser: "Geyser — relief drain length (m)",

    drainLen_floorDrain: "Floor Drain — drain length (m)",
    drainElbowsPerFixture: "Drain elbows/junctions per fixture",
    pipeWastageFactor: "Pipe wastage factor (1.1 = +10%)",
  },
  electrical: {
    cableSizeLightingMm2: "Lighting circuit cable size (mm²)",
    cableSizeSocketMm2: "Socket circuit cable size (mm²)",
    cableSizeWaterHeaterMm2: "Water Heater/Geyser cable size (mm²)",
    cableSizeCookerMm2: "Cooker cable size (mm²)",
    cableSizePumpMm2: "Water Pump cable size (mm²)",
    conductorsPerCircuit: "Conductors per circuit (2 = single-core L+N, 1 = multi-core cable)",
    circuitAllowanceM: "Extra length per circuit run (m, for drops/dressing)",
    cableWastageFactor: "Cable wastage factor (1.1 = +10%)",
    earthWireFactor: "Earth wire length (fraction of live cable, sockets/dedicated)",
    conduitSizeMm: "Conduit size (mm, label only)",
    conduitWastageFactor: "Conduit wastage factor (1.1 = +10%)",
    junctionBoxesPerLightPoint: "Junction boxes per light point",
    cableClipsPerMeter: "Cable clips/saddles per meter",
  },
  firealarm: {
    cableSizeMm2: "Fire-rated cable size (mm²)",
    circuitAllowanceM: "Extra length per zone/loop run (m)",
    cableWastageFactor: "Cable wastage factor (1.1 = +10%)",
    addressableDevicesPerLoop: "Addressable: devices per loop",
    addressableIsolatorPerDevices: "Addressable: 1 isolator per N devices",
    conventionalZonesPerPanel: "Conventional: zones per panel",
    deviceSparePercent: "Recommended spare detectors (fraction, 0.05 = 5%)",
  },
};

const CALC_CONSTANTS_GROUP_LABELS = {
  general: "General (shared)",
  concrete: "Concrete",
  blockwork: "Blockwork",
  plastering: "Plastering",
  piping: "Bathroom Piping",
  electrical: "Low Voltage Electrical",
  firealarm: "Fire Alarm",
};

function openCalculatorConstantsEditor() {
  const overlay = document.getElementById("modalOverlay");
  const body = document.getElementById("modalBody");
  const title = document.getElementById("modalTitle");
  const submit = document.getElementById("modalSubmit");
  const foot = document.getElementById("modalFoot");
  if (!overlay || !body || !title || !foot) return;

  const c = getCalcConstants();
  title.innerText = "Calculator Constants";
  overlay.style.display = "flex";

  body.innerHTML = Object.keys(CALC_CONSTANTS_FIELD_LABELS)
    .map((group) => {
      const fields = Object.keys(CALC_CONSTANTS_FIELD_LABELS[group])
        .map((key) => {
          const id = `calcconst_${group}_${key}`;
          const val = c[group][key];
          return `<label style="display:block; font-weight:700; font-size:13px; margin-top:8px; margin-bottom:2px;">${CALC_CONSTANTS_FIELD_LABELS[group][key]}</label>
            <input id="${id}" type="number" step="any" value="${val}">`;
        })
        .join("");
      const cardId = `constgroup_${group}`;
      return `<div class="calc-card-row" data-card-id="${cardId}" style="border:1px solid var(--border); border-radius:10px; margin-bottom:10px; background:var(--card); overflow:hidden;">
        <div class="calc-card-header" style="display:flex; align-items:center; gap:8px; padding:12px; cursor:pointer;" onclick="window.toggleCalcCard('${cardId}')">
          <i class="fas fa-chevron-down calc-card-chevron" style="transition: transform 0.15s; flex:none; transform: rotate(-90deg);"></i>
          <strong style="font-size:15px;">${CALC_CONSTANTS_GROUP_LABELS[group]}</strong>
        </div>
        <div class="calc-card-body" style="display:none; padding: 0 12px 12px 12px;">
          ${fields}
        </div>
      </div>`;
    })
    .join("");

  foot.innerHTML = `
    <button id="modalSubmit" class="action-btn">Save</button>
    <button class="action-btn" style="background:var(--card-light); color:var(--text); margin-top:8px;" onclick="window.resetCalculatorConstants()">Reset to Defaults</button>
  `;
  const newSubmit = document.getElementById("modalSubmit");
  newSubmit.onclick = () => {
    const values = {};
    Object.keys(CALC_CONSTANTS_FIELD_LABELS).forEach((group) => {
      values[group] = {};
      Object.keys(CALC_CONSTANTS_FIELD_LABELS[group]).forEach((key) => {
        const input = document.getElementById(`calcconst_${group}_${key}`);
        values[group][key] = Number(input.value);
      });
    });
    setCalcConstants(values);
    closeModal();
    if (typeof showSyncToast === "function")
      showSyncToast("✅ Constants saved");
    const select = document.getElementById("calc-type-select");
    if (select && select.value) switchCalculator(select.value);
  };
}
window.openCalculatorConstantsEditor = openCalculatorConstantsEditor;

function resetCalculatorConstants() {
  if (!confirm("Reset all calculator constants to their defaults?")) return;
  resetCalcConstants();
  closeModal();
  if (typeof showSyncToast === "function")
    showSyncToast("↺ Constants reset to defaults");
  const select = document.getElementById("calc-type-select");
  if (select && select.value) switchCalculator(select.value);
}
window.resetCalculatorConstants = resetCalculatorConstants;

// ===== REBAR WEIGHT CONVERTER =====
// Standard site formula: weight per metre (kg/m) = diameter(mm)^2 / 162
// -- converts either way: (diameter + number of rods) -> total kg, or
// (diameter + total kg) -> number of rods, using an editable stock
// length per rod (default 12m, a common market standard) either way.

const REBAR_STANDARD_SIZES = [6, 8, 10, 12, 16, 20, 25, 32, 40];

function renderRebarCalculator(container) {
  container.innerHTML = `
    <div id="rebar-elements-container"></div>
    <button class="action-btn" style="width:auto; padding:8px 16px; font-size:13px; background:var(--card-light); color:var(--text);" onclick="window.addRebarElement()">
      <i class="fas fa-plus"></i> Add Bar Size
    </button>
    <button class="action-btn" style="margin-top:14px; width:auto; padding:12px 24px;" onclick="window.calculateRebar()">
      <i class="fas fa-calculator"></i> Calculate
    </button>
  `;
  CALC_CARD_ADD_FNS["rebar-elements-container"] = addRebarElement;
  addRebarElement();
}
window.renderRebarCalculator = renderRebarCalculator;

function addRebarElement() {
  const container = document.getElementById("rebar-elements-container");
  if (!container) return;
  const id = `rebarel${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const c = getCalcConstants().rebar;

  const sizeOptions = REBAR_STANDARD_SIZES.map((d) => `<option value="${d}">${d}mm</option>`).join("");

  const body = `
    <label style="display:block; font-weight:800; margin-bottom:4px;">Bar Diameter</label>
    <select class="rb-diameter">
      ${sizeOptions}
      <option value="custom">Other (enter below)</option>
    </select>
    <input type="number" class="rb-diameter-custom" min="1" step="0.1" placeholder="Diameter in mm" style="margin-top:6px; display:none;">

    <label style="display:block; font-weight:800; margin-top:10px; margin-bottom:4px;">Convert</label>
    <select class="rb-mode" onchange="window.toggleRebarMode('${id}')">
      <option value="toKg">Diameter + Number of Rods → Total kg</option>
      <option value="toRods">Diameter + Total kg → Number of Rods</option>
    </select>

    <label style="display:block; font-weight:800; margin-top:10px; margin-bottom:4px;">Stock Length per Rod (m)</label>
    <input type="number" class="rb-stock-length" min="0.1" step="0.1" value="${c.stockLengthM}">

    <div class="rb-qty-row" style="margin-top:10px;">
      <label style="display:block; font-weight:800; margin-bottom:4px;">Number of Rods</label>
      <input type="number" class="rb-quantity" min="0" step="1" value="0">
    </div>
    <div class="rb-weight-row" style="margin-top:10px; display:none;">
      <label style="display:block; font-weight:800; margin-bottom:4px;">Total Weight (kg)</label>
      <input type="number" class="rb-weight" min="0" step="0.01" value="0">
    </div>
  `;

  container.insertAdjacentHTML("beforeend", buildCardShellHtml(id, "rebar-elements-container", "Bar Size (e.g. Columns)", body));
  const row = container.querySelector(`.calc-card-row[data-card-id="${id}"]`);
  const diameterSelect = row.querySelector(".rb-diameter");
  const diameterCustom = row.querySelector(".rb-diameter-custom");
  diameterSelect.addEventListener("change", () => {
    diameterCustom.style.display = diameterSelect.value === "custom" ? "block" : "none";
  });
}
window.addRebarElement = addRebarElement;

function toggleRebarMode(id) {
  const row = document.querySelector(`.calc-card-row[data-card-id="${id}"]`);
  if (!row) return;
  const mode = row.querySelector(".rb-mode").value;
  row.querySelector(".rb-qty-row").style.display = mode === "toKg" ? "block" : "none";
  row.querySelector(".rb-weight-row").style.display = mode === "toRods" ? "block" : "none";
}
window.toggleRebarMode = toggleRebarMode;

function calculateRebar() {
  const rows = document.querySelectorAll("#rebar-elements-container .calc-card-row");
  if (!rows.length) {
    alert("Add at least one bar size");
    return;
  }
  const c = getCalcConstants().rebar;

  const lines = [];
  let grandTotalKg = 0;
  let anyEntered = false;

  rows.forEach((row, idx) => {
    const name = row.querySelector(".calc-card-name").value.trim() || `Bar Size ${idx + 1}`;
    const diameterSelect = row.querySelector(".rb-diameter");
    const diameter = diameterSelect.value === "custom"
      ? Number(row.querySelector(".rb-diameter-custom").value) || 0
      : Number(diameterSelect.value) || 0;
    const stockLength = Number(row.querySelector(".rb-stock-length").value) || c.stockLengthM;
    const mode = row.querySelector(".rb-mode").value;
    const kgPerMetre = (diameter * diameter) / c.weightDivisor;

    if (!diameter || !kgPerMetre) return;

    if (mode === "toKg") {
      const quantity = Number(row.querySelector(".rb-quantity").value) || 0;
      if (!quantity) return;
      anyEntered = true;
      const totalLength = quantity * stockLength;
      const totalKg = totalLength * kgPerMetre;
      grandTotalKg += totalKg;
      lines.push(
        `${name}: Y${diameter} × ${quantity} rods @ ${fmtNum(stockLength, 1)}m = ${fmtNum(totalLength, 1)}m → ${fmtNum(totalKg, 1)} kg (${fmtNum(kgPerMetre, 3)} kg/m)`,
      );
    } else {
      const totalKg = Number(row.querySelector(".rb-weight").value) || 0;
      if (!totalKg) return;
      anyEntered = true;
      const totalLength = totalKg / kgPerMetre;
      const rodsExact = totalLength / stockLength;
      const rodsToBuy = Math.ceil(rodsExact); // you can't buy a fraction of a stock-length rod
      grandTotalKg += totalKg;
      lines.push(
        `${name}: Y${diameter}, ${fmtNum(totalKg, 1)} kg (${fmtNum(kgPerMetre, 3)} kg/m) = ${fmtNum(totalLength, 1)}m → ${fmtNum(rodsExact, 2)} rods @ ${fmtNum(stockLength, 1)}m (buy ${rodsToBuy} whole rods)`,
      );
    }
  });

  if (!anyEntered) {
    alert("Enter a quantity or weight for at least one bar size");
    return;
  }

  const output =
    `REBAR WEIGHT CONVERSION\n` +
    `Formula: kg/m = diameter(mm)² ÷ ${c.weightDivisor}\n\n` +
    lines.join("\n") +
    `\n\nGRAND TOTAL: ${fmtNum(grandTotalKg, 1)} kg (${fmtNum(grandTotalKg / 1000, 3)} tonnes)`;

  showCalcOutput(output);
}
window.calculateRebar = calculateRebar;

