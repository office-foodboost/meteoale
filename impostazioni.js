/* MeteoAle · Impostazioni condivise (ingranaggio in alto a destra + pannello)
   Uso:  <script src="impostazioni.js"></script>            (index.html)
         <script src="../impostazioni.js"></script>         (proposte/*.html)
         MeteoImpostazioni.init({ monta: elemento|null, onLuogo: function(luogo)|null })
   - MeteoImpostazioni.get() → { stile, animazioni, base }  (localStorage "meteo.impostazioni")
   - a ogni cambio: evento window "meteo-impostazioni" (detail = impostazioni) e classe "mi-no-anim" su <html>
   - località: le stesse dell'app (meteo.luoghi / meteo.attivo). Dopo un cambio chiama onLuogo(luogo),
     altrimenti ricarica la pagina senza ?nome=&lat=&lon= (così vale la località salvata).
   - nome di chi usa il telefono (localStorage "meteo.nome", resta lì e basta):
     MeteoImpostazioni.nome() → "Maria" oppure "";  a ogni cambio: evento window "meteo-nome" (detail = { nome })
     MeteoImpostazioni.saluto() → "Buonasera, Maria" (o solo "Buonasera");  saluta(elemento, { soloConNome })
     tiene aggiornato un elemento (cambio nome, ora che passa, ritorno sull'app).
   - primo utilizzo: foglio di benvenuto (nome, località, dove sono le impostazioni) finché "meteo.benvenuto"
     non vale "1". Non compare nelle anteprime (?anteprima=1 o pagina dentro un iframe); ?benvenuto=1 lo mostra sempre.
   Niente dipendenze, niente chiavi. CSS iniettato, classi con prefisso "mi-". */
