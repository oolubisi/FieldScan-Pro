// Run: node tests/pwa-files.test.js
const fs = require("fs");
const path = require("path");
const { computeBuild, readPrecache } = require("../tools/stamp.js");

function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); }
const section = (t) => console.log("\n=== " + t + " ===");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const sw = read("sw.js");
const precache = readPrecache(sw);
const html = read("index.html");

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name).split(path.sep).join("/")]);
}

section("Everything needed offline is cached");
precache.filter((f) => f !== "./").forEach((f) => check(exists(f), `${f} is in the cache list but doesn't exist`));
check(precache.includes("./") && precache.includes("index.html"), "the start page is cached under both names");
const referenced = [];
html.replace(/(?:src|href)="([^"]+)"/g, (_, u) => { referenced.push(u); return _; });
referenced.filter((u) => !/^#/.test(u)).forEach((u) => {
  check(!/^[a-z]+:\/\//i.test(u), `index.html pulls ${u} from another site, which fails offline`);
  check(precache.includes(u), `index.html uses ${u} but it isn't in the cache list, so it would be missing offline`);
});
["js", "css", "icons"].forEach((dir) => walk(dir).forEach((f) => check(precache.includes(f), `${f} exists but isn't in the cache list (it would be missing offline)`)));
console.log(`Confirmed: ${precache.length - 1} files cached; every file the page uses, and every file in js/ css/ icons/, is in the list`);

section("Cached files can't be a stale mix");
const stamped = /const BUILD = "([0-9a-f]{12})";/.exec(sw);
check(stamped, "sw.js has a BUILD stamp");
check(stamped[1] === computeBuild(ROOT), `a file changed since sw.js was stamped -- run: node tools/stamp.js (stamped ${stamped[1]}, files are ${computeBuild(ROOT)})`);
check(/const CACHE = "fsp-shell-" \+ BUILD;/.test(sw), "the cache name is derived from the build");
console.log("Confirmed: sw.js is stamped for exactly these file contents (" + stamped[1] + ")");

section("Script order");
const scripts = referenced.filter((u) => /\.js$/.test(u));
check(scripts[scripts.length - 1] === "js/app.js", "app.js loads last (it starts everything)");
check(scripts.indexOf("js/protocol.js") < scripts.indexOf("js/sync.js") && scripts.indexOf("js/db.js") < scripts.indexOf("js/app.js"), "libraries load before the app");
check(new Set(scripts).size === scripts.length, "no script is loaded twice");
console.log("Confirmed: " + scripts.join(" > "));

section("Install manifest");
const manifest = JSON.parse(read("manifest.webmanifest"));
["name", "short_name", "start_url", "scope", "display", "background_color", "theme_color"].forEach((k) => check(manifest[k], `manifest.${k} is missing`));
check(manifest.display === "standalone", "opens as its own app, not a browser tab");
check(/^\.\/?$/.test(manifest.start_url) && /^\.\/?$/.test(manifest.scope), "start_url and scope are relative, so it works under any folder (such as a GitHub Pages project path)");
check(manifest.id === undefined, "no manifest id: an id of './' would resolve to the site root and could clash with other apps on the same github.io address");
check(manifest.short_name.length <= 12, "short name fits under the home-screen icon");

function pngSize(file) {
  const b = fs.readFileSync(path.join(ROOT, file));
  check(b.slice(1, 4).toString() === "PNG", `${file} isn't a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
const sizes = manifest.icons.map((i) => i.sizes);
check(sizes.includes("192x192") && sizes.includes("512x512"), "has 192 and 512 icons (needed to be installable)");
manifest.icons.forEach((i) => {
  check(precache.includes(i.src), `${i.src} is cached`);
  const [w, h] = pngSize(i.src);
  check(`${w}x${h}` === i.sizes, `${i.src} is really ${w}x${h}, but the manifest says ${i.sizes}`);
  check(i.type === "image/png", `${i.src} type`);
});
check(manifest.icons.some((i) => i.purpose === "maskable") && manifest.icons.some((i) => i.purpose === "any"), "has both a normal and a maskable icon");
check(html.includes('rel="manifest" href="manifest.webmanifest"'), "the page links the manifest");
check(/<meta name="viewport"[^>]*width=device-width/.test(html), "the page is mobile-sized");
check(new RegExp(`<meta name="theme-color" content="${manifest.theme_color}"`).test(html), "theme colour matches the manifest");
console.log("Confirmed: installable manifest, real PNG icons at their stated sizes, relative paths, no id clash");

section("No outside dependencies");
const css = read("css/app.css");
check(!/https?:\/\//.test(css), "the stylesheet doesn't load anything from another site");
check(!/@import/.test(css), "no CSS @imports");
console.log("Confirmed: nothing is fetched from another site, so the app is fully self-contained");

console.log("\n\u2705 ALL PWA FILE TESTS PASSED");
