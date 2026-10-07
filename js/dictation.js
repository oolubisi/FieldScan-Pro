// ===== Speak instead of type =====
// Adds a microphone button beside every field marked data-dictate. It uses the phone's own speech recognition
// (Chrome's, which needs a connection); where that isn't available the buttons simply don't appear.

function dtSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

/** Joins what was already typed with what was just said. */
function dtJoin(before, said) {
  const a = String(before || "").replace(/\s+$/, ""), b = String(said || "").trim();
  if (!b) return String(before || "");
  return a ? `${a}${/[.!?]$/.test(a) ? " " : " "}${b}` : b.charAt(0).toUpperCase() + b.slice(1);
}

function dtAttach(root) {
  if (!dtSupported()) return 0;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let n = 0;
  (root || document).querySelectorAll("[data-dictate]").forEach((field) => {
    if (field.dataset.dtDone) return;
    field.dataset.dtDone = "1";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "dt-btn"; btn.textContent = "🎤"; btn.setAttribute("aria-label", "Speak");
    field.insertAdjacentElement("afterend", btn);
    let rec = null;
    btn.onclick = () => {
      if (rec) { rec.stop(); return; }
      rec = new Rec();
      rec.lang = "en-NG"; rec.interimResults = false; rec.continuous = false;
      const before = field.value;
      btn.classList.add("on");
      rec.onresult = (ev) => {
        const said = Array.from(ev.results).map((r) => r[0].transcript).join(" ");
        field.value = dtJoin(before, said);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const done = () => { rec = null; btn.classList.remove("on"); };
      rec.onend = done;
      rec.onerror = (e) => { done(); if (window.showStatus) showStatus(e.error === "not-allowed" ? "Allow the microphone to dictate." : "Couldn't hear that. Try again.", true); };
      try { rec.start(); } catch (e) { done(); }
    };
    n++;
  });
  return n;
}