(function (global) {
  "use strict";
  if (global.MeteoImpostazioni) return;

  /* ---------- dentro il pannello iPad ----------
     Il pannello mostra MeteoAle in un riquadro che non scorre (iframe con scrolling="no" e misure fisse): così su iOS 12
     il riquadro non si allunga quanto la pagina, e i fogli a tutto schermo (giorno, impostazioni) restano al loro posto.
     Qui dentro è la pagina a scorrere dentro di sé: .pagina se c'è, altrimenti <body>.
     Si riconosce dal riquadro (scrolling="no") oppure da ?cornice=1 nel link, ricordato per le pagine aperte dopo.
     A ogni tocco avvisa il pannello, che così non torna da solo alla sua schermata principale.
     Un dito che scorre di lato (o due dita sul trackpad, o le frecce) viene passato al pannello, che cambia schermata:
     non vale sulle strisce che scorrono di lato (le ore), sulla mappa, nei campi e quando è aperto un foglio.
     Fuori dal pannello non cambia niente. */
  var CORNICE = (function () {
    if (global.parent === global) return false;
    var si = false;
    try { var f = global.frameElement; si = !!f && String(f.getAttribute("scrolling")).toLowerCase() === "no"; } catch (e) {}
    try {
      if (/[?&]cornice=1(&|$)/.test(location.search)) { si = true; sessionStorage.setItem("meteo.cornice", "1"); }
      else if (sessionStorage.getItem("meteo.cornice") === "1") si = true;
    } catch (e2) {}
    return si;
  })();
  if (CORNICE) {
    document.documentElement.classList.add("mi-cornice");
    var stileCornice = document.createElement("style");
    stileCornice.textContent = "html.mi-cornice,html.mi-cornice body{height:100%!important;overflow:hidden!important}" +
      "html.mi-cornice .mi-scorre{height:100%!important;min-height:0!important;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch}";
    (document.head || document.documentElement).appendChild(stileCornice);
    var segnaScorre = function () { (document.querySelector(".pagina") || document.body).classList.add("mi-scorre"); };
    if (document.body) segnaScorre(); else document.addEventListener("DOMContentLoaded", segnaScorre);
    var avvisaPannello = function (m) { try { global.parent.postMessage(m, "*"); } catch (e) {} };
    var foglioAperto = function () { var c = document.documentElement.classList; return c.contains("mg-aperto") || c.contains("mi-aperto"); };
    var scorreDiLato = function (el) {
      for (; el && el !== document.documentElement; el = el.parentNode) {
        if (el.nodeType !== 1) continue;
        if (el.id === "mappa" || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
        if (el.classList && (el.classList.contains("leaflet-container") || el.classList.contains("mm-mappa"))) return true;
        if (el.scrollWidth > el.clientWidth + 4) {
          var ox = global.getComputedStyle(el).overflowX;
          if (ox === "auto" || ox === "scroll") return true;
        }
      }
      return false;
    };
    var tx = null, ty = 0;
    document.addEventListener("touchstart", function (e) {
      avvisaPannello("meteoale:tocco");
      tx = null;
      if (e.touches.length !== 1 || foglioAperto() || scorreDiLato(e.target)) return;
      tx = e.touches[0].clientX; ty = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", function (e) {
      if (tx === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
      tx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) avvisaPannello(dx < 0 ? "meteoale:avanti" : "meteoale:indietro");
    }, { passive: true });
    document.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaX) < 30 || Math.abs(e.deltaX) < Math.abs(e.deltaY) || foglioAperto() || scorreDiLato(e.target)) return;
      avvisaPannello(e.deltaX > 0 ? "meteoale:avanti" : "meteoale:indietro");
    }, { passive: true });
    document.addEventListener("keydown", function (e) {
      if ((e.keyCode !== 37 && e.keyCode !== 39) || foglioAperto() || scorreDiLato(e.target)) return;
      avvisaPannello(e.keyCode === 39 ? "meteoale:avanti" : "meteoale:indietro");
    });
  }
  /* focus senza far scorrere la pagina: dove { preventScroll } non è capito (Safari vecchi) è meglio non spostare il focus */
  var FOCUS_FERMO = (function () {
    var ok = false;
    try { document.createElement("div").focus({ get preventScroll() { ok = true; return true; } }); } catch (e) {}
    return ok;
  })();
  function fuoco(el) { if (FOCUS_FERMO && el) { try { el.focus({ preventScroll: true }); } catch (e) {} } }

  /* cartella dell'app, ricavata dall'indirizzo di questo file (document.currentScript vale solo adesso) */
  var SCRIPT = document.currentScript;
  var BASE = (function () {
    try { if (SCRIPT && SCRIPT.src) return new URL(".", SCRIPT.src).href; } catch (e) {}
    return new URL(".", location.href).href;
  })();

  var CHIAVE = "meteo.impostazioni", CHIAVE_LUOGHI = "meteo.luoghi", CHIAVE_ATTIVO = "meteo.attivo";
  var CHIAVE_NOME = "meteo.nome", CHIAVE_BENV = "meteo.benvenuto"; /* testo semplice, non JSON */
  /* Versione: il numero si cambia a mano; build e data li scrive pubblica.sh al momento della pubblicazione */
  var VERSIONE = "1.0";
  var BUILD = "8";
  var AGGIORNATO = "2026-11-25T07:49";   // es. "2026-11-24T22:55"
  function dataBella(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }) +
      " alle " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  var STILI = [
    { id: "classico", nome: "Classico", sotto: "Nero e oro", pagina: "index.html" },
    { id: "cielo", nome: "Cielo", sotto: "Cielo vivo", pagina: "proposte/1-cielo.html" },
    { id: "chiaro", nome: "Chiaro", sotto: "Su bianco", pagina: "proposte/2-chiaro.html" },
    { id: "semplice", nome: "Semplice", sotto: "Testi grandi", pagina: "proposte/3-semplice.html" },
    { id: "scena", nome: "Scena animata", sotto: "Paesaggio vivo", pagina: "proposte/4-scena.html" }
  ];
  var BASI = [
    { id: "satellite", nome: "Satellite", sotto: "Foto dal satellite, colori naturali (EOX)" },
    { id: "notte", nome: "Satellite notte", sotto: "La Terra di notte, con le luci delle città" },
    { id: "rilievo", nome: "Rilievo", sotto: "Montagne e valli, toni scuri" },
    { id: "chiara", nome: "Rilievo chiaro", sotto: "Rilievo su fondo chiaro" },
    { id: "topo", nome: "Topografica", sotto: "Curve di livello, strade e sentieri" }
  ];
  /* chi non ha mai scelto uno stile parte dalla Scena animata (anche index.html, nello script in <head>) */
  var PREDEFINITE = { stile: "scena", animazioni: true, base: "satellite" };
  var ids = function (a) { return a.map(function (x) { return x.id; }); };

  /* ---------- lettura e scrittura ---------- */
  function leggi(k, def) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } }
  function scrivi(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function get() {
    var s = leggi(CHIAVE, {});
    if (!s || typeof s !== "object") s = {};
    return {
      stile: ids(STILI).indexOf(s.stile) >= 0 ? s.stile : PREDEFINITE.stile,
      animazioni: typeof s.animazioni === "boolean" ? s.animazioni : PREDEFINITE.animazioni,
      base: ids(BASI).indexOf(s.base) >= 0 ? s.base : PREDEFINITE.base
    };
  }
  function applicaClasse(s) { document.documentElement.classList.toggle("mi-no-anim", !s.animazioni); }
  function imposta(cambi) {
    var s = get();
    Object.keys(cambi).forEach(function (k) { s[k] = cambi[k]; });
    scrivi(CHIAVE, s);
    applicaClasse(s);
    var copia = { stile: s.stile, animazioni: s.animazioni, base: s.base };
    try { global.dispatchEvent(new CustomEvent("meteo-impostazioni", { detail: copia })); } catch (e) {}
    return s;
  }
  applicaClasse(get()); /* subito, prima del primo disegno */

  /* ---------- nome e saluto (il nome resta su questo telefono: non va da nessuna parte) ---------- */
  function nome() { try { return (localStorage.getItem(CHIAVE_NOME) || "").trim().slice(0, 30); } catch (e) { return ""; } }
  function avvisaNome() { try { global.dispatchEvent(new CustomEvent("meteo-nome", { detail: { nome: nome() } })); } catch (e) {} }
  function impostaNome(n) {
    n = String(n == null ? "" : n).replace(/\s+/g, " ").trim().slice(0, 30);
    if (n === nome()) return n;
    try { if (n) localStorage.setItem(CHIAVE_NOME, n); else localStorage.removeItem(CHIAVE_NOME); } catch (e) {}
    avvisaNome();
    return n;
  }
  global.addEventListener("storage", function (e) { if (e.key === CHIAVE_NOME) avvisaNome(); }); /* cambiato in un'altra scheda */
  function parolaSaluto(d) {
    var h = (d || new Date()).getHours();
    return h >= 5 && h < 13 ? "Buongiorno" : h >= 13 && h < 18 ? "Buon pomeriggio" : h >= 18 && h < 23 ? "Buonasera" : "Buonanotte";
  }
  function saluto(d) { var n = nome(); return parolaSaluto(d) + (n ? ", " + n : ""); }
  /* tiene aggiornato il saluto in un elemento; soloConNome: senza nome l'elemento sparisce */
  function saluta(el, o) {
    if (!el) return;
    o = o || {};
    el.setAttribute("data-mi-saluto", "");
    var fai = function () {
      var t = nome() || !o.soloConNome ? saluto() : "";
      if (el.textContent !== t) el.textContent = t;
      el.hidden = !t;
    };
    fai();
    global.addEventListener("meteo-nome", fai);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) fai(); });
    setInterval(fai, 60000);
  }

  function statoLuoghi() {
    var l = leggi(CHIAVE_LUOGHI, []), a = leggi(CHIAVE_ATTIVO, 0);
    if (!Array.isArray(l)) l = [];
    if (!(a >= 0 && a < l.length)) a = 0;
    return { luoghi: l, attivo: a };
  }
  function salvaLuoghi(st) { scrivi(CHIAVE_LUOGHI, st.luoghi); scrivi(CHIAVE_ATTIVO, st.attivo); }
  /* stesse regole dell'app: la posizione automatica è una sola (si aggiorna), le altre non si doppiano */
  function aggiungi(st, l) {
    var i = -1;
    st.luoghi.forEach(function (x, k) {
      if (i >= 0 || !x) return;
      if (l.auto ? x.auto : (!x.auto && Math.abs(x.lat - l.lat) < 0.01 && Math.abs(x.lon - l.lon) < 0.01)) i = k;
    });
    if (i >= 0 && l.auto) { st.luoghi[i] = l; st.attivo = i; }
    else if (i >= 0) st.attivo = i;
    else { st.luoghi.push(l); st.attivo = st.luoghi.length - 1; }
    return st;
  }
  var chiaveL = function (l) { return l ? (+l.lat).toFixed(2) + "," + (+l.lon).toFixed(2) + "," + (l.nome || "") : ""; };

  /* link con località (?nome=&lat=&lon=): la pagina la mostra, qui la salvo come fa l'app classica */
  (function daLink() {
    var p = new URLSearchParams(location.search);
    var lat = parseFloat(p.get("lat")), lon = parseFloat(p.get("lon"));
    if (!isFinite(lat) || !isFinite(lon)) return;
    var st = statoLuoghi();
    aggiungi(st, { nome: p.get("nome") || "Località", sotto: "", lat: lat, lon: lon });
    salvaLuoghi(st);
  })();

  /* ---------- stile del pannello ---------- */
  var INGRANAGGIO = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var SPUNTA = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var CSS = [
    /* ingranaggio */
    ".mi-ingranaggio{box-sizing:border-box;margin:0;padding:0;border:0;background:none;font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;pointer-events:auto;display:inline-grid;place-items:center;flex:none;line-height:0;-webkit-appearance:none;appearance:none}",
    ".mi-ingranaggio svg{display:block;width:22px;height:22px}",
    ".mi-ingranaggio.mi-montato{width:44px;height:44px;border-radius:50%}",
    ".mi-ingranaggio.mi-fluttuante{position:fixed;top:calc(env(safe-area-inset-top, 0px) + 10px);right:12px;width:40px;height:40px;border-radius:50%;z-index:1000;color:#fff;background:rgba(18,22,30,.42);border:1px solid rgba(255,255,255,.22);-webkit-backdrop-filter:blur(12px) saturate(140%);backdrop-filter:blur(12px) saturate(140%);box-shadow:0 2px 10px rgba(0,0,0,.18)}",
    ".mi-ingranaggio:active{transform:scale(.94)}",
    ".mi-ingranaggio:focus-visible{outline:2px solid #0A64D8;outline-offset:2px}",
    "html.mi-aperto,html.mi-aperto body{overflow:hidden!important}",
    /* velo e foglio */
    ".mi-velo{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2000;background:rgba(0,0,0,.45);visibility:hidden;opacity:0;transition:opacity .22s ease,visibility 0s linear .22s;-webkit-tap-highlight-color:transparent}",
    ".mi-velo.mi-su{visibility:visible;opacity:1;transition:opacity .22s ease}",
    ".mi-foglio{position:absolute;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;height:calc(100% - env(safe-area-inset-top, 0px) - 18px);background:#F2F2F7;color:#1C1C1E;border-radius:16px 16px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1)}",
    ".mi-velo.mi-su .mi-foglio{transform:none}",
    "html.mi-no-anim .mi-velo,html.mi-no-anim .mi-foglio{transition:none!important}",
    ".mi-foglio{font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;font-size:16px;line-height:1.35;text-align:left;letter-spacing:normal;text-transform:none;-webkit-font-smoothing:antialiased}",
    ".mi-foglio *{box-sizing:border-box;margin:0;padding:0;border:0;font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Segoe UI\",Roboto,\"Helvetica Neue\",Arial,sans-serif;font-size:16px;font-weight:400;font-style:normal;line-height:1.35;letter-spacing:normal;text-transform:none;text-align:left;text-shadow:none;color:inherit;background:none;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}",
    ".mi-foglio button{cursor:pointer;-webkit-appearance:none;appearance:none;border-radius:0}",
    ".mi-foglio :focus-visible{outline:2px solid #0A64D8;outline-offset:2px}",
    ".mi-foglio svg{display:block;flex:none}",
    ".mi-testa{flex:none;display:flex;align-items:center;justify-content:space-between;padding:6px 8px 6px 20px;min-height:58px;border-bottom:1px solid #DCDCE1;background:#F2F2F7;border-radius:16px 16px 0 0}",
    ".mi-foglio .mi-titolo{font-size:20px;font-weight:700;color:#1C1C1E}",
    ".mi-foglio .mi-chiudi{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:30px;line-height:1;color:#3C3C43;font-weight:300}",
    ".mi-corpo{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:4px 16px calc(env(safe-area-inset-bottom, 0px) + 28px)}",
    ".mi-foglio .mi-sez{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6C6C72;margin:22px 4px 8px}",
    ".mi-foglio .mi-sez label{font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit}",
    ".mi-foglio .mi-nota{font-size:13px;color:#6C6C72;margin:8px 4px 0;line-height:1.4}",
    ".mi-gruppo{background:#fff;border-radius:12px;overflow:hidden}",
    /* stili */
    ".mi-stili{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}",
    ".mi-foglio .mi-stile{display:flex;flex-direction:column;gap:6px;padding:6px;background:#fff;border-radius:14px;box-shadow:inset 0 0 0 1px #E3E3E8;min-height:44px;position:relative}",
    ".mi-foglio .mi-stile[aria-pressed=true]{box-shadow:inset 0 0 0 2.5px #0A64D8}",
    ".mi-foglio .mi-stile .mi-n{font-size:14px;font-weight:600;color:#1C1C1E;padding:0 2px;line-height:1.2}",
    ".mi-foglio .mi-stile .mi-s{font-size:12px;color:#6C6C72;padding:0 2px 2px;margin-top:-5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".mi-foglio .mi-ok{position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:50%;background:#0A64D8;color:#fff;display:none;place-items:center;box-shadow:0 0 0 2px #fff}",
    ".mi-foglio .mi-ok svg{width:15px;height:15px}",
    ".mi-foglio .mi-stile[aria-pressed=true] .mi-ok{display:grid}",
    /* mini anteprime disegnate */
    ".mi-foglio .mi-mini{position:relative;display:block;height:112px;border-radius:9px;overflow:hidden}",
    ".mi-foglio .mi-mini i{position:absolute;display:block;font-style:normal}",
    ".mi-foglio .mi-mini b{position:absolute;display:block;font-weight:200;left:0;right:0;text-align:center;line-height:1}",
    ".mi-m-classico{background:#000}",
    ".mi-m-classico .mi-a{top:11px;left:30%;right:30%;height:4px;border-radius:2px;background:#C9B27C}",
    ".mi-foglio .mi-m-classico b{top:24px;font-size:28px;color:#F2EAD8}",
    ".mi-m-classico .mi-c{top:60px;left:8px;right:8px;height:22px;border-radius:5px;background:#100E0A;box-shadow:inset 0 0 0 1px #241F16}",
    ".mi-m-classico .mi-d{top:67px;left:14px;width:40%;height:3px;border-radius:2px;background:#8A7C66}",
    ".mi-m-classico .mi-e{bottom:0;left:0;right:0;height:18px;background:#0B0A07;border-top:1px solid #241F16}",
    ".mi-m-classico .mi-f{bottom:7px;left:18%;width:64%;height:4px;background:radial-gradient(circle,#C9B27C 0 2px,transparent 2.5px) 0 0/25% 100% repeat-x}",
    ".mi-m-cielo{background:linear-gradient(180deg,#1E66C4 0%,#4D9BE6 55%,#8CC6F5 100%)}",
    ".mi-m-cielo .mi-a{top:12px;left:32%;right:32%;height:4px;border-radius:2px;background:rgba(255,255,255,.9)}",
    ".mi-foglio .mi-m-cielo b{top:22px;font-size:30px;color:#fff}",
    ".mi-m-cielo .mi-c{top:20px;right:-14px;width:44px;height:16px;border-radius:50%;background:rgba(255,255,255,.75);filter:blur(4px)}",
    ".mi-m-cielo .mi-d{top:62px;left:8px;right:8px;height:20px;border-radius:7px;background:rgba(6,28,64,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}",
    ".mi-m-cielo .mi-e{top:87px;left:8px;right:8px;height:18px;border-radius:7px;background:rgba(6,28,64,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22)}",
    ".mi-m-chiaro{background:#F1F3F5}",
    ".mi-m-chiaro .mi-a{top:0;left:0;right:0;height:26px;background:#fff;border-bottom:1px solid #D8DDE2}",
    ".mi-m-chiaro .mi-b2{top:8px;left:8px;width:10px;height:10px;border-radius:3px;background:#0A6B73}",
    ".mi-m-chiaro .mi-c{top:11px;left:22px;width:34%;height:4px;border-radius:2px;background:#0F1720}",
    ".mi-m-chiaro .mi-d{top:33px;left:8px;right:8px;height:40px;border-radius:6px;background:#fff;box-shadow:inset 0 0 0 1px #D8DDE2}",
    ".mi-m-chiaro .mi-e{top:41px;left:15px;width:13px;height:13px;border-radius:50%;background:#FFC23A}",
    ".mi-foglio .mi-m-chiaro b{top:41px;left:34px;right:auto;font-size:19px;font-weight:700;color:#0F1720}",
    ".mi-m-chiaro .mi-f{top:80px;left:8px;right:8px;height:16px;border-radius:5px;background:#0A6B73}",
    ".mi-m-semplice{background:#F4F1EA}",
    ".mi-m-semplice .mi-a{top:10px;left:9px;width:55%;height:8px;border-radius:3px;background:#15191F}",
    ".mi-m-semplice .mi-c{top:10px;right:9px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1.5px #E2DDD2}",
    ".mi-m-semplice .mi-d{top:32px;left:8px;right:8px;height:46px;border-radius:9px;background:#FFD56A}",
    ".mi-foglio .mi-m-semplice b{top:41px;font-size:28px;font-weight:800;color:#15191F}",
    ".mi-m-semplice .mi-e{top:85px;left:8px;right:8px;height:18px;border-radius:7px;background:#1556B0}",
    ".mi-m-scena{background:#EAF4FD}",
    ".mi-m-scena .mi-a{top:0;left:0;right:0;height:68px;background:linear-gradient(180deg,#2F8FE8,#6DB8F5 70%,#CDEBFF)}",
    ".mi-m-scena .mi-c{top:26px;left:-6px;width:70px;height:42px;background:linear-gradient(180deg,#fff 0 22%,#B9AFA6 23%);clip-path:polygon(50% 0,100% 100%,0 100%)}",
    ".mi-m-scena .mi-d{top:34px;right:-10px;width:66px;height:34px;background:linear-gradient(180deg,#fff 0 20%,#8E847C 21%);clip-path:polygon(48% 0,100% 100%,0 100%)}",
    ".mi-m-scena .mi-e{top:52px;left:-20%;width:140%;height:30px;border-radius:50%;background:#5E9C5A}",
    ".mi-foglio .mi-m-scena b{top:10px;font-size:26px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.2)}",
    ".mi-m-scena .mi-f{top:76px;left:8px;right:8px;height:28px;border-radius:7px;background:#fff;box-shadow:0 1px 4px rgba(20,40,70,.12)}",
    /* righe (località, mappa, animazioni) */
    ".mi-foglio .mi-riga{display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 6px 6px 16px;width:100%;position:relative}",
    ".mi-foglio .mi-riga+.mi-riga::before{content:\"\";position:absolute;top:0;left:16px;right:0;height:1px;background:#E3E3E8}",
    ".mi-foglio .mi-testo{flex:1;min-width:0;padding:4px 0;display:block}",
    ".mi-foglio .mi-testo .mi-n{display:block;font-size:17px;color:#1C1C1E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".mi-foglio .mi-testo .mi-s{display:block;font-size:13px;color:#6C6C72;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".mi-foglio .mi-spunta{width:28px;height:28px;display:grid;place-items:center;color:#0A64D8;visibility:hidden}",
    ".mi-foglio [aria-checked=true] .mi-spunta,.mi-foglio .mi-attivo .mi-spunta{visibility:visible}",
    ".mi-foglio .mi-attivo .mi-testo .mi-n{font-weight:600}",
    ".mi-foglio .mi-togli{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:24px;line-height:1;color:#8E8E93;flex:none}",
    ".mi-foglio .mi-vuoto{padding:16px;font-size:15px;color:#6C6C72}",
    ".mi-foglio .mi-cerca,.mi-foglio .mi-campo{display:block;width:100%;height:46px;margin-top:10px;padding:0 14px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #D6D6DB;font-size:16px;color:#1C1C1E;-webkit-appearance:none;appearance:none;outline:none}",
    ".mi-foglio .mi-campo{margin-top:0;font-size:17px}",
    ".mi-foglio .mi-cerca:focus,.mi-foglio .mi-campo:focus{box-shadow:inset 0 0 0 2px #0A64D8}",
    ".mi-foglio .mi-cerca::placeholder,.mi-foglio .mi-campo::placeholder{color:#8E8E93}",
    ".mi-foglio [hidden],[data-mi-saluto][hidden]{display:none!important}",
    ".mi-foglio .mi-risultati:not(:empty){margin-top:8px}",
    ".mi-foglio .mi-msg{font-size:14px;color:#3C3C43;margin:10px 4px 0;line-height:1.4}",
    ".mi-foglio .mi-msg:empty{display:none}",
    ".mi-foglio .mi-bottone{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:48px;margin-top:10px;padding:10px 14px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #D6D6DB;color:#0A64D8;font-size:16px;font-weight:600;text-align:center}",
    ".mi-foglio .mi-bottone svg{width:20px;height:20px}",
    ".mi-foglio .mi-bottone:active,.mi-foglio .mi-riga:active,.mi-foglio .mi-stile:active{background:#ECECF0}",
    /* interruttore */
    ".mi-foglio .mi-int{width:51px;height:31px;border-radius:16px;background:#D6D6DB;position:relative;flex:none;margin-right:8px;transition:background .2s}",
    ".mi-foglio .mi-int::after{content:\"\";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(0,0,0,.2);transition:transform .2s}",
    ".mi-foglio [aria-checked=true] .mi-int{background:#34A853}",
    ".mi-foglio [aria-checked=true] .mi-int::after{transform:translateX(20px)}",
    "html.mi-no-anim .mi-int,html.mi-no-anim .mi-int::after{transition:none!important}",
    /* informazioni */
    ".mi-foglio .mi-info{background:#fff;border-radius:12px;padding:14px 16px;font-size:14px;color:#3C3C43;line-height:1.5}",
    ".mi-foglio .mi-info p+p{margin-top:8px}",
    ".mi-foglio .mi-info strong{font-weight:600;color:#1C1C1E}",
    "@media (max-width:370px){.mi-stili{gap:8px}.mi-foglio .mi-mini{height:100px}.mi-foglio .mi-stile .mi-n{font-size:13px}}",
    /* benvenuto (primo utilizzo): un foglio chiaro a tutto schermo, uguale sopra ogni stile */
    ".mi-benv{position:fixed;top:0;right:0;bottom:0;left:0;z-index:3000;background:#EEF4FA}",
    ".mi-benv>.mi-foglio{position:absolute;top:0;right:0;bottom:0;left:0;max-width:none;height:auto;margin:0;border-radius:0;box-shadow:none;transform:none;transition:none;display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:linear-gradient(180deg,#D9ECFF 0%,#EEF5FC 38%,#F6F7FA 100%)}",
    ".mi-foglio .mi-b-corpo{display:flex;flex-direction:column;max-width:440px;min-height:100%;margin:0 auto;padding:calc(env(safe-area-inset-top, 0px) + 22px) 22px calc(env(safe-area-inset-bottom, 0px) + 22px)}",
    ".mi-foglio .mi-b-punti{display:flex;justify-content:center;gap:8px;margin-bottom:26px}",
    ".mi-foglio .mi-b-punti i{display:block;width:8px;height:8px;border-radius:4px;background:#C3CEDA}",
    ".mi-foglio .mi-b-punti i.mi-su{width:24px;background:#0A64D8}",
    ".mi-foglio .mi-b-passo{display:flex;flex-direction:column;flex:1}",
    ".mi-foglio .mi-b-logo{display:block;width:84px;height:84px;margin:6px auto 22px;border-radius:20px;box-shadow:0 8px 24px rgba(10,60,120,.2)}",
    ".mi-foglio .mi-b-icona{display:grid;place-items:center;width:84px;height:84px;margin:6px auto 22px;border-radius:50%;background:#fff;color:#0A64D8;box-shadow:0 8px 24px rgba(10,60,120,.14)}",
    ".mi-foglio .mi-b-icona svg{width:40px;height:40px}",
    ".mi-foglio .mi-b-tit:focus{outline:none}",
    ".mi-foglio .mi-b-tit{font-size:28px;font-weight:700;line-height:1.15;letter-spacing:-.01em;text-align:center;color:#0F1720}",
    ".mi-foglio .mi-b-testo{font-size:18px;line-height:1.45;color:#3C4650;text-align:center;margin-top:10px}",
    ".mi-foglio .mi-b-et{display:block;font-size:21px;font-weight:600;color:#1C1C1E;margin:34px 2px 12px}",
    ".mi-benv .mi-campo{height:58px;padding:0 18px;border-radius:14px;font-size:21px;box-shadow:inset 0 0 0 1.5px #C4CEDA}",
    ".mi-benv .mi-campo:focus{box-shadow:inset 0 0 0 2.5px #0A64D8}",
    ".mi-benv .mi-nota{font-size:14px;margin-top:10px}",
    ".mi-benv .mi-bottone{min-height:58px;margin-top:24px;border-radius:14px;font-size:18px;box-shadow:inset 0 0 0 1.5px #C4CEDA}",
    ".mi-benv .mi-bottone svg{width:22px;height:22px}",
    ".mi-benv .mi-cerca{height:54px;margin-top:0;border-radius:14px;font-size:18px;box-shadow:inset 0 0 0 1.5px #C4CEDA}",
    ".mi-benv .mi-cerca:focus{box-shadow:inset 0 0 0 2.5px #0A64D8}",
    ".mi-benv .mi-riga{min-height:58px}",
    ".mi-foglio .mi-b-o{display:flex;align-items:center;gap:12px;margin:18px 4px 14px;font-size:15px;color:#6C6C72}",
    ".mi-foglio .mi-b-o::before,.mi-foglio .mi-b-o::after{content:\"\";flex:1;height:1px;background:#D3D9E0}",
    ".mi-foglio .mi-b-scelto{display:flex;align-items:center;gap:12px;margin-top:26px;padding:14px 14px 14px 16px;border-radius:14px;background:#fff;box-shadow:inset 0 0 0 2px #0A64D8}",
    ".mi-foglio .mi-b-scelto>svg{width:26px;height:26px;color:#0A64D8}",
    ".mi-foglio .mi-b-scelto .mi-testo .mi-n{font-size:20px;font-weight:600;white-space:normal}",
    ".mi-foglio .mi-b-scelto .mi-testo .mi-s{font-size:14px;white-space:normal}",
    ".mi-foglio .mi-b-scelto .mi-ok{position:static;display:grid;width:28px;height:28px;box-shadow:none}",
    ".mi-foglio .mi-b-azioni{display:flex;flex-direction:column;gap:6px;margin-top:auto;padding-top:28px}",
    ".mi-foglio .mi-b-primo{display:block;width:100%;min-height:58px;padding:12px 16px;border-radius:14px;background:#0A64D8;color:#fff;font-size:19px;font-weight:600;text-align:center;box-shadow:0 4px 14px rgba(10,100,216,.28)}",
    ".mi-foglio .mi-b-primo:active{background:#0853B4}",
    ".mi-foglio .mi-b-link{display:block;width:100%;min-height:50px;padding:8px 16px;border-radius:12px;color:#0A64D8;font-size:17px;font-weight:500;text-align:center}",
    ".mi-foglio .mi-b-link:active{background:rgba(10,100,216,.08)}",
    "@media (max-height:640px){.mi-foglio .mi-b-logo,.mi-foglio .mi-b-icona{width:64px;height:64px;margin-bottom:14px}.mi-foglio .mi-b-et{margin-top:22px}}"
  ].join("\n");
  (function inietta() {
    if (document.getElementById("mi-stile")) return;
    var st = document.createElement("style");
    st.id = "mi-stile"; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  })();

  /* ---------- pannello ---------- */
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var opz = { monta: null, onLuogo: null };
  var velo = null, ingr = null, RS = null; /* RS: la ricerca per nome del pannello */
  var q = function (sel) { return velo.querySelector(sel); };

  function mini(id) {
    var dentro = {
      classico: '<i class="mi-a"></i><b>21°</b><i class="mi-c"></i><i class="mi-d"></i><i class="mi-e"></i><i class="mi-f"></i>',
      cielo: '<i class="mi-a"></i><i class="mi-c"></i><b>21°</b><i class="mi-d"></i><i class="mi-e"></i>',
      chiaro: '<i class="mi-a"></i><i class="mi-b2"></i><i class="mi-c"></i><i class="mi-d"></i><i class="mi-e"></i><b>21°</b><i class="mi-f"></i>',
      semplice: '<i class="mi-a"></i><i class="mi-c"></i><i class="mi-d"></i><b>21°</b><i class="mi-e"></i>',
      scena: '<i class="mi-a"></i><i class="mi-c"></i><i class="mi-d"></i><i class="mi-e"></i><b>21°</b><i class="mi-f"></i>'
    }[id];
    return '<span class="mi-mini mi-m-' + id + '" aria-hidden="true">' + dentro + '</span>';
  }

  function costruisci() {
    velo = document.createElement("div");
    velo.className = "mi-velo";
    velo.innerHTML =
      '<div class="mi-foglio" role="dialog" aria-modal="true" aria-labelledby="mi-titolo">' +
        '<div class="mi-testa"><h2 class="mi-titolo" id="mi-titolo">Impostazioni</h2>' +
        '<button type="button" class="mi-chiudi" aria-label="Chiudi">×</button></div>' +
        '<div class="mi-corpo">' +
          '<h3 class="mi-sez"><label for="mi-nome">Il tuo nome</label></h3>' +
          '<input class="mi-campo mi-nome" id="mi-nome" type="text" maxlength="30" placeholder="Come ti chiami?" autocomplete="given-name" autocapitalize="words" enterkeyhint="done" spellcheck="false">' +
          '<p class="mi-nota">Serve solo per il saluto. Resta su questo telefono, non viene mandato a nessuno.</p>' +

          '<h3 class="mi-sez">Stile della schermata principale</h3>' +
          '<div class="mi-stili">' + STILI.map(function (s) {
            return '<button type="button" class="mi-stile" data-stile="' + s.id + '" aria-pressed="false">' + mini(s.id) +
              '<span class="mi-ok">' + SPUNTA + '</span><span class="mi-n">' + esc(s.nome) + '</span><span class="mi-s">' + esc(s.sotto) + '</span></button>';
          }).join("") + '</div>' +
          '<p class="mi-nota">Vale solo su questo telefono e cambia il look di tutte le schede, mappa compresa.</p>' +

          '<h3 class="mi-sez">Località</h3>' +
          '<div class="mi-gruppo mi-salvate"></div>' +
          '<input class="mi-cerca" type="search" placeholder="Cerca un paese o una città" autocomplete="off" autocapitalize="words" enterkeyhint="search" aria-label="Cerca una località">' +
          '<div class="mi-gruppo mi-risultati"></div>' +
          '<button type="button" class="mi-bottone mi-gps"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/></svg>Posizione automatica (GPS)</button>' +
          '<button type="button" class="mi-bottone mi-condividi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12"/></svg>Condividi questa località</button>' +
          '<div class="mi-msg" role="status" aria-live="polite"></div>' +
          '<p class="mi-nota">Niente account: le località restano su questo telefono. Il link apre il meteo già sulla località.</p>' +

          '<h3 class="mi-sez">Mappa radar</h3>' +
          '<div class="mi-gruppo" role="radiogroup" aria-label="Mappa di base">' + BASI.map(function (b) {
            return '<button type="button" class="mi-riga mi-base" role="radio" aria-checked="false" data-base="' + b.id + '">' +
              '<span class="mi-testo"><span class="mi-n">' + esc(b.nome) + '</span><span class="mi-s">' + esc(b.sotto) + '</span></span>' +
              '<span class="mi-spunta">' + SPUNTA + '</span></button>';
          }).join("") + '</div>' +

          '<h3 class="mi-sez">Animazioni</h3>' +
          '<div class="mi-gruppo"><button type="button" class="mi-riga mi-anim" role="switch" aria-checked="true">' +
            '<span class="mi-testo"><span class="mi-n">Sfondi e scene animate</span><span class="mi-s">Nuvole, pioggia e neve che si muovono</span></span>' +
            '<span class="mi-int" aria-hidden="true"></span></button></div>' +
          '<p class="mi-nota">Spente, la pagina resta ferma: utile con la batteria bassa o se il movimento dà fastidio.</p>' +

          '<h3 class="mi-sez">Informazioni</h3>' +
          '<div class="mi-info">' +
            '<p>Dati: Open-Meteo (CC BY 4.0) · Aria: Copernicus CAMS · Radar: Protezione Civile (CC BY-SA 4.0) · Satellite: © EUMETSAT · Mappe: EOX, NASA Black Marble, OpenTopoMap (CC BY-SA), © OpenStreetMap · Località: GeoNames, BigDataCloud</p>' +
            '<p>Uso personale, non commerciale.</p>' +
            '<p><strong>MeteoAle ' + VERSIONE + '</strong>' + (BUILD !== "sviluppo" ? ' · build ' + BUILD : ' · copia di prova') + '</p>' +
            '<p>Ultimo aggiornamento: ' + (AGGIORNATO ? dataBella(AGGIORNATO) : 'non ancora pubblicato') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(velo);

    velo.addEventListener("click", function (e) {
      if (e.target === velo) { chiudi(); return; }
      var b = e.target.closest("button");
      if (!b || !velo.contains(b)) return;
      if (b.classList.contains("mi-chiudi")) chiudi();
      else if (b.dataset.stile) scegliStile(b.dataset.stile);
      else if (b.dataset.base) { imposta({ base: b.dataset.base }); aggiornaScelte(); }
      else if (b.classList.contains("mi-anim")) { imposta({ animazioni: !get().animazioni }); aggiornaScelte(); }
      else if (b.dataset.tolgo != null) togli(+b.dataset.tolgo);
      else if (b.dataset.i != null) scegliSalvata(+b.dataset.i);
      else if (b.dataset.r != null) scegliTrovata(+b.dataset.r);
      else if (b.classList.contains("mi-gps")) posizione();
      else if (b.classList.contains("mi-condividi")) condividi();
    });
    RS = ricerca(q(".mi-cerca"), q(".mi-risultati"), "data-r");
    var campo = q(".mi-nome");
    var salvaCampo = function () { impostaNome(campo.value); if (campo.value !== nome()) campo.value = nome(); };
    campo.addEventListener("change", salvaCampo);
    campo.addEventListener("blur", salvaCampo);
    campo.addEventListener("keydown", function (e) { if (e.key === "Enter") campo.blur(); });
    global.addEventListener("meteo-nome", function () { if (document.activeElement !== campo) campo.value = nome(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && velo.classList.contains("mi-su")) chiudi(); });
  }

  function aggiornaScelte() {
    var s = get();
    velo.querySelectorAll(".mi-stile").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.stile === s.stile)); });
    velo.querySelectorAll(".mi-base").forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.base === s.base)); });
    q(".mi-anim").setAttribute("aria-checked", String(s.animazioni));
  }
  function elencoSalvate() {
    var st = statoLuoghi();
    q(".mi-salvate").innerHTML = st.luoghi.length ? st.luoghi.map(function (l, i) {
      l = l || {};
      return '<div class="mi-riga' + (i === st.attivo ? " mi-attivo" : "") + '">' +
        '<button type="button" class="mi-testo" data-i="' + i + '"' + (i === st.attivo ? ' aria-current="true"' : "") + '>' +
        '<span class="mi-n">' + esc(l.nome || "Località") + '</span>' + (l.sotto ? '<span class="mi-s">' + esc(l.sotto) + '</span>' : "") + '</button>' +
        '<span class="mi-spunta">' + SPUNTA + '</span>' +
        '<button type="button" class="mi-togli" data-tolgo="' + i + '" aria-label="Togli ' + esc(l.nome || "località") + '">×</button></div>';
    }).join("") : '<div class="mi-vuoto">Nessuna località salvata: cercala qui sotto.</div>';
    q(".mi-condividi").style.display = st.luoghi[st.attivo] ? "" : "none";
  }
  function messaggio(t) { q(".mi-msg").textContent = t || ""; }

  function apri() {
    if (!velo) return;
    aggiornaScelte(); elencoSalvate(); messaggio("");
    q(".mi-nome").value = nome();
    q(".mi-cerca").value = ""; q(".mi-risultati").innerHTML = "";
    q(".mi-corpo").scrollTop = 0;
    document.documentElement.classList.add("mi-aperto");
    velo.classList.add("mi-su");
    setTimeout(function () { fuoco(q(".mi-chiudi")); }, 30);
  }
  function chiudi() {
    if (!velo || !velo.classList.contains("mi-su")) return;
    velo.classList.remove("mi-su");
    document.documentElement.classList.remove("mi-aperto");
    if (RS) RS.ferma();
    try { q(".mi-nome").blur(); q(".mi-cerca").blur(); } catch (e) {}
    fuoco(ingr);
  }

  /* ---------- azioni ---------- */
  function scegliStile(id) {
    var s = STILI.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    imposta({ stile: id });
    aggiornaScelte();
    var dest = new URL(s.pagina, BASE);
    var qui = location.pathname, la = dest.pathname;
    var stessa = qui === la || (/\/index\.html$/.test(la) && qui === la.replace(/index\.html$/, ""));
    if (stessa && location.origin === dest.origin) { chiudi(); return; }
    location.replace(dest.href); /* niente ?query e niente #scheda */
  }
  function ricarica() {
    if (location.search) location.replace(location.pathname + location.hash);
    else location.reload();
  }
  /* salva, poi avvisa la pagina con onLuogo; senza onLuogo ricarica la pagina */
  function fatto(st, primaChiave, chiudere) {
    salvaLuoghi(st);
    var l = st.luoghi[st.attivo] || null;
    if (typeof opz.onLuogo === "function") {
      if (chiudere) chiudi(); else elencoSalvate();
      try { opz.onLuogo(l); } catch (e) { console.error(e); }
      return;
    }
    ricarica(); /* senza onLuogo la pagina si ridisegna ricaricandosi, sempre */
  }
  function chiaveAttiva(st) { return chiaveL(st.luoghi[st.attivo]); }
  function scegliSalvata(i) {
    var st = statoLuoghi(); if (!st.luoghi[i]) return;
    var prima = chiaveAttiva(st);
    st.attivo = i;
    fatto(st, prima, true);
  }
  function togli(i) {
    var st = statoLuoghi(); if (!st.luoghi[i]) return;
    var prima = chiaveAttiva(st);
    st.luoghi.splice(i, 1);
    if (i < st.attivo) st.attivo--;
    if (st.attivo >= st.luoghi.length) st.attivo = Math.max(0, st.luoghi.length - 1);
    fatto(st, prima, false);
  }
  function scegliTrovata(k) {
    var l = RS && RS.luogo(k); if (!l) return;
    var st = statoLuoghi(), prima = chiaveAttiva(st);
    aggiungi(st, l);
    fatto(st, prima, true);
  }
  function scarica(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  /* ricerca per nome (geocoding Open-Meteo) su un campo e un riquadro dei risultati; usata dal pannello e dal benvenuto.
     Ogni risultato è un bottone con l'attributo attr="indice"; luogo(indice) lo restituisce pronto da salvare. */
  function ricerca(input, box, attr) {
    var r = { trovati: [], attesa: null, n: 0 };
    var sotto = function (x) { return [x.admin2, x.admin1, x.country].filter(Boolean).join(" · "); };
    r.ferma = function () { clearTimeout(r.attesa); r.n++; };
    r.luogo = function (k) {
      var x = r.trovati[k];
      return x ? { nome: x.name, sotto: sotto(x), lat: x.latitude, lon: x.longitude } : null;
    };
    r.cerca = function () {
      clearTimeout(r.attesa);
      var testo = input.value.trim();
      if (testo.length < 2) { r.n++; box.innerHTML = ""; return; }
      r.attesa = setTimeout(function () {
        var n = ++r.n;
        scarica("https://geocoding-api.open-meteo.com/v1/search?count=8&language=it&name=" + encodeURIComponent(testo)).then(function (res) {
          if (n !== r.n) return;
          r.trovati = (res && res.results) || [];
          box.innerHTML = r.trovati.length ? r.trovati.map(function (x, i) {
            return '<button type="button" class="mi-riga" ' + attr + '="' + i + '"><span class="mi-testo"><span class="mi-n">' + esc(x.name) + '</span>' +
              '<span class="mi-s">' + esc(sotto(x)) + '</span></span></button>';
          }).join("") : '<div class="mi-vuoto">Nessun risultato.</div>';
        }).catch(function () {
          if (n !== r.n) return;
          box.innerHTML = '<div class="mi-vuoto">Ricerca non disponibile, controlla la connessione.</div>';
        });
      }, 300);
    };
    input.addEventListener("input", r.cerca);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") e.target.blur(); });
    return r;
  }
  /* Posizione automatica: stessa logica dell'app. Il nome arriva da BigDataCloud (riceve solo le coordinate).
     Il GPS funziona solo su https: dalla rete di casa (http) il telefono lo blocca. */
  function nomeDa(lat, lon) {
    return scarica("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=it")
      .then(function (r) { return r.city || r.locality || "La mia posizione"; })
      .catch(function () { return "La mia posizione"; });
  }
  /* chiede la posizione e la passa a ok() già pronta da salvare (una sola località automatica, auto:true);
     msg(testo) mostra a che punto è o perché non va */
  function gpsLuogo(msg, ok) {
    var ko = "Posizione non disponibile: permesso negato, oppure la pagina non è su https (dalla Wi-Fi di casa il telefono blocca il GPS). Cerca il paese per nome.";
    if (!navigator.geolocation) { msg("Questo telefono non dà la posizione al browser."); return; }
    msg("Cerco la posizione…");
    navigator.geolocation.getCurrentPosition(function (p) {
      var lat = +p.coords.latitude.toFixed(3), lon = +p.coords.longitude.toFixed(3);
      nomeDa(lat, lon).then(function (n) {
        msg("");
        ok({ nome: n, sotto: "Posizione automatica (GPS)", lat: lat, lon: lon, auto: true });
      });
    }, function () { msg(ko); }, { timeout: 10000, maximumAge: 5 * 60000 });
  }
  function posizione() {
    gpsLuogo(messaggio, function (l) {
      var st = statoLuoghi(), prima = chiaveAttiva(st);
      aggiungi(st, l);
      fatto(st, prima, true);
    });
  }
  function condividi() {
    var st = statoLuoghi(), l = st.luoghi[st.attivo]; if (!l) return;
    var url = new URL("index.html", BASE).href + "?nome=" + encodeURIComponent(l.nome || "Località") + "&lat=" + l.lat + "&lon=" + l.lon;
    var copia = function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(url).then(function () { messaggio("Link copiato: incollalo in un messaggio."); });
      }
      return Promise.reject(new Error("niente appunti"));
    };
    var p = navigator.share ? navigator.share({ title: "Meteo " + (l.nome || ""), url: url }).catch(function (e) {
      if (e && e.name === "AbortError") return;
      return copia();
    }) : copia();
    p.catch(function () { messaggio(url); });
  }

  /* ---------- benvenuto: la prima volta (nome, località, dove sono le impostazioni) ---------- */
  var PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.4"/></svg>';
  var benv = null;
  /* la pagina di questo indirizzo, tra quelle degli stili (null se è un'altra) */
  function stileQui() {
    var qui = location.pathname;
    for (var i = 0; i < STILI.length; i++) {
      var la = new URL(STILI[i].pagina, BASE).pathname;
      if (qui === la || (/\/index\.html$/.test(la) && qui === la.replace(/index\.html$/, ""))) return STILI[i].id;
    }
    return null;
  }
  function vuoleBenvenuto() {
    var p = new URLSearchParams(location.search);
    /* index.html sta per passare alla pagina dello stile scelto (script in <head>): il benvenuto comparirà là */
    if (stileQui() === "classico" && get().stile !== "classico" && !/^#(radar|mappa|aria|uv|vento|sole)$/.test(location.hash)) return false;
    if (p.get("benvenuto") === "1") return true;             /* per provarlo: lo mostra sempre */
    if (p.get("anteprima") === "1") return false;            /* anteprime sul computer */
    var dentro = false;
    try { dentro = global.self !== global.top; } catch (e) { dentro = true; }
    if (dentro) return false;                                /* pagina dentro un iframe */
    try { return !localStorage.getItem(CHIAVE_BENV); } catch (e) { return false; }
  }
  function benvenuto() {
    if (benv) return;
    var prima = chiaveAttiva(statoLuoghi()); /* per sapere alla fine se la località è cambiata */
    benv = document.createElement("div");
    benv.className = "mi-benv";
    benv.innerHTML =
      '<div class="mi-foglio" role="dialog" aria-modal="true" aria-labelledby="mi-b-t1">' +
      '<div class="mi-b-corpo">' +
        '<div class="mi-b-punti" aria-hidden="true"><i class="mi-su"></i><i></i><i></i></div>' +

        '<section class="mi-b-passo" data-passo="1">' +
          '<img class="mi-b-logo" src="' + esc(new URL("icona-192.png", BASE).href) + '" alt="" width="84" height="84">' +
          '<h2 class="mi-b-tit" id="mi-b-t1" tabindex="-1">Benvenuto in MeteoAle</h2>' +
          '<p class="mi-b-testo">Il meteo di famiglia, semplice e senza account.</p>' +
          '<label class="mi-b-et" for="mi-b-nome">Come ti chiami?</label>' +
          '<input class="mi-campo" id="mi-b-nome" type="text" maxlength="30" placeholder="Il tuo nome" autocomplete="given-name" autocapitalize="words" enterkeyhint="next" spellcheck="false">' +
          '<p class="mi-nota">Serve solo per salutarti. Resta su questo telefono.</p>' +
          '<div class="mi-b-azioni">' +
            '<button type="button" class="mi-b-primo" data-b="avanti">Avanti</button>' +
            '<button type="button" class="mi-b-link" data-b="salta">Salta</button>' +
          '</div>' +
        '</section>' +

        '<section class="mi-b-passo" data-passo="2" hidden>' +
          '<span class="mi-b-icona" aria-hidden="true">' + PIN + '</span>' +
          '<h2 class="mi-b-tit" id="mi-b-t2" tabindex="-1">Dove vuoi vedere il meteo?</h2>' +
          '<div class="mi-b-scelto" hidden>' + PIN +
            '<span class="mi-testo"><span class="mi-n"></span><span class="mi-s"></span></span>' +
            '<span class="mi-ok">' + SPUNTA + '</span></div>' +
          '<div class="mi-b-scegli">' +
            '<button type="button" class="mi-bottone" data-b="gps">' + PIN + 'Usa la mia posizione (GPS)</button>' +
            '<div class="mi-b-o">oppure</div>' +
            '<input class="mi-cerca" type="search" placeholder="Cerca un paese o una città" autocomplete="off" autocapitalize="words" enterkeyhint="search" aria-label="Cerca una località">' +
            '<div class="mi-gruppo mi-risultati"></div>' +
            '<div class="mi-msg" role="status" aria-live="polite"></div>' +
          '</div>' +
          '<div class="mi-b-azioni">' +
            '<button type="button" class="mi-b-primo" data-b="bene" hidden>Va bene così</button>' +
            '<button type="button" class="mi-b-link" data-b="cambia" hidden>Scegli un\'altra località</button>' +
            '<button type="button" class="mi-b-link" data-b="dopo">Più tardi</button>' +
          '</div>' +
        '</section>' +

        '<section class="mi-b-passo" data-passo="3" hidden>' +
          '<span class="mi-b-icona" aria-hidden="true">' + INGRANAGGIO + '</span>' +
          '<h2 class="mi-b-tit" id="mi-b-t3" tabindex="-1">Tutto pronto!</h2>' +
          '<p class="mi-b-testo">Puoi cambiare stile, località e nome quando vuoi dall\'ingranaggio ⚙ in alto a destra.</p>' +
          '<div class="mi-b-azioni">' +
            '<button type="button" class="mi-b-primo" data-b="inizia">Inizia</button>' +
          '</div>' +
        '</section>' +
      '</div></div>';
    document.body.appendChild(benv);
    document.documentElement.classList.add("mi-aperto");

    var b = function (sel) { return benv.querySelector(sel); };
    var campo = b("#mi-b-nome"), p2 = b('[data-passo="2"]');
    var RB = ricerca(p2.querySelector(".mi-cerca"), p2.querySelector(".mi-risultati"), "data-br");
    var msg = function (t) { p2.querySelector(".mi-msg").textContent = t || ""; };
    campo.value = nome();

    function passo(n) {
      benv.querySelectorAll(".mi-b-passo").forEach(function (s) { s.hidden = s.getAttribute("data-passo") !== String(n); });
      benv.querySelectorAll(".mi-b-punti i").forEach(function (x, i) { x.classList.toggle("mi-su", i === n - 1); });
      benv.firstChild.setAttribute("aria-labelledby", "mi-b-t" + n);
      benv.firstChild.scrollTop = 0;
      if (n === 2) mostraLuogo(false);
      if (n === 3) { var nn = nome(); b("#mi-b-t3").textContent = nn ? "Tutto pronto, " + nn + "!" : "Tutto pronto!"; }
      setTimeout(function () {
        try { (n === 1 ? campo : b("#mi-b-t" + n)).focus({ preventScroll: true }); } catch (e) {}
      }, 40);
    }
    /* passo 2: la località già scelta (anche da un link) con "Va bene così", oppure GPS e ricerca */
    function mostraLuogo(cambio) {
      var st = statoLuoghi(), l = st.luoghi[st.attivo], c = !!l && !cambio;
      var sc = b(".mi-b-scelto");
      sc.hidden = !c;
      if (l) { sc.querySelector(".mi-n").textContent = l.nome || "Località"; sc.querySelector(".mi-s").textContent = l.sotto || ""; }
      b(".mi-b-scegli").hidden = c;
      b('[data-b="bene"]').hidden = !c;
      b('[data-b="cambia"]').hidden = !c;
      b('[data-b="dopo"]').hidden = c;
      if (!c) { RB.ferma(); p2.querySelector(".mi-cerca").value = ""; p2.querySelector(".mi-risultati").innerHTML = ""; msg(""); }
    }
    /* salva la località scelta (senza ricaricare: la pagina si aggiorna alla fine) */
    function scelta(l) {
      if (!l || !benv) return; /* risposta del GPS arrivata a benvenuto già chiuso */
      var st = statoLuoghi();
      aggiungi(st, l);
      salvaLuoghi(st);
      RB.ferma();
      mostraLuogo(false);
      try { b('[data-b="bene"]').focus({ preventScroll: true }); } catch (e) {}
    }
    function fine() {
      try { localStorage.setItem(CHIAVE_BENV, "1"); } catch (e) {}
      RB.ferma();
      benv.remove(); benv = null;
      if (!velo || !velo.classList.contains("mi-su")) document.documentElement.classList.remove("mi-aperto");
      var st = statoLuoghi();
      if (chiaveAttiva(st) === prima) return;               /* stessa località: la pagina è già giusta */
      if (typeof opz.onLuogo === "function") { try { opz.onLuogo(st.luoghi[st.attivo] || null); } catch (e) { console.error(e); } }
      else ricarica();
    }

    benv.addEventListener("click", function (e) {
      var t = e.target.closest("button");
      if (!t || !benv.contains(t)) return;
      var a = t.getAttribute("data-b");
      if (a === "avanti") { impostaNome(campo.value); passo(2); }
      else if (a === "salta") fine();
      else if (a === "gps") gpsLuogo(msg, scelta);
      else if (a === "bene" || a === "dopo") passo(3);
      else if (a === "cambia") { mostraLuogo(true); try { p2.querySelector(".mi-cerca").focus({ preventScroll: true }); } catch (e2) {} }
      else if (a === "inizia") fine();
      else if (t.hasAttribute("data-br")) scelta(RB.luogo(+t.getAttribute("data-br")));
    });
    campo.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); impostaNome(campo.value); passo(2); } });
    passo(1);
  }

  /* ---------- avvio ---------- */
  function init(o) {
    o = o || {};
    opz.monta = o.monta || null;
    opz.onLuogo = typeof o.onLuogo === "function" ? o.onLuogo : null;
    var parti = function () {
      if (!velo) costruisci();
      if (!ingr) {
        ingr = document.createElement("button");
        ingr.type = "button";
        ingr.setAttribute("aria-label", "Impostazioni");
        ingr.setAttribute("title", "Impostazioni");
        ingr.innerHTML = INGRANAGGIO;
        ingr.addEventListener("click", apri);
      }
      ingr.className = "mi-ingranaggio " + (opz.monta ? "mi-montato" : "mi-fluttuante");
      (opz.monta || document.body).appendChild(ingr);
      if (vuoleBenvenuto()) benvenuto();
    };
    if (document.body) parti(); else document.addEventListener("DOMContentLoaded", parti);
    return api;
  }
  function pagina(stile) {
    var s = STILI.filter(function (x) { return x.id === stile; })[0] || STILI[0];
    return new URL(s.pagina, BASE).href;
  }

  var api = { init: init, get: get, apri: apri, chiudi: chiudi, pagina: pagina,
    nome: nome, impostaNome: impostaNome, saluto: saluto, saluta: saluta, benvenuto: benvenuto };
  global.MeteoImpostazioni = api;
})(window);
