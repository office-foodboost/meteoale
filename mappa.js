/* Mappa meteo animata (prototipo) - Meteo di famiglia, Beppiani Home.
   Uso:  MappaMeteo.init(elemento, { lat, lon, nome, zoom, strati, ora, pausa })
   - strati: { pioggia: true, nuvole: true, fulmini: true }
   - ora:    (solo per prove) fine della sequenza, es. "2026-11-12T12:00:00Z"
   - pausa:  true = non parte da sola
   - titolo: false = niente riquadro "Radar e satellite / luogo" in alto (dentro l'app il nome è già nell'intestazione)
   - futuro: ore di previsione dopo "Adesso" (predefinito 24, 0 = solo passato; con "ora" la previsione è spenta)
   - fotogramma: indice sulla barra (0 = un'ora fa, 6 = adesso, 7 e oltre = previsione ora per ora)
   Richiede Leaflet 1.9 (lib/leaflet.js) e mappa.css. Nessuna chiave, nessun server.
   La previsione usa la libreria Open-Meteo (GPL-2.0, caricata così com'è dal CDN) solo quando si usa
   la parte futura della barra: all'apertura non scarica niente in più.

   Fonti:
   - Radar pioggia: Protezione Civile, Radar-DPC, CC BY-SA 4.0 (WMS GeoWebCache, riquadri 256 px EPSG:3857)
   - Nuvole (infrarosso 10,5 µm) e fulmini (Lightning Imager): EUMETSAT EUMETView, © EUMETSAT
   - Previsione pioggia e nuvole: Open-Meteo (CC BY 4.0), modello ICON-2I ItaliaMeteo-ARPAE
     (riserva DWD ICON-EU), file .om dal bucket pubblico S3, libreria @openmeteo/weather-map-layer 0.3.2
   - Mappa di base: EOxCloudless 2023 (EOX, CC BY-NC-SA 4.0, uso personale non commerciale) +
     nomi e confini EOX overlay_bright (dati © OpenStreetMap contributors, rendering © EOX).
     (tile.openstreetmap.org scartato: blocca le pagine senza Referer valido.)                    */
