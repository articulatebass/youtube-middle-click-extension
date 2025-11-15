function debugLog(...args) {
  // Comment this out if you don't want logs
  console.log("[YT MiddleSearch]", ...args);
}

// =========================
// Enable/disable via storage
// =========================

let extensionEnabled = true;

// Try to load enabled state from storage (MV3)
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get({ enabled: true }, (data) => {
    extensionEnabled = data.enabled;
    debugLog("Initial enabled state:", extensionEnabled);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.enabled) {
      extensionEnabled = changes.enabled.newValue;
      debugLog("Enabled state changed:", extensionEnabled);
    }
  });
}

// =========================
// Search input helper
// =========================

function getSearchInput() {
  // 1) Direct selectors
  let input = document.querySelector("input#search");
  if (input) {
    debugLog("Found input#search in main document:", input);
    return input;
  }

  input = document.querySelector('input[aria-label="Search"]');
  if (input) {
    debugLog('Found input[aria-label="Search"] in main document:', input);
    return input;
  }

  // 2) Fallback: look inside masthead
  const masthead = document.querySelector("ytd-masthead");
  if (masthead) {
    const mastInputs = masthead.querySelectorAll("input");
    if (mastInputs.length > 0) {
      debugLog("Found input(s) inside ytd-masthead:", mastInputs);
      return mastInputs[0];
    }
  }

  debugLog("No search input found");
  return null;
}

// =========================
// Suggestion helpers
// =========================

function getSuggestionsRoot() {
  const candidates = [
    "tp-yt-paper-listbox[role='listbox']",
    "ytd-searchbox-suggestions",
    "yt-searchbox-suggestions"
  ];

  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  return document.body;
}

function findSuggestionInList(nodes) {
  if (!nodes) return null;

  for (const node of nodes) {
    if (!node || node === window || node === document) continue;

    const tag = node.tagName || "";
    const getAttr = node.getAttribute ? node.getAttribute.bind(node) : () => null;
    const className = typeof node.className === "string" ? node.className : "";

    if (/YTD-SEARCHBOX-SUGGESTION|YT-SEARCHBOX-SUGGESTION/i.test(tag)) return node;
    if (getAttr("role") === "option") return node;
    if (/suggestion/i.test(className)) return node;
  }

  return null;
}

function findSuggestionByCoords(x, y) {
  const root = getSuggestionsRoot();

  let candidates = root.querySelectorAll(
    "[role='option'], ytd-searchbox-suggestion, yt-searchbox-suggestion, [class*='suggestion']"
  );

  if (!candidates.length) {
    candidates = document.querySelectorAll(
      "[role='option'], ytd-searchbox-suggestion, yt-searchbox-suggestion, [class*='suggestion']"
    );
  }

  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return el;
    }
  }

  return null;
}

function findSuggestionForEvent(e) {
  const path = e.composedPath ? e.composedPath() : e.path || [];
  let suggestion = findSuggestionInList(path);
  if (suggestion) return suggestion;

  suggestion = findSuggestionByCoords(e.clientX, e.clientY);
  return suggestion;
}

// aggressive text extraction for suggestions
function getSuggestionText(node) {
  if (!node) return "";

  const attrCandidates = ["aria-label", "title", "data-query", "data-value", "data-text"];
  for (const attr of attrCandidates) {
    if (node.getAttribute) {
      const v = node.getAttribute(attr);
      if (v && v.trim()) return v.trim();
    }
  }

  const desc = node.querySelector("[aria-label], [title], [data-query], [data-value], [data-text]");
  if (desc) {
    for (const attr of attrCandidates) {
      if (desc.getAttribute) {
        const v = desc.getAttribute(attr);
        if (v && v.trim()) return v.trim();
      }
    }
  }

  const textEl =
    node.querySelector("yt-formatted-string") ||
    node.querySelector("span") ||
    node;

  let text = (textEl.innerText || textEl.textContent || "").trim();

  if (text.includes("\n")) {
    text = text.split("\n")[0].trim();
  }

  if (text) return text;

  const walker = document.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (n) =>
        n.nodeValue && n.nodeValue.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
    }
  );

  let pieces = [];
  let current;
  while ((current = walker.nextNode())) {
    pieces.push(current.nodeValue.trim());
  }

  text = pieces.join(" ").trim();
  if (text) return text;

  try {
    const tag = node.tagName;
    const cls = node.className;
    const outer = node.outerHTML ? node.outerHTML.slice(0, 200).replace(/\s+/g, " ") : "";
    debugLog("Could not extract text from suggestion node:", { tag, cls, outer });
  } catch (_) {}

  return "";
}

