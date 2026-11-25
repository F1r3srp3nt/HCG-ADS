/* HCG Store theme test page: placements via the HCG ADS SDK with theme "hcg-store". */
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var slots = ["leaderboard", "rectangle", "native"];
  var debug = document.getElementById("debug");
  var consentState = { measurement: params.get("measurement") !== "0", storage: params.get("storage") === "1" };
  function consent() { return { measurement: consentState.measurement, storage: consentState.storage }; }
  function line(slot, text) {
    var id = "dbg-" + slot, li = document.getElementById(id);
    if (!li) { li = document.createElement("li"); li.id = id; debug.appendChild(li); }
    li.textContent = slot + ": " + text;
  }
  ["measurement", "storage"].forEach(function (k) {
    var box = document.getElementById("consent-" + k);
    box.checked = consentState[k];
    box.addEventListener("change", function () { consentState[k] = box.checked; if (window.HCGAds) window.HCGAds.setConsent(consent()); });
  });
  if (!window.HCGAds) { slots.forEach(function (s) { line(s, "SDK not loaded (the page keeps working)"); }); return; }
  document.getElementById("sdk-version").textContent = window.HCGAds.version;
  window.HCGAds.init({
    consent: consent, autoScan: false, theme: "hcg-store", debug: params.has("debug"),
    onRender: function (e) { line(e.element.getAttribute("data-slot"), "rendered · " + e.ad.headline + " · " + e.ad.disclosure); },
    onEmpty: function (e) { line(e.element.getAttribute("data-slot"), "empty (" + e.reason + ")"); },
    onError: function (e) { line(e.element.getAttribute("data-slot"), "error (collapsed)"); }
  });
  slots.forEach(function (s) {
    var key = params.get(s), host = document.getElementById("slot-" + s);
    if (!key) { host.setAttribute("data-hcg-ads-state", "empty"); line(s, "no placement key"); return; }
    window.HCGAds.render(host, { placement: key, theme: "hcg-store" });
  });
})();
