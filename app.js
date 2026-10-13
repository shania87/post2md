import { resolve } from "./resolve.js";
import { SITES } from "./sites.js";
import { prefetch, shareOut, copyText } from "./share.js";

const $ = (id) => document.getElementById(id);
let current = null;
// Bumped on every run; a run whose number is no longer current drops its result.
let generation = 0;

function setStatus(message, kind = "") {
  $("status").textContent = message;
  $("status").className = kind;
}

function renderImages() {
  const grid = $("images");
  grid.replaceChildren();
  current.images.forEach((img, i) => {
    const fig = document.createElement("label");
    fig.className = "thumb" + (img.error ? " failed" : "");
    const pic = document.createElement("img");
    pic.src = img.url;
    pic.alt = `Image ${i + 1}`;
    pic.loading = "lazy";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = img.checked;
    box.addEventListener("change", () => { img.checked = box.checked; });
    const caption = document.createElement("span");
    caption.textContent = img.error ? `Image ${i + 1}: can't attach` : `Image ${i + 1}`;
    fig.append(pic, box, caption);
    grid.append(fig);
  });
  $("imagesBlock").hidden = current.images.length === 0;
}

async function run(...inputs) {
  const mine = ++generation;
  const stale = () => mine !== generation;
  current = null;
  $("result").hidden = true;
  $("handoff").hidden = true;
  const link = resolve(...inputs);
  if (!link) {
    setStatus("No X or Reddit post link found in that.", "error");
    return;
  }
  $("input").value = link.url;
  const site = SITES[link.site];

  if (site.handoff) {
    const h = site.handoff(link);
    $("handoffNote").textContent = h.note;
    $("handoffLink").href = h.href;
    $("handoffLink").textContent = h.label;
    $("handoff").hidden = false;
    setStatus("");
    return;
  }

  setStatus(`Loading ${site.label} post…`);
  let result;
  try {
    result = site.format(await site.load(link));
  } catch (err) {
    if (stale()) return;
    setStatus(err.message || String(err), "error");
    $("handoffNote").textContent = "";
    $("handoffLink").href = link.url;
    $("handoffLink").textContent = `Open on ${site.label}`;
    $("handoff").hidden = false;
    return;
  }

  if (stale()) return;
  current = result;
  $("markdown").value = result.markdown;
  renderImages();
  $("result").hidden = false;
  // Share stays off until downloads settle, or it would send whichever images happened to be ready.
  const pending = result.images.length > 0;
  $("share").disabled = pending;
  $("share").textContent = pending ? "Preparing images…" : "Share";
  setStatus("");
  await prefetch(result.images);
  if (stale()) return;
  $("share").disabled = false;
  $("share").textContent = "Share";
  renderImages();
}

$("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = $("input").value.trim();
  if (!value) return;
  history.replaceState(null, "", `?u=${encodeURIComponent(value)}`);
  run(value);
});

$("share").addEventListener("click", async () => {
  if (!current) return;
  try {
    setStatus(await shareOut(current), "ok");
  } catch (err) {
    // AbortError means the user closed the share sheet; that's not a failure.
    if (err.name !== "AbortError") setStatus(`Share failed: ${err.message}`, "error");
  }
});

$("copy").addEventListener("click", async () => {
  if (!current) return;
  try {
    await copyText(current.markdown);
    setStatus("Markdown copied.", "ok");
  } catch (err) {
    $("markdown").select();
    setStatus("Copy was blocked. The text is selected; copy it by hand.", "error");
  }
});

// Share target and ?u= both arrive as query params. The X app usually puts the link in `text`.
const params = new URLSearchParams(location.search);
const incoming = ["u", "url", "text", "title"].map((key) => params.get(key)).filter(Boolean);
if (incoming.length) run(...incoming);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* still works as a plain page */ });
}
