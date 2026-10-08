/* Yandex Games SDK adapter.
   Loads /sdk.js when the game runs on Yandex hosting; anywhere else
   (local dev, GitHub Pages) it degrades to a no-op mock and the game
   keeps its localStorage-only saves. Exposed as window.YNDK. */
const YNDK = (() => {
  let ysdk = null;
  let player = null;
  let dataCb = null;
  let readyCalled = false;
  let lastAdv = Date.now();
  let matchCount = 0;
  const ADV_COOLDOWN = 180e3;   // at most one interstitial per 3 minutes
  let pending = {};             // save keys waiting for the player object
  let flushT = null;

  function loadSdk() {
    return new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "/sdk.js";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  function pushReady() {
    if (!readyCalled || !ysdk) return;
    try { if (ysdk.features.LoadingAPI) ysdk.features.LoadingAPI.ready(); } catch (e) {}
  }

  function flush() {
    flushT = null;
    if (!player || !Object.keys(pending).length) return;
    const d = pending;
    pending = {};
    try { player.setData(d).catch(() => {}); } catch (e) {}
  }

  async function init() {
    try {
      if (await loadSdk()) {
        ysdk = await YaGames.init();
        try {
          player = await ysdk.getPlayer({ scopes: false });
          const data = await player.getData();
          if (dataCb) dataCb(data);
          if (flushT) { clearTimeout(flushT); flush(); }
        } catch (e) { /* lite player (not logged in): cloud saves unavailable */ }
      }
    } catch (e) { ysdk = null; }
    pushReady();
  }

  const api = {
    get active() { return !!ysdk; },
    // Call once the title screen is visible and input is accepted.
    ready() { readyCalled = true; pushReady(); },
    onData(cb) { dataCb = cb; },
    gameplayStart() { try { if (ysdk && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.start(); } catch (e) {} },
    gameplayStop() { try { if (ysdk && ysdk.features.GameplayAPI) ysdk.features.GameplayAPI.stop(); } catch (e) {} },
    save(key, val) {
      pending[key] = val;
      if (player && !flushT) flushT = setTimeout(flush, 1500);
    },
    countMatch() { matchCount++; },
    // Natural break between matches: runs `done` right away or after an ad.
    maybeInterstitial(done) {
      if (!ysdk || matchCount < 1 || Date.now() - lastAdv < ADV_COOLDOWN) { done(); return; }
      lastAdv = Date.now();
      api.gameplayStop();
      let fired = false;
      const fin = () => { if (!fired) { fired = true; done(); } };
      try {
        ysdk.adv.showFullscreenAdv({ callbacks: { onOpen() {}, onClose: fin, onError: fin } });
        setTimeout(fin, 20000);   // never block the game if the SDK stalls
      } catch (e) { fin(); }
    },
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && flushT) { clearTimeout(flushT); flush(); }
  });
  init();
  return api;
})();
window.YNDK = YNDK;
