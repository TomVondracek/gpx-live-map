const VISITOR_MESSAGE_STORAGE_KEY = "ultralog-visitor-id";
const VISITOR_MESSAGE_MAX_NAME = 40;
const VISITOR_MESSAGE_MAX_TEXT = 500;

function isVisitorMessageEnabled() {
  return Boolean(PROJECT_CONFIG && PROJECT_CONFIG.publicMessageEnabled);
}

function getVisitorMessageElements() {
  return {
    card: document.getElementById("visitor-message-card"),
    form: document.getElementById("visitor-message-form"),
    nameInput: document.getElementById("visitor-name"),
    textInput: document.getElementById("visitor-text"),
    honeypotInput: document.getElementById("visitor-website"),
    submitButton: document.getElementById("visitor-submit"),
    status: document.getElementById("visitor-message-status"),
  };
}

function setVisitorMessageStatus(message, tone = "neutral") {
  const { status } = getVisitorMessageElements();
  if (!status) {
    return;
  }
  status.textContent = message;
  status.dataset.tone = tone;
}

function setVisitorMessageFormEnabled(enabled) {
  const { nameInput, textInput, honeypotInput, submitButton } = getVisitorMessageElements();
  [nameInput, textInput, honeypotInput, submitButton].forEach((element) => {
    if (element) {
      element.disabled = !enabled;
    }
  });
}

function getOrCreateVisitorId() {
  try {
    const existing = localStorage.getItem(VISITOR_MESSAGE_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const next = crypto.randomUUID();
    localStorage.setItem(VISITOR_MESSAGE_STORAGE_KEY, next);
    return next;
  } catch {
    return crypto.randomUUID();
  }
}

function validateVisitorMessage(senderName, messageText) {
  const trimmedName = String(senderName || "").trim();
  const trimmedText = String(messageText || "").trim();

  if (!trimmedName) {
    throw new Error("Vyplň prosím jméno.");
  }
  if (!trimmedText) {
    throw new Error("Vyplň prosím text zprávy.");
  }
  if (trimmedName.length > VISITOR_MESSAGE_MAX_NAME) {
    throw new Error("Jméno je příliš dlouhé.");
  }
  if (trimmedText.length > VISITOR_MESSAGE_MAX_TEXT) {
    throw new Error("Zpráva je příliš dlouhá.");
  }

  return {
    senderName: trimmedName,
    messageText: trimmedText,
  };
}

async function postVisitorMessage(payload) {
  const response = await fetch(SHEET_URL, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = text ? JSON.parse(text) : { ok: true };
  if (!data.ok) {
    if (data.error === "visitor_rate_limited") {
      throw new Error("Zprávu lze poslat znovu za chvíli.");
    }
    if (data.error === "public_messages_disabled") {
      throw new Error("Posílání zpráv je teď vypnuté.");
    }
    if (data.error === "invalid_visitor_message") {
      throw new Error("Zpráva není vyplněná správně.");
    }
    throw new Error("Odeslání zprávy selhalo.");
  }

  return data;
}

async function handleVisitorMessageSubmit(event) {
  event.preventDefault();

  const elements = getVisitorMessageElements();
  if (!elements.form) {
    return;
  }

  try {
    const { senderName, messageText } = validateVisitorMessage(
      elements.nameInput && elements.nameInput.value,
      elements.textInput && elements.textInput.value,
    );

    const payload = createVisitorMessagePayload(
      senderName,
      messageText,
      getOrCreateVisitorId(),
      elements.honeypotInput && elements.honeypotInput.value,
    );

    setVisitorMessageFormEnabled(false);
    setVisitorMessageStatus("Odesílám zprávu…");

    await postVisitorMessage(payload);

    elements.form.reset();
    setVisitorMessageStatus("Zpráva dorazila a objeví se v panelu Zprávy.", "success");
    await loadFull();
  } catch (error) {
    console.error("Odeslání veřejné zprávy selhalo:", error);
    setVisitorMessageStatus(error && error.message ? error.message : "Zprávu se nepodařilo odeslat.", "error");
  } finally {
    setVisitorMessageFormEnabled(true);
  }
}

function initVisitorMessageForm() {
  const elements = getVisitorMessageElements();
  if (!elements.card || !elements.form) {
    return;
  }

  if (!isVisitorMessageEnabled()) {
    elements.card.hidden = true;
    return;
  }

  elements.form.addEventListener("submit", handleVisitorMessageSubmit);
  setVisitorMessageStatus("Zpráva se zobrazí veřejně v panelu Zprávy.");
}

initVisitorMessageForm();
