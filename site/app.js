/* Radar — tela de notícias para TV. Nome, cores, cidade e categorias vêm de config.json.
   Escrito em JavaScript simples (sem recursos modernos) para rodar
   também nos navegadores mais antigos de Smart TVs. */
(function () {
  var CONFIG = {
    dataUrl: 'news.json',
    slideSeconds: 15,          // tempo de cada notícia na tela
    refreshMinutes: 10,        // de quanto em quanto tempo busca notícias novas
    reloadHours: 6,            // recarrega a página inteira (evita travamentos da TV)
    maxItems: 12,
    weatherMinutes: 30,        // clima: Open-Meteo (gratuita, sem cadastro)
    currencyMinutes: 15,       // câmbio: AwesomeAPI (gratuita, sem cadastro)
    selicHours: 6              // Selic: API do Banco Central (gratuita, sem cadastro)
  };

  // Ícones disponíveis para as categorias do config.json
  var ICONS = {
    documento: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    grafico: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    lampada: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    moeda: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5A2.5 2.5 0 0 0 12 8c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2a2.5 2.5 0 0 1-2.5-1.5M12 6.5V8M12 16v1.5"/>',
    bateria: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 11v2M10 11v2"/>',
    raio: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    folha: '<path d="M5 21c0-9 5-15 15-16-1 10-7 15-15 16z"/><path d="M5 21l8-8"/>',
    globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
    predio: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
    pessoas: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 13.5c2 1 3.5 3.3 3.5 6.5"/>',
    carro: '<path d="M5 17h14M3 17v-4l2-5a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 8l2 5v4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    noticia: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',

    // Ícones do clima
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    lua: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    parcial: '<path d="M12 2v1.5M4.9 4.9l1 1M2 12h1.5M19.1 4.9l-1 1"/><path d="M7.5 11.5a4.5 4.5 0 0 1 8.4-2.3"/><path d="M17 21H9a4 4 0 1 1 .9-7.9A5 5 0 0 1 19.6 14 3.5 3.5 0 0 1 17 21z"/>',
    nublado: '<path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 11 4 4 0 0 1 17.5 19z"/>',
    chuva: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 7 4 4 0 0 1 17.5 15z"/><path d="M8 18v3M12 18v3M16 18v3"/>',
    tempestade: '<path d="M17.5 15H8a5 5 0 1 1 1.1-9.9A6 6 0 0 1 20.6 7 4 4 0 0 1 17.5 15z"/><path d="M13 16l-2 3h3l-2 3"/>',
    neblina: '<path d="M4 8h16M3 12h18M5 16h14M8 20h8"/>'
  };

  var CATEGORIES = {};        // id -> { label, icon }, preenchido a partir do config.json
  var DEFAULT_CATEGORY = '';

  var state = { items: [], index: -1, updatedAt: null, ai: false, timer: null };
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage');

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.sol) + '</svg>';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function getJSON(url, onData) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function () {
      if (xhr.status < 200 || xhr.status >= 300) return;
      try { onData(JSON.parse(xhr.responseText)); } catch (e) { /* mantém o que já está na tela */ }
    };
    xhr.send();
  }

  /* ---------- Escala: o palco tem 1920x1080 e se ajusta à tela ---------- */
  function fit() {
    var w = window.innerWidth, h = window.innerHeight;
    var scale = Math.min(w / 1920, h / 1080);
    var x = (w - 1920 * scale) / 2, y = (h - 1080 * scale) / 2;
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  }

  /* ---------- Relógio ---------- */
  var WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function tickClock() {
    var d = new Date();
    $('clock-time').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('clock-date').textContent = WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function timeAgo(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    var h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + ' h';
    var days = Math.round(h / 24);
    return days === 1 ? 'ontem' : 'há ' + days + ' dias';
  }

  /* ---------- Clima ---------- */
  function weatherIcon(code, isDay) {
    if (code === 0 || code === 1) return isDay ? 'sol' : 'lua';
    if (code === 2) return isDay ? 'parcial' : 'nublado';
    if (code === 3) return 'nublado';
    if (code === 45 || code === 48) return 'neblina';
    if (code >= 95) return 'tempestade';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'chuva';
    return 'nublado';
  }

  function loadWeather() {
    var c = CONFIG.city;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon +
      '&current=temperature_2m,weather_code,is_day' +
      '&daily=temperature_2m_max,temperature_2m_min,sunshine_duration,shortwave_radiation_sum' +
      '&timezone=auto&forecast_days=1';
    getJSON(url, function (data) {
      var cur = data.current, day = data.daily;
      if (!cur || !day) return;
      var el = $('weather');
      el.querySelector('.weather-icon').innerHTML = icon(weatherIcon(cur.weather_code, cur.is_day));
      el.querySelector('.stat-value').textContent = Math.round(cur.temperature_2m) + '°';
      el.querySelector('.weather-range').textContent =
        Math.round(day.temperature_2m_max[0]) + '° / ' + Math.round(day.temperature_2m_min[0]) + '°';
      el.hidden = false;

      if (CONFIG.showSunHours) {
        var sunHours = Math.round((day.sunshine_duration[0] || 0) / 3600);
        $('sun-hours').textContent = sunHours + ' h de sol previstas hoje em ' + c.name;
      }

      if (panel().solarKwp) renderSolar(day.shortwave_radiation_sum[0]);
    });
  }

  /* ---------- Painel lateral ---------- */
  function panel() { return CONFIG.panel || {}; }

  function decimal(n, digits) { return n.toFixed(digits).replace('.', ','); }

  // Estimativa simples: potência (kWp) × irradiação do dia (kWh/m²) × 0,8 de perdas do sistema
  function renderSolar(radiationMJ) {
    if (!radiationMJ) return;
    var kwp = panel().solarKwp;
    var kwh = Math.round(kwp * (radiationMJ / 3.6) * 0.8);
    var el = $('ind-solar');
    el.querySelector('.ind-label').textContent = 'Geração hoje';
    el.querySelector('.ind-value').textContent = '≈ ' + kwh + ' kWh';
    el.querySelector('.ind-note').textContent = 'sistema de ' + kwp + ' kWp em ' + CONFIG.city.name;
    el.hidden = false;
  }

  function renderFlag(flag) {
    if (!panel().tariffFlag || !flag || !flag.name) return;
    var el = $('ind-flag');
    var month = MONTHS[parseInt(flag.month.slice(5, 7), 10) - 1] || '';
    var color = flag.name.toLowerCase().split(' ')[0];
    el.querySelector('.ind-label').textContent = 'Bandeira · ' + month;
    el.querySelector('.flag-dot').className = 'flag-dot flag-' + color;
    el.querySelector('.flag-name').textContent = flag.name;
    el.querySelector('.ind-note').textContent = flag.extraPerMWh > 0 ?
      '+ R$ ' + decimal(flag.extraPerMWh / 10, 2) + ' a cada 100 kWh' : 'sem cobrança extra na conta';
    el.hidden = false;
  }

  function loadSelic() {
    getJSON('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', function (data) {
      var rate = data && data[0] && parseFloat(data[0].valor);
      if (!rate) return;
      var el = $('ind-selic');
      el.querySelector('.ind-value').textContent = decimal(rate, 2) + '% a.a.';
      el.hidden = false;
    });
  }

  /* ---------- Câmbio ---------- */
  function showRate(id, quote) {
    var bid = quote && parseFloat(quote.bid);
    if (!bid) return;
    var el = $(id);
    el.querySelector('.stat-value').textContent = 'R$ ' + bid.toFixed(2).replace('.', ',');
    el.hidden = false;
  }

  function loadCurrency() {
    getJSON('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL', function (data) {
      showRate('usd', data.USDBRL);
      showRate('eur', data.EURBRL);
    });
  }

  /* ---------- Notícias ---------- */
  function loadNews() {
    getJSON(CONFIG.dataUrl + '?t=' + Date.now(), function (data) {
      if (data.updatedAt !== state.updatedAt) {
        state.items = (data.items || []).slice(0, CONFIG.maxItems);
        state.updatedAt = data.updatedAt;
        state.ai = !!data.ai;
        renderFooter();
        renderFlag(data.tariffFlag);
        buildProgress();
        if (state.index === -1 || state.index >= state.items.length) {
          state.index = -1;
          next();
        }
      }
      document.body.className = state.items.length ? '' : 'is-empty';
    });
  }

  function renderFooter() {
    var d = new Date(state.updatedAt);
    var text = isNaN(d.getTime()) ? '' :
      'Atualizado às ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + (state.ai ? ' · resumos por IA' : '');
    $('updated').textContent = text;
  }

  /* ---------- Carrossel ---------- */
  function buildProgress() {
    var html = '';
    for (var i = 0; i < state.items.length; i++) html += '<div class="seg"><i></i></div>';
    $('progress').innerHTML = html;
  }

  function updateProgress() {
    var segs = $('progress').children;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      var bar = seg.firstChild;
      seg.className = 'seg' + (i < state.index ? ' done' : '');
      bar.style.animationDuration = '';
      if (i === state.index) {
        void seg.offsetWidth; // reinicia a animação
        seg.className = 'seg active';
        bar.style.animationDuration = CONFIG.slideSeconds + 's';
      }
    }
  }

  function render(item) {
    var cat = CATEGORIES[item.category] || CATEGORIES[DEFAULT_CATEGORY] || { label: '', icon: 'noticia' };
    $('f-eyebrow').innerHTML = icon(cat.icon) + '<span>' + escapeHtml(cat.label) + '</span>' +
      '<span class="sep">·</span><span class="region">' + (item.region === 'INT' ? 'Internacional' : 'Brasil') + '</span>';

    var title = $('f-title');
    title.textContent = item.title;
    title.className = 'title' + (item.title.length > 64 ? ' long' : '');
    $('f-summary').textContent = item.summary;
    $('f-source').textContent = item.source;
    $('f-time').textContent = timeAgo(item.publishedAt);

    var qr = $('qr');
    qr.innerHTML = '';
    if (window.QRCode && item.url) {
      new window.QRCode(qr, {
        text: item.url, width: 184, height: 184,
        colorDark: CONFIG.colors.background || '#000000', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  }

  function next() {
    if (!state.items.length) return;
    var feature = $('feature');
    var first = state.index === -1;
    state.index = (state.index + 1) % state.items.length;

    function show() {
      render(state.items[state.index]);
      feature.className = 'feature entering';
      updateProgress();
    }

    if (first) {
      show();
    } else {
      feature.className = 'feature leaving';
      setTimeout(show, 700);
    }

    clearTimeout(state.timer);
    state.timer = setTimeout(next, CONFIG.slideSeconds * 1000);
  }

  /* ---------- Identidade: nome, logo e cores ---------- */
  function applyBrand() {
    document.title = CONFIG.name;
    var brand = CONFIG.logo ?
      '<img class="logo" src="' + escapeHtml(CONFIG.logo) + '" alt="' + escapeHtml(CONFIG.name) + '">' :
      '<span class="brand-name">' + escapeHtml(CONFIG.name) + '</span>';
    $('brand').innerHTML = brand;
    $('empty-brand').innerHTML = brand;

    var c = CONFIG.colors || {}, root = document.documentElement.style;
    if (c.background) root.setProperty('--fundo', c.background);
    if (c.accent) root.setProperty('--destaque', c.accent);
    if (c.highlight) root.setProperty('--icone', c.highlight);

    var cats = CONFIG.categories || [];
    for (var i = 0; i < cats.length; i++) {
      CATEGORIES[cats[i].id] = { label: cats[i].label, icon: cats[i].icon };
    }
    if (cats.length) DEFAULT_CATEGORY = cats[cats.length - 1].id;
  }

  function start(config) {
    for (var key in config) CONFIG[key] = config[key];
    applyBrand();
    loadNews();
    loadWeather();
    setInterval(loadNews, CONFIG.refreshMinutes * 60000);
    setInterval(loadWeather, CONFIG.weatherMinutes * 60000);
    var p = panel();
    if (p.tariffFlag || p.selic || p.solarKwp) {
      $('panel').hidden = false;
      stage.className = 'has-panel';
    }
    if (p.selic) {
      loadSelic();
      setInterval(loadSelic, CONFIG.selicHours * 3600000);
    }
    if (CONFIG.showCurrency) {
      loadCurrency();
      setInterval(loadCurrency, CONFIG.currencyMinutes * 60000);
    }
  }

  /* ---------- Início ---------- */
  window.addEventListener('resize', fit);
  fit();
  tickClock();
  setInterval(tickClock, 1000);
  document.body.className = 'is-empty';

  getJSON('config.json?t=' + Date.now(), start);
  setTimeout(function () { window.location.reload(); }, CONFIG.reloadHours * 3600000);
})();