(function (global) {
  "use strict";

  var DPC_API = "https://radar-api.protezionecivile.it/findLastProductByType?type=SRI";
  var DPC_WMS = "https://radar-geowebcache.protezionecivile.it/service/wms";
  var EU_WMS = "https://view.eumetsat.int/geoserver/ows";
  function euCaps(strato, versione) {
    return "https://view.eumetsat.int/geoserver/mtg_fd/" + strato + "/ows?service=WMS&request=GetCapabilities&version=" + versione;
  }
  // Mappe di base senza chiave (scelta con opz.base). Nomi e confini EOX sopra quelle senza etichette.
  var EOX = "https://tiles.maps.eox.at/wmts/1.0.0/";
  var OSM_CR = 'dati <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">©&nbsp;OpenStreetMap contributors</a>';
  var BASI = {
    satellite: { nome: "Satellite", url: EOX + "s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg", nomi: "overlay_bright_3857", filtro: "mm-f-satellite",
      cr: '<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless 2023 by EOX</a> (Copernicus Sentinel 2023)' },
    notte: { nome: "Satellite notte", url: EOX + "blackmarble_3857/default/g/{z}/{y}/{x}.jpg", nomi: "overlay_bright_3857", filtro: "",
      cr: 'Black Marble © NASA, rendering <a href="https://maps.eox.at" target="_blank" rel="noopener">©&nbsp;EOX</a>' },
    rilievo: { nome: "Rilievo", url: EOX + "terrain_3857/default/g/{z}/{y}/{x}.jpg", nomi: null, filtro: "mm-f-scura",
      cr: 'Terrain <a href="https://maps.eox.at" target="_blank" rel="noopener">©&nbsp;EOX</a>, ' + OSM_CR },
    chiara: { nome: "Rilievo chiaro", url: EOX + "terrain-light_3857/default/g/{z}/{y}/{x}.jpg", nomi: null, filtro: "",
      cr: 'Terrain Light <a href="https://maps.eox.at" target="_blank" rel="noopener">©&nbsp;EOX</a>, ' + OSM_CR },
    topo: { nome: "Topografica", url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", nomi: null, filtro: "",
      cr: '© <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC BY-SA), ' + OSM_CR + ', SRTM' }
  };

  var MIN = 60000;
  var PASSO = 10 * MIN;        // un fotogramma ogni 10 minuti
  var N_FRAME = 7;             // 7 fotogrammi = ultima ora
  var R = 20037508.342789244;  // mezzo giro del mondo in metri (Web Mercator)
  var COPERTURA_RADAR = [[35, 5], [48.5, 20.5]];

  // Nuvole: soglie sulla luminosità dell'infrarosso (più chiaro = più freddo = nuvola alta)
  var IR_SOGLIA = 105, IR_PIENO = 180, IR_ALFA_MAX = 0.75;

  // ---------- previsione (Open-Meteo) ----------
  var ORA = 60 * MIN;
  var FUTURO_ORE = 24;         // ore di previsione dopo "Adesso" (opz.futuro)
  var OM_LIB = "https://unpkg.com/@openmeteo/weather-map-layer@0.3.2/dist/index.mjs";
  var OM_S3 = "https://openmeteo.s3.amazonaws.com/data_spatial/";
  var MODELLI = [
    { id: "italia_meteo_arpae_icon_2i", nome: "ICON-2I ItaliaMeteo-ARPAE", breve: "ICON-2I" },
    { id: "dwd_icon_eu", nome: "DWD ICON-EU", breve: "ICON-EU" }
  ];
  var PREV_AVANTI = { pioggia: 3, nuvole: 1 };  // fotogrammi precaricati dopo quello in vista (le nuvole pesano ~0,4 MB l'uno)
  var PREV_MAX = { pioggia: 8, nuvole: 3 };     // livelli tenuti in memoria (ogni livello sono alcune tele da 512 px)
  // Scala della pioggia con i colori del radar della Protezione Civile (mm/h). La DPC non pubblica i
  // valori della sua legenda: le soglie sono indicative. Sotto la prima soglia: trasparente.
  var SCALA_PIOGGIA = { type: "breakpoint", unit: "mm/h",
    breakpoints: [0, 0.2, 0.6, 1.2, 3, 6, 12, 25],
    colors: [[102, 252, 252, 0], [102, 252, 252, 0.62], [102, 252, 252, 0.82], [76, 251, 76, 0.86],
      [251, 251, 76, 0.9], [251, 131, 51, 0.92], [251, 76, 76, 0.95], [213, 76, 255, 0.95]] };
  // Nuvole previste come quelle da satellite: bianco con trasparenza che cresce con la copertura
  var SCALA_NUVOLE = { type: "breakpoint", unit: "%",
    breakpoints: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    colors: [0, 0.02, 0.06, 0.11, 0.17, 0.23, 0.3, 0.37, 0.44, 0.52, 0.6].map(function (a) { return [238, 238, 242, a]; }) };

  // La libreria si carica una volta sola per pagina, al primo uso della previsione
  var omPronto = null;
  function caricaOM() {
    if (omPronto) return omPronto;
    omPronto = new Promise(function (ok, ko) {
      // import() dentro una funzione creata al volo: i browser vecchi non vanno in errore leggendo questo file
      try { new Function("u", "return import(u)")(OM_LIB).then(ok, ko); } catch (e) { ko(e); }
    }).then(function (OM) {
      var ad = OM.addLeafletProtocolSupport(L), base = OM.defaultOmProtocolSettings;
      var imp = {};
      for (var k in base) imp[k] = base[k];
      imp.colorScales = {};
      for (var c in base.colorScales) imp.colorScales[c] = base.colorScales[c];
      imp.colorScales.precipitation = SCALA_PIOGGIA;
      imp.colorScales.cloud_cover = SCALA_NUVOLE;
      imp.maxStatesWithData = PREV_MAX.pioggia + PREV_MAX.nuvole + 2;
      // Cache dei blocchi scaricati: quella predefinita (8 MB in memoria) non basta per un giro di 24 ore
      // con pioggia e nuvole (~10 MB) e al secondo giro riscaricava tutto. Su https/localhost uso la
      // Cache Storage del browser (su disco, al massimo 48 MB, i file di una corsa non cambiano);
      // altrimenti una cache in memoria da 24 MB.
      imp.fileReaderConfig = {};
      for (var f in base.fileReaderConfig) imp.fileReaderConfig[f] = base.fileReaderConfig[f];
      try {
        imp.fileReaderConfig.cache = typeof caches !== "undefined" && global.isSecureContext
          ? new OM.BrowserBlockCache({ cacheName: "mappa-meteo-previsione", maxBytes: 48 * 1024 * 1024 })
          : new OM.LruBlockCache(65536, 384);
      } catch (e) { console.warn("MappaMeteo: cache previsione predefinita", e); }
      ad.addProtocol("om", OM.omProtocol, imp);
      return { OM: OM, ad: ad };
    });
    omPronto.catch(function (e) { console.warn("MappaMeteo: libreria previsione non caricata", e); omPronto = null; });
    return omPronto;
  }
  // Ultima corsa di un modello: { id, nome, breve, run: "2026/11/24/1200Z/", valid: [...], tempi: {ms: indice} }
  function leggiModello(m) {
    return fetch(OM_S3 + m.id + "/latest.json", { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    }).then(function (j) {
      var ref = new Date(j.reference_time), p2 = function (n) { return (n < 10 ? "0" : "") + n; };
      if (isNaN(ref) || !j.valid_times || !j.valid_times.length) throw new Error("latest.json senza tempi");
      var tempi = {};
      j.valid_times.forEach(function (v, i) { tempi[Date.parse(v)] = i; });
      return { id: m.id, nome: m.nome, breve: m.breve, valid: j.valid_times, tempi: tempi, variabili: j.variables || [],
        run: ref.getUTCFullYear() + "/" + p2(ref.getUTCMonth() + 1) + "/" + p2(ref.getUTCDate()) + "/" + p2(ref.getUTCHours()) + p2(ref.getUTCMinutes()) + "Z/" };
    });
  }

  var fmtOra = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });
  var fmtGiorno = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" });
  var fmtData = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
  var fmtOraNum = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" });

  var ICONE = {
    pioggia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 7.5a3.75 3.75 0 0 1 .5 7.47"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/></svg>',
    nuvole: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.8 9a4.75 4.75 0 0 1-.3 9.5z"/></svg>',
    fulmini: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 2.5L5.5 13.5h6l-1 8 8-11h-6z"/></svg>',
    centra: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pausa: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>'
  };
  var NOMI = { pioggia: "Pioggia", nuvole: "Nuvole", fulmini: "Fulmini" };

  // ---------- utilità ----------
  function giu(t, passo) { return Math.floor(t / passo) * passo; }
  function iso(t) { return new Date(t).toISOString(); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function attesa(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function conTempoMax(p, ms) { return Promise.race([p, attesa(ms).then(function () { return "tempo"; })]); }

  function prendiTesto(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); });
  }
  // Scarica un'immagine (CORS aperto) e la decodifica; un secondo tentativo se qualcosa va storto
  function prendiImmagine(url, tentativi) {
    if (tentativi == null) tentativi = 2;
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      var tipo = r.headers.get("content-type") || "";
      if (tipo.indexOf("image/") !== 0) throw new Error("risposta non immagine: " + tipo);
      return r.blob();
    }).then(function (b) {
      return new Promise(function (ok, ko) {
        var u = URL.createObjectURL(b), im = new Image();
        im.onload = function () { URL.revokeObjectURL(u); ok(im); };
        im.onerror = function () { URL.revokeObjectURL(u); ko(new Error("immagine non valida (" + b.size + " byte)")); };
        im.src = u;
      });
    }).catch(function (e) {
      if (tentativi > 1) return attesa(800).then(function () { return prendiImmagine(url, tentativi - 1); });
      throw e;
    });
  }
  function canvasABlobUrl(cv) {
    return new Promise(function (ok, ko) {
      cv.toBlob(function (b) { b ? ok(URL.createObjectURL(b)) : ko(new Error("toBlob")); }, "image/png");
    });
  }

  // Ultimo istante disponibile di ogni fonte
  function ultimoRadar() {
    return prendiTesto(DPC_API).then(function (t) {
      var j = JSON.parse(t);
      // 5 minuti di margine: l'ultimo prodotto a volte non è ancora nel servizio mappe (riquadro vuoto)
      return j.lastProducts[0].time - 5 * MIN;
    }).catch(function (e) {
      console.warn("MappaMeteo: ora radar non letta, uso l'orologio", e);
      return giu(Date.now() - 15 * MIN, 5 * MIN);
    });
  }
  function ultimoEumetsat(strato, passo, ritardo) {
    // Capabilities del solo strato (~7 kB, CORS aperto). Il tempo è "inizio/fine/passo" in UTC.
    // A volte la versione 1.3.0 torna senza lo strato: in quel caso provo la 1.1.1 (<Extent>).
    function leggi(x) {
      var m = /<(?:Dimension|Extent) name="time"[^>]*>\s*(\d[^<]*)</.exec(x);
      var fine = m ? Date.parse(m[1].split("/")[1]) : NaN;
      if (isNaN(fine)) throw new Error("tempo non trovato");
      return fine;
    }
    return prendiTesto(euCaps(strato, "1.3.0")).then(leggi).catch(function () {
      return prendiTesto(euCaps(strato, "1.1.1")).then(leggi);
    }).catch(function (e) {
      console.warn("MappaMeteo: ora EUMETSAT non letta per " + strato + ", uso l'orologio", e);
      return giu(Date.now() - ritardo, passo);
    });
  }

  // Strato radar DPC: riquadri da 512 px sullo schermo, chiesti a 256 px un livello di zoom sopra
  // (allineati alla griglia GeoWebCache) -> 4 volte meno richieste, il radar è comunque a ~1 km.
  var StratoRadar = L.TileLayer.extend({
    getTileUrl: function (c) {
      var z = this._getZoomForUrl(), n = Math.pow(2, z), s = 2 * R / n;
      var minx = -R + c.x * s, maxy = R - c.y * s;
      var bbox = [minx, maxy - s, minx + s, maxy].join(",");
      return DPC_WMS + "?service=WMS&request=GetMap&version=1.1.1&layers=radar:sri&styles=&format=image/png&transparent=true" +
        "&srs=EPSG:3857&width=256&height=256&bbox=" + bbox + "&time=" + iso(this.options.tempo);
    }
  });

  // ---------- componente ----------
  function init(contenitore, opz) {
    opz = opz || {};
    if (typeof L === "undefined") { contenitore.textContent = "Mappa non disponibile (manca Leaflet)."; return null; }
    var LAT = +opz.lat, LON = +opz.lon;
    var BASE = BASI[opz.base] || BASI.satellite;
    var attivi = { pioggia: true, nuvole: true, fulmini: true };
    if (opz.strati) for (var k in attivi) if (k in opz.strati) attivi[k] = !!opz.strati[k];

    // --- interfaccia ---
    contenitore.innerHTML = "";
    // Filtro per il radar DPC: toglie il velo grigio dell'"area radar" (nero al 20%) e rende più
    // visibile la pioggia debole (che il servizio disegna quasi trasparente). Se il browser non
    // supporta i filtri SVG sui livelli HTML, il radar resta com'è.
    if (!document.getElementById("mm-filtro-radar")) {
      var defs = el("div", null, '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="mm-filtro-radar" color-interpolation-filters="sRGB">' +
        '<feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0.25 0.25 0.25 2.2 -0.44"/></filter></svg>');
      document.body.appendChild(defs.firstChild);
    }
    var radice = el("div", "mm-root");
    var divMappa = el("div", "mm-mappa");
    var testa = el("div", "mm-testa", '<div class="mm-testa-box"><div class="mm-etichetta">Radar e satellite</div><div class="mm-luogo"></div></div>');
    testa.querySelector(".mm-luogo").textContent = opz.nome || "";
    var colonna = el("div", "mm-strati");
    var bottoni = {};
    ["pioggia", "nuvole", "fulmini"].forEach(function (s) {
      var b = el("button", "mm-btn", ICONE[s] + "<span>" + NOMI[s] + "</span>");
      b.type = "button"; b.setAttribute("aria-pressed", attivi[s]); b.setAttribute("aria-label", NOMI[s]);
      b.addEventListener("click", function () { commuta(s); });
      bottoni[s] = b; colonna.appendChild(b);
    });
    var bCentra = el("button", "mm-btn mm-btn-centra", ICONE.centra + "<span>Centra</span>");
    bCentra.type = "button"; bCentra.setAttribute("aria-label", "Centra sul luogo");
    colonna.appendChild(bCentra);

    // Fotogrammi futuri: ogni ora piena dopo adesso, dall'orologio (i tempi del modello si leggono solo al primo uso)
    var oreFuturo = opz.futuro != null ? Math.max(0, Math.min(72, Math.round(+opz.futuro) || 0)) : FUTURO_ORE;
    if (opz.ora) oreFuturo = 0;   // prova su un momento passato: niente previsione
    var futuri = [];              // { t, strati: {pioggia,nuvole}: livello, pronto, carica, errore, manca }
    var primaOra = Math.ceil((Date.now() + 1) / ORA) * ORA;
    for (var h = 0; h < oreFuturo; h++) futuri.push({ t: primaOra + h * ORA, strati: {}, pronto: {}, carica: {}, errore: {}, manca: false });
    var ADESSO = N_FRAME - 1, TOT = N_FRAME + futuri.length;
    // posizione di un fotogramma sulla barra (il pomello è largo 22 px)
    function posBarra(k) { return "calc(11px + (100% - 22px) * " + (k / (TOT - 1)) + ")"; }

    var scala = futuri.length
      ? '<span class="mm-s-inizio">-' + ((N_FRAME - 1) * PASSO / 3600000) + ' h</span>' +
        '<span class="mm-s-adesso" style="left:' + posBarra(ADESSO) + '">Adesso</span>' +
        '<span class="mm-s-prev" style="left:' + posBarra((ADESSO + TOT - 1) / 2) + '">Previsione</span>' +
        '<span class="mm-s-fine">+' + oreFuturo + ' h</span>'
      : '<span class="mm-s-inizio">-' + ((N_FRAME - 1) * PASSO / 3600000) + ' h</span><span class="mm-s-fine">Ultima</span>';
    var barra = el("div", "mm-barra",
      '<div class="mm-riga">' +
        '<button type="button" class="mm-play" aria-label="Avvia" disabled></button>' +
        '<div class="mm-orario"><div class="mm-ora">--:--</div><div class="mm-giorno">Carico i dati...</div></div>' +
        '<div class="mm-stato"></div>' +
      '</div>' +
      (futuri.length ? '<div class="mm-salti">' +
        '<button type="button" class="mm-salto" data-salto="adesso">Adesso</button>' +
        '<button type="button" class="mm-salto" data-salto="3">+3 h</button>' +
        '<button type="button" class="mm-salto" data-salto="6">+6 h</button>' +
        '<button type="button" class="mm-salto" data-salto="domani">Domani</button></div>' : '') +
      '<div class="mm-cursore-box"><div class="mm-tacche"></div>' + (futuri.length ? '<div class="mm-adesso" style="left:' + posBarra(ADESSO) + '"></div>' : '') +
        '<input class="mm-cursore" type="range" min="0" max="' + (TOT - 1) + '" step="1" value="' + ADESSO + '" aria-label="Ora del fotogramma"></div>' +
      '<div class="mm-scala">' + scala + '</div>' +
      '<div class="mm-piede"><div class="mm-piede-sx"><div class="mm-legenda">Debole<i></i>Forte</div>' +
        (futuri.length ? '<div class="mm-nota-fulmini">Fulmini: solo osservati</div>' : '') + '</div>' +
        '<div class="mm-crediti"><a href="https://dpc-radar.readthedocs.io/" target="_blank" rel="noopener">Radar-DPC (CC&nbsp;BY-SA&nbsp;4.0)</a><br>' +
        '<a href="https://www.eumetsat.int/" target="_blank" rel="noopener">©&nbsp;EUMETSAT</a> · ' +
        BASE.cr + (BASE.nomi ? ' · <a href="https://maps.eox.at" target="_blank" rel="noopener">Nomi ©&nbsp;EOX</a>, ' + OSM_CR : '') +
        (futuri.length ? '<br>Previsione: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC&nbsp;BY&nbsp;4.0), <span class="mm-cr-modello">' + MODELLI[0].nome + '</span>' : '') +
        '</div></div>');
    var avviso = el("div", "mm-avviso");
    radice.appendChild(divMappa); if (opz.titolo !== false) radice.appendChild(testa); radice.appendChild(colonna); radice.appendChild(barra); radice.appendChild(avviso);
    contenitore.appendChild(radice);

    var bPlay = barra.querySelector(".mm-play"), cursore = barra.querySelector(".mm-cursore");
    var eOra = barra.querySelector(".mm-ora"), eGiorno = barra.querySelector(".mm-giorno"), eStato = barra.querySelector(".mm-stato");
    // un tratto della barra per ogni passaggio da un fotogramma al successivo (dopo "Adesso" = previsione)
    var eTacche = barra.querySelector(".mm-tacche"), tacche = [];
    for (var i = 0; i < TOT - 1; i++) { var t = el("div", "mm-tacca" + (i >= ADESSO ? " mm-futuro" : "")); eTacche.appendChild(t); tacche.push(t); }
    var salti = [].slice.call(barra.querySelectorAll(".mm-salto"));
    bPlay.innerHTML = ICONE.play;
    // i controlli non devono trascinare la mappa
    [testa, colonna, barra].forEach(function (x) { L.DomEvent.disableClickPropagation(x); L.DomEvent.disableScrollPropagation(x); });

    // --- mappa ---
    var mappa = L.map(divMappa, { zoomControl: false, attributionControl: false, minZoom: 4, maxZoom: 11, zoomSnap: 1 })
      .setView([LAT, LON], opz.zoom || 7);
    function pannello(nome, z) { var p = mappa.createPane(nome); p.style.zIndex = z; p.style.pointerEvents = "none"; return p; }
    L.tileLayer(BASE.url, { maxZoom: 19, minZoom: 1, subdomains: "abc", className: "mm-base " + BASE.filtro }).addTo(mappa);
    if (BASE.nomi) {
      pannello("mm-nomi", 500);
      L.tileLayer(EOX + BASE.nomi + "/default/g/{z}/{y}/{x}.png", { maxZoom: 19, minZoom: 1, pane: "mm-nomi" }).addTo(mappa);
    }
    var riquadri = { nuvole: pannello("mm-nuvole", 300), pioggia: pannello("mm-radar", 350), fulmini: pannello("mm-fulmini", 450) };
    riquadri.pioggia.classList.add("mm-pane-radar");
    // previsione in riquadri suoi: il filtro del radar DPC ne altererebbe i colori
    var riquadriPrev = futuri.length ? { nuvole: pannello("mm-prev-nuvole", 301), pioggia: pannello("mm-prev-pioggia", 351) } : {};
    L.marker([LAT, LON], { interactive: false, keyboard: false,
      icon: L.divIcon({ className: "", html: '<div class="mm-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(mappa);
    /* Centra il luogo nella parte di mappa davvero visibile: sotto c'è il pannello dell'orario,
       quindi il centro utile è fra il bordo alto e l'inizio del pannello, non il centro dello schermo. */
    function centraVisibile(z) {
      z = z || opz.zoom || 7;
      var alto = divMappa.clientHeight, cima = barra.offsetTop;
      if (!alto || !cima || cima >= alto) { mappa.setView([LAT, LON], z); return; }
      var dy = alto / 2 - cima / 2;   // di quanto il centro visibile sta sopra il centro dello schermo
      var p = mappa.project([LAT, LON], z).add([0, dy]);
      mappa.setView(mappa.unproject(p, z), z, { animate: false });
    }
    requestAnimationFrame(function () { centraVisibile(); });
    bCentra.addEventListener("click", function () { centraVisibile(); });

    // --- stato ---
    var frames = [];          // { t, radar: StratoRadar|null, pronto: {pioggia,nuvole,fulmini} }
    var ultimi = null;        // ultimo istante per fonte
    var sat = null;           // area chiesta ai satelliti: { bounds, bbox, w, h, zoom }
    var cacheSat = { nuvole: {}, fulmini: {} };  // chiave tempo -> { overlay, promessa }
    var indice = N_FRAME - 1, inPlay = false, timer = null, caricamento = null, generazione = 0, distrutto = false;
    var avvioAutomatico = !opz.pausa;
    // Il play automatico (all'apertura, o quando l'app torna sulla Mappa) gira solo sul passato:
    // la previsione entra nel giro dopo un gesto (play, cursore, scorciatoie), così aprire la mappa non la scarica.
    var conFuturo = false;
    var testoPassato = "";    // stato del caricamento del passato ("Carico 3/7")

    function aggiornaBottoni() {
      for (var s in bottoni) {
        bottoni[s].classList.toggle("mm-attivo", attivi[s]);
        bottoni[s].setAttribute("aria-pressed", attivi[s]);
        riquadri[s].style.display = attivi[s] ? "" : "none";
        if (riquadriPrev[s]) riquadriPrev[s].style.display = attivi[s] ? "" : "none";
      }
      barra.querySelector(".mm-legenda").style.visibility = attivi.pioggia ? "" : "hidden";
    }
    function fot(k) { return k < N_FRAME ? frames[k] : futuri[k - N_FRAME]; }
    function nelFuturo(k) { return k > ADESSO; }

    // Ora effettiva di ogni fonte per il fotogramma t (ogni fonte ha il suo ultimo dato, non sono allineate)
    function tempoRadar(t) { return Math.min(giu(t, 5 * MIN), giu(ultimi.radar, 5 * MIN)); }
    function tempoNuvole(t) { return Math.min(giu(t, 10 * MIN), giu(ultimi.nuvole, 10 * MIN)); }
    function tempiFulmini(t) {
      // il prodotto fulmini è ogni 5 minuti: per uno scatto da 10 minuti si sommano i due quinti di ora
      var a = Math.min(giu(t, 5 * MIN) - 5 * MIN, giu(ultimi.fulmini, 5 * MIN)), b = Math.min(giu(t, 5 * MIN), giu(ultimi.fulmini, 5 * MIN));
      return a === b ? [b] : [a, b];
    }

    function calcolaAreaSat() {
      var b = mappa.getBounds().pad(0.3);
      var sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
      var dim = mappa.getSize(), w = dim.x * 1.6, h = w * (ne.y - sw.y) / (ne.x - sw.x);
      var scala = Math.min(1, 1000 / Math.max(w, h));
      return { bounds: b, bbox: [sw.x, sw.y, ne.x, ne.y].join(","), w: Math.max(64, Math.round(w * scala)), h: Math.max(64, Math.round(h * scala)), zoom: mappa.getZoom() };
    }
    // riduzione: i fulmini (griglia ~2 km) si chiedono a 1/3 della risoluzione e il browser li ammorbidisce
    function urlEu(strato, t, formato, riduzione) {
      var r = riduzione || 1;
      return EU_WMS + "?service=WMS&request=GetMap&version=1.3.0&layers=mtg_fd:" + strato + "&styles=&format=" + formato +
        (formato === "image/png" ? "&transparent=true" : "") + "&crs=EPSG:3857&bbox=" + sat.bbox +
        "&width=" + Math.round(sat.w / r) + "&height=" + Math.round(sat.h / r) + "&time=" + iso(t);
    }

    var cv = document.createElement("canvas");
    function nuvoleDaIR(im) {
      cv.width = im.naturalWidth; cv.height = im.naturalHeight;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      var dati = cx.getImageData(0, 0, cv.width, cv.height), d = dati.data;
      for (var i = 0; i < d.length; i += 4) {
        var g = d[i], a = (g - IR_SOGLIA) / (IR_PIENO - IR_SOGLIA);
        if (a <= 0) { d[i + 3] = 0; continue; }
        if (a > 1) a = 1;
        d[i] = 238; d[i + 1] = 238; d[i + 2] = 242; d[i + 3] = Math.round(Math.pow(a, 0.85) * IR_ALFA_MAX * 255);
      }
      cx.putImageData(dati, 0, 0);
      return canvasABlobUrl(cv);
    }
    function fulminiUniti(immagini) {
      cv.width = immagini[0].naturalWidth; cv.height = immagini[0].naturalHeight;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.clearRect(0, 0, cv.width, cv.height);
      immagini.forEach(function (im) { cx.drawImage(im, 0, 0, cv.width, cv.height); });
      return canvasABlobUrl(cv);
    }

    // Carica (una volta) l'immagine satellitare per una chiave tempo
    function caricaSat(strato, tempi, gen) {
      var chiave = tempi.join("+"), c = cacheSat[strato];
      if (c[chiave]) return c[chiave].promessa;
      var area = sat;
      var promessa = Promise.all(tempi.map(function (t) {
        return prendiImmagine(strato === "nuvole" ? urlEu("ir105_hrfi", t, "image/jpeg") : urlEu("li_afa", t, "image/png", 3));
      })).then(function (imm) {
        if (distrutto || area !== sat) throw new Error("superato");
        return strato === "nuvole" ? nuvoleDaIR(imm[0]) : fulminiUniti(imm);
      }).then(function (url) {
        var ov = L.imageOverlay(url, area.bounds, { pane: strato === "nuvole" ? "mm-nuvole" : "mm-fulmini", opacity: 0, interactive: false }).addTo(mappa);
        ov._mmOpacita = strato === "nuvole" ? 1 : 0.9;
        c[chiave].overlay = ov;
        return ov;
      });
      c[chiave] = { promessa: promessa, overlay: null };
      promessa.catch(function (e) { if (e.message !== "superato") { console.warn("MappaMeteo: " + strato + " " + chiave + " non caricato", e); } delete c[chiave]; });
      return promessa;
    }

    function caricaRadar(f) {
      if (f.radar) return conTempoMax(f.radar._mmPromessa, 12000);
      var strato = new StratoRadar("", {
        tempo: tempoRadar(f.t), tileSize: 512, zoomOffset: -1, maxNativeZoom: 9, minZoom: 4,
        bounds: COPERTURA_RADAR, pane: "mm-radar", opacity: 0, keepBuffer: 1, updateWhenZooming: false
      });
      var errori = 0;
      strato.on("tileerror", function () { if (!errori++) console.warn("MappaMeteo: riquadro radar non caricato " + iso(strato.options.tempo)); });
      strato._mmPromessa = new Promise(function (ok) { strato.once("load", function () { ok(strato); }); });
      f.radar = strato;
      strato.addTo(mappa);
      return conTempoMax(strato._mmPromessa, 12000);
    }

    function caricaFotogramma(f, gen) {
      var lavori = [];
      if (attivi.pioggia && !f.pronto.pioggia) lavori.push(caricaRadar(f).then(function () { f.pronto.pioggia = true; }));
      if (attivi.nuvole && !f.pronto.nuvole) lavori.push(caricaSat("nuvole", [tempoNuvole(f.t)], gen).then(function () { f.pronto.nuvole = true; }, function () {}));
      if (attivi.fulmini && !f.pronto.fulmini) lavori.push(caricaSat("fulmini", tempiFulmini(f.t), gen).then(function () { f.pronto.fulmini = true; }, function () {}));
      return Promise.all(lavori);
    }
    function fotogrammaPronto(f) {
      return (!attivi.pioggia || f.pronto.pioggia) && (!attivi.nuvole || f.pronto.nuvole) && (!attivi.fulmini || f.pronto.fulmini);
    }

    // Precarica tutti i fotogrammi, dal più recente al più vecchio, due alla volta
    function caricaTutto() {
      var gen = ++generazione;
      var coda = [];
      for (var i = frames.length - 1; i >= 0; i--) coda.push(i);
      var fatti = 0;
      function segna() {
        var n = 0;
        frames.forEach(function (f) { if (fotogrammaPronto(f)) n++; });
        fatti = n;
        testoPassato = n < frames.length ? "Carico <b>" + n + "/" + frames.length + "</b>" : "";
        aggiornaTacche(); aggiornaStato();
      }
      segna();
      function lavoratore() {
        if (gen !== generazione || distrutto) return Promise.resolve();
        var k = coda.shift();
        if (k === undefined) return Promise.resolve();
        return caricaFotogramma(frames[k], gen).then(function () {
          if (gen !== generazione) return;
          segna();
          if (k === indice) mostra(indice);
          return lavoratore();
        });
      }
      bPlay.disabled = true;
      caricamento = Promise.all([lavoratore(), lavoratore()]).then(function () {
        if (gen !== generazione || distrutto) return;
        segna();
        bPlay.disabled = false;
        mostra(indice);
        riepilogo();
        if (avvioAutomatico) { avvioAutomatico = false; avvia(); }
      });
      return caricamento;
    }

    function etichettaGiorno(t) {
      var oggi = fmtData.format(new Date()), ieri = fmtData.format(new Date(Date.now() - 864e5)), g = fmtData.format(new Date(t));
      var domani = fmtData.format(new Date(Date.now() + 864e5));
      return g === oggi ? "Oggi" : g === ieri ? "Ieri" : g === domani ? "Domani" : fmtGiorno.format(new Date(t));
    }

    // ---------- previsione: libreria, modello e livelli caricati solo quando servono ----------
    var prev = null;          // promessa { OM, ad, m } (libreria + ultima corsa del modello)
    var prevLib = null;       // { OM, ad, m } quando pronta
    var prevErrore = false;   // libreria o modello non disponibili
    var modelloN = 0;         // indice in MODELLI (passa alla riserva se il primo non va)
    var erroriModello = 0;
    var limitiPrev = null;    // area chiesta alla libreria (vista allargata)
    var codaPrev = [], lavoratoriPrev = 0;

    function preparaPrev() {
      if (prev) return prev;
      prevErrore = false;
      aggiornaStato();
      prev = caricaOM().then(function (o) {
        // il primo modello che copre la prima ora futura; se nessuno, prendo quello che risponde
        function prova(n, ripiego) {
          if (n >= MODELLI.length) { if (ripiego) return ripiego; throw new Error("nessun modello disponibile"); }
          return leggiModello(MODELLI[n]).then(function (m) {
            m.n = n;
            if (m.tempi[futuri[0].t] !== undefined && m.variabili.indexOf("precipitation") >= 0) return m;
            return prova(n + 1, ripiego || m);
          }, function (e) { console.warn("MappaMeteo: " + MODELLI[n].id + " non disponibile", e); return prova(n + 1, ripiego); });
        }
        return prova(modelloN, null).then(function (m) { return { OM: o.OM, ad: o.ad, m: m }; });
      });
      prev.then(function (p) {
        if (distrutto) return;
        prevLib = p; modelloN = p.m.n;
        var cr = barra.querySelector(".mm-cr-modello"); if (cr) cr.textContent = p.m.nome;
        futuri.forEach(function (f) { f.manca = p.m.tempi[f.t] === undefined; });
        aggiornaLimiti(true);
        console.log("MAPPA-PREV modello " + p.m.id + " corsa " + p.m.run + " (" + p.m.valid.length + " ore)");
        aggiornaTacche(); mostra(indice, true);
      }, function (e) {
        console.warn("MappaMeteo: previsione non disponibile", e);
        prev = null; prevErrore = true;
        if (!distrutto) { aggiornaTacche(); mostra(indice, true); }
      });
      return prev;
    }

    // La libreria legge i dati solo dentro l'area indicata: la vista allargata di un quarto per lato
    function aggiornaLimiti(forza) {
      if (!prevLib) return false;
      var vista = mappa.getBounds();
      if (!forza && limitiPrev && limitiPrev.contains(vista)) return false;
      limitiPrev = vista.pad(0.25);
      prevLib.OM.updateCurrentBounds([Math.max(-180, limitiPrev.getWest()), Math.max(-85, limitiPrev.getSouth()),
        Math.min(180, limitiPrev.getEast()), Math.min(85, limitiPrev.getNorth())]);
      return true;
    }

    function togliStrato(f, s) {
      if (!f.strati[s]) return;
      mappa.removeLayer(f.strati[s]);
      f.strati[s] = null; f.pronto[s] = false; f.carica[s] = false; f.errore[s] = false;
    }
    // Troppi livelli in memoria: tolgo i più lontani da quello in vista (prima quelli già passati)
    function sfoltisci(s) {
      var vivi = [];
      futuri.forEach(function (f, j) { if (f.strati[s]) vivi.push({ f: f, k: N_FRAME + j }); });
      if (vivi.length <= PREV_MAX[s]) return;
      vivi.forEach(function (v) { v.d = v.k === indice ? -1 : v.k < indice ? (indice - v.k) * 3 : v.k - indice; });
      vivi.sort(function (a, b) { return b.d - a.d; });
      for (var i = 0; i < vivi.length - PREV_MAX[s]; i++) togliStrato(vivi[i].f, s);
    }

    function urlPrev(m, i, s) {
      var vt = m.valid[i];
      // durata del passo in ore (la pioggia è il totale del passo, la libreria la riporta a mm/h)
      var dt = i > 0 ? (Date.parse(vt) - Date.parse(m.valid[i - 1])) / ORA : m.valid.length > 1 ? (Date.parse(m.valid[1]) - Date.parse(vt)) / ORA : 1;
      return "om://" + OM_S3 + m.id + "/" + m.run + vt.replace(":", "").replace("Z", "") + ".om?variable=" +
        (s === "pioggia" ? "precipitation" : "cloud_cover&color_blend=true") + "&delta_time_hours=" + dt;
    }

    // Carica uno strato previsto per un fotogramma; la promessa si risolve sempre (pronto, errore o tempo scaduto)
    function caricaPrevStrato(f, s) {
      if (f.strati[s]) return f.strati[s]._mmPromessa;
      var p = prevLib, i = p.m.tempi[f.t];
      if (i === undefined) { f.manca = true; return Promise.resolve(); }
      var lay = p.ad.createTileLayer(urlPrev(p.m, i, s), {
        pane: s === "pioggia" ? "mm-prev-pioggia" : "mm-prev-nuvole", opacity: fot(indice) === f ? 1 : 0,
        updateWhenIdle: true, keepBuffer: 1, minZoom: 4
      });
      var buoni = 0, errori = 0, t0 = Date.now();
      lay.on("tileload", function () { buoni++; });
      lay.on("tileerror", function () { errori++; });
      f.carica[s] = true; f.errore[s] = false;
      lay._mmPromessa = conTempoMax(new Promise(function (ok) { lay.once("load", ok); }), 25000).then(function (r) {
        if (f.strati[s] !== lay || distrutto) return;
        f.carica[s] = false; f.pronto[s] = true;
        if (r === "tempo") console.warn("MappaMeteo: previsione " + s + " " + iso(f.t) + " lenta, la mostro com'è");
        if (errori && !buoni) {
          f.errore[s] = true;
          console.warn("MappaMeteo: previsione " + s + " " + iso(f.t) + " non caricata (" + p.m.id + ")");
          // due fotogrammi falliti col primo modello: passo alla riserva
          if (++erroriModello >= 2 && modelloN === p.m.n && modelloN + 1 < MODELLI.length) cambiaModello();
        }
        console.log("MAPPA-PREV " + s + " " + iso(f.t) + " " + (Date.now() - t0) + " ms" + (errori ? " errori " + errori : ""));
      });
      f.strati[s] = lay;
      lay.addTo(mappa);
      sfoltisci(s);
      return lay._mmPromessa;
    }
    function cambiaModello() {
      modelloN++; erroriModello = 0;
      futuri.forEach(function (f) { togliStrato(f, "pioggia"); togliStrato(f, "nuvole"); });
      prev = null; prevLib = null;
      if (nelFuturo(indice)) pianificaPrev(indice);
    }

    function prevPronto(f) {
      if (prevErrore || f.manca) return true;
      return (!attivi.pioggia || !!f.pronto.pioggia) && (!attivi.nuvole || !!f.pronto.nuvole);
    }

    // Coda di caricamento: il fotogramma in vista, poi qualcuno dopo (pioggia 3, nuvole 1); due alla volta
    function pianificaPrev(k) {
      if (!futuri.length || distrutto) return;
      var coda = [];
      for (var j = Math.max(k, N_FRAME); j < Math.min(TOT, k + 1 + PREV_AVANTI.pioggia); j++) {
        ["pioggia", "nuvole"].forEach(function (s) { if (j - Math.max(k, N_FRAME) <= PREV_AVANTI[s]) coda.push({ k: j, s: s }); });
      }
      codaPrev = coda;
      preparaPrev().then(function () {
        while (lavoratoriPrev < 2 && codaPrev.length) { lavoratoriPrev++; lavoraPrev(); }
      }, function () {});
    }
    function lavoraPrev() {
      var c;
      // salto quello che è già caricato o spento
      while ((c = codaPrev.shift()) && (!attivi[c.s] || fot(c.k).strati[c.s] && !fot(c.k).carica[c.s])) {}
      if (!c || distrutto || !prevLib) { lavoratoriPrev--; return; }
      var f = fot(c.k);
      aggiornaTacche();
      caricaPrevStrato(f, c.s).then(function () {
        if (distrutto) return;
        aggiornaTacche();
        if (fot(indice) === f) mostra(indice, true);
        lavoraPrev();
      });
    }

    function aggiornaTacche() {
      for (var j = 0; j < tacche.length; j++) {
        var k = j + 1, f = fot(k), pronta = false, carica = false;
        if (!f) pronta = false;
        else if (k < N_FRAME) pronta = fotogrammaPronto(f);
        else if (prevLib) { pronta = prevPronto(f) && !f.carica.pioggia && !f.carica.nuvole; carica = !!(f.carica.pioggia || f.carica.nuvole); }
        tacche[j].classList.toggle("mm-pronta", pronta);
        tacche[j].classList.toggle("mm-carica", carica);
        tacche[j].classList.toggle("mm-passata", j < indice);
      }
    }
    function aggiornaStato() {
      var testo = testoPassato, st = "";
      if (frames.length && nelFuturo(indice)) {
        var f = fot(indice);
        if (prevErrore) { testo = "Previsione non disponibile"; st = "errore"; }
        else if (prevLib && f.manca) { testo = "Oltre la previsione"; st = "errore"; }
        else if (!prevLib || !prevPronto(f) || f.carica.pioggia && attivi.pioggia || f.carica.nuvole && attivi.nuvole) { testo = '<span class="mm-rotella"></span>Carico previsione'; st = "carico"; }
        else st = "pronto";
      }
      eStato.innerHTML = testo;
      radice.setAttribute("data-prev", st);
    }

    // Scorciatoie: Adesso, +3 h, +6 h, Domani (alle 12, o alle 9 se le 12 sono oltre la previsione)
    function indiceSalto(cosa) {
      if (cosa === "adesso") return ADESSO;
      if (cosa === "domani") {
        var domani = fmtData.format(new Date(Date.now() + 864e5)), alle9 = -1;
        for (var j = 0; j < futuri.length; j++) {
          if (fmtData.format(new Date(futuri[j].t)) !== domani) continue;
          var hh = +fmtOraNum.format(new Date(futuri[j].t));
          if (hh === 12) return N_FRAME + j;
          if (hh === 9) alle9 = N_FRAME + j;
        }
        return alle9;
      }
      var meta = Date.now() + (+cosa) * ORA, best = -1, d = Infinity;
      futuri.forEach(function (f, j) { var x = Math.abs(f.t - meta); if (x < d) { d = x; best = N_FRAME + j; } });
      return best;
    }
    salti.forEach(function (b) {
      var k = indiceSalto(b.getAttribute("data-salto"));
      if (k < 0) b.hidden = true;
      b.addEventListener("click", function () {
        var k = indiceSalto(b.getAttribute("data-salto"));
        if (k < 0 || !frames.length) return;
        ferma();
        if (nelFuturo(k)) conFuturo = true;
        mostra(k);
      });
    });
    function aggiornaSalti() {
      salti.forEach(function (b) { b.classList.toggle("mm-attivo", indiceSalto(b.getAttribute("data-salto")) === indice); });
    }

    function mostra(k, soloVista) {
      if (!frames.length) return;
      indice = k;
      var f = fot(k), fut = nelFuturo(k);
      frames.forEach(function (x, j) { if (x.radar) x.radar.setOpacity(j === k ? 0.95 : 0); });
      var chiaviOn = {
        nuvole: attivi.nuvole && !fut ? String(tempoNuvole(f.t)) : null,
        fulmini: attivi.fulmini && !fut ? tempiFulmini(f.t).join("+") : null
      };
      ["nuvole", "fulmini"].forEach(function (s) {
        var c = cacheSat[s];
        for (var ch in c) if (c[ch].overlay) c[ch].overlay.setOpacity(ch === chiaviOn[s] ? c[ch].overlay._mmOpacita : 0);
      });
      futuri.forEach(function (x) { for (var s in x.strati) if (x.strati[s]) x.strati[s].setOpacity(x === f ? 1 : 0); });
      cursore.value = k;
      radice.classList.toggle("mm-in-futuro", fut);
      // i fulmini non hanno previsione: nel futuro il pulsante si attenua e compare la nota
      radice.classList.toggle("mm-fulmini-futuro", fut && attivi.fulmini);
      var note = [etichettaGiorno(f.t)];
      if (fut) {
        eOra.innerHTML = fmtOra.format(new Date(f.t)) + '<span class="mm-previsto"> · previsto</span>';
        note.push(prevLib ? "previsione " + prevLib.m.breve : "previsione");
      } else {
        eOra.textContent = fmtOra.format(new Date(f.t));
        if (attivi.nuvole && tempoNuvole(f.t) < f.t) note.push("nuvole " + fmtOra.format(new Date(tempoNuvole(f.t))));
        if (attivi.pioggia && tempoRadar(f.t) < f.t) note.push("radar " + fmtOra.format(new Date(tempoRadar(f.t))));
      }
      eGiorno.textContent = note.join(" · ");
      aggiornaTacche(); aggiornaStato(); aggiornaSalti();
      if (fut && !soloVista) pianificaPrev(k);
    }

    var attesaPlay = 0;
    function passo() {
      if (!inPlay) return;
      var n = conFuturo && futuri.length ? TOT : N_FRAME;
      var k = (indice + 1) % n;
      if (nelFuturo(k)) {
        // previsione: aspetto il fotogramma (massimo 12 s), intanto si carica con i successivi
        if (!prevPronto(fot(k)) && attesaPlay < 48) {
          if (!attesaPlay++) pianificaPrev(k);
          timer = setTimeout(passo, 250);
          return;
        }
        attesaPlay = 0;
      } else {
        // passato: salta i fotogrammi non ancora pronti
        var giri = 0;
        while (!fotogrammaPronto(frames[k]) && giri++ < N_FRAME) k = (k + 1) % N_FRAME;
      }
      mostra(k);
      // passato veloce, previsione 1 s per ora, pausa su Adesso e alla fine del giro
      var ultimo = k === n - 1;
      timer = setTimeout(passo, ultimo ? 1800 : k === ADESSO ? 1200 : nelFuturo(k) ? 1000 : 550);
    }
    function avvia() {
      if (inPlay || !frames.length) return;
      inPlay = true; attesaPlay = 0; bPlay.innerHTML = ICONE.pausa; bPlay.setAttribute("aria-label", "Pausa");
      // con la previsione nel giro preparo subito i primi fotogrammi futuri
      if (conFuturo && futuri.length) pianificaPrev(nelFuturo(indice) ? indice : N_FRAME);
      timer = setTimeout(passo, 300);
    }
    function ferma() { inPlay = false; clearTimeout(timer); bPlay.innerHTML = ICONE.play; bPlay.setAttribute("aria-label", "Avvia"); }
    bPlay.addEventListener("click", function () {
      if (inPlay) return ferma();
      if (futuri.length) conFuturo = true;   // play premuto a mano: il giro continua nella previsione
      avvia();
    });
    cursore.addEventListener("input", function () {
      if (!frames.length) return;
      ferma();
      if (nelFuturo(+cursore.value)) conFuturo = true;
      mostra(+cursore.value);
    });

    function commuta(s) {
      attivi[s] = !attivi[s];
      aggiornaBottoni();
      if (!frames.length) return;
      mostra(indice);
      if (attivi[s] && frames.some(function (f) { return !fotogrammaPronto(f); })) {
        var eraInPlay = inPlay; ferma();
        caricaTutto().then(function () { if (eraInPlay) avvia(); });
      }
    }

    // Quando la vista esce dall'area chiesta ai satelliti, la richiedo (una volta, a spostamento finito)
    var attesaMossa = null;
    mappa.on("moveend", function () {
      if (!sat) return;
      clearTimeout(attesaMossa);
      attesaMossa = setTimeout(function () {
        var dentro = sat.bounds.contains(mappa.getBounds()) && Math.abs(mappa.getZoom() - sat.zoom) <= 1;
        if (dentro || !(attivi.nuvole || attivi.fulmini)) return;
        ["nuvole", "fulmini"].forEach(function (s) {
          for (var ch in cacheSat[s]) if (cacheSat[s][ch].overlay) { URL.revokeObjectURL(cacheSat[s][ch].overlay._url); mappa.removeLayer(cacheSat[s][ch].overlay); }
          cacheSat[s] = {};
        });
        frames.forEach(function (f) { f.pronto.nuvole = false; f.pronto.fulmini = false; });
        sat = calcolaAreaSat();
        var eraInPlay = inPlay; ferma();
        caricaTutto().then(function () { if (eraInPlay) avvia(); });
      }, 400);
    });

    // Previsione: se la vista esce dall'area chiesta alla libreria, la allargo, tengo solo il fotogramma
    // in vista (ridisegnato) e ricarico i successivi. Registrato qui, prima dei livelli: gira prima di loro.
    mappa.on("moveend", function () {
      if (!prevLib || !aggiornaLimiti(false)) return;
      var f = fot(indice);
      futuri.forEach(function (x) {
        ["pioggia", "nuvole"].forEach(function (s) {
          if (!x.strati[s]) return;
          if (x === f) x.strati[s].redraw(); else togliStrato(x, s);
        });
      });
      aggiornaTacche();
      if (nelFuturo(indice)) pianificaPrev(indice);
    });

    function riepilogo() {
      try {
        var host = {};
        performance.getEntriesByType("resource").forEach(function (r) {
          var h = new URL(r.name).host; host[h] = (host[h] || 0) + 1;
        });
        var pronti = { pioggia: 0, nuvole: 0, fulmini: 0 };
        frames.forEach(function (f) { for (var s in pronti) if (f.pronto[s]) pronti[s]++; });
        console.log("MAPPA-RIEPILOGO " + JSON.stringify({
          fotogrammi: frames.length, da: iso(frames[0].t), a: iso(frames[frames.length - 1].t), ultimi: {
            radar: iso(ultimi.radar), nuvole: iso(ultimi.nuvole), fulmini: iso(ultimi.fulmini) },
          pronti: pronti, immaginiSat: { nuvole: Object.keys(cacheSat.nuvole).length, fulmini: Object.keys(cacheSat.fulmini).length },
          areaSat: sat && (sat.w + "x" + sat.h), richiestePerHost: host
        }));
      } catch (e) { console.warn(e); }
    }

    // --- avvio ---
    aggiornaBottoni();
    Promise.all([ultimoRadar(), ultimoEumetsat("ir105_hrfi", 10 * MIN, 35 * MIN), ultimoEumetsat("li_afa", 5 * MIN, 20 * MIN)]).then(function (u) {
      if (distrutto) return;
      ultimi = { radar: u[0], nuvole: u[1], fulmini: u[2] };
      // la sequenza finisce sul dato più recente (passo 5 min); ogni fonte usa il suo ultimo dato <= ora del fotogramma
      var fine = opz.ora ? giu(Date.parse(opz.ora), 5 * MIN) : giu(Math.max(u[0], u[1], u[2]), 5 * MIN);
      if (isNaN(fine)) fine = giu(Date.now() - 20 * MIN, PASSO);
      if (opz.ora) ultimi = { radar: Math.min(u[0], fine), nuvole: Math.min(u[1], fine), fulmini: Math.min(u[2], fine) };
      for (var i = 0; i < N_FRAME; i++) frames.push({ t: fine - (N_FRAME - 1 - i) * PASSO, radar: null, pronto: {} });
      indice = opz.fotogramma != null && !isNaN(+opz.fotogramma) ? Math.max(0, Math.min(TOT - 1, +opz.fotogramma)) : ADESSO;
      if (nelFuturo(indice)) conFuturo = true;
      sat = calcolaAreaSat();
      mostra(indice);
      caricaTutto();
    });

    return {
      mappa: mappa,
      avvia: avvia,
      ferma: ferma,
      distruggi: function () {
        distrutto = true; ferma(); generazione++; codaPrev = [];
        ["nuvole", "fulmini"].forEach(function (s) { for (var ch in cacheSat[s]) if (cacheSat[s][ch].overlay) URL.revokeObjectURL(cacheSat[s][ch].overlay._url); });
        mappa.remove(); contenitore.innerHTML = "";
      }
    };
  }

  global.MappaMeteo = { init: init };
})(window);
