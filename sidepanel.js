const tabsList = document.querySelector("#tabs");
const refreshButton = document.querySelector("#refresh");

let draggedTabId = null;

async function getCurrentWindowTabs() {
  return chrome.tabs.query({ currentWindow: true });
}

function tabTitle(tab) {
  return tab.title || tab.url || "Untitled tab";
}

function renderTabs(tabs) {
  tabsList.replaceChildren(
    ...tabs.map((tab) => {
      const item = document.createElement("li");
      item.className = `tab${tab.active ? " active" : ""}`;
      item.draggable = true;
      item.dataset.tabId = String(tab.id);
      item.dataset.index = String(tab.index);

      const title = document.createElement("button");
      title.className = "tab-title";
      title.type = "button";
      title.textContent = tabTitle(tab);
      title.title = tabTitle(tab);
      title.addEventListener("click", () => activateTab(tab.id));

      const dragHandle = document.createElement("span");
      dragHandle.className = "drag-handle";
      dragHandle.textContent = ":::";
      dragHandle.setAttribute("aria-hidden", "true");

      item.append(dragHandle, title);
      return item;
    }),
  );
}

async function refreshTabs() {
  renderTabs(await getCurrentWindowTabs());
}

async function activateTab(tabId) {
  await chrome.tabs.update(tabId, { active: true });
  await refreshTabs();
}

tabsList.addEventListener("dragstart", (event) => {
  const item = event.target.closest(".tab");
  if (!item) return;

  draggedTabId = Number(item.dataset.tabId);
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", item.dataset.tabId);
});

tabsList.addEventListener("dragover", (event) => {
  const item = event.target.closest(".tab");
  if (!item || Number(item.dataset.tabId) === draggedTabId) return;

  event.preventDefault();
  item.classList.add("drag-over");
});

tabsList.addEventListener("dragleave", (event) => {
  event.target.closest(".tab")?.classList.remove("drag-over");
});

tabsList.addEventListener("drop", async (event) => {
  const item = event.target.closest(".tab");
  if (!item || draggedTabId === null) return;

  event.preventDefault();
  item.classList.remove("drag-over");

  await chrome.tabs.move(draggedTabId, { index: Number(item.dataset.index) });
  draggedTabId = null;
  await refreshTabs();
});

tabsList.addEventListener("dragend", (event) => {
  event.target.closest(".tab")?.classList.remove("dragging");
  tabsList.querySelectorAll(".drag-over").forEach((item) => {
    item.classList.remove("drag-over");
  });
  draggedTabId = null;
});

refreshButton.addEventListener("click", refreshTabs);

chrome.tabs.onCreated.addListener(refreshTabs);
chrome.tabs.onUpdated.addListener(refreshTabs);
chrome.tabs.onMoved.addListener(refreshTabs);
chrome.tabs.onRemoved.addListener(refreshTabs);
chrome.tabs.onActivated.addListener(refreshTabs);

refreshTabs();
