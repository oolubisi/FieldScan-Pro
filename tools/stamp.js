#!/usr/bin/env node
/**
 * Stamps sw.js with a hash of every file the service worker caches.
 *
 * Run after changing ANY app file:   node tools/stamp.js
 * (tests/pwa-files.test.js fails if you forget, so a changed file can never
 * ship under an old cache name and be ignored by phones that already have it.)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function readPrecache(swText) {
  const m = /const PRECACHE = (\[[\s\S]*?\]);/.exec(swText);
  if (!m) throw new Error("PRECACHE list not found in sw.js");
  return JSON.parse(m[1]);
}

function computeBuild(root = ROOT) {
  const files = readPrecache(fs.readFileSync(path.join(root, "sw.js"), "utf8"))
    .filter((f) => f !== "./") // "./" is index.html again
    .sort();
  const manifest = files.map((f) => `${f}:${sha(fs.readFileSync(path.join(root, f)))}`).join("\n");
  return sha(manifest).slice(0, 12);
}

function stamp(root = ROOT) {
  const swPath = path.join(root, "sw.js");
  const text = fs.readFileSync(swPath, "utf8");
  const build = computeBuild(root);
  const next = text.replace(/const BUILD = "[0-9a-f]{12}";/, `const BUILD = "${build}";`);
  if (next === text && !text.includes(`const BUILD = "${build}";`)) throw new Error("BUILD line not found in sw.js");
  fs.writeFileSync(swPath, next);
  return build;
}

module.exports = { computeBuild, readPrecache, stamp };

if (require.main === module) console.log("sw.js stamped: fsp-shell-" + stamp());
