const APP_SCREEN_CAPTURE = "capture";
const APP_SCREEN_VISITOR_INBOX = "visitor_inbox";

let activeAppScreen = APP_SCREEN_CAPTURE;
let visitorInboxLoading = false;

function getVisitorInboxElements() {
  return {
    captureScreen: document.getElementById("capture-screen"),
    inboxScreen: document.getElementById("visitor-inbox-screen"),
    openButton: document.querySelector("[data-open-visitor-messages]"),
    closeButton: document.getElementById("visitor-inbox-close"),
    refreshButton: document.getElementById("visitor-inbox-refresh"),
    status: document.getElementById("visitor-inbox-status"),
    list: document.getElementById("visitor-inbox-list"),
  };
}

function setVisitorInboxStatus(message, tone = "neutral") {
  const { status } = getVisitorInboxElements();
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function formatVisitorInboxTime(raw) {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getReadFeedUrl() {
  const canReadPublicly = PROJECT_CONFIG && PROJECT_CONFIG.publicReadEnabled === true;
  if (!canReadPublicly && !READ_TOKEN) {
    return null;
  }

  const url = new URL(SHEET_URL);
  if (READ_TOKEN) {
    url.searchParams.set("token", READ_TOKEN);
  }
  return url.toString();
}

async function fetchVisitorMessages() {
  const url = getReadFeedUrl();
  if (!url) {
    throw new Error("Chybí read token pro načtení zpráv.");
  }

  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (!Array.isArray(data)) {
    throw new Error(data && data.error ? data.error : "Neplatná odpověď serveru.");
  }

  return data
    .filter((record) => getEntryType(record) === ENTRY_TYPE_VISITOR_MESSAGE)
    .sort((left, right) => String(right && right.time || "").localeCompare(String(left && left.time || "")));
}

function renderVisitorMessages(records) {
  const { list } = getVisitorInboxElements();
  if (!list) return;

  list.innerHTML = "";

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "visitor-message-empty";
    empty.textContent = "Zatím tu nejsou žádné zprávy od lidí.";
    list.appendChild(empty);
    return;
  }

  records.forEach((record) => {
    const item = document.createElement("article");
    item.className = "visitor-message-item";

    const badge = document.createElement("div");
    badge.className = "visitor-message-badge";
    badge.textContent = "Zpráva pro tebe";
    item.appendChild(badge);

    const meta = document.createElement("div");
    meta.className = "visitor-message-meta";
    const sender = String(record.sender_name || "").trim() || "Neznámý návštěvník";
    meta.textContent = `${sender} · ${formatVisitorInboxTime(record.time) || "bez času"}`;
    item.appendChild(meta);

    const text = document.createElement("div");
    text.className = "visitor-message-text";
    text.textContent = String(record.note || "").trim() || "bez textu";
    item.appendChild(text);

    list.appendChild(item);
  });
}

async function refreshVisitorInbox() {
  if (visitorInboxLoading) {
    return;
  }

  const { refreshButton } = getVisitorInboxElements();
  visitorInboxLoading = true;
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = "Načítám…";
  }

  try {
    setVisitorInboxStatus("Načítám zprávy…");
    const records = await fetchVisitorMessages();
    renderVisitorMessages(records);
    setVisitorInboxStatus(records.length
      ? `Načteno ${records.length} zpráv.`
      : "Zatím tu nejsou žádné zprávy.", records.length ? "success" : "neutral");
  } catch (error) {
    console.error("Načtení zpráv selhalo:", error);
    renderVisitorMessages([]);
    setVisitorInboxStatus(error && error.message ? error.message : "Zprávy se nepodařilo načíst.", "error");
  } finally {
    visitorInboxLoading = false;
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = "Obnovit";
    }
  }
}

function setActiveAppScreen(screenName) {
  activeAppScreen = screenName;
  const { captureScreen, inboxScreen } = getVisitorInboxElements();
  const main = document.querySelector("main");
  if (captureScreen) {
    captureScreen.classList.toggle("hidden", screenName !== APP_SCREEN_CAPTURE);
  }
  if (inboxScreen) {
    inboxScreen.classList.toggle("hidden", screenName !== APP_SCREEN_VISITOR_INBOX);
  }
  if (main) {
    main.classList.toggle("is-scroll-screen", screenName === APP_SCREEN_VISITOR_INBOX);
  }
}

async function openVisitorInbox() {
  discardNote();
  setActiveAppScreen(APP_SCREEN_VISITOR_INBOX);
  await refreshVisitorInbox();
}

function closeVisitorInbox() {
  setActiveAppScreen(APP_SCREEN_CAPTURE);
}

function initVisitorInbox() {
  const { openButton, closeButton, refreshButton } = getVisitorInboxElements();
  if (!openButton || !closeButton || !refreshButton) {
    return;
  }

  openButton.addEventListener("click", async () => {
    vibrate("light");
    await openVisitorInbox();
  });
  closeButton.addEventListener("click", () => {
    vibrate("light");
    closeVisitorInbox();
  });
  refreshButton.addEventListener("click", async () => {
    vibrate("light");
    await refreshVisitorInbox();
  });
}
