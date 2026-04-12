function readTokenFromLocation() {
  const queryToken = new URLSearchParams(window.location.search).get("token");
  const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const hashToken = new URLSearchParams(rawHash).get("token");
  return hashToken || queryToken || "";
}

function storeMapToken(token) {
  if (!token) return;
  try {
    localStorage.setItem(MAP_TOKEN_STORAGE_KEY, token);
  } catch {}
}

function readStoredMapToken() {
  try {
    return localStorage.getItem(MAP_TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function clearTokenFromUrl() {
  const url = new URL(window.location.href);
  let changed = false;

  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    changed = true;
  }

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash);
    if (hashParams.has("token")) {
      hashParams.delete("token");
      url.hash = hashParams.toString() ? `#${hashParams.toString()}` : "";
      changed = true;
    }
  }

  if (changed) {
    window.history.replaceState({}, document.title, url.toString());
  }
}

function getMapToken() {
  const urlToken = readTokenFromLocation();
  if (urlToken) {
    storeMapToken(urlToken);
    clearTokenFromUrl();
    return urlToken;
  }
  return readStoredMapToken();
}

function getSheetDataUrl(since = null) {
  const token = getMapToken();
  if (!token) return null;

  const url = new URL(SHEET_URL);
  url.searchParams.set("token", token);
  if (since) url.searchParams.set("since", since);
  return url.toString();
}

function setNotesStatus(message) {
  const empty = document.getElementById("notes-empty");
  const countBadge = document.getElementById("notes-count");
  const fabCount = document.getElementById("fab-count");
  const list = document.getElementById("notes-list");

  empty.innerHTML = "";
  empty.textContent = message;
  empty.style.display = "block";
  countBadge.textContent = "0";
  fabCount.textContent = "0";
  Array.from(list.querySelectorAll(".note-item")).forEach((el) => el.remove());
}
