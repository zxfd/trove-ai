const DEFAULT_TROVE_URL = 'http://trove.v2rich.cn:18081';
const MENU_ID = 'save-to-trove';

function normalizeBaseUrl(value) {
  try {
    const url = new URL(value || DEFAULT_TROVE_URL);
    if (!['http:', 'https:'].includes(url.protocol)) return DEFAULT_TROVE_URL;
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return DEFAULT_TROVE_URL;
  }
}

function isWebUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function getTroveBaseUrl() {
  const settings = await chrome.storage.sync.get('troveBaseUrl');
  return normalizeBaseUrl(settings.troveBaseUrl);
}

async function openQuickAdd(targetUrl) {
  if (!isWebUrl(targetUrl)) return;
  const baseUrl = await getTroveBaseUrl();
  await chrome.tabs.create({ url: `${baseUrl}/quick-add#${targetUrl}` });
}

function installContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '存入 Trove',
      contexts: ['page', 'link'],
    });
  });
}

chrome.runtime.onInstalled.addListener(installContextMenu);
chrome.runtime.onStartup.addListener(installContextMenu);

chrome.action.onClicked.addListener((tab) => {
  void openQuickAdd(tab.url);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  void openQuickAdd(info.linkUrl || info.pageUrl || tab?.url);
});