// =========================
// Search button helpers
// =========================

// Decide if a given BUTTON element is the search button
function isSearchButtonElement(button) {
  if (!button || !button.tagName) return false;
  if (button.tagName.toUpperCase() !== "BUTTON") return false;

  const id = button.id || "";
  const cls = button.className || "";
  const aria = button.getAttribute ? (button.getAttribute("aria-label") || "") : "";

  if (id.includes("search-icon")) return true;
  if (/ytSearchboxComponentSearchButton/i.test(cls)) return true;
  if (aria.toLowerCase() === "search") return true;

  return false;
}

// Try path first, then coordinates, and always walk up to closest button
function findSearchButtonForEvent(e) {
  const path = e.composedPath ? e.composedPath() : e.path || [];

  for (const node of path) {
    if (!node || node === window || node === document) continue;
    if (!node.closest) continue;
    const btn = node.closest("button");
    if (btn && isSearchButtonElement(btn)) {
      debugLog("Found search button via path/closest:", btn);
      return btn;
    }
  }

  const underPoint = document.elementsFromPoint(e.clientX, e.clientY) || [];
  for (const node of underPoint) {
    if (!node || !node.closest) continue;
    const btn = node.closest("button");
    if (btn && isSearchButtonElement(btn)) {
      debugLog("Found search button via elementsFromPoint/closest:", btn);
      return btn;
    }
  }

  return null;
}

function handleSearchButtonMiddleClick(e) {
  const input = getSearchInput();
  const query = input ? (input.value || "").trim() : "";

  debugLog("Middle click on search button, query:", query);

  const url =
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(query);

  e.preventDefault();
  e.stopPropagation();
  window.open(url, "_blank");
}

// =========================
// Global handlers
// =========================

function handleMouseDown(e) {
  if (!extensionEnabled) return;       // <-- respect toggle
  if (e.button !== 1) return;

  // 1) Search button: stop autoscroll
  const searchBtn = findSearchButtonForEvent(e);
  if (searchBtn) {
    debugLog("Middle mousedown on search button");
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // 2) Suggestions
  const suggestion = findSuggestionForEvent(e);
  if (!suggestion) return;

  debugLog("Middle mousedown on suggestion row");
  e.preventDefault();
  e.stopPropagation();
}

function handleAuxClick(e) {
  if (!extensionEnabled) return;       // <-- respect toggle
  if (e.button !== 1) return;

  // 1) Search button
  const searchBtn = findSearchButtonForEvent(e);
  if (searchBtn) {
    handleSearchButtonMiddleClick(e);
    return;
  }

  // 2) Suggestions
  const suggestion = findSuggestionForEvent(e);
  if (!suggestion) return; // not in suggestion row; let YT handle everything else normally

  const text = getSuggestionText(suggestion);
  debugLog("Middle click on suggestion:", text);

  if (!text) return;

  e.preventDefault();
  e.stopPropagation();

  const url =
    "https://www.youtube.com/results?search_query=" +
    encodeURIComponent(text);

  window.open(url, "_blank");
}

window.addEventListener("mousedown", handleMouseDown, true);
window.addEventListener("auxclick", handleAuxClick, true);

debugLog("YT MiddleSearch content script loaded");
