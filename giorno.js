/* MeteoAle · Pop-up di un giorno (ora per ora oppure mattina, pomeriggio, sera)
   Uso:  <script src="giorno.js"></script>            (index.html)
         <script src="../giorno.js"></script>         (proposte/*.html)
         MeteoGiorno.apri({ lat, lon, nome, data: "AAAA-MM-GG" })   data = giorno locale della località
         MeteoGiorno.chiudi()
   - Scarica da solo quello che serve da Open-Meteo (previsioni 10 giorni, timezone=auto, senza chiave).
     Copia in memoria e in localStorage per 10 minuti per località ("meteo.giorno.v1.<lat>,<lon>").
   - Oggi: ora per ora dall'ora attuale. Domani: ora per ora. Dal terzo giorno: Mattina, Pomeriggio, Sera, Notte.
     Poi neve (probabilità dal modello a insieme ICON, solo se la neve è plausibile) e temporali.
   - Si chiude con ×, tocco fuori, Esc e il "indietro" del telefono (apre una voce nella cronologia).
   - CSS iniettato, classi "mg-"; colori dal tema (temi.css, variabili --t-*), con colori di riserva.
   Extra (facoltativi, usati da index.html):
     MeteoGiorno.metti(lat, lon, m)  passa una risposta /v1/forecast già scaricata (stessa forma), evita una chiamata
     MeteoGiorno.probNeve(lat, lon)  → Promise { "AAAA-MM-GG": { p: %, n: scenari } } oppure null
   Niente dipendenze. */
