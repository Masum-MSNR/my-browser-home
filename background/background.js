chrome.webNavigation.onCompleted.addListener(async (details) => {
  const tabId = details.tabId;

  chrome.tabs.get(tabId, async (tab) => {
    if (!tab || !tab.url || !tab.favIconUrl) return;

    const rootDomain = getFullDomain(tab.url);
    if (!rootDomain) return;

    const pageData = {
      url: tab.url,
      favicon: tab.favIconUrl,
      title: tab.title || tab.url
    };

    chrome.storage.local.set({ [rootDomain]: pageData });
  });
});


function getFullDomain(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch (e) {
    console.warn("Invalid URL:", url);
    return '';
  }
}