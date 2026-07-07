// ==UserScript==
// @name         Vidura Transcript Helper
// @namespace    https://vidura.nipuntheekshana.com
// @version      1.0.0
// @description  Sends a YouTube video's transcript to Vidura for Sinhala subtitles. Runs in your browser (a clean IP YouTube trusts), captures the player's own caption data, and posts it to your Vidura library.
// @match        https://www.youtube.com/watch*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      __API_HOST__
// @downloadURL  __API_BASE__/transcript-helper.user.js
// @updateURL    __API_BASE__/transcript-helper.user.js
// ==/UserScript==

(function () {
  "use strict";
  const API_BASE = "__API_BASE__";
  const win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

  // --- Capture the player's own /api/timedtext responses -------------------
  // The player fetches captions with a valid PO token; we can't reproduce that
  // token, so we piggyback on its request and keep the response body per video.
  const captured = Object.create(null); // videoId -> { body, isJson }

  function noteTimedtext(url, body) {
    try {
      const v = new URL(url, location.href).searchParams.get("v");
      if (v && body && body.length > 0) {
        captured[v] = { body, isJson: body.trimStart().startsWith("{") };
      }
    } catch (_) { /* ignore */ }
  }

  const origFetch = win.fetch;
  if (origFetch) {
    win.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const p = origFetch.apply(this, arguments);
      if (url && url.indexOf("/api/timedtext") !== -1) {
        p.then((res) => { res.clone().text().then((t) => noteTimedtext(url, t)).catch(() => {}); })
          .catch(() => {});
      }
      return p;
    };
  }

  const XHR = win.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__vd_url = url;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      if (this.__vd_url && String(this.__vd_url).indexOf("/api/timedtext") !== -1) {
        this.addEventListener("load", () => {
          try { noteTimedtext(this.__vd_url, this.responseText); } catch (_) {}
        });
      }
      return send.apply(this, arguments);
    };
  }

  // --- Small utilities -----------------------------------------------------
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const videoId = () => new URLSearchParams(location.search).get("v");

  function parseJson3(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return []; }
    const out = [];
    let last = "";
    for (const ev of data.events || []) {
      if (!ev.segs) continue;
      const text = clean(ev.segs.map((s) => s.utf8 || "").join(""));
      if (!text || text === last) continue;
      last = text;
      const startMs = Math.max(0, Math.floor(ev.tStartMs || 0));
      const durMs = Math.max(1, Math.floor(ev.dDurationMs || 4000));
      out.push({ startMs, endMs: startMs + durMs, text });
    }
    return out;
  }

  function parseXml(raw) {
    // srv3 / ttml: <p t="1234" d="4000">text</p> or <text start="1.2" dur="4">
    const out = [];
    let doc;
    try { doc = new DOMParser().parseFromString(raw, "text/xml"); } catch { return []; }
    const ps = doc.querySelectorAll("p, text");
    let last = "";
    ps.forEach((p) => {
      const text = clean(p.textContent);
      if (!text || text === last) return;
      last = text;
      const tAttr = p.getAttribute("t") ?? p.getAttribute("start");
      const dAttr = p.getAttribute("d") ?? p.getAttribute("dur");
      let startMs = 0;
      if (tAttr != null) startMs = tAttr.indexOf(".") !== -1 ? Math.round(parseFloat(tAttr) * 1000) : parseInt(tAttr, 10);
      let durMs = 4000;
      if (dAttr != null) durMs = dAttr.indexOf(".") !== -1 ? Math.round(parseFloat(dAttr) * 1000) : parseInt(dAttr, 10);
      out.push({ startMs: Math.max(0, startMs || 0), endMs: Math.max(1, (startMs || 0) + (durMs || 4000)), text });
    });
    return out;
  }

  function segmentsFor(v) {
    const c = captured[v];
    if (!c) return [];
    return c.isJson ? parseJson3(c.body) : parseXml(c.body);
  }

  function metadata() {
    const vd = (win.ytInitialPlayerResponse || {}).videoDetails || {};
    const v = videoId();
    return {
      title: vd.title || document.title.replace(/ - YouTube$/, "") || null,
      channelTitle: vd.author || null,
      durationMs: Number(vd.lengthSeconds) ? Number(vd.lengthSeconds) * 1000 : null,
      thumbnailUrl: v ? `https://i.ytimg.com/vi/${v}/hqdefault.jpg` : null,
    };
  }

  // Turn captions on so the player fetches the track (if it hasn't already).
  async function ensureCaptions() {
    const player = document.getElementById("movie_player");
    try {
      if (player && player.loadModule) {
        player.loadModule("captions");
        const list = (player.getOption && player.getOption("captions", "tracklist")) || [];
        const en = list.find((t) => (t.languageCode || "").startsWith("en")) || list[0];
        if (en) player.setOption("captions", "track", en);
      }
    } catch (_) { /* ignore */ }
    const cc = document.querySelector(".ytp-subtitles-button");
    if (cc && cc.getAttribute("aria-pressed") !== "true") cc.click();
    // Nudge playback briefly; some tracks only load once the player starts.
    const video = document.querySelector("video");
    try { if (video && video.paused) { video.muted = true; await video.play().catch(() => {}); } } catch (_) {}
  }

  async function waitForSegments(v, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const segs = segmentsFor(v);
      if (segs.length) return segs;
      await sleep(400);
    }
    return segmentsFor(v);
  }

  // --- Token ---------------------------------------------------------------
  async function getToken(forcePrompt) {
    let token = await GM_getValue("vidura_token", "");
    if (!token || forcePrompt) {
      token = (win.prompt(
        "Paste your Vidura ingest token\n(Vidura → Settings → Browser transcript helper):",
        token || "",
      ) || "").trim();
      if (token) await GM_setValue("vidura_token", token);
    }
    return token;
  }

  function post(path, token, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: API_BASE + path,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        data: JSON.stringify(body),
        onload: (r) => resolve({ status: r.status, text: r.responseText }),
        onerror: () => reject(new Error("network error")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  // --- UI ------------------------------------------------------------------
  function toast(msg, kind) {
    let el = document.getElementById("vidura-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "vidura-toast";
      el.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:76px;max-width:320px;padding:12px 14px;border-radius:12px;font:500 13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.35);transition:opacity .3s;opacity:0";
      document.body.appendChild(el);
    }
    el.style.background = kind === "error" ? "#b3261e" : kind === "work" ? "#334155" : "#0f766e";
    el.textContent = msg;
    el.style.opacity = "1";
    if (kind !== "work") setTimeout(() => { el.style.opacity = "0"; }, 4500);
  }

  async function run() {
    const v = videoId();
    if (!v) return toast("Open a YouTube video first.", "error");
    const token = await getToken(false);
    if (!token) return toast("No token set — add it from Vidura Settings.", "error");

    toast("Reading transcript…", "work");
    await ensureCaptions();
    const segs = await waitForSegments(v, 9000);
    if (!segs.length) {
      return toast("Couldn't read captions. Turn on CC (the video must have captions), then retry.", "error");
    }

    toast(`Sending ${segs.length} lines to Vidura…`, "work");
    const meta = metadata();
    try {
      const res = await post("/api/ingest/transcript", token, {
        youtubeVideoId: v,
        youtubeUrl: `https://www.youtube.com/watch?v=${v}`,
        title: meta.title,
        channelTitle: meta.channelTitle,
        durationMs: meta.durationMs,
        thumbnailUrl: meta.thumbnailUrl,
        segments: segs,
      });
      if (res.status === 401) { await getToken(true); return toast("Token rejected — re-enter it and retry.", "error"); }
      if (res.status >= 200 && res.status < 300) {
        toast(`✓ Sent ${segs.length} lines. Vidura is translating it now.`, "ok");
      } else {
        let msg = "Failed (" + res.status + ")";
        try { msg = JSON.parse(res.text).error || msg; } catch (_) {}
        toast(msg, "error");
      }
    } catch (e) {
      toast("Send failed: " + e.message, "error");
    }
  }

  function addButton() {
    if (document.getElementById("vidura-send-btn")) return;
    const btn = document.createElement("button");
    btn.id = "vidura-send-btn";
    btn.textContent = "Send to Vidura";
    btn.style.cssText = "position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:11px 16px;border:0;border-radius:999px;background:linear-gradient(135deg,#0f766e,#0ea5e9);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(14,165,233,.4)";
    btn.addEventListener("click", run);
    document.body.appendChild(btn);
  }

  function boot() {
    if (document.body) addButton();
    else setTimeout(boot, 300);
  }
  boot();
  // YouTube is a SPA — re-add the button after in-app navigations.
  win.addEventListener("yt-navigate-finish", () => setTimeout(addButton, 400));
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("Send this video's transcript to Vidura", run);
    GM_registerMenuCommand("Set/replace Vidura token", () => getToken(true));
  }
})();