(function (global) {
  "use strict";
  if (global.MeteoGiorno) return;

  var URL_METEO = "https://api.open-meteo.com/v1/forecast";
  var URL_INSIEME = "https://ensemble-api.open-meteo.com/v1/ensemble";
  var FRESCO = 10 * 60 * 1000, FRESCO_NEVE = 30 * 60 * 1000;
  var CACHE = "meteo.giorno.v1.", CACHE_NEVE = "meteo.giorno.neve.v1.";
  var ORARIE = ["temperature_2m", "precipitation_probability", "precipitation", "weather_code", "is_day", "wind_speed_10m",
    "wind_gusts_10m", "wind_direction_10m", "snowfall", "snowfall_height", "freezing_level_height", "lightning_potential"];
  var GIORNALIERE = ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_probability_max", "precipitation_sum",
    "snowfall_sum", "cape_max", "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant", "sunrise", "sunset", "uv_index_max"];

  /* ---------- testi ---------- */
  var CODICI = {
    0: "Cielo sereno", 1: "Prevalentemente sereno", 2: "Parzialmente nuvoloso", 3: "Cielo coperto",
    45: "Nebbia", 48: "Nebbia con brina",
    51: "Pioviggine leggera", 53: "Pioviggine", 55: "Pioviggine intensa", 56: "Pioviggine gelata", 57: "Pioviggine gelata",
    61: "Pioggia debole", 63: "Pioggia moderata", 65: "Pioggia forte", 66: "Pioggia gelata", 67: "Pioggia gelata forte",
    71: "Neve debole", 73: "Neve moderata", 75: "Neve forte", 77: "Granelli di neve",
    80: "Rovesci deboli", 81: "Rovesci di pioggia", 82: "Rovesci violenti", 85: "Rovesci di neve", 86: "Forti rovesci di neve",
    95: "Temporale", 96: "Temporale con grandine", 99: "Temporale con grandine forte"
  };
  var GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  var MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  var VENTI = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  var LIV_TEMPORALI = ["basso", "moderato", "alto", "molto alto"];
  var PERIODI = [["Mattina", 6, 12], ["Pomeriggio", 12, 18], ["Sera", 18, 24], ["Notte", 0, 6]];

  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var maiusc = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
  var r0 = function (x) { return Math.round(x); };
  var r1 = function (x) { return (Math.round(x * 10) / 10).toLocaleString("it-IT"); };
  var hh = function (iso) { return parseInt(iso.substr(11, 2), 10); };
  var neve = function (c) { return (c >= 71 && c <= 77) || c === 85 || c === 86; };
  var ventoDa = function (g) { return VENTI[Math.round(((g % 360) + 360) % 360 / 45) % 8]; };
  var opPioggia = function (p) { return (0.4 + 0.6 * Math.min(100, Math.max(0, p || 0)) / 100).toFixed(2); };
  var tondo50 = function (x) { return (Math.round(x / 50) * 50).toLocaleString("it-IT"); };
  var chiave = function (lat, lon) { return (+lat).toFixed(2) + "," + (+lon).toFixed(2); };
  function leggi(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function scrivi(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function scarica(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }

  /* ora e giorno della LOCALITÀ (dal fuso dato da Open-Meteo), non del telefono */
  function adessoLocale(m) {
    var off = m && m.utc_offset_seconds != null ? m.utc_offset_seconds : -new Date().getTimezoneOffset() * 60;
    return new Date(Date.now() + off * 1000).toISOString().substr(0, 13) + ":00";
  }

  /* ---------- dati ---------- */
  var mem = {}, inCorso = {}, memNeve = {}, neveInCorso = {};
  function valido(m) {
    if (!m || !m.hourly || !m.daily || !m.hourly.time || !m.daily.time) return false;
    for (var i = 0; i < ORARIE.length; i++) if (!m.hourly[ORARIE[i]]) return false;
    for (var j = 0; j < GIORNALIERE.length; j++) if (!m.daily[GIORNALIERE[j]]) return false;
    return true;
  }
  function urlMeteo(lat, lon) {
    return URL_METEO + "?latitude=" + lat + "&longitude=" + lon + "&timezone=auto&forecast_days=10" +
      "&hourly=" + ORARIE.join(",") + "&daily=" + GIORNALIERE.join(",");
  }
  function dati(lat, lon) {
    var k = chiave(lat, lon), x = mem[k];
    if (x && Date.now() - x.t < FRESCO) return Promise.resolve(x);
    if (!x) { var c = leggi(CACHE + k); if (c && valido(c.m)) { mem[k] = x = c; if (Date.now() - c.t < FRESCO) return Promise.resolve(c); } }
    if (inCorso[k]) return inCorso[k];
    var vecchio = x;
    inCorso[k] = scarica(urlMeteo(lat, lon)).then(function (m) {
      if (!valido(m)) throw new Error("dati incompleti");
      var v = { t: Date.now(), m: m };
      mem[k] = v; scrivi(CACHE + k, v);
      return v;
    }).catch(function (e) {
      if (vecchio) return { t: vecchio.t, m: vecchio.m, offline: true };
      throw e;
    }).then(function (v) { delete inCorso[k]; return v; }, function (e) { delete inCorso[k]; throw e; });
    return inCorso[k];
  }
  function metti(lat, lon, m, t) {
    if (!valido(m)) return false;
    var k = chiave(lat, lon), x = mem[k], tt = t || Date.now();
    if (!x || x.t <= tt) mem[k] = { t: tt, m: m };
    return true;
  }

  /* probabilità di neve: modello a insieme ICON (40 scenari), quota di scenari con almeno 0,5 cm in quel giorno */
  function probNeve(lat, lon) {
    var k = chiave(lat, lon), x = memNeve[k];
    if (x && Date.now() - x.t < FRESCO_NEVE) return Promise.resolve(x.prob);
    if (!x) { var c = leggi(CACHE_NEVE + k); if (c && Date.now() - c.t < FRESCO_NEVE) { memNeve[k] = c; return Promise.resolve(c.prob); } }
    if (neveInCorso[k]) return neveInCorso[k];
    neveInCorso[k] = scarica(URL_INSIEME + "?latitude=" + lat + "&longitude=" + lon + "&hourly=snowfall&models=icon_seamless&forecast_days=7&timezone=auto")
      .then(function (r) { return calcolaProbNeve(r); }, function () { return null; })
      .then(function (prob) {
        var v = { t: Date.now(), prob: prob }; /* anche l'errore resta 30 minuti: niente tentativi a raffica */
        memNeve[k] = v; if (prob) scrivi(CACHE_NEVE + k, v);
        delete neveInCorso[k];
        return prob;
      });
    return neveInCorso[k];
  }
  function calcolaProbNeve(r) {
    var h = r && r.hourly; if (!h || !h.time) return null;
    var serie = Object.keys(h).filter(function (x) { return /^snowfall(_member\d+)?$/.test(x); }).map(function (x) { return h[x]; })
      .filter(function (a) { return Array.isArray(a) && a.some(function (v) { return v != null; }); });
    if (!serie.length) return null;
    var perGiorno = {};
    h.time.forEach(function (t, i) { var g = t.substr(0, 10); (perGiorno[g] = perGiorno[g] || []).push(i); });
    var out = {};
    Object.keys(perGiorno).forEach(function (g) {
      var idx = perGiorno[g], si = 0, n = 0;
      serie.forEach(function (a) {
        var v = idx.map(function (i) { return a[i]; }).filter(function (x) { return x != null; });
        if (v.length < idx.length / 2) return;
        n++; if (v.reduce(function (x, y) { return x + y; }, 0) >= 0.5) si++;
      });
      if (n >= 10) out[g] = { p: Math.round(si / n * 100), n: n };
    });
    return out;
  }

  /* ---------- icone (stesse forme dell'app, colori dal tema) ---------- */
  function icona(code, giorno) {
    var sole = '<g class="mg-i-sole"><circle cx="32" cy="32" r="10"/><path d="M32 10v6M32 48v6M10 32h6M48 32h6M16.4 16.4l4.3 4.3M43.3 43.3l4.3 4.3M16.4 47.6l4.3-4.3M43.3 20.7l4.3-4.3"/></g>';
    var luna = '<path class="mg-i-sole" d="M38 12a20 20 0 1 0 14 30a16 16 0 1 1 -14 -30z"/>';
    var soleP = '<g transform="translate(-8 -8) scale(.75)">' + sole + '</g>';
    var lunaP = '<g transform="translate(-6 -6) scale(.7)">' + luna + '</g>';
    var nuvola = function (y) { return '<path class="mg-i-nube" transform="translate(0 ' + y + ')" d="M20 44h26a9 9 0 0 0 0-18a13 13 0 0 0-25-2a10 10 0 0 0-1 20z"/>'; };
    var gocce = function (n) { return '<path class="mg-i-goccia" d="' + (n === 2 ? "M27 50l-3 6M39 50l-3 6" : "M24 50l-3 7M33 50l-3 7M42 50l-3 7") + '"/>'; };
    var fiocchi = '<g class="mg-i-fiocco"><circle cx="24" cy="53" r="2"/><circle cx="33" cy="57" r="2"/><circle cx="42" cy="53" r="2"/></g>';
    var x;
    if (code === 0) x = giorno ? sole : luna;
    else if (code === 1 || code === 2) x = (giorno ? soleP : lunaP) + nuvola(4);
    else if (code === 3) x = nuvola(0);
    else if (code === 45 || code === 48) x = nuvola(-6) + '<path class="mg-i-linea" d="M14 48h36M18 54h28"/>';
    else if (code >= 51 && code <= 57) x = nuvola(-6) + gocce(2);
    else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) x = nuvola(-6) + gocce(3);
    else if (neve(code)) x = nuvola(-6) + fiocchi;
    else if (code >= 95) x = nuvola(-6) + '<path class="mg-i-fulmine" d="M34 44l-6 9h7l-5 9"/>';
    else x = nuvola(0);
    return '<svg viewBox="0 0 64 64" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + x + '</svg>';
  }
  var frecciaVento = function (g) { return '<svg class="mg-fv" viewBox="0 0 24 24" style="transform:rotate(' + (g + 180) + 'deg)" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V4M6 10l6-6 6 6"/></svg>'; };
  var SVG_NEVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5"/></svg>';
  var SVG_TUONO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13.5 1.5L4.5 13.5h6.5L9.5 22.5l10-13h-6.5z"/></svg>';
  var SX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  var DX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

  /* ---------- stile ---------- */
  var CSS = [
    ".mg-velo{--mg-bg:var(--t-card-solido,#fff);--mg-testo:var(--t-testo,#15191F);--mg-testo-2:var(--t-testo-2,#5A6570);--mg-linea:var(--t-linea,#E3E7EB);",
    "--mg-accento:var(--t-accento,#0A6B73);--mg-incavo:var(--t-incavo,#F1F3F5);--mg-pioggia:var(--t-pioggia,#1E6FD0);--mg-neve:var(--t-neve,#2E78B5);--mg-fulmine:var(--t-fulmine,#A68600);",
    "position:fixed;top:0;right:0;bottom:0;left:0;z-index:1500;background:rgba(0,0,0,.45);visibility:hidden;opacity:0;transition:opacity .22s ease,visibility 0s linear .22s;-webkit-tap-highlight-color:transparent}",
    ".mg-velo.mg-su{visibility:visible;opacity:1;transition:opacity .22s ease}",
    "html.mg-aperto,html.mg-aperto body{overflow:hidden!important}",
    ".mg-foglio{position:absolute;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;height:calc(100% - env(safe-area-inset-top,0px) - 28px);display:flex;flex-direction:column;",
    "background:var(--mg-bg);color:var(--mg-testo);border-radius:18px 18px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.28);transform:translateY(100%);transition:transform .28s cubic-bezier(.2,.8,.2,1);",
    "font-family:var(--t-font,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif);font-size:15px;line-height:1.35;text-align:left;letter-spacing:normal;text-transform:none;-webkit-font-smoothing:antialiased;overflow:hidden}",
    "html[data-stile=cielo] .mg-foglio{background:linear-gradient(180deg,var(--cielo-a,#1A62C4),var(--cielo-b,#3B8EE0))}",
    "@media (max-height:700px){.mg-foglio{height:100%;border-radius:0}}",
    ".mg-velo.mg-su .mg-foglio{transform:none}",
    "html.mi-no-anim .mg-velo,html.mi-no-anim .mg-foglio{transition:none!important}",
    ".mg-foglio *{box-sizing:border-box;margin:0;padding:0}",
    ".mg-foglio button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;-webkit-appearance:none;appearance:none;text-align:inherit}",
    ".mg-foglio button:focus-visible{outline:2px solid var(--mg-accento);outline-offset:2px;border-radius:10px}",
    ".mg-foglio svg{display:block;flex:none}",
    ".mg-testa{flex:none;display:grid;grid-template-columns:44px 1fr 44px 44px;align-items:center;gap:2px;padding:max(8px,env(safe-area-inset-top,0px)) 6px 8px;border-bottom:1px solid var(--mg-linea)}",
    ".mg-foglio:focus{outline:none}",
    "@media (min-height:701px){.mg-testa{padding-top:8px}}",
    ".mg-tit{min-width:0;text-align:center}",
    ".mg-tit b{display:block;font-size:18px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".mg-tit span{display:block;font-size:12.5px;color:var(--mg-testo-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}",
    ".mg-btn{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:var(--mg-testo)}",
    ".mg-btn svg{width:24px;height:24px}",
    ".mg-btn[disabled]{opacity:.25;cursor:default}",
    ".mg-x{font-size:30px;line-height:1;color:var(--mg-testo-2)}",
    ".mg-corpo{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 24px)}",
    ".mg-sintesi{display:flex;align-items:center;gap:12px}",
    ".mg-sintesi .mg-ic{width:64px;height:64px}",
    ".mg-cond{font-size:19px;font-weight:600;line-height:1.2}",
    ".mg-mm{font-size:15px;margin-top:4px}",
    ".mg-mm .mg-max{font-weight:700}",
    ".mg-mm .mg-min{color:var(--mg-testo-2)}",
    ".mg-piove{font-size:14px;margin-top:3px;color:var(--mg-pioggia);font-weight:600}",
    ".mg-asciutto{color:var(--mg-testo-2);font-weight:400}",
    ".mg-fatti{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}",
    ".mg-fatti div{background:var(--mg-incavo);border:1px solid var(--mg-linea);border-radius:12px;padding:8px 9px;min-width:0}",
    ".mg-fatti span{display:block;font-size:11px;color:var(--mg-testo-2);text-transform:uppercase;letter-spacing:.05em}",
    ".mg-fatti b{display:flex;align-items:center;gap:4px;font-size:15px;font-weight:600;margin-top:2px;white-space:nowrap}",
    ".mg-sez{font-size:12px;font-weight:600;color:var(--mg-testo-2);text-transform:uppercase;letter-spacing:.08em;margin:20px 0 6px}",
    ".mg-ore{border-top:1px solid var(--mg-linea)}",
    ".mg-ora{display:grid;grid-template-columns:40px 34px 46px 1fr 98px;align-items:center;gap:6px;min-height:46px;padding:4px 0;border-bottom:1px solid var(--mg-linea)}",
    ".mg-ora.mg-intesta{min-height:28px;font-size:11px;color:var(--mg-testo-2);text-transform:uppercase;letter-spacing:.05em}",
    ".mg-ora .mg-h{font-size:15px;font-variant-numeric:tabular-nums}",
    ".mg-ora.mg-notte .mg-h{color:var(--mg-testo-2)}",
    ".mg-ora .mg-ic{width:32px;height:32px}",
    ".mg-ora .mg-t{font-size:17px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums}",
    ".mg-ora .mg-p{font-size:14px;color:var(--mg-pioggia);font-variant-numeric:tabular-nums;padding-left:8px}",
    ".mg-ora .mg-p small{font-size:12px}",
    ".mg-ora .mg-v{display:flex;align-items:center;gap:4px;font-size:14px;justify-content:flex-end;font-variant-numeric:tabular-nums}",
    ".mg-ora .mg-v small{color:var(--mg-testo-2);font-size:12px}",
    ".mg-fv{width:14px;height:14px}",
    ".mg-ora.mg-adesso{background:var(--mg-incavo);border-radius:10px;border-bottom-color:transparent;margin:0 -8px;padding:4px 8px}",
    ".mg-periodi{display:flex;flex-direction:column;gap:8px}",
    ".mg-per{display:grid;grid-template-columns:92px 44px 1fr;align-items:center;gap:10px;padding:10px 12px;background:var(--mg-incavo);border:1px solid var(--mg-linea);border-radius:14px}",
    ".mg-per .mg-ic{width:44px;height:44px}",
    ".mg-per .mg-nome{font-size:16px;font-weight:700}",
    ".mg-per .mg-ore-p{font-size:12px;color:var(--mg-testo-2);margin-top:1px}",
    ".mg-per .mg-c{font-size:14px;line-height:1.25}",
    ".mg-per .mg-r{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:14px;margin-top:4px;align-items:center}",
    ".mg-per .mg-r .mg-tt{font-weight:700;font-variant-numeric:tabular-nums}",
    ".mg-per .mg-r .mg-pp{color:var(--mg-pioggia);font-weight:600}",
    ".mg-per .mg-r .mg-vv{display:inline-flex;align-items:center;gap:3px;color:var(--mg-testo-2)}",
    ".mg-per.mg-pnotte{opacity:.85}",
    ".mg-rischio{margin-top:18px;padding-top:12px;border-top:1px solid var(--mg-linea)}",
    ".mg-rischio .mg-sez{display:flex;align-items:center;gap:7px;margin:0 0 8px}",
    ".mg-rischio .mg-sez svg{width:14px;height:14px}",
    ".mg-griglia{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
    ".mg-griglia .mg-n{font-size:11px;color:var(--mg-testo-2);text-transform:uppercase;letter-spacing:.05em}",
    ".mg-griglia .mg-val{font-size:17px;font-weight:600;margin-top:2px}",
    ".mg-griglia .mg-s{font-size:12px;color:var(--mg-testo-2);margin-top:1px}",
    ".mg-nota{font-size:12px;color:var(--mg-testo-2);line-height:1.45;margin-top:10px}",
    ".mg-vuoto{text-align:center;color:var(--mg-testo-2);padding:48px 16px;line-height:1.5}",
    ".mg-piede{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:20px}",
    ".mg-piede button{min-height:48px;padding:8px 12px;border:1px solid var(--mg-linea);border-radius:12px;display:flex;align-items:center;gap:6px;font-weight:600;color:var(--mg-accento)}",
    ".mg-piede button svg{width:18px;height:18px}",
    ".mg-piede .mg-succ{justify-content:flex-end;text-align:right}",
    ".mg-piede button[disabled]{visibility:hidden}",
    /* icone: colori dal tema */
    ".mg-i-sole{stroke:var(--t-ic-sole,#F0A400)}",
    ".mg-i-nube{stroke:var(--t-ic-nube,#6B7785);fill:var(--t-ic-nube-fondo,#fff)}",
    ".mg-i-linea{stroke:var(--t-ic-nube,#6B7785)}",
    ".mg-i-goccia{stroke:var(--t-ic-goccia,#1E6FD0)}",
    ".mg-i-fiocco{fill:var(--t-ic-nube,#6B7785);stroke:none}",
    ".mg-i-fulmine{stroke:var(--t-fulmine,#A68600)}",
    /* Semplice: testi più grandi */
    "html[data-stile=semplice] .mg-foglio{font-size:17px}",
    "html[data-stile=semplice] .mg-tit b{font-size:21px;font-weight:800}",
    "html[data-stile=semplice] .mg-tit span,html[data-stile=semplice] .mg-nota,html[data-stile=semplice] .mg-griglia .mg-s{font-size:15px}",
    "html[data-stile=semplice] .mg-cond{font-size:22px;font-weight:800}",
    "html[data-stile=semplice] .mg-ora{grid-template-columns:44px 34px 50px 1fr 104px}",
    "html[data-stile=semplice] .mg-ora .mg-h{font-size:17px;font-weight:700}",
    "html[data-stile=semplice] .mg-ora .mg-t{font-size:20px;font-weight:800}",
    "html[data-stile=semplice] .mg-ora .mg-p,html[data-stile=semplice] .mg-ora .mg-v{font-size:15px;font-weight:700}",
    "html[data-stile=semplice] .mg-per .mg-nome{font-size:19px;font-weight:800}",
    "html[data-stile=semplice] .mg-per .mg-c,html[data-stile=semplice] .mg-per .mg-r{font-size:16px}",
    "html[data-stile=semplice] .mg-sez,html[data-stile=semplice] .mg-fatti span,html[data-stile=semplice] .mg-griglia .mg-n,html[data-stile=semplice] .mg-ora.mg-intesta{font-size:14px;text-transform:none;letter-spacing:0;font-weight:700}",
    "@media (max-width:370px){.mg-ora{grid-template-columns:36px 30px 42px 1fr 92px;gap:4px}.mg-ora .mg-ic{width:28px;height:28px}.mg-per{grid-template-columns:82px 40px 1fr;gap:8px;padding:10px}.mg-per .mg-ic{width:40px;height:40px}.mg-fatti b{font-size:14px}}"
  ].join("\n");

  /* ---------- stato e struttura ---------- */
  var FOCUS_FERMO = (function () {
    var ok = false;
    try { document.createElement("div").focus({ get preventScroll() { ok = true; return true; } }); } catch (e) {}
    return ok;
  })();
  var velo = null, foglio, corpo, titolo, sottotitolo, bPrec, bSucc;
  var st = null;              /* { lat, lon, nome, data, v: {t, m, offline} } */
  var aperto = false, spinto = false, richiesta = 0;

  function costruisci() {
    if (velo) return;
    var s = document.createElement("style"); s.id = "mg-css"; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    velo = document.createElement("div");
    velo.className = "mg-velo";
    velo.innerHTML = '<div class="mg-foglio" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="mg-titolo">' +
      '<div class="mg-testa"><button type="button" class="mg-btn mg-prec" aria-label="Giorno prima">' + SX + '</button>' +
      '<div class="mg-tit"><b id="mg-titolo"></b><span></span></div>' +
      '<button type="button" class="mg-btn mg-succ" aria-label="Giorno dopo">' + DX + '</button>' +
      '<button type="button" class="mg-btn mg-x" aria-label="Chiudi">×</button></div>' +
      '<div class="mg-corpo"></div></div>';
    document.body.appendChild(velo);
    foglio = velo.querySelector(".mg-foglio"); corpo = velo.querySelector(".mg-corpo");
    titolo = velo.querySelector(".mg-tit b"); sottotitolo = velo.querySelector(".mg-tit span");
    bPrec = velo.querySelector(".mg-testa .mg-prec"); bSucc = velo.querySelector(".mg-testa .mg-succ");
    velo.addEventListener("click", function (e) {
      if (e.target === velo) { chiudi(); return; }
      var b = e.target.closest("button"); if (!b) return;
      if (b.classList.contains("mg-x")) chiudi();
      else if (b.classList.contains("mg-prec")) sposta(-1);
      else if (b.classList.contains("mg-succ")) sposta(1);
    });
    document.addEventListener("keydown", function (e) {
      if (!aperto) return;
      if (e.key === "Escape") { e.stopPropagation(); chiudi(); }
      else if (e.key === "ArrowLeft") sposta(-1);
      else if (e.key === "ArrowRight") sposta(1);
    }, true);
    /* "indietro" del telefono: la voce aggiunta all'apertura viene tolta, il foglio si chiude */
    global.addEventListener("popstate", function () {
      if (aperto && !(history.state && history.state.mgGiorno)) { spinto = false; chiudiSubito(); }
    });
  }

  function apri(o) {
    o = o || {};
    var lat = +o.lat, lon = +o.lon;
    if (!isFinite(lat) || !isFinite(lon) || !/^\d{4}-\d{2}-\d{2}$/.test(String(o.data || ""))) return;
    var parti = function () {
      costruisci();
      st = { lat: lat, lon: lon, nome: o.nome || "", data: String(o.data), v: null };
      if (!aperto) {
        aperto = true;
        /* dentro un riquadro (pannello iPad) niente voce nella cronologia: lì non c'è un tasto "indietro" */
        spinto = false;
        if (global.parent === global) { try { history.pushState({ mgGiorno: 1 }, "", location.href); spinto = true; } catch (e) {} }
        document.documentElement.classList.add("mg-aperto");
        void velo.offsetWidth; /* per far partire la transizione */
        velo.classList.add("mg-su");
        /* dove { preventScroll } non è capito (Safari vecchi) il focus farebbe scorrere la pagina: meglio non spostarlo */
        if (FOCUS_FERMO) setTimeout(function () { try { foglio.focus({ preventScroll: true }); } catch (e) {} }, 30);
      }
      var tt = titoloData(st.data, null, st.nome);
      titolo.textContent = tt[0]; sottotitolo.textContent = tt[1];
      bPrec.disabled = bSucc.disabled = true;
      corpo.innerHTML = '<div class="mg-vuoto">Carico la previsione…</div>';
      var n = ++richiesta;
      dati(lat, lon).then(function (v) {
        if (n !== richiesta || !aperto) return;
        st.v = v; disegna(true);
      }, function () {
        if (n !== richiesta || !aperto) return;
        corpo.innerHTML = '<div class="mg-vuoto">Previsione non disponibile in questo momento.<br>Controlla la connessione e riprova.</div>';
      });
    };
    if (document.body) parti(); else document.addEventListener("DOMContentLoaded", parti);
  }
  function chiudiSubito() {
    aperto = false; richiesta++;
    if (!velo) return;
    velo.classList.remove("mg-su");
    document.documentElement.classList.remove("mg-aperto");
  }
  function chiudi() {
    if (!aperto) return;
    if (spinto && history.state && history.state.mgGiorno) { spinto = false; chiudiSubito(); history.back(); }
    else chiudiSubito();
  }
  function sposta(dir) {
    if (!st || !st.v) return;
    var d = st.v.m.daily, i = d.time.indexOf(st.data) + dir, i0 = Math.max(0, d.time.indexOf(adessoLocale(st.v.m).substr(0, 10)));
    if (i < i0 || i >= d.time.length) return;
    st.data = d.time[i];
    disegna(true);
  }

  /* ---------- testi delle date ---------- */
  /* [titolo, sottotitolo]: "Domani" + "mercoledì 25 novembre · Trento", oppure "Venerdì 27 novembre" + "Trento" */
  function titoloData(data, rel, nome) {
    var dt = new Date(data + "T12:00:00"), lunga = GIORNI[dt.getDay()] + " " + dt.getDate() + " " + MESI[dt.getMonth()];
    var dove = nome ? " · " + nome : "";
    if (rel === 0) return ["Oggi", lunga + dove];
    if (rel === 1) return ["Domani", lunga + dove];
    return [maiusc(lunga), nome || ""];
  }
  function nomeBreve(data, rel) {
    if (rel === 0) return "Oggi";
    if (rel === 1) return "Domani";
    var dt = new Date(data + "T12:00:00");
    return maiusc(GIORNI[dt.getDay()]) + " " + dt.getDate();
  }

  /* ---------- neve e temporali di un giorno (stessa logica di index.html) ---------- */
  function infoGiorno(m, gi, ens) {
    var d = m.daily, h = m.hourly, data = d.time[gi], idx = [];
    h.time.forEach(function (t, i) { if (t.substr(0, 10) === data) idx.push(i); });
    var val = function (arr, i) { return arr && arr[i] != null ? arr[i] : null; };
    var cm = d.snowfall_sum[gi] != null ? d.snowfall_sum[gi] : null;
    var quota = null, zero = null;
    idx.forEach(function (i) {
      var q = val(h.snowfall_height, i), z = val(h.freezing_level_height, i);
      if ((h.precipitation[i] || 0) >= 0.1 && q != null) quota = quota == null ? q : Math.min(quota, q);
      if (z != null) zero = zero == null ? z : Math.min(zero, z);
    });
    var vicina = quota != null && m.elevation != null && quota <= m.elevation + 800;
    var neveBlocco = (cm != null && cm >= 0.1) || (ens && ens.p >= 10);
    var t1 = -1, t2 = -1, grandine = false, lpi = null;
    idx.forEach(function (i) {
      var c = h.weather_code[i];
      if (c >= 95) { if (t1 < 0) t1 = i; t2 = i; if (c >= 96) grandine = true; }
      var v = val(h.lightning_potential, i); if (v != null) lpi = Math.max(lpi || 0, v);
    });
    var temporale = t1 >= 0 || d.weather_code[gi] >= 95;
    if (d.weather_code[gi] >= 96) grandine = true;
    var cape = d.cape_max[gi] != null ? d.cape_max[gi] : null;
    var livCape = cape == null ? 0 : cape < 300 ? 0 : cape < 1000 ? 1 : cape < 2500 ? 2 : 3;
    return {
      cm: cm, ens: ens, quota: quota, zero: zero, neveBlocco: neveBlocco, soloQuota: !neveBlocco && vicina,
      temporale: temporale, grandine: grandine, t1: t1, t2: t2, lpi: lpi, cape: cape,
      liv: Math.max(livCape, temporale ? (grandine ? 2 : 1) : 0),
      tuonoBlocco: temporale || (cape != null && cape >= 300) || (lpi != null && lpi > 0),
      raffiche: d.wind_gusts_10m_max[gi]
    };
  }
  /* la neve è plausibile? solo allora si chiede il modello a insieme */
  function nevePlausibile(m, gi) {
    var d = m.daily, h = m.hourly, data = d.time[gi];
    if ((d.snowfall_sum[gi] || 0) > 0 || neve(d.weather_code[gi])) return true;
    var el = m.elevation != null ? m.elevation : 0, si = false;
    h.time.forEach(function (t, i) {
      if (si || t.substr(0, 10) !== data) return;
      var q = h.snowfall_height[i], z = h.freezing_level_height[i];
      if ((h.snowfall[i] || 0) > 0 || (q != null && q <= el + 400) || (z != null && z <= el + 300 && (h.precipitation_probability[i] || 0) >= 20)) si = true;
    });
    return si;
  }
  function cella(n, v, s) { return '<div><div class="mg-n">' + n + '</div><div class="mg-val">' + v + '</div>' + (s ? '<div class="mg-s">' + s + '</div>' : "") + '</div>'; }
  function bloccoNeve(f) {
    if (!f.neveBlocco) return "";
    var c = cella("Neve fresca", f.cm != null && f.cm >= 0.1 ? r1(f.cm) + " cm" : "0 cm", "totale del giorno");
    if (f.ens) c += cella("Probabilità", f.ens.p + "%", "almeno mezzo cm");
    if (f.quota != null) c += cella("Quota neve", "da " + tondo50(f.quota) + " m", f.zero != null ? "zero termico " + tondo50(f.zero) + " m" : "");
    else if (f.zero != null) c += cella("Zero termico", tondo50(f.zero) + " m", "");
    return '<div class="mg-rischio"><div class="mg-sez"><span style="color:var(--mg-neve)">' + SVG_NEVE + '</span>Neve</div><div class="mg-griglia">' + c + '</div>' +
      (f.ens ? '<div class="mg-nota">Probabilità: quante delle ' + f.ens.n + ' simulazioni del modello ICON danno almeno mezzo centimetro.</div>' : "") + '</div>';
  }
  function bloccoTemporali(f, h) {
    if (!f.tuonoBlocco) return "";
    var c = cella("Rischio indicativo", maiusc(LIV_TEMPORALI[f.liv]), f.cape != null ? "CAPE " + r0(f.cape) + " J/kg" : "");
    if (f.temporale) c += cella("Temporali", f.t1 >= 0 ? hh(h.time[f.t1]) + "–" + ((hh(h.time[f.t2]) + 1) % 24 || 24) : "Previsti", f.grandine ? "possibile grandine" : "ore circa");
    else c += cella("Temporali", "Non previsti", "dal modello");
    if (f.lpi != null && f.lpi > 0) c += cella("Fulmini", "Possibili", "potenziale fino a " + r1(f.lpi) + " J/kg");
    if (f.raffiche != null) c += cella("Raffiche", r0(f.raffiche) + " km/h", "massimo del giorno");
    return '<div class="mg-rischio"><div class="mg-sez"><span style="color:var(--mg-fulmine)">' + SVG_TUONO + '</span>Temporali e fulmini</div><div class="mg-griglia">' + c + '</div>' +
      '<div class="mg-nota">Il rischio è indicativo: dipende dall\'energia nell\'aria (CAPE) e dai temporali previsti dal modello.</div></div>';
  }
  function rigaRischi(f) {
    var t = "";
    if (f.soloQuota) t = "Neve solo in quota, da " + tondo50(f.quota) + " m" + (f.zero != null ? " (zero termico " + tondo50(f.zero) + " m)" : "") + "." + (f.tuonoBlocco ? "" : " Niente temporali previsti.");
    else if (!f.neveBlocco && !f.tuonoBlocco) t = "Niente neve né temporali previsti.";
    return t ? '<div class="mg-rischio mg-nota" style="margin-top:18px">' + t + '</div>' : "";
  }

  /* ---------- un periodo di 6 ore ---------- */
  function periodo(m, data, da, a) {
    var h = m.hourly, idx = [];
    h.time.forEach(function (t, i) { if (t.substr(0, 10) === data) { var o = hh(t); if (o >= da && o < a) idx.push(i); } });
    if (!idx.length) return null;
    var cod = idx.map(function (i) { return h.weather_code[i]; }).filter(function (c) { return c != null; });
    var bagnati = cod.filter(function (c) { return c >= 51; });
    var c;
    if (bagnati.length) c = Math.max.apply(null, bagnati);
    else { var cont = {}; cod.forEach(function (x) { cont[x] = (cont[x] || 0) + 1; }); c = +Object.keys(cont).sort(function (x, y) { return cont[y] - cont[x] || y - x; })[0]; }
    var num = function (k) { return idx.map(function (i) { return h[k][i]; }).filter(function (v) { return v != null; }); };
    var t = num("temperature_2m"), p = num("precipitation_probability"), mm = num("precipitation"), sn = num("snowfall"), v = num("wind_speed_10m"), g = num("wind_gusts_10m");
    var giorno = idx.filter(function (i) { return h.is_day[i] === 1; }).length * 2 >= idx.length;
    var sx = 0, sy = 0;
    idx.forEach(function (i) { var w = h.wind_speed_10m[i] || 0, dr = (h.wind_direction_10m[i] || 0) * Math.PI / 180; sx += w * Math.sin(dr); sy += w * Math.cos(dr); });
    var dir = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
    var somma = function (a) { return a.reduce(function (x, y) { return x + y; }, 0); };
    return {
      c: c, giorno: giorno, tMin: t.length ? Math.min.apply(null, t) : null, tMax: t.length ? Math.max.apply(null, t) : null,
      p: p.length ? Math.max.apply(null, p) : 0, mm: somma(mm), cm: somma(sn),
      v: v.length ? Math.max.apply(null, v) : 0, g: g.length ? Math.max.apply(null, g) : null, dir: dir
    };
  }

  /* ---------- disegno ---------- */
  function disegna(inCima) {
    var v = st.v, m = v.m, d = m.daily, h = m.hourly;
    var adesso = adessoLocale(m), oggi = adesso.substr(0, 10);
    var gi = d.time.indexOf(st.data), i0 = d.time.indexOf(oggi);
    if (i0 < 0) i0 = 0;
    var rel = gi - i0;
    var tt = titoloData(st.data, gi >= 0 ? rel : null, st.nome);
    titolo.textContent = tt[0];
    sottotitolo.textContent = tt[1] + (v.offline ? (tt[1] ? " · " : "") + "senza rete, dati delle " + new Date(v.t).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "");
    bPrec.disabled = !(gi > i0);
    bSucc.disabled = !(gi >= 0 && gi < d.time.length - 1);
    if (gi < 0 || gi < i0) {
      corpo.innerHTML = '<div class="mg-vuoto">Previsione non disponibile per questo giorno.</div>';
      return;
    }
    var ens = null, k = chiave(st.lat, st.lon), ne = memNeve[k];
    if (ne && ne.prob && ne.prob[st.data]) ens = ne.prob[st.data];
    var info = infoGiorno(m, gi, ens);

    /* sintesi */
    var pp = d.precipitation_probability_max[gi], mm = d.precipitation_sum[gi] || 0;
    var nevica = info.cm != null && info.cm >= 0.1 && neve(d.weather_code[gi]);
    var piove = mm >= 0.1 ? (nevica ? r1(info.cm) + " cm di neve" : r1(mm) + " mm di pioggia") + (pp != null ? " · " + pp + "%" : "")
      : '<span class="mg-asciutto">' + (pp != null && pp >= 20 ? "Pioggia poco probabile · " + pp + "%" : "Asciutto" + (pp != null ? " · pioggia " + pp + "%" : "")) + '</span>';
    var s = '<div class="mg-sintesi"><div class="mg-ic">' + icona(d.weather_code[gi], true) + '</div><div style="min-width:0">' +
      '<div class="mg-cond">' + esc(CODICI[d.weather_code[gi]] || "") + '</div>' +
      '<div class="mg-mm"><span class="mg-max">Max ' + r0(d.temperature_2m_max[gi]) + '°</span> <span class="mg-min">· min ' + r0(d.temperature_2m_min[gi]) + '°</span></div>' +
      '<div class="mg-piove">' + piove + '</div></div></div>';
    var ora_ = function (iso) { return iso ? iso.substr(11, 5) : "--"; };
    s += '<div class="mg-fatti">' +
      '<div><span>Sole</span><b>' + ora_(d.sunrise[gi]) + '–' + ora_(d.sunset[gi]) + '</b></div>' +
      '<div><span>Vento</span><b>' + frecciaVento(d.wind_direction_10m_dominant[gi] || 0) + r0(d.wind_speed_10m_max[gi] || 0) + ' <small style="font-weight:400">km/h</small></b></div>' +
      '<div><span>UV max</span><b>' + r0(d.uv_index_max[gi] || 0) + '</b></div></div>';

    if (rel <= 1) {
      /* ora per ora */
      var da = rel === 0 ? h.time.indexOf(adesso) : -1, righe = "";
      h.time.forEach(function (t, i) {
        if (t.substr(0, 10) !== st.data || (rel === 0 && da >= 0 && i < da)) return;
        var p = h.precipitation_probability[i] || 0, q = h.precipitation[i] || 0, sn = h.snowfall[i] || 0;
        var pTxt = (p >= 5 ? p + "%" : "") + (sn >= 0.1 ? ' <small>' + r1(sn) + ' cm</small>' : q >= 0.1 ? ' <small>' + r1(q) + ' mm</small>' : "");
        var g = h.wind_gusts_10m[i];
        righe += '<div class="mg-ora' + (h.is_day[i] ? "" : " mg-notte") + (i === da ? " mg-adesso" : "") + '">' +
          '<div class="mg-h">' + (i === da ? "Ora" : t.substr(11, 2)) + '</div>' +
          '<div class="mg-ic">' + icona(h.weather_code[i], h.is_day[i] === 1) + '</div>' +
          '<div class="mg-t">' + r0(h.temperature_2m[i]) + '°</div>' +
          '<div class="mg-p" style="opacity:' + opPioggia(p) + '">' + pTxt + '</div>' +
          '<div class="mg-v">' + frecciaVento(h.wind_direction_10m[i] || 0) + r0(h.wind_speed_10m[i] || 0) + (g != null && g >= (h.wind_speed_10m[i] || 0) + 8 ? ' <small>raff. ' + r0(g) + '</small>' : ' <small>km/h</small>') + '</div></div>';
      });
      s += '<div class="mg-sez">' + (rel === 0 ? "Da adesso, ora per ora" : "Ora per ora") + '</div>' +
        '<div class="mg-ore"><div class="mg-ora mg-intesta"><div>Ora</div><div></div><div style="text-align:right">Temp.</div><div style="padding-left:8px">Pioggia</div><div style="text-align:right">Vento</div></div>' + righe + '</div>';
    } else {
      /* mattina, pomeriggio, sera, notte */
      var per = "";
      PERIODI.forEach(function (x) {
        var f = periodo(m, st.data, x[1], x[2]); if (!f) return;
        var pTxt = f.p + "%" + (f.cm >= 0.1 ? " · " + r1(f.cm) + " cm" : f.mm >= 0.1 ? " · " + r1(f.mm) + " mm" : "");
        per += '<div class="mg-per' + (x[0] === "Notte" ? " mg-pnotte" : "") + '"><div><div class="mg-nome">' + x[0] + '</div><div class="mg-ore-p">' + x[1] + '–' + x[2] + '</div></div>' +
          '<div class="mg-ic">' + icona(f.c, f.giorno) + '</div>' +
          '<div style="min-width:0"><div class="mg-c">' + esc(CODICI[f.c] || "") + '</div><div class="mg-r">' +
          '<span class="mg-tt">' + (f.tMin == null ? "--" : r0(f.tMin) === r0(f.tMax) ? r0(f.tMax) + "°" : r0(f.tMin) + "° / " + r0(f.tMax) + "°") + '</span>' +
          '<span class="mg-pp" style="opacity:' + opPioggia(f.p) + '">' + pTxt + '</span>' +
          '<span class="mg-vv">' + frecciaVento(f.dir) + r0(f.v) + (f.g != null && f.g >= f.v + 8 ? " · raff. " + r0(f.g) : " km/h") + '</span></div></div></div>';
      });
      s += '<div class="mg-sez">Nel corso del giorno</div><div class="mg-periodi">' + per + '</div>' +
        '<div class="mg-nota">Temperature minima e massima del periodo, probabilità di pioggia più alta e millimetri totali, vento più forte.</div>';
    }

    s += bloccoNeve(info) + rigaRischi(info) + bloccoTemporali(info, h);

    /* giorno prima e dopo */
    var prec = gi > i0 ? d.time[gi - 1] : null, succ = gi < d.time.length - 1 ? d.time[gi + 1] : null;
    s += '<div class="mg-piede"><button type="button" class="mg-prec"' + (prec ? "" : " disabled") + '>' + SX + (prec ? nomeBreve(prec, rel - 1) : "") + '</button>' +
      '<button type="button" class="mg-succ"' + (succ ? "" : " disabled") + '>' + (succ ? nomeBreve(succ, rel + 1) : "") + DX + '</button></div>';
    s += '<div class="mg-nota" style="text-align:center;margin-top:16px">Dati: Open-Meteo.com (CC BY 4.0)</div>';
    corpo.innerHTML = s;
    if (inCima) corpo.scrollTop = 0;

    /* neve plausibile: chiedo il modello a insieme e ridisegno quando arriva */
    if (!ens && gi - i0 < 7 && nevePlausibile(m, gi) && !(ne && Date.now() - ne.t < FRESCO_NEVE)) {
      var data = st.data, n = richiesta;
      probNeve(st.lat, st.lon).then(function (prob) {
        if (aperto && n === richiesta && st && st.data === data && prob && prob[data]) disegna(false);
      });
    }
  }

  global.MeteoGiorno = { apri: apri, chiudi: chiudi, metti: metti, probNeve: probNeve };
})(window);
