// Crop geometry used by the photo editor (the drawing itself needs a real browser canvas).
const fs = require("fs");
const { JSDOM } = require("jsdom");
function check(c, m) { if (!c) { console.error("FAIL: " + m); process.exit(1); } }
const w = new JSDOM("", { runScripts: "outside-only" }).window;
w.eval(fs.readFileSync(__dirname + "/../js/photoedit.js", "utf8"));
console.log("=== Photo editor helpers ===");
const R = w.phNormRect;
check(JSON.stringify(R({ x: 50, y: 60 }, { x: 10, y: -5 }, 100, 100)) === JSON.stringify({ x: 10, y: 0, w: 40, h: 60 }), "drag in any direction, clamped to the picture");
check(R({ x: 1, y: 1 }, { x: 3, y: 3 }, 100, 100) === null, "tiny drags are ignored");
const r2 = R({ x: 90, y: 90 }, { x: 500, y: 500 }, 100, 100);
check(r2.w === 10 && r2.h === 10, "can't extend beyond the edge");
const pt = w.phPoint({ clientX: 150, clientY: 75 }, { width: 800, height: 400, getBoundingClientRect: () => ({ left: 50, top: 25, width: 200, height: 100 }) });
check(pt.x === 400 && pt.y === 200, "screen position maps to picture pixels");
console.log("Confirmed: crop rectangle and pointer mapping");
console.log("\n✅ ALL PHOTO EDITOR TESTS PASSED");
