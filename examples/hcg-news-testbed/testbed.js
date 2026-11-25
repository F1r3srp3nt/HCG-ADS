/* HCG News — HCG ADS test environment. No build step; plain browser JavaScript. */
(function () {
  "use strict";

  var CONFIG = window.HCG_NEWS_TESTBED_CONFIG;
  var SLOTS = [
    { param: "leaderboard", slot: "home-leaderboard", name: "Homepage leaderboard" },
    { param: "sidebar", slot: "article-sidebar", name: "Article sidebar" },
    { param: "inarticle", slot: "in-article", name: "In-article promotion" },
    { param: "related", slot: "related-article", name: "Related article promotion" },
    { param: "mobile", slot: "mobile-banner", name: "Mobile banner" },
  ];
  var STORE_KEYS = "hcg-ads-testbed:placements";
  var STORE_CONSENT = "hcg-ads-testbed:consent";
  var COLUMNS = "id,title,subtitle,slug,excerpt,content_type,published_at,featured_image_url,featured_image_alt,is_demo,category:news_categories(id,name,slug)";

  var params = new URLSearchParams(location.search);
  var keys = {};
  var results = {};
  var rendered = [];

  // ---- helpers ---------------------------------------------------------------

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); } catch (e) { return ""; }
  }
  function isMobile() { return window.matchMedia("(max-width: 720px)").matches; }
  function canonical(a) {
    var section = a.category && a.category.slug ? a.category.slug : "news";
    return CONFIG.publicationURL.replace(/\/$/, "") + "/" + encodeURIComponent(section) + "/" + encodeURIComponent(a.slug || "");
  }
  function safeImage(url) { return typeof url === "string" && url.indexOf("https://") === 0 ? url : null; }

  // ---- HCG News public read API (same queries as the publication) ---------------

  function news(query) {
    var url = CONFIG.projectURL.replace(/\/$/, "") + "/rest/v1/news_articles?" + query +
      "&status=eq.published&published_at=lte." + encodeURIComponent(new Date().toISOString());
    return fetch(url, { headers: { apikey: CONFIG.publicClientKey, Authorization: "Bearer " + CONFIG.publicClientKey, Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("HCG News answered HTTP " + r.status); return r.json(); })
      .then(function (rows) { return (rows || []).filter(function (a) { return a && a.title && !a.is_demo; }); });
  }
  function latest(limit) { return news("select=" + COLUMNS + "&order=published_at.desc,id.desc&limit=" + (limit || 12)); }
  function article(id) { return news("select=" + COLUMNS + "&id=eq." + encodeURIComponent(id) + "&limit=1").then(function (r) { return r[0] || null; }); }

  // ---- placement keys ------------------------------------------------------------

  function resolveKeys() {
    var fromAdmin = fetch("/admin/v1/placements?publisherId=pub_hcg_news", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { placements: [] }; })
      .then(function (d) {
        var map = {};
        (d.placements || []).forEach(function (p) {
          var s = SLOTS.filter(function (x) { return x.slot === p.slot; })[0];
          if (s && p.status === "active") map[s.param] = p.publicKey;
        });
        return map;
      })
      .catch(function () { return {}; });
    return fromAdmin.then(function (adminMap) {
      var saved = load(STORE_KEYS) || {};
      SLOTS.forEach(function (s) {
        keys[s.param] = params.get(s.param) || saved[s.param] || adminMap[s.param] || "";
      });
    });
  }

  // ---- ads ---------------------------------------------------------------------

  function consent() {
    return {
      measurement: document.getElementById("consent-measurement").checked,
      storage: document.getElementById("consent-storage").checked,
    };
  }

  function placeAd(container, param, category) {
    var key = keys[param];
    var s = SLOTS.filter(function (x) { return x.param === param; })[0];
    var host = h("div", { class: "ad-host", "data-slot": param });
    container.appendChild(host);
    if (!key) {
      results[param] = { state: "not configured", detail: "No placement key" };
      host.style.display = "none";
      renderDebug();
      return;
    }
    results[param] = { state: "loading", detail: "" };
    host.addEventListener("hcg-ads:render", function (e) {
      results[param] = { state: "rendered", detail: e.detail.ad.headline + " · " + e.detail.ad.campaignId };
      renderDebug();
    });
    host.addEventListener("hcg-ads:empty", function (e) { results[param] = { state: "empty", detail: e.detail.reason }; renderDebug(); });
    host.addEventListener("hcg-ads:error", function (e) { results[param] = { state: "error", detail: e.detail.error }; renderDebug(); });
    rendered.push(host);
    if (window.HCGAds) window.HCGAds.render(host, { placement: key, context: category ? { category: category } : undefined });
    else { results[param] = { state: "error", detail: "SDK not loaded" }; host.style.display = "none"; }
    renderDebug();
    void s;
  }

  function renderDebug() {
    var list = document.getElementById("debug");
    list.textContent = "";
    SLOTS.forEach(function (s) {
      var r = results[s.param];
      if (!r) return;
      list.appendChild(h("li", { class: "debug-" + r.state.replace(/\s/g, "-") }, [
        h("strong", { text: s.name }), h("span", { text: " — " + r.state + (r.detail ? ": " + r.detail : "") }),
      ]));
    });
  }

  // ---- views -------------------------------------------------------------------

  function card(a) {
    var img = safeImage(a.featured_image_url);
    return h("article", { class: "story" }, [
      img ? h("a", { class: "story-img", href: "?article=" + encodeURIComponent(a.id) }, [h("img", { src: img, alt: a.featured_image_alt || "", loading: "lazy", referrerpolicy: "no-referrer" })]) : null,
      h("div", { class: "story-body" }, [
        a.category ? h("span", { class: "kicker", text: a.category.name }) : null,
        h("h2", {}, [h("a", { href: "?article=" + encodeURIComponent(a.id), text: a.title })]),
        a.excerpt || a.subtitle ? h("p", { class: "standfirst", text: a.excerpt || a.subtitle }) : null,
        h("time", { datetime: a.published_at, text: fmtDate(a.published_at) }),
      ]),
    ]);
  }

  function homeView(articles) {
    var content = document.getElementById("content");
    content.textContent = "";
    if (!articles.length) { content.appendChild(h("p", { class: "status", text: "HCG News returned no published articles." })); return; }
    content.appendChild(h("h1", { class: "page-title", text: "Latest" }));
    var lead = articles[0];
    var list = h("div", { class: "stories" });
    articles.forEach(function (a, i) {
      var c = card(a);
      if (i === 0) c.classList.add("lead");
      list.appendChild(c);
    });
    content.appendChild(list);
    void lead;
  }

  function articleView(a, more) {
    var content = document.getElementById("content");
    content.textContent = "";
    if (!a) {
      content.appendChild(h("p", { class: "status", text: "This article is not published (or no longer available)." }));
      return null;
    }
    document.title = a.title + " — HCG News (test environment)";
    var img = safeImage(a.featured_image_url);
    var body = h("article", { class: "article" }, [
      h("a", { class: "back", href: "./", text: "← All stories" }),
      a.category ? h("span", { class: "kicker", text: a.category.name }) : null,
      h("h1", { class: "headline", text: a.title }),
      a.subtitle ? h("p", { class: "subtitle", text: a.subtitle }) : null,
      h("time", { datetime: a.published_at, text: fmtDate(a.published_at) }),
      img ? h("figure", { class: "cover" }, [h("img", { src: img, alt: a.featured_image_alt || "", referrerpolicy: "no-referrer" })]) : null,
      a.excerpt ? h("p", { class: "lede", text: a.excerpt }) : null,
    ]);
    var inArticle = h("div", { class: "slot slot-inline" });
    body.appendChild(inArticle);
    body.appendChild(h("p", { class: "readmore" }, [
      h("a", { href: canonical(a), rel: "noopener", target: "_blank", text: "Read the full article on news.hakmicapitalgroup.com →" }),
    ]));
    var related = h("div", { class: "slot slot-inline" });
    body.appendChild(h("h2", { class: "more-title", text: "More from HCG News" }));
    body.appendChild(related);
    var moreList = h("div", { class: "stories compact" });
    more.filter(function (m) { return m.id !== a.id; }).slice(0, 4).forEach(function (m) { moreList.appendChild(card(m)); });
    body.appendChild(moreList);
    content.appendChild(body);
    return { inArticle: inArticle, related: related, category: a.category && a.category.slug };
  }

  function sectionsNav(articles) {
    var nav = document.getElementById("sections");
    var seen = {};
    articles.forEach(function (a) {
      if (a.category && !seen[a.category.slug]) {
        seen[a.category.slug] = true;
        nav.appendChild(h("span", { text: a.category.name }));
      }
    });
  }

  // ---- tools ---------------------------------------------------------------------

  function setupTools() {
    var saved = load(STORE_CONSENT) || { measurement: true, storage: false };
    document.getElementById("consent-measurement").checked = !!saved.measurement;
    document.getElementById("consent-storage").checked = !!saved.storage;
    ["consent-measurement", "consent-storage"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", function () {
        store(STORE_CONSENT, consent());
        if (window.HCGAds) {
          window.HCGAds.setConsent(consent());
          rendered.forEach(function (el) { window.HCGAds.refresh(el); });
        }
      });
    });
    document.getElementById("refresh").addEventListener("click", function () {
      if (window.HCGAds) rendered.forEach(function (el) { window.HCGAds.refresh(el); });
    });

    var form = document.getElementById("config-form");
    var saved2 = load(STORE_KEYS) || {};
    SLOTS.forEach(function (s) {
      form.appendChild(h("label", {}, [h("span", { text: s.name + " (" + s.slot + ")" }), h("input", { name: s.param, value: saved2[s.param] || "", placeholder: keys[s.param] || "plc_pub_…", autocomplete: "off", spellcheck: "false" })]));
    });
    var save = h("button", { type: "submit", text: "Save and reload" });
    form.appendChild(save);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var map = {};
      SLOTS.forEach(function (s) { var v = form.elements[s.param].value.trim(); if (v) map[s.param] = v; });
      store(STORE_KEYS, map);
      location.reload();
    });
  }

  // ---- start ---------------------------------------------------------------------

  function start() {
    setupTools();
    if (window.HCGAds) {
      document.getElementById("sdk-version").textContent = window.HCGAds.version;
      window.HCGAds.init({ consent: consent, autoScan: false, debug: params.has("debug") });
    }
    var id = params.get("article");
    var top = document.getElementById("slot-top");
    var sidebar = document.getElementById("slot-sidebar");

    Promise.all([resolveKeys(), latest(12)])
      .then(function (r) {
        var articles = r[1];
        sectionsNav(articles);
        if (!id) {
          homeView(articles);
          placeAd(top, isMobile() ? "mobile" : "leaderboard");
          placeAd(sidebar, "sidebar");
          return;
        }
        return article(id).then(function (a) {
          var slots = articleView(a, articles);
          if (isMobile()) placeAd(top, "mobile", slots && slots.category);
          placeAd(sidebar, "sidebar", slots && slots.category);
          if (slots) {
            placeAd(slots.inArticle, "inarticle", slots.category);
            placeAd(slots.related, "related", slots.category);
          }
        });
      })
      .catch(function (e) {
        var content = document.getElementById("content");
        content.textContent = "";
        content.appendChild(h("p", { class: "status error", text: "Could not load HCG News: " + e.message }));
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
