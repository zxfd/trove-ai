const DEFAULT_TROVE_URL = 'http://trove.v2rich.cn:18081';
const input = document.querySelector('#trove-url');
const status = document.querySelector('#status');

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Trove 地址必须以 http:// 或 https:// 开头');
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`;
}

async function loadSettings() {
  const settings = await chrome.storage.sync.get('troveBaseUrl');
  input.value = settings.troveBaseUrl || DEFAULT_TROVE_URL;
}

async function saveSettings() {
  try {
    const troveBaseUrl = normalizeBaseUrl(input.value.trim());
    await chrome.storage.sync.set({ troveBaseUrl });
    input.value = troveBaseUrl;
    status.textContent = '已保存';
  } catch (error) {
    status.textContent = error.message;
    status.style.color = '#d92d20';
  }
}

document.querySelector('#save').addEventListener('click', () => {
  status.style.color = '';
  void saveSettings();
});

document.querySelector('#open').addEventListener('click', async () => {
  try {
    const troveBaseUrl = normalizeBaseUrl(input.value.trim());
    await chrome.tabs.create({ url: `${troveBaseUrl}/quick-add` });
  } catch (error) {
    status.textContent = error.message;
    status.style.color = '#d92d20';
  }
});

void loadSettings();
