document.addEventListener("DOMContentLoaded", () => {
  const checkbox = document.getElementById("enabled");
  const statusPill = document.getElementById("status-pill");

  function updateStatus(checked) {
    if (!statusPill) return;

    statusPill.textContent = checked ? "On" : "Off";
    statusPill.classList.toggle("on", checked);
    statusPill.classList.toggle("off", !checked);
  }

  // Load current state (default true)
  chrome.storage.sync.get({ enabled: true }, (data) => {
    const enabled = !!data.enabled;
    checkbox.checked = enabled;
    updateStatus(enabled);
  });

  // Save when toggled
  checkbox.addEventListener("change", () => {
    const enabled = checkbox.checked;
    chrome.storage.sync.set({ enabled }, () => {
      updateStatus(enabled);
    });
  });
});
