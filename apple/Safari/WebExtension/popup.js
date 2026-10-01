// SAM Safari extension popup. Reads the current page's visible text (activeTab + scripting),
// hands it to the native handler, and shows the answer. Never talks to the network itself.
const APP_ID = "com.hectic.sam.mobile"; // ignored by Safari on macOS; required on iOS
const $ = (id) => document.getElementById(id);

function native(message) {
  return browser.runtime.sendNativeMessage(APP_ID, message);
}

async function pageText() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No page to read.");
  const [result] = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const main = document.querySelector("main, article, [role=main]") || document.body;
      return { title: document.title, url: location.href, text: (main.innerText || "").slice(0, 60000) };
    },
  });
  return result?.result ?? { title: tab.title ?? "", url: tab.url ?? "", text: "" };
}

function show(text, provider, isError) {
  const el = $("answer");
  el.className = isError ? "error" : "";
  el.textContent = text;
  if (provider) {
    const p = document.createElement("span");
    p.className = "provider";
    p.textContent = `Answered by ${provider} on your Mac`;
    el.appendChild(p);
  }
}

function setBusy(busy) {
  for (const b of document.querySelectorAll("button")) b.disabled = busy;
  if (busy) {
    $("answer").className = "";
    $("answer").innerHTML = '<span class="thinking">SAM is reading…</span>';
  }
}

async function run(mode, question) {
  setBusy(true);
  try {
    const page = await pageText();
    const reply = await native({ action: "page", mode, question, ...page });
    if (reply?.error) show(reply.error, null, true);
    else show(reply?.text || "SAM had nothing to say.", reply?.provider);
  } catch (e) {
    show(e?.message || String(e), null, true);
  } finally {
    setBusy(false);
  }
}

async function status() {
  const el = $("status");
  try {
    const s = await native({ action: "status" });
    if (!s?.paired) { el.textContent = "Not paired"; el.className = "status off"; return; }
    el.textContent = s.reachable ? "Mac connected" : "Mac unreachable";
    el.className = s.reachable ? "status ok" : "status off";
  } catch {
    el.textContent = "Open the SAM app";
    el.className = "status off";
  }
}

for (const b of document.querySelectorAll(".actions button")) {
  b.addEventListener("click", () => run(b.dataset.mode));
}
$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("question").value.trim();
  if (q) run("ask", q);
});
status();
