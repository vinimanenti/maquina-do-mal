// ============================================================
// MÁQUINA DO MAL — APP.JS (COMPLETO)
// ============================================================

// ===== SUPABASE CONFIG =====
var _sbClient = null;
try {
  const _SB_URL = 'https://mqupvcuwknrmlfoxmmpz.supabase.co';
  const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xdXB2Y3V3a25ybWxmb3htbXB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjE0MzAsImV4cCI6MjA5MDczNzQzMH0.lv7UB6ncQ7EmNFHARDVly2SGku6A3PMxbEpWmcE4lMI';
  if (window.supabase && window.supabase.createClient) {
    _sbClient = window.supabase.createClient(_SB_URL, _SB_KEY);
    console.log('Supabase client initialized');
  }
} catch(e) { console.warn('Supabase init failed:', e); }

// ===== CLOUD SYNC MODULE =====
var CloudSync = {
  _queue: [],
  _processing: false,
  _ready: false,

  async loadAll() {
    if (!_sbClient) { console.warn('CloudSync: no Supabase client'); return; }
    try {
      const { data, error } = await _sbClient.from('app_data').select('key, value');
      if (error) { console.warn('CloudSync loadAll error:', error); return; }
      if (data && data.length > 0) {
        data.forEach(row => {
          localStorage.setItem('mdm_' + row.key, JSON.stringify(row.value));
        });
        console.log('CloudSync: loaded ' + data.length + ' keys from cloud');
      }
      this._ready = true;
    } catch (e) { console.warn('CloudSync loadAll exception:', e); }
  },

  save(key, val) {
    if (!_sbClient) return;
    this._queue.push({ action: 'upsert', key, val });
    this._processQueue();
  },

  remove(key) {
    if (!_sbClient) return;
    this._queue.push({ action: 'delete', key });
    this._processQueue();
  },

  async _processQueue() {
    if (this._processing) return;
    this._processing = true;
    while (this._queue.length > 0) {
      const job = this._queue.shift();
      try {
        if (job.action === 'upsert') {
          await _sbClient.from('app_data').upsert(
            { key: job.key, value: job.val, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
          );
        } else if (job.action === 'delete') {
          await _sbClient.from('app_data').delete().eq('key', job.key);
        }
      } catch (e) { console.warn('CloudSync error:', e); }
    }
    this._processing = false;
  }
};

// ===== LOCAL STORAGE HELPERS (with Cloud Sync) =====
const LS = {
  get: (key, def = null) => {
    try { const v = localStorage.getItem('mdm_' + key); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set: (key, val) => {
    localStorage.setItem('mdm_' + key, JSON.stringify(val));
    CloudSync.save(key, val);
  },
  remove: (key) => {
    localStorage.removeItem('mdm_' + key);
    CloudSync.remove(key);
  }
};

// Current modal player
let currentModalPlayer = null;

const POSICOES_LIST = ['Goleiro','Zaga','Lateral','Volante','Meio-campo','Atacante'];

document.addEventListener('DOMContentLoaded', async () => {
  // Load cloud data first, then initialize UI
  await CloudSync.loadAll();
  loadCustomPlayers();
  initPWA();
  initNavbar();
  initHeroParticles();
  initHeroCounters();
  loadPlayerPhotos();
  loadPlayerStars();
  loadPlayerPositions();
  initPlayerCards();
  initModal();
  initStatsTabs();
  initStatsTables();
  initAwards();
  initMatchHistory();
  initMVP();
  initMensalidade();
  initTeamGenerator();
  initResenha();
  initAdmin();
});

// ===== CUSTOM PLAYER MANAGEMENT (ADD/RENAME/DELETE) =====
function loadCustomPlayers() {
  // Apply deletions
  const deleted = LS.get('deleted_players', []);
  deleted.forEach(key => {
    const idx = ELENCO.findIndex(p => normalizeName(p.nome) === key);
    if (idx !== -1) ELENCO.splice(idx, 1);
  });
  // Apply renames
  const renames = LS.get('renamed_players', {});
  Object.keys(renames).forEach(oldKey => {
    const player = ELENCO.find(p => normalizeName(p.nome) === oldKey);
    if (player) player.nome = renames[oldKey];
  });
  // Add custom players
  const custom = LS.get('custom_players', []);
  custom.forEach(cp => {
    if (!ELENCO.find(p => normalizeName(p.nome) === normalizeName(cp.nome))) {
      ELENCO.push(cp);
    }
  });
}

function getNextPlayerId() {
  return Math.max(...ELENCO.map(p => p.id), 0) + 1;
}

function addNewPlayer(nome, estrelas) {
  const newPlayer = { id: getNextPlayerId(), nome, estrelas: estrelas || 3, posicao: '', badges: [], posicoes: ['', '', ''] };
  ELENCO.push(newPlayer);
  const custom = LS.get('custom_players', []);
  custom.push(newPlayer);
  LS.set('custom_players', custom);
  rebuildAllUI();
}

function renamePlayer(oldName, newName) {
  const oldKey = normalizeName(oldName);
  const newKey = normalizeName(newName);
  const player = ELENCO.find(p => normalizeName(p.nome) === oldKey);
  if (!player) return;
  player.nome = newName;
  // Update localStorage renames
  const renames = LS.get('renamed_players', {});
  // Check if this was already a renamed player or a custom player
  const custom = LS.get('custom_players', []);
  const customIdx = custom.findIndex(p => normalizeName(p.nome) === oldKey);
  if (customIdx !== -1) {
    custom[customIdx].nome = newName;
    LS.set('custom_players', custom);
  } else {
    // Find original key (could be a rename chain)
    let originalKey = oldKey;
    for (const [oKey, oVal] of Object.entries(renames)) {
      if (normalizeName(oVal) === oldKey) { originalKey = oKey; break; }
    }
    delete renames[oldKey];
    renames[originalKey] = newName;
    LS.set('renamed_players', renames);
  }
  // Migrate localStorage data (photos, stars, positions)
  const photos = LS.get('photos', {});
  if (photos[oldKey]) { photos[newKey] = photos[oldKey]; delete photos[oldKey]; LS.set('photos', photos); window._playerPhotos = photos; }
  const stars = LS.get('stars', {});
  if (stars[oldKey]) { stars[newKey] = stars[oldKey]; delete stars[oldKey]; LS.set('stars', stars); }
  const positions = LS.get('positions', {});
  if (positions[oldKey]) { positions[newKey] = positions[oldKey]; delete positions[oldKey]; LS.set('positions', positions); }
  // Migrate match results (player lists, goals, mvps)
  migrateNameInMatches(oldName, newName);
  // Migrate MVP history
  migrateNameInMvpHistory(oldName, newName);
  // Migrate mensalidade data
  migrateNameInMensalidade(oldKey, newKey);
  rebuildAllUI();
}

function migrateNameInMatches(oldName, newName) {
  const matches = LS.get('match_results', []);
  let changed = false;
  const oldN = normalizeName(oldName);
  matches.forEach(m => {
    ['team1', 'team2'].forEach(t => {
      if (m[t].players) {
        const idx = m[t].players.findIndex(p => normalizeName(p) === oldN);
        if (idx !== -1) { m[t].players[idx] = newName; changed = true; }
      }
    });
    if (m.goals && m.goals[oldName] !== undefined) {
      m.goals[newName] = m.goals[oldName];
      delete m.goals[oldName];
      changed = true;
    }
    if (m.mvps) {
      const mvpIdx = m.mvps.findIndex(p => normalizeName(p) === oldN);
      if (mvpIdx !== -1) { m.mvps[mvpIdx] = newName; changed = true; }
    }
  });
  if (changed) LS.set('match_results', matches);
}

function migrateNameInMvpHistory(oldName, newName) {
  const history = LS.get('mvp_history', []);
  let changed = false;
  const oldN = normalizeName(oldName);
  history.forEach(h => {
    if (normalizeName(h.player) === oldN) { h.player = newName; changed = true; }
  });
  if (changed) LS.set('mvp_history', history);
}

function migrateNameInMensalidade(oldKey, newKey) {
  // Iterate all mensalidade keys in localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const lsKey = localStorage.key(i);
    if (lsKey && lsKey.startsWith('mdm_mensalidade_') && lsKey !== 'mdm_mensalidade_valor') {
      try {
        const data = JSON.parse(localStorage.getItem(lsKey));
        if (data && data[oldKey] !== undefined) {
          data[newKey] = data[oldKey];
          delete data[oldKey];
          localStorage.setItem(lsKey, JSON.stringify(data));
        }
      } catch(e) {}
    }
  }
}

function deletePlayer(nome) {
  const key = normalizeName(nome);
  const idx = ELENCO.findIndex(p => normalizeName(p.nome) === key);
  if (idx === -1) return;
  ELENCO.splice(idx, 1);
  // Check if it's a custom player or original
  const custom = LS.get('custom_players', []);
  const customIdx = custom.findIndex(p => normalizeName(p.nome) === key);
  if (customIdx !== -1) {
    custom.splice(customIdx, 1);
    LS.set('custom_players', custom);
  } else {
    const deleted = LS.get('deleted_players', []);
    // Also track original key if it was renamed
    const renames = LS.get('renamed_players', {});
    let originalKey = key;
    for (const [oKey, oVal] of Object.entries(renames)) {
      if (normalizeName(oVal) === key) { originalKey = oKey; delete renames[oKey]; break; }
    }
    LS.set('renamed_players', renames);
    deleted.push(originalKey);
    LS.set('deleted_players', deleted);
  }
  rebuildAllUI();
}

function rebuildAllUI() {
  initPlayerCards();
  // Rebuild team generator
  document.getElementById('genPlayerSelect').innerHTML = '';
  initTeamGenerator();
  // Rebuild match form
  initMatchForm();
  // Rebuild resenha dropdowns
  const sel1 = document.getElementById('resenhaPlayer1');
  const sel2 = document.getElementById('resenhaPlayer2');
  const v1 = sel1.value, v2 = sel2.value;
  sel1.innerHTML = '<option value="">Selecione...</option>';
  sel2.innerHTML = '<option value="">Selecione...</option>';
  const sorted = [...ELENCO].sort((a, b) => b.estrelas - a.estrelas || a.nome.localeCompare(b.nome));
  sorted.forEach(p => {
    [sel1, sel2].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = p.nome;
      opt.textContent = `${p.nome} ${'★'.repeat(p.estrelas)}`;
      sel.appendChild(opt);
    });
  });
  if (v1 && ELENCO.find(p => p.nome === v1)) sel1.value = v1;
  if (v2 && ELENCO.find(p => p.nome === v2)) sel2.value = v2;
  // Rebuild MVP select
  const mvpSelect = document.getElementById('mvpPlayerSelect');
  mvpSelect.innerHTML = '';
  ELENCO.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.nome; opt.textContent = p.nome;
    mvpSelect.appendChild(opt);
  });
  // Rebuild mensalidade
  renderMensalidade();
  renderMensalidadeAdmin();
  // Rebuild match history
  renderMatches();
  renderAdminMatchList();
  // Rebuild MVP
  renderMVP();
  renderAdminMvpList();
  // Rebuild admin players
  renderAdminPlayers();
  // Refresh stats
  initStatsTables();
}

// ===== PWA =====
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('pwaInstall');
    btn.style.display = 'flex';
    btn.addEventListener('click', () => {
      btn.style.display = 'none';
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
    });
  });
}

// ===== NAVBAR =====
function initNavbar() {
  const navbar = document.getElementById('navbar');
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 50));
  toggle.addEventListener('click', () => links.classList.toggle('active'));
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('active')));
}

// ===== HERO PARTICLES =====
function initHeroParticles() {
  const c = document.getElementById('heroParticles');
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'hero-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDelay = Math.random() * 6 + 's';
    p.style.animationDuration = (4 + Math.random() * 4) + 's';
    const s = 2 + Math.random() * 3;
    p.style.width = s + 'px'; p.style.height = s + 'px';
    if (Math.random() > 0.7) p.style.background = '#D4A017';
    c.appendChild(p);
  }
}

// ===== HERO COUNTERS =====
function initHeroCounters() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        animateCounter(el, parseInt(el.dataset.count));
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach(c => observer.observe(c));
}

function animateCounter(el, target) {
  const start = performance.now();
  (function update(now) {
    const p = Math.min((now - start) / 2000, 1);
    el.textContent = Math.round((1 - Math.pow(1 - p, 3)) * target);
    if (p < 1) requestAnimationFrame(update);
  })(start);
}

// ===== PLAYER PHOTOS =====
function loadPlayerPhotos() {
  window._playerPhotos = LS.get('photos', {});
}

function getPlayerPhoto(nome) {
  return window._playerPhotos[normalizeName(nome)] || null;
}

function savePlayerPhoto(nome, dataUrl) {
  window._playerPhotos[normalizeName(nome)] = dataUrl;
  LS.set('photos', window._playerPhotos);
}

// ===== PLAYER STARS (EDITABLE) =====
function loadPlayerStars() {
  const custom = LS.get('stars', {});
  Object.keys(custom).forEach(key => {
    const player = ELENCO.find(p => normalizeName(p.nome) === key);
    if (player) player.estrelas = custom[key];
  });
}

// ===== PLAYER POSITIONS =====
function loadPlayerPositions() {
  const custom = LS.get('positions', {});
  Object.keys(custom).forEach(key => {
    const player = ELENCO.find(p => normalizeName(p.nome) === key);
    if (player) player.posicoes = custom[key];
  });
  // Ensure all players have posicoes array
  ELENCO.forEach(p => {
    if (!p.posicoes || !Array.isArray(p.posicoes)) {
      p.posicoes = [p.posicao || '', '', ''];
    }
    while (p.posicoes.length < 3) p.posicoes.push('');
  });
}

function getPlayerPositions(nome) {
  const player = ELENCO.find(p => normalizeName(p.nome) === normalizeName(nome));
  return player ? (player.posicoes || []).filter(p => p) : [];
}

function getPosClass(pos) {
  const map = { 'Goleiro': 'goleiro', 'Zaga': 'zaga', 'Lateral': 'lateral', 'Volante': 'volante', 'Meio-campo': 'meio-campo', 'Atacante': 'atacante' };
  return map[pos] || '';
}

// ===== PLAYER CARDS =====
function initPlayerCards() {
  const grid = document.getElementById('playersGrid');
  grid.innerHTML = '';
  ELENCO.sort((a, b) => b.estrelas - a.estrelas || a.nome.localeCompare(b.nome));
  ELENCO.forEach(player => {
    const stats = getPlayerStats(player.nome);
    const photo = getPlayerPhoto(player.nome);
    const card = document.createElement('div');
    const isLeader = player.badges && player.badges.length > 0;
    card.className = `player-card${isLeader ? ' card-leader' : ''}`;
    card.dataset.stars = player.estrelas;
    card.dataset.playerName = player.nome;
    const playerPositions = getPlayerPositions(player.nome);
    const posBase = playerPositions.length > 0 ? playerPositions.join(',') : (player.posicao || '');
    card.dataset.position = posBase;
    const initials = player.nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarContent = photo
      ? `<img src="${photo}" alt="${player.nome}">`
      : `<span class="fut-initials">${initials}</span>`;
    const badgesHtml = player.badges.map(b => `<span class="card-badge">${BADGE_LABELS[b] || b}</span>`).join('');
    const positions = getPlayerPositions(player.nome);
    const posMain = positions.length > 0 ? positions[0] : (player.posicao || '');
    const posAbbr = { 'Goleiro':'GOL','Zaga':'ZAG','Lateral':'LAT','Volante':'VOL','Meio-campo':'MEI','Atacante':'ATA','Defensor':'DEF','Meia':'MEI','Meia/Atacante':'MEI','Meia/Defensor':'MEI' };
    const posTag = posAbbr[posMain] || posMain.substring(0,3).toUpperCase();
    card.innerHTML = `
      ${badgesHtml ? `<div class="card-badges">${badgesHtml}</div>` : ''}
      <div class="fut-card-inner">
        <div class="fut-card-top">
          <div class="fut-card-info">
            <span class="fut-card-pos">${posTag}</span>
          </div>
          <div class="fut-card-photo">${avatarContent}</div>
        </div>
        <div class="fut-card-bottom">
          <div class="fut-card-name">${player.nome}</div>
          <div class="fut-card-stats">
            <div class="fut-stat"><span class="fut-stat-val">${stats.golsTotal}</span><span class="fut-stat-lbl">GOL</span></div>
            <div class="fut-stat"><span class="fut-stat-val">${stats.vitoriasTotal}</span><span class="fut-stat-lbl">VIT</span></div>
            <div class="fut-stat"><span class="fut-stat-val">${stats.jogosTotal}</span><span class="fut-stat-lbl">JGS</span></div>
            ${stats.mvpTotal > 0 ? `<div class="fut-stat fut-stat-mvp"><span class="fut-stat-val">${stats.mvpTotal}</span><span class="fut-stat-lbl">MVP</span></div>` : ''}
          </div>
        </div>
      </div>`;
    card.addEventListener('click', () => openModal(player));
    grid.appendChild(card);
  });
  // Filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const f = btn.dataset.filter;
      const posMap = {
        'Goleiro': ['goleiro'],
        'Defensor': ['defensor', 'zaga', 'lateral', 'defesa'],
        'Meia': ['meia', 'volante', 'meio-campo', 'meio', 'meia/defensor', 'meia/atacante'],
        'Atacante': ['atacante']
      };
      document.querySelectorAll('.player-card').forEach(c => {
        if (f === 'all') { c.style.display = ''; return; }
        const pos = (c.dataset.position || '').toLowerCase();
        const terms = posMap[f] || [f.toLowerCase()];
        const match = terms.some(t => pos.includes(t));
        c.style.display = match ? '' : 'none';
      });
    });
  });
}

function renderStars(count) {
  return Array.from({ length: 5 }, (_, i) => `<span class="star ${i < count ? 'filled' : 'empty'}">★</span>`).join('');
}

function getPlayerStats(nome) {
  const find = (arr, n) => arr.find(p => normalizeName(p.nome) === normalizeName(n));
  const pc26 = find(PLAYERS_DATABASE.pontosCorridos2026, nome);
  const a26 = find(PLAYERS_DATABASE.artilharia2026, nome);

  // Aggregate from registered match results
  const matchStats = getMatchStatsForPlayer(nome);

  // MVP/Destaques
  const d26 = find(PLAYERS_DATABASE.destaques2026, nome);
  const baseMvp = d26 ? d26.destaques : 0;
  const totalMvp = baseMvp + matchStats.mvps;

  return {
    gols2026: (a26 ? a26.gols : 0) + matchStats.gols, pontos2026: pc26 ? pc26.pts : 0,
    apr2026: pc26 ? pc26.apr : 0, v2026: (pc26 ? pc26.v : 0) + matchStats.vitorias,
    e2026: pc26 ? pc26.e : 0, d2026: pc26 ? pc26.d : 0, pd2026: (pc26 ? pc26.pd : 0) + matchStats.jogos,
    golsTotal: (a26 ? a26.gols : 0) + matchStats.gols,
    vitoriasTotal: (pc26 ? pc26.v : 0) + matchStats.vitorias,
    jogosTotal: (pc26 ? pc26.pd : 0) + matchStats.jogos,
    mvpTotal: totalMvp,
    matchGols: matchStats.gols,
    matchVitorias: matchStats.vitorias,
    matchJogos: matchStats.jogos,
    matchEmpates: matchStats.empates,
    matchDerrotas: matchStats.derrotas,
  };
}

function getMatchStatsForPlayer(nome) {
  const matches = LS.get('match_results', []);
  const nName = normalizeName(nome);
  let gols = 0, vitorias = 0, derrotas = 0, empates = 0, jogos = 0, mvps = 0;
  matches.forEach(m => {
    const inTeam1 = (m.team1.players || []).some(p => normalizeName(p) === nName);
    const inTeam2 = (m.team2.players || []).some(p => normalizeName(p) === nName);
    if (!inTeam1 && !inTeam2) return;
    jogos++;
    // Count goals
    const playerGoals = (m.goals || {})[nome] || 0;
    gols += playerGoals;
    // Count MVPs
    const matchMvps = m.mvps || [];
    if (matchMvps.some(mv => normalizeName(mv) === nName)) mvps++;
    // Determine result
    const s1 = m.team1.score, s2 = m.team2.score;
    if (inTeam1) {
      if (s1 > s2) vitorias++;
      else if (s1 < s2) derrotas++;
      else empates++;
    } else {
      if (s2 > s1) vitorias++;
      else if (s2 < s1) derrotas++;
      else empates++;
    }
  });
  return { gols, vitorias, derrotas, empates, jogos, mvps };
}

function normalizeName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ===== MODAL =====
function initModal() {
  const overlay = document.getElementById('playerModal');
  document.getElementById('modalClose').addEventListener('click', () => overlay.classList.remove('active'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('active'); });
}

function openModal(player) {
  currentModalPlayer = player;
  const overlay = document.getElementById('playerModal');
  const stats = getPlayerStats(player.nome);
  const photo = getPlayerPhoto(player.nome);
  const initials = player.nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('modalAvatar').innerHTML = photo ? `<img src="${photo}" alt="">` : `<span style="font-size:1.8rem;font-family:'Oswald',sans-serif">${initials}</span>`;
  document.getElementById('modalName').textContent = player.nome;
  document.getElementById('modalStars').innerHTML = '';
  const badgeEl = document.getElementById('modalBadge');
  if (player.badges.length > 0) { badgeEl.textContent = BADGE_LABELS[player.badges[0]] || ''; badgeEl.style.display = ''; }
  else badgeEl.style.display = 'none';
  document.getElementById('modalGols2026').textContent = stats.gols2026;
  document.getElementById('modalPontos2026').textContent = stats.pontos2026;
  document.getElementById('modalMvp').textContent = stats.mvpTotal;

  // Evolution Chart (year-over-year)
  const evoChart = document.getElementById('modalEvolutionChart');
  evoChart.innerHTML = '';
  const evoData = [
    { label: '2026', value: stats.gols2026, color: 'var(--red-bright)' },
  ];
  const evoMax = Math.max(...evoData.map(d => d.value), 1);
  evoData.forEach(d => {
    const group = document.createElement('div');
    group.className = 'evo-bar-group';
    const h = (d.value / evoMax) * 80;
    group.innerHTML = `
      <div class="evo-bar" style="height:${Math.max(h, 4)}px"><span class="evo-value">${d.value}</span></div>
      <span class="evo-label">${d.label}</span>`;
    evoChart.appendChild(group);
  });

  // Monthly Chart
  const chartContainer = document.getElementById('modalChart');
  chartContainer.innerHTML = '';
  const meses = stats.gols2024Meses.length > 0 ? stats.gols2024Meses : stats.gols2025Meses;
  const labels = stats.gols2024Meses.length > 0 ? MESES : MESES.slice(0, 7);
  document.getElementById('modalChartTitle').textContent = stats.gols2024Meses.length > 0 ? 'Desempenho Mensal — Gols 2024' : stats.gols2025Meses.length > 0 ? 'Desempenho Mensal — Gols 2025' : 'Desempenho Mensal';
  if (meses.length > 0) {
    const maxVal = Math.max(...meses, 1);
    meses.forEach((val, i) => {
      const w = document.createElement('div');
      w.className = 'chart-bar-wrapper';
      w.innerHTML = `<span class="chart-bar-value">${val}</span><div class="chart-bar" style="height:${Math.max((val / maxVal) * 100, 2)}%"></div><span class="chart-bar-label">${labels[i]}</span>`;
      chartContainer.appendChild(w);
    });
  }
  // Positions
  const posContainer = document.getElementById('modalPositions');
  const positions = getPlayerPositions(player.nome);
  if (positions.length > 0) {
    posContainer.innerHTML = positions.map(p => `<span class="modal-pos-tag ${getPosClass(p)}">${p}</span>`).join('');
    posContainer.style.display = '';
  } else {
    posContainer.style.display = 'none';
  }

  overlay.classList.add('active');
}

// ===== STATS TABS =====
function initStatsTabs() {
  document.querySelectorAll('.stats-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.stats-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });
}

// ===== STATS TABLES =====
function updateSeasonHero() {
  const art = PLAYERS_DATABASE.artilharia2026 || [];
  const pc = PLAYERS_DATABASE.pontosCorridos2026 || [];
  const totalGols = art.reduce((s, p) => s + p.gols, 0);
  const matchResults = LS.get('match_results', []);
  const matchGols = matchResults.reduce((s, m) => s + Object.values(m.goals || {}).reduce((a, b) => a + b, 0), 0);
  const totalPartidas = Math.max(...pc.map(p => p.pd), 0) + matchResults.length;
  const jogadores = pc.filter(p => p.pd > 0).length;
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('seasonTotalGols', totalGols + matchGols);
  el('seasonTotalJogos', totalPartidas);
  el('seasonTotalJogadores', jogadores || ELENCO.length);
}

function initStatsTables() {
  updateSeasonHero();
  fillTable('tablePC2026', PLAYERS_DATABASE.pontosCorridos2026.filter(p => p.pd > 0), (p, i) => `
    <td><span class="pos-badge pos-${i <= 2 ? i + 1 : ''}">${i + 1}</span></td><td>${p.nome}</td>
    <td>${p.v}</td><td>${p.e}</td><td>${p.d}</td>
    <td style="font-weight:700;color:var(--text-primary)">${p.pts}</td><td>${p.pd}</td><td>${p.apr.toFixed(1)}%</td>`);
  fillTable('tableArt2026', PLAYERS_DATABASE.artilharia2026.filter(p => p.gols > 0), (p, i) => `
    <td><span class="pos-badge pos-${i <= 2 ? i + 1 : ''}">${i + 1}</span></td><td>${p.nome}</td>
    <td>${p.pd}</td><td style="font-weight:700;color:var(--red-bright)">${p.gols}</td>
    <td>${p.meses[0]}</td><td>${p.meses[1]}</td><td>${p.meses[2]}</td>`);

  // MVP Ranking 2026 (base data + match results)
  const mvpData = buildMvpRanking();
  fillTable('tableMvp2026', mvpData.filter(p => p.mvps > 0), (p, i) => `
    <td><span class="pos-badge pos-${i <= 2 ? i + 1 : ''}">${i + 1}</span></td><td>${p.nome}</td>
    <td>${p.pd}</td><td style="font-weight:700;color:var(--gold)">${p.mvps}</td>
    <td>${p.pd > 0 ? ((p.mvps / p.pd) * 100).toFixed(0) + '%' : '—'}</td>`);
}

function fillTable(tableId, data, rowRenderer) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  tbody.innerHTML = '';
  data.forEach((item, i) => { const tr = document.createElement('tr'); tr.innerHTML = rowRenderer(item, i); tbody.appendChild(tr); });
}

function buildMvpRanking() {
  // Combine base destaques with match results
  const mvpMap = {};
  const pdMap = {};

  // Base data from spreadsheet
  (PLAYERS_DATABASE.destaques2026 || []).forEach(p => {
    const key = p.nome;
    mvpMap[key] = (mvpMap[key] || 0) + p.destaques;
    pdMap[key] = (pdMap[key] || 0) + p.pd;
  });

  // Match results MVPs
  const matches = LS.get('match_results', []);
  matches.forEach(m => {
    const allPlayers = [...(m.team1.players || []), ...(m.team2.players || [])];
    allPlayers.forEach(p => { pdMap[p] = (pdMap[p] || 0); }); // ensure they exist in pd
    (m.mvps || []).forEach(mvpName => {
      if (mvpName) {
        mvpMap[mvpName] = (mvpMap[mvpName] || 0) + 1;
      }
    });
    // Add match games to pd count for all players
    allPlayers.forEach(p => { pdMap[p] = (pdMap[p] || 0); });
  });

  // Build array
  const result = [];
  const allNames = new Set([...Object.keys(mvpMap), ...Object.keys(pdMap)]);
  allNames.forEach(nome => {
    const stats = getPlayerStats(nome);
    result.push({ nome, mvps: mvpMap[nome] || 0, pd: stats.pd2026 || pdMap[nome] || 0 });
  });

  return result.sort((a, b) => b.mvps - a.mvps || a.nome.localeCompare(b.nome));
}

// ===== PREMIAÇÕES =====
function initAwards() {
  const grid = document.getElementById('awardsGrid');
  const awards = [
    { icon: '⚽', title: 'Artilheiro', player: 'Douglas Almeida', detail: '18 gols em 11 jogos', season: '2026', year: 'y2026' },
    { icon: '👑', title: 'Líder Pontos Corridos', player: 'Bruninho', detail: '24 pontos · 66.7%', season: '2026', year: 'y2026' },
    { icon: '📈', title: 'Maior Aproveitamento', player: 'Marcos Vinícius', detail: '72.2% · 6 jogos', season: '2026', year: 'y2026' },
    { icon: '🎯', title: 'Artilheiro do Mês', player: 'Douglas Almeida', detail: '11 gols em Março', season: '2026', year: 'y2026' },
    { icon: '💥', title: 'Destaque Ofensivo', player: 'Diogo Gabriel', detail: '13 gols (8 em Mar)', season: '2026', year: 'y2026' },
  ];
  awards.forEach(a => {
    const card = document.createElement('div');
    card.className = 'award-card';
    card.innerHTML = `
      <div class="award-year ${a.year}"></div>
      <div class="award-icon">${a.icon}</div>
      <div class="award-title">${a.title}</div>
      <div class="award-player">${a.player}</div>
      <div class="award-detail">${a.detail}</div>
      <span class="award-season">${a.season}</span>`;
    grid.appendChild(card);
  });
}

// ===== MATCH HISTORY =====
function initMatchHistory() {
  renderMatches();
}

function renderMatches() {
  const list = document.getElementById('matchList');
  const summaryEl = document.getElementById('matchStatsSummary');
  const matchResults = LS.get('match_results', []);

  if (matchResults.length === 0) {
    list.innerHTML = '<div class="empty-state"><i class="fas fa-futbol"></i><p>Nenhum confronto registrado ainda.</p><p class="empty-hint">Use o Painel Admin para adicionar resultados.</p></div>';
    if (summaryEl) summaryEl.innerHTML = '';
    return;
  }

  // Summary stats
  let totalGols = 0, totalPartidas = matchResults.length;
  const artilheiros = {};
  matchResults.forEach(m => {
    totalGols += m.team1.score + m.team2.score;
    Object.entries(m.goals || {}).forEach(([name, g]) => { artilheiros[name] = (artilheiros[name] || 0) + g; });
  });
  const topScorer = Object.entries(artilheiros).sort((a, b) => b[1] - a[1])[0];
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="match-stat-card"><div class="match-stat-value">${totalPartidas}</div><div class="match-stat-label">Partidas</div></div>
      <div class="match-stat-card"><div class="match-stat-value">${totalGols}</div><div class="match-stat-label">Gols Totais</div></div>
      <div class="match-stat-card"><div class="match-stat-value">${totalPartidas > 0 ? (totalGols / totalPartidas).toFixed(1) : 0}</div><div class="match-stat-label">Gols/Partida</div></div>
      ${topScorer ? `<div class="match-stat-card"><div class="match-stat-value" style="font-size:1.2rem">${topScorer[0]}</div><div class="match-stat-label">Artilheiro (${topScorer[1]} gols)</div></div>` : ''}`;
  }

  const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  list.innerHTML = '';
  matchResults.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(m => {
    const d = new Date(m.date + 'T12:00:00');
    const t1Name = m.team1.name || m.team1;
    const t2Name = m.team2.name || m.team2;
    const s1 = typeof m.team1.score === 'number' ? m.team1.score : m.score1;
    const s2 = typeof m.team2.score === 'number' ? m.team2.score : m.score2;
    const hasDetail = (m.team1.players && m.team1.players.length > 0) || (m.team2.players && m.team2.players.length > 0);

    const card = document.createElement('div');
    card.className = 'match-card-enhanced';

    // Goal scorers
    const scorers = Object.entries(m.goals || {}).filter(([, g]) => g > 0);
    const matchMvps = m.mvps || [];
    const mvpsHtml = matchMvps.length > 0 ? `
      <div class="match-card-scorers" style="border-top:none;padding-top:0">
        <div class="match-card-scorers-title">🏆 MVP</div>
        ${matchMvps.map(name => `<div class="match-card-scorer" style="color:var(--gold)">${name}</div>`).join('')}
      </div>` : '';
    const scorersHtml = scorers.length > 0 ? `
      <div class="match-card-scorers">
        <div class="match-card-scorers-title">⚽ Gols</div>
        ${scorers.map(([name, g]) => `<div class="match-card-scorer">${name} ${g > 1 ? `(${g})` : ''}</div>`).join('')}
      </div>` : '';

    // Rosters
    const team1Players = (m.team1.players || []).map(p => {
      const g = (m.goals || {})[p] || 0;
      return `<div class="match-roster-player"><span>${p}</span>${g > 0 ? `<span class="goal-balls">${'⚽'.repeat(g)}</span>` : ''}</div>`;
    }).join('');
    const team2Players = (m.team2.players || []).map(p => {
      const g = (m.goals || {})[p] || 0;
      return `<div class="match-roster-player"><span>${p}</span>${g > 0 ? `<span class="goal-balls">${'⚽'.repeat(g)}</span>` : ''}</div>`;
    }).join('');

    card.innerHTML = `
      <div class="match-card-top">
        <div class="match-date-badge"><div class="match-date-day">${d.getDate()}</div><div class="match-date-month">${monthNames[d.getMonth()]}</div></div>
        <div class="match-teams">
          <span class="match-team-name">${t1Name}</span>
          <span class="match-score">${s1} x ${s2}</span>
          <span class="match-team-name">${t2Name}</span>
        </div>
      </div>
      ${hasDetail ? `
        <div class="match-card-toggle"><i class="fas fa-chevron-down"></i> Detalhes</div>
        <div class="match-card-detail">
          <div class="match-card-rosters">
            <div class="match-roster"><div class="match-roster-title team1-color">${t1Name}</div>${team1Players}</div>
            <div class="match-roster"><div class="match-roster-title team2-color">${t2Name}</div>${team2Players}</div>
          </div>
          ${mvpsHtml}
          ${scorersHtml}
        </div>` : ''}`;

    if (hasDetail) {
      card.querySelector('.match-card-toggle').addEventListener('click', () => card.classList.toggle('open'));
      card.querySelector('.match-card-top').addEventListener('click', () => card.classList.toggle('open'));
    }

    list.appendChild(card);
  });
}

// ===== AGENDA =====
// ===== MVP =====
function initMVP() {
  renderMVP();
}

function renderMVP() {
  const current = document.getElementById('mvpCurrent');
  const historyList = document.getElementById('mvpHistoryList');
  const votingActive = LS.get('mvp_voting', false);
  const votes = LS.get('mvp_votes', {});
  const myVote = LS.get('mvp_my_vote', null);

  if (votingActive) {
    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    current.innerHTML = `
      <h3 style="font-family:'Oswald';letter-spacing:2px;margin-bottom:16px;text-align:center">VOTE NO MVP</h3>
      <div class="mvp-vote-grid">
        ${ELENCO.map(p => {
          const voteCount = votes[p.nome] || 0;
          const isVoted = myVote === p.nome;
          return `<div class="mvp-vote-card ${isVoted ? 'voted' : ''}" onclick="voteMVP('${p.nome.replace(/'/g, "\\'")}')">
            <div style="font-size:1.5rem">${isVoted ? '⭐' : '⚽'}</div>
            <div class="mvp-vote-name">${p.nome}</div>
            <div class="mvp-vote-count">${voteCount} voto(s)</div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    current.innerHTML = '<div class="empty-state"><i class="fas fa-vote-yea"></i><p>Nenhuma votação ativa.</p><p class="empty-hint">Inicie uma votação pelo Painel Admin.</p></div>';
  }

  // History
  const mvpHistory = LS.get('mvp_history', []);
  if (mvpHistory.length > 0) {
    historyList.innerHTML = '';
    mvpHistory.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(m => {
      const div = document.createElement('div');
      div.className = 'mvp-winner-card';
      div.innerHTML = `<div class="mvp-winner-icon">🏅</div><div class="mvp-winner-info"><h4>${m.player}</h4><p>${m.date}</p></div>`;
      historyList.appendChild(div);
    });
  }
}

window.voteMVP = function(nome) {
  const myVote = LS.get('mvp_my_vote', null);
  const votes = LS.get('mvp_votes', {});
  if (myVote) { votes[myVote] = Math.max(0, (votes[myVote] || 0) - 1); }
  if (myVote === nome) { LS.remove('mvp_my_vote'); }
  else { votes[nome] = (votes[nome] || 0) + 1; LS.set('mvp_my_vote', nome); }
  LS.set('mvp_votes', votes);
  renderMVP();
};

// ===== MENSALIDADE =====
// ===== MENSALIDADE =====
let mensViewMonth, mensViewYear;

function initMensalidade() {
  const now = new Date();
  mensViewMonth = now.getMonth(); // 0-based
  mensViewYear = now.getFullYear();
  document.getElementById('mensPrev').addEventListener('click', () => {
    mensViewMonth--;
    if (mensViewMonth < 0) { mensViewMonth = 11; mensViewYear--; }
    renderMensalidade();
  });
  document.getElementById('mensNext').addEventListener('click', () => {
    mensViewMonth++;
    if (mensViewMonth > 11) { mensViewMonth = 0; mensViewYear++; }
    renderMensalidade();
  });
  renderMensalidade();
}

function renderMensalidade() {
  const grid = document.getElementById('mensalidadeGrid');
  const summary = document.getElementById('mensalidadeSummary');
  const deadlineBar = document.getElementById('mensDeadlineBar');
  const atrasadosSection = document.getElementById('mensAtrasadosSection');
  const monthDisplay = document.getElementById('mensMonthDisplay');
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const mesKey = `${mensViewYear}-${String(mensViewMonth + 1).padStart(2, '0')}`;
  const data = LS.get('mensalidade_' + mesKey, {});
  const valor = LS.get('mensalidade_valor', 50);
  const now = new Date();
  const isCurrentMonth = mensViewMonth === now.getMonth() && mensViewYear === now.getFullYear();
  const isPastMonth = new Date(mensViewYear, mensViewMonth + 1, 0) < new Date(now.getFullYear(), now.getMonth(), 1);

  // Month display
  monthDisplay.innerHTML = `<span class="mens-month-name">${monthNames[mensViewMonth]}</span><span class="mens-month-year">${mensViewYear}</span>`;
  if (isCurrentMonth) monthDisplay.innerHTML += '<span class="mens-month-current">MÊS ATUAL</span>';

  // Count statuses
  let pagos = 0, pendentes = 0, atrasados = 0;
  const atrasadosList = [];
  ELENCO.forEach(p => {
    const key = normalizeName(p.nome);
    let status = data[key] || 'pendente';
    // Auto-mark as atrasado if past month and still pendente
    if (isPastMonth && status === 'pendente') status = 'atrasado';
    if (status === 'pago') pagos++;
    else if (status === 'atrasado') { atrasados++; atrasadosList.push(p.nome); }
    else pendentes++;
  });

  const total = ELENCO.length;
  const percentPago = total > 0 ? Math.round((pagos / total) * 100) : 0;

  // Summary cards
  summary.innerHTML = `
    <div class="mensalidade-summary-card mens-card-pagos">
      <div class="mensalidade-summary-icon"><i class="fas fa-check-circle"></i></div>
      <div class="mensalidade-summary-value" style="color:var(--green)">${pagos}</div>
      <div class="mensalidade-summary-label">Pagos</div>
      <div class="mens-progress-bar"><div class="mens-progress-fill mens-fill-green" style="width:${percentPago}%"></div></div>
      <div class="mens-progress-text">${percentPago}%</div>
    </div>
    <div class="mensalidade-summary-card mens-card-pendentes">
      <div class="mensalidade-summary-icon"><i class="fas fa-clock"></i></div>
      <div class="mensalidade-summary-value" style="color:var(--orange)">${pendentes}</div>
      <div class="mensalidade-summary-label">Pendentes</div>
    </div>
    <div class="mensalidade-summary-card mens-card-atrasados ${atrasados > 0 ? 'mens-has-atrasados' : ''}">
      <div class="mensalidade-summary-icon"><i class="fas fa-exclamation-triangle"></i></div>
      <div class="mensalidade-summary-value" style="color:var(--red-bright)">${atrasados}</div>
      <div class="mensalidade-summary-label">Atrasados</div>
    </div>
    <div class="mensalidade-summary-card">
      <div class="mensalidade-summary-icon"><i class="fas fa-coins"></i></div>
      <div class="mensalidade-summary-value" style="color:var(--gold)">R$${valor}</div>
      <div class="mensalidade-summary-label">Valor Mensal</div>
    </div>`;

  // Deadline bar
  if (isCurrentMonth) {
    const daysLeft = 30 - now.getDate();
    if (daysLeft > 0) {
      deadlineBar.innerHTML = `<i class="fas fa-calendar-day"></i> Vencimento em <strong>${daysLeft} dia${daysLeft > 1 ? 's' : ''}</strong> (dia 30/${String(mensViewMonth + 1).padStart(2, '0')})`;
      deadlineBar.className = 'mens-deadline-bar mens-deadline-active';
    } else if (daysLeft === 0) {
      deadlineBar.innerHTML = `<i class="fas fa-exclamation-circle"></i> <strong>VENCE HOJE!</strong> dia 30/${String(mensViewMonth + 1).padStart(2, '0')}`;
      deadlineBar.className = 'mens-deadline-bar mens-deadline-today';
    } else {
      deadlineBar.innerHTML = `<i class="fas fa-exclamation-triangle"></i> Vencimento <strong>expirado</strong> em ${Math.abs(daysLeft)} dia${Math.abs(daysLeft) > 1 ? 's' : ''}`;
      deadlineBar.className = 'mens-deadline-bar mens-deadline-expired';
    }
  } else if (isPastMonth) {
    deadlineBar.innerHTML = `<i class="fas fa-history"></i> Mês encerrado — vencimento foi em 30/${String(mensViewMonth + 1).padStart(2, '0')}/${mensViewYear}`;
    deadlineBar.className = 'mens-deadline-bar mens-deadline-past';
  } else {
    deadlineBar.innerHTML = `<i class="fas fa-calendar"></i> Vencimento: 30/${String(mensViewMonth + 1).padStart(2, '0')}/${mensViewYear}`;
    deadlineBar.className = 'mens-deadline-bar mens-deadline-future';
  }

  // Atrasados highlight section
  if (atrasados > 0) {
    atrasadosSection.innerHTML = `
      <div class="mens-atrasados-card">
        <div class="mens-atrasados-header"><i class="fas fa-exclamation-triangle"></i> ${atrasados} JOGADOR${atrasados > 1 ? 'ES' : ''} COM MENSALIDADE ATRASADA</div>
        <div class="mens-atrasados-list">${atrasadosList.map(n => `<span class="mens-atrasado-name"><i class="fas fa-user"></i> ${n}</span>`).join('')}</div>
        <div class="mens-atrasados-total">Total em aberto: <strong>R$${(atrasados * valor).toFixed(2).replace('.', ',')}</strong></div>
      </div>`;
  } else {
    atrasadosSection.innerHTML = '';
  }

  // Grid
  grid.innerHTML = '';
  const sorted = [...ELENCO].sort((a, b) => {
    const sa = data[normalizeName(a.nome)] || (isPastMonth ? 'atrasado' : 'pendente');
    const sb = data[normalizeName(b.nome)] || (isPastMonth ? 'atrasado' : 'pendente');
    const order = { atrasado: 0, pendente: 1, pago: 2 };
    return (order[sa] ?? 1) - (order[sb] ?? 1) || a.nome.localeCompare(b.nome);
  });
  sorted.forEach(p => {
    let status = data[normalizeName(p.nome)] || 'pendente';
    if (isPastMonth && status === 'pendente') status = 'atrasado';
    const statusLabel = status === 'pago' ? '✓ Pago' : status === 'atrasado' ? '✗ Atrasado' : '● Pendente';
    const statusIcon = status === 'pago' ? 'check-circle' : status === 'atrasado' ? 'times-circle' : 'clock';
    const item = document.createElement('div');
    item.className = `mensalidade-item mens-item-${status}`;
    item.innerHTML = `
      <div class="mensalidade-name"><i class="fas fa-${statusIcon} mens-status-icon mens-icon-${status}"></i>${p.nome}</div>
      <span class="mensalidade-status ${status}">${statusLabel}</span>`;
    grid.appendChild(item);
  });
}

// ===== RESENHA / COMPARAÇÃO =====
function initResenha() {
  const sel1 = document.getElementById('resenhaPlayer1');
  const sel2 = document.getElementById('resenhaPlayer2');
  const sorted = [...ELENCO].sort((a, b) => b.estrelas - a.estrelas || a.nome.localeCompare(b.nome));
  sorted.forEach(p => {
    [sel1, sel2].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = p.nome;
      opt.textContent = `${p.nome} ${'★'.repeat(p.estrelas)}`;
      sel.appendChild(opt);
    });
  });
  const update = () => {
    if (sel1.value && sel2.value && sel1.value !== sel2.value) renderComparison(sel1.value, sel2.value);
    else if (sel1.value && sel2.value && sel1.value === sel2.value) {
      document.getElementById('resenhaResult').innerHTML = '<div class="resenha-empty"><i class="fas fa-exclamation-triangle"></i><p>Selecione dois jogadores diferentes!</p></div>';
    }
  };
  sel1.addEventListener('change', update);
  sel2.addEventListener('change', update);
}

function renderComparison(name1, name2) {
  const container = document.getElementById('resenhaResult');
  const p1 = ELENCO.find(p => p.nome === name1);
  const p2 = ELENCO.find(p => p.nome === name2);
  if (!p1 || !p2) return;

  const s1 = getPlayerStats(name1);
  const s2 = getPlayerStats(name2);
  const photo1 = getPlayerPhoto(name1);
  const photo2 = getPlayerPhoto(name2);
  const pos1 = getPlayerPositions(name1);
  const pos2 = getPlayerPositions(name2);
  const initials1 = name1.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  const initials2 = name2.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  // Define comparison stats
  const stats = [
    { label: 'Gols 2026', icon: 'fa-futbol', v1: s1.gols2026, v2: s2.gols2026, higher: true },
    { label: 'Pontos 2026', icon: 'fa-chart-line', v1: s1.pontos2026, v2: s2.pontos2026, higher: true },
    { label: 'MVP', icon: 'fa-medal', v1: s1.mvpTotal, v2: s2.mvpTotal, higher: true },
    { label: 'Gols Total', icon: 'fa-futbol', v1: s1.golsTotal, v2: s2.golsTotal, higher: true },
    { label: 'Vitórias Total', icon: 'fa-trophy', v1: s1.vitoriasTotal, v2: s2.vitoriasTotal, higher: true },
    { label: 'Jogos Total', icon: 'fa-calendar-check', v1: s1.jogosTotal, v2: s2.jogosTotal, higher: true },
  ];

  // Count wins
  let wins1 = 0, wins2 = 0;
  stats.forEach(s => {
    if (s.v1 > s.v2) wins1++;
    else if (s.v2 > s.v1) wins2++;
  });

  // Build stat rows HTML
  const rowsHtml = stats.map(s => {
    const max = Math.max(s.v1, s.v2, 1);
    const w1 = s.higher ? (s.v1 > s.v2 ? 'winner' : s.v1 < s.v2 ? 'loser' : 'draw') : 'draw';
    const w2 = s.higher ? (s.v2 > s.v1 ? 'winner' : s.v2 < s.v1 ? 'loser' : 'draw') : 'draw';
    const bar1 = (s.v1 / max) * 100;
    const bar2 = (s.v2 / max) * 100;
    return `
      <div class="compare-stat-row">
        <div class="compare-stat-value left ${w1}">
          <div>${s.v1}</div>
          <div style="padding:0 16px"><div class="compare-stat-bar left" style="width:${bar1}%"></div></div>
        </div>
        <div class="compare-stat-label"><i class="fas ${s.icon}"></i> ${s.label}</div>
        <div class="compare-stat-value right ${w2}">
          <div>${s.v2}</div>
          <div style="padding:0 16px"><div class="compare-stat-bar right" style="width:${bar2}%"></div></div>
        </div>
      </div>`;
  }).join('');

  // Score summary
  const scoreW1 = wins1 > wins2 ? 'winner' : wins1 < wins2 ? 'loser' : 'draw';
  const scoreW2 = wins2 > wins1 ? 'winner' : wins2 < wins1 ? 'loser' : 'draw';
  const crownHtml = wins1 !== wins2 ? '<span class="compare-crown">👑</span>' : '';

  // Evolution chart (goals by year)
  const evoYears = [
    { label: '2026', v1: s1.gols2026, v2: s2.gols2026 },
  ];
  const evoMax = Math.max(...evoYears.flatMap(y => [y.v1, y.v2]), 1);
  const evoHtml = evoYears.map(y => {
    const h1 = Math.max((y.v1 / evoMax) * 70, 4);
    const h2 = Math.max((y.v2 / evoMax) * 70, 4);
    return `<div class="compare-evo-year">
      <div class="compare-evo-bars">
        <div class="compare-evo-bar p1" style="height:${h1}px"><span class="compare-evo-bar-val" style="color:var(--red-bright)">${y.v1}</span></div>
        <div class="compare-evo-bar p2" style="height:${h2}px"><span class="compare-evo-bar-val" style="color:var(--blue)">${y.v2}</span></div>
      </div>
      <span class="compare-evo-label">${y.label}</span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="compare-card">
      <div class="compare-header">
        <div class="compare-player-header left">
          <div class="compare-avatar">${photo1 ? `<img src="${photo1}" alt="">` : initials1}</div>
          <div class="compare-name">${name1}</div>
          <div class="compare-pos">${pos1.length > 0 ? pos1.join(' · ') : p1.posicao}</div>
        </div>
        <div class="compare-vs-divider"><div class="compare-vs-badge">VS</div></div>
        <div class="compare-player-header right">
          <div class="compare-avatar">${photo2 ? `<img src="${photo2}" alt="">` : initials2}</div>
          <div class="compare-name">${name2}</div>
          <div class="compare-pos">${pos2.length > 0 ? pos2.join(' · ') : p2.posicao}</div>
        </div>
      </div>
      <div class="compare-stats">${rowsHtml}</div>
      <div class="compare-score-row">
        <div class="compare-score-val ${scoreW1}">${wins1 > wins2 ? crownHtml : ''}${wins1}</div>
        <div class="compare-score-label">PLACAR<br>FINAL</div>
        <div class="compare-score-val ${scoreW2}">${wins2 > wins1 ? crownHtml : ''}${wins2}</div>
      </div>
      <div class="compare-evo">
        <div class="compare-evo-title"><i class="fas fa-chart-bar"></i> Evolução de Gols por Temporada</div>
        <div class="compare-evo-chart">
          <div style="display:flex;align-items:center;gap:8px;margin-right:12px">
            <div style="width:10px;height:10px;background:var(--red-bright);border-radius:2px"></div>
            <span style="font-size:0.65rem;color:var(--text-muted)">${name1.split(' ')[0]}</span>
          </div>
          ${evoHtml}
          <div style="display:flex;align-items:center;gap:8px;margin-left:12px">
            <div style="width:10px;height:10px;background:var(--blue);border-radius:2px"></div>
            <span style="font-size:0.65rem;color:var(--text-muted)">${name2.split(' ')[0]}</span>
          </div>
        </div>
      </div>
    </div>`;
}

// ===== TEAM GENERATOR =====
function initTeamGenerator() {
  const selectContainer = document.getElementById('genPlayerSelect');
  const sorted = [...ELENCO].sort((a, b) => b.estrelas - a.estrelas || a.nome.localeCompare(b.nome));
  sorted.forEach(player => {
    const positions = getPlayerPositions(player.nome);
    const posDots = positions.map(p => `<span class="gen-pos-dot ${getPosClass(p)}" title="${p}"></span>`).join('');
    const label = document.createElement('label');
    label.className = 'gen-player-check';
    label.innerHTML = `
      <input type="checkbox" value="${player.id}" data-stars="${player.estrelas}" data-name="${player.nome}" data-positions="${positions.join(',')}">
      <div class="gen-check-box"></div>
      <span class="gen-player-name">${player.nome}</span>
      <span class="gen-player-pos">${posDots}</span>
      <span class="gen-player-stars">${'★'.repeat(player.estrelas)}${'☆'.repeat(5 - player.estrelas)}</span>`;
    label.querySelector('input').addEventListener('change', function () { label.classList.toggle('selected', this.checked); });
    selectContainer.appendChild(label);
  });
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    selectContainer.querySelectorAll('input').forEach(cb => { cb.checked = true; cb.closest('.gen-player-check').classList.add('selected'); });
  });
  document.getElementById('btnClear').addEventListener('click', () => {
    selectContainer.querySelectorAll('input').forEach(cb => { cb.checked = false; cb.closest('.gen-player-check').classList.remove('selected'); });
    document.getElementById('genResults').innerHTML = '';
    document.getElementById('btnShareTeams').style.display = 'none';
  });
  document.getElementById('btnGenerate').addEventListener('click', generateTeams);
  document.getElementById('btnShareTeams').addEventListener('click', shareTeamsWhatsApp);
}

function generateTeams() {
  const resultsContainer = document.getElementById('genResults');
  const perTeam = parseInt(document.getElementById('playersPerTeam').value);
  const selectedPlayers = [];
  document.querySelectorAll('#genPlayerSelect input:checked').forEach(cb => {
    const positions = cb.dataset.positions ? cb.dataset.positions.split(',').filter(p => p) : [];
    selectedPlayers.push({ id: parseInt(cb.value), nome: cb.dataset.name, estrelas: parseInt(cb.dataset.stars), positions });
  });
  if (selectedPlayers.length < perTeam * 2) {
    resultsContainer.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)"><i class="fas fa-exclamation-triangle" style="font-size:2rem;color:var(--gold);margin-bottom:12px;display:block"></i>Selecione pelo menos ${perTeam * 2} jogadores para formar 2 times.</div>`;
    return;
  }
  const numTeams = Math.floor(selectedPlayers.length / perTeam);

  // Group by primary position, then shuffle within
  const posGroups = {};
  selectedPlayers.forEach(p => {
    const primaryPos = p.positions[0] || 'Sem posição';
    if (!posGroups[primaryPos]) posGroups[primaryPos] = [];
    posGroups[primaryPos].push(p);
  });
  // Sort each position group by stars desc, then shuffle within same star
  Object.values(posGroups).forEach(group => {
    group.sort((a, b) => b.estrelas - a.estrelas);
    // Shuffle within same star level
    let i = 0;
    while (i < group.length) {
      let j = i;
      while (j < group.length && group[j].estrelas === group[i].estrelas) j++;
      const sub = group.slice(i, j);
      shuffleArray(sub);
      for (let k = 0; k < sub.length; k++) group[i + k] = sub[k];
      i = j;
    }
  });

  // Distribute by position first (each team gets similar positions)
  const teams = Array.from({ length: numTeams }, () => []);
  const posOrder = ['Goleiro', 'Zaga', 'Lateral', 'Volante', 'Meio-campo', 'Atacante', 'Sem posição'];
  const allSorted = [];
  posOrder.forEach(pos => { if (posGroups[pos]) allSorted.push(...posGroups[pos]); });
  // Add any remaining
  Object.keys(posGroups).forEach(pos => { if (!posOrder.includes(pos)) allSorted.push(...posGroups[pos]); });

  // Snake draft within each position group for balance
  let dir = 1, idx = 0;
  allSorted.slice(0, numTeams * perTeam).forEach(p => {
    teams[idx].push(p); idx += dir;
    if (idx >= numTeams) { idx = numTeams - 1; dir = -1; }
    if (idx < 0) { idx = 0; dir = 1; }
  });
  const reservas = allSorted.slice(numTeams * perTeam);
  const teamNames = ['TIME VERMELHO', 'TIME AZUL', 'TIME VERDE', 'TIME DOURADO', 'TIME BRANCO', 'TIME PRETO'];
  resultsContainer.innerHTML = '';
  window._lastTeams = [];
  teams.forEach((team, i) => {
    const avg = (team.reduce((s, p) => s + p.estrelas, 0) / team.length).toFixed(1);
    window._lastTeams.push({ name: teamNames[i] || 'TIME ' + (i + 1), players: team, avg });
    // Count positions in team
    const posCounts = {};
    team.forEach(p => { const pos = p.positions[0] || '?'; posCounts[pos] = (posCounts[pos] || 0) + 1; });
    const posTagsHtml = Object.entries(posCounts).map(([pos, count]) =>
      `<span class="gen-team-pos-tag modal-pos-tag ${getPosClass(pos)}">${count}x ${pos}</span>`
    ).join('');

    const card = document.createElement('div');
    card.className = 'gen-team-card';
    card.innerHTML = `
      <div class="gen-team-header"><span class="gen-team-name">${teamNames[i] || 'TIME ' + (i + 1)}</span><span class="gen-team-rating"><i class="fas fa-star"></i> ${avg} média</span></div>
      <div class="gen-team-pos-summary">${posTagsHtml}</div>
      <div class="gen-team-players">${team.map(p => {
        const posLabel = p.positions[0] || '';
        return `<div class="gen-team-player"><span class="gen-team-player-name">${p.nome} <small style="color:var(--text-muted);font-size:0.65rem">${posLabel}</small></span><span class="gen-team-player-stars">${'★'.repeat(p.estrelas)}</span></div>`;
      }).join('')}</div>`;
    resultsContainer.appendChild(card);
  });
  if (reservas.length > 0) {
    const card = document.createElement('div');
    card.className = 'gen-team-card';
    card.innerHTML = `<div class="gen-team-header" style="background:rgba(255,255,255,0.05)"><span class="gen-team-name" style="color:var(--text-muted)">RESERVAS</span><span class="gen-team-rating">${reservas.length} jogador(es)</span></div>
      <div class="gen-team-players">${reservas.map(p => `<div class="gen-team-player"><span class="gen-team-player-name">${p.nome}</span><span class="gen-team-player-stars">${'★'.repeat(p.estrelas)}</span></div>`).join('')}</div>`;
    resultsContainer.appendChild(card);
  }
  document.getElementById('btnShareTeams').style.display = 'flex';
  resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function shareTeamsWhatsApp() {
  if (!window._lastTeams) return;
  let msg = '⚽🐺 *MÁQUINA DO MAL — TIMES DA SEMANA*\n\n';
  window._lastTeams.forEach(t => {
    msg += `*${t.name}* (⭐ ${t.avg})\n`;
    t.players.forEach(p => {
      const pos = p.positions && p.positions[0] ? ` (${p.positions[0]})` : '';
      msg += `• ${p.nome}${pos}\n`;
    });
    msg += '\n';
  });
  msg += '🔥 Bora jogar! #MáquinaDoMal';
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(msg), '_blank');
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
}

// ===== ADMIN PANEL =====
function initAdmin() {
  const ADMIN_PASS = 'mdm2022';

  document.getElementById('adminLoginBtn').addEventListener('click', () => {
    if (document.getElementById('adminPassword').value === ADMIN_PASS) {
      document.getElementById('adminLogin').style.display = 'none';
      document.getElementById('adminPanel').style.display = 'block';
      initAdminPanel();
    } else {
      alert('Senha incorreta!');
    }
  });
  document.getElementById('adminPassword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('adminLoginBtn').click();
  });

  // Admin tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.admin).classList.add('active');
    });
  });
}

function initAdminPanel() {
  // ---- MATCH ADMIN ----
  initMatchForm();
  document.getElementById('addMatch').addEventListener('click', saveMatchResult);
  document.getElementById('btnImportSorteio').addEventListener('click', importFromSorteio);

  // ---- MVP ADMIN ----
  const mvpSelect = document.getElementById('mvpPlayerSelect');
  ELENCO.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.nome; opt.textContent = p.nome;
    mvpSelect.appendChild(opt);
  });
  document.getElementById('addMvpWinner').addEventListener('click', () => {
    const date = document.getElementById('mvpDate').value;
    const player = document.getElementById('mvpPlayerSelect').value;
    if (!date || !player) return alert('Preencha data e jogador!');
    const history = LS.get('mvp_history', []);
    history.push({ date, player });
    LS.set('mvp_history', history);
    LS.set('mvp_votes', {});
    LS.remove('mvp_my_vote');
    renderMVP();
    renderAdminMvpList();
  });
  document.getElementById('mvpVotingActive').checked = LS.get('mvp_voting', false);
  document.getElementById('mvpVotingActive').addEventListener('change', function () {
    LS.set('mvp_voting', this.checked);
    if (this.checked) { LS.set('mvp_votes', {}); LS.remove('mvp_my_vote'); }
    renderMVP();
  });

  // ---- MENSALIDADE ADMIN ----
  const valor = LS.get('mensalidade_valor', 50);
  document.getElementById('mensalidadeValor').value = valor;
  // Auto-select current month/year
  const nowM = new Date();
  document.getElementById('mensalidadeMes').value = String(nowM.getMonth() + 1).padStart(2, '0');
  document.getElementById('mensalidadeAno').value = String(nowM.getFullYear());
  renderMensalidadeAdmin();
  document.getElementById('saveMensalidade').addEventListener('click', () => {
    const mes = document.getElementById('mensalidadeMes').value;
    const ano = document.getElementById('mensalidadeAno').value;
    const key = `${ano}-${mes}`;
    const data = {};
    document.querySelectorAll('#mensalidadeAdminGrid select').forEach(sel => {
      data[sel.dataset.player] = sel.value;
    });
    LS.set('mensalidade_' + key, data);
    LS.set('mensalidade_valor', document.getElementById('mensalidadeValor').value);
    renderMensalidade();
    const btn = document.getElementById('saveMensalidade');
    btn.innerHTML = '<i class="fas fa-check"></i> SALVO!';
    btn.style.background = '#28a745';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> SALVAR'; btn.style.background = ''; }, 2500);
  });
  document.getElementById('mensalidadeMes').addEventListener('change', renderMensalidadeAdmin);
  document.getElementById('mensalidadeAno').addEventListener('change', renderMensalidadeAdmin);
  document.getElementById('mensMarcarTodosPago').addEventListener('click', () => {
    document.querySelectorAll('#mensalidadeAdminGrid select').forEach(sel => { sel.value = 'pago'; });
  });

  // ---- PLAYER DATA ADMIN (stars + positions + photos) ----
  renderAdminPlayers();
  document.getElementById('savePlayerData').addEventListener('click', () => {
    const customStars = {};
    const customPos = {};
    document.querySelectorAll('#adminPlayersList .admin-player-item').forEach(item => {
      const key = item.dataset.playerKey;
      const starSel = item.querySelector('.admin-star-select');
      if (starSel) {
        customStars[key] = parseInt(starSel.value);
        const player = ELENCO.find(p => normalizeName(p.nome) === key);
        if (player) player.estrelas = parseInt(starSel.value);
      }
      const posSels = item.querySelectorAll('.admin-pos-select');
      const posArr = Array.from(posSels).map(s => s.value);
      customPos[key] = posArr;
      const player = ELENCO.find(p => normalizeName(p.nome) === key);
      if (player) player.posicoes = posArr;
    });
    LS.set('stars', customStars);
    LS.set('positions', customPos);
    initPlayerCards();
    // Rebuild generator checkboxes
    document.getElementById('genPlayerSelect').innerHTML = '';
    initTeamGenerator();
    const btn = document.getElementById('savePlayerData');
    btn.innerHTML = '<i class="fas fa-check"></i> SALVO!';
    btn.style.background = '#28a745';
    setTimeout(() => { btn.innerHTML = '<i class="fas fa-save"></i> SALVAR TUDO'; btn.style.background = ''; }, 2500);
    // Rebuild match form and resenha
    initMatchForm();
    const sel1 = document.getElementById('resenhaPlayer1');
    const sel2 = document.getElementById('resenhaPlayer2');
    sel1.innerHTML = '<option value="">Selecione...</option>';
    sel2.innerHTML = '<option value="">Selecione...</option>';
    [...ELENCO].sort((a, b) => b.estrelas - a.estrelas || a.nome.localeCompare(b.nome)).forEach(p => {
      [sel1, sel2].forEach(sel => {
        const opt = document.createElement('option');
        opt.value = p.nome;
        opt.textContent = `${p.nome} ${'★'.repeat(p.estrelas)}`;
        sel.appendChild(opt);
      });
    });
  });

  renderAdminMatchList();
  renderAdminMvpList();
}

function renderAdminMatchList() {
  const list = document.getElementById('adminMatchList');
  const matches = LS.get('match_results', []);
  list.innerHTML = '';
  matches.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((m, i) => {
    const t1Name = m.team1.name || 'Time 1';
    const t2Name = m.team2.name || 'Time 2';
    const s1 = m.team1.score; const s2 = m.team2.score;
    const scorers = Object.entries(m.goals || {}).filter(([, g]) => g > 0).map(([n, g]) => `${n}(${g})`).join(', ');
    const mvpNames = (m.mvps || []).join(', ');
    const item = document.createElement('div');
    item.className = 'admin-list-item';
    item.style.flexDirection = 'column'; item.style.alignItems = 'stretch'; item.style.gap = '6px';
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="admin-list-item-info"><strong>${m.date}</strong> · ${t1Name} ${s1} x ${s2} ${t2Name}</span>
        <button onclick="deleteMatchResult(${i})"><i class="fas fa-trash"></i></button>
      </div>
      ${scorers ? `<div style="font-size:0.72rem;color:var(--gold)">⚽ ${scorers}</div>` : ''}
      ${mvpNames ? `<div style="font-size:0.72rem;color:var(--gold)">🏆 MVP: ${mvpNames}</div>` : ''}
      <div style="font-size:0.68rem;color:var(--text-muted)">${(m.team1.players || []).length + (m.team2.players || []).length} jogadores</div>`;
    list.appendChild(item);
  });
}

function renderAdminMvpList() {
  const list = document.getElementById('adminMvpList');
  const history = LS.get('mvp_history', []);
  list.innerHTML = '';
  history.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach((m, i) => {
    const item = document.createElement('div');
    item.className = 'admin-list-item';
    item.innerHTML = `<span class="admin-list-item-info">🏅 ${m.player}<span>${m.date}</span></span><button onclick="deleteItem('mvp_history',${i})"><i class="fas fa-trash"></i></button>`;
    list.appendChild(item);
  });
}

function renderMensalidadeAdmin() {
  const grid = document.getElementById('mensalidadeAdminGrid');
  const summaryEl = document.getElementById('mensAdminSummary');
  const mes = document.getElementById('mensalidadeMes').value;
  const ano = document.getElementById('mensalidadeAno').value;
  const monthNames = ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const key = `${ano}-${mes}`;
  const data = LS.get('mensalidade_' + key, {});
  let pagos = 0, pendentes = 0, atrasados = 0;
  ELENCO.forEach(p => {
    const s = data[normalizeName(p.nome)] || 'pendente';
    if (s === 'pago') pagos++; else if (s === 'atrasado') atrasados++; else pendentes++;
  });
  summaryEl.innerHTML = `
    <div class="mens-admin-summary-bar">
      <span style="font-family:'Oswald',sans-serif;letter-spacing:1px">${monthNames[parseInt(mes)]} ${ano}</span>
      <span style="font-size:0.8rem"><span style="color:var(--green)">✓ ${pagos}</span> · <span style="color:var(--orange)">● ${pendentes}</span> · <span style="color:var(--red-bright)">✗ ${atrasados}</span></span>
    </div>`;
  grid.innerHTML = '';
  ELENCO.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(p => {
    const nKey = normalizeName(p.nome);
    const status = data[nKey] || 'pendente';
    const item = document.createElement('div');
    item.className = `mensalidade-admin-item mens-admin-${status}`;
    item.innerHTML = `
      <span class="admin-player-name">${p.nome}</span>
      <select data-player="${nKey}">
        <option value="pendente" ${status === 'pendente' ? 'selected' : ''}>⏳ Pendente</option>
        <option value="pago" ${status === 'pago' ? 'selected' : ''}>✅ Pago</option>
        <option value="atrasado" ${status === 'atrasado' ? 'selected' : ''}>❌ Atrasado</option>
      </select>`;
    const sel = item.querySelector('select');
    sel.addEventListener('change', function() {
      item.className = `mensalidade-admin-item mens-admin-${this.value}`;
    });
    grid.appendChild(item);
  });
}

// ===== MATCH FORM FUNCTIONS =====
function initMatchForm() {
  const sorted = [...ELENCO].sort((a, b) => a.nome.localeCompare(b.nome));
  ['matchTeam1Players', 'matchTeam2Players'].forEach(containerId => {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    sorted.forEach(p => {
      const label = document.createElement('label');
      label.className = 'match-player-check';
      label.innerHTML = `
        <input type="checkbox" value="${p.nome}">
        <span class="match-player-check-box"></span>
        <span>${p.nome}</span>`;
      const cb = label.querySelector('input');
      cb.addEventListener('change', function() {
        label.classList.toggle('selected', this.checked);
        updateGoalInputs(containerId);
      });
      container.appendChild(label);
    });
  });
  // Set today's date
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('matchDate').value = today;
}

function updateMvpDropdowns(teamPlayersId) {
  const teamNum = teamPlayersId.includes('Team1') ? '1' : '2';
  const selectA = document.getElementById(`matchMvp${teamNum}A`);
  const selectB = document.getElementById(`matchMvp${teamNum}B`);
  const label = document.getElementById(`mvpTeam${teamNum}Label`);
  const teamName = document.getElementById(`matchTeam${teamNum}Name`).value || `TIME ${teamNum}`;
  label.textContent = teamName;

  const checked = document.querySelectorAll(`#${teamPlayersId} input:checked`);
  const prevA = selectA.value, prevB = selectB.value;
  [selectA, selectB].forEach(sel => {
    sel.innerHTML = '<option value="">— Selecionar —</option>';
    checked.forEach(cb => {
      const opt = document.createElement('option');
      opt.value = cb.value; opt.textContent = cb.value;
      sel.appendChild(opt);
    });
  });
  selectA.value = prevA; selectB.value = prevB;
}

function updateGoalInputs(teamPlayersId) {
  const goalsId = teamPlayersId.replace('Players', 'Goals');
  const goalsContainer = document.getElementById(goalsId);
  const labelEl = goalsContainer.previousElementSibling; // goals-label
  const checked = document.querySelectorAll(`#${teamPlayersId} input:checked`);
  updateMvpDropdowns(teamPlayersId);

  if (checked.length === 0) {
    goalsContainer.innerHTML = '';
    labelEl.style.display = 'none';
    return;
  }
  labelEl.style.display = '';
  goalsContainer.innerHTML = '';
  checked.forEach(cb => {
    const name = cb.value;
    const existing = goalsContainer.querySelector(`[data-player="${name}"]`);
    const currentGoals = existing ? parseInt(existing.querySelector('.goal-count').textContent) : 0;
    const row = document.createElement('div');
    row.className = 'match-goal-row';
    row.dataset.player = name;
    row.innerHTML = `
      <span class="goal-icon"><i class="fas fa-futbol"></i></span>
      <span class="goal-player-name">${name}</span>
      <div class="goal-controls">
        <button class="goal-btn goal-minus" type="button">−</button>
        <span class="goal-count">${currentGoals}</span>
        <button class="goal-btn goal-plus" type="button">+</button>
      </div>`;
    row.querySelector('.goal-minus').addEventListener('click', () => {
      const cnt = row.querySelector('.goal-count');
      cnt.textContent = Math.max(0, parseInt(cnt.textContent) - 1);
    });
    row.querySelector('.goal-plus').addEventListener('click', () => {
      const cnt = row.querySelector('.goal-count');
      cnt.textContent = parseInt(cnt.textContent) + 1;
    });
    goalsContainer.appendChild(row);
  });
}

function importFromSorteio() {
  if (!window._lastTeams || window._lastTeams.length < 2) {
    alert('Nenhum sorteio disponível! Gere os times primeiro na aba "Sortear Times".');
    return;
  }
  const teams = window._lastTeams;
  // Fill team 1
  document.getElementById('matchTeam1Name').value = teams[0].name;
  document.getElementById('matchScore1').value = 0;
  fillTeamPlayers('matchTeam1Players', teams[0].players.map(p => p.nome));
  // Fill team 2
  document.getElementById('matchTeam2Name').value = teams[1].name;
  document.getElementById('matchScore2').value = 0;
  fillTeamPlayers('matchTeam2Players', teams[1].players.map(p => p.nome));
  // Update MVP labels
  document.getElementById('mvpTeam1Label').textContent = teams[0].name;
  document.getElementById('mvpTeam2Label').textContent = teams[1].name;

  // Visual feedback for import
  const importBtn = document.getElementById('btnImportSorteio');
  importBtn.innerHTML = `<i class="fas fa-check"></i> Importado: ${teams[0].name} vs ${teams[1].name}`;
  setTimeout(() => { importBtn.innerHTML = '<i class="fas fa-file-import"></i> Importar do Último Sorteio'; }, 3000);
}

function fillTeamPlayers(containerId, playerNames) {
  const normalizedNames = playerNames.map(n => normalizeName(n));
  document.querySelectorAll(`#${containerId} input`).forEach(cb => {
    const isMatch = normalizedNames.includes(normalizeName(cb.value));
    cb.checked = isMatch;
    cb.closest('.match-player-check').classList.toggle('selected', isMatch);
  });
  updateGoalInputs(containerId);
}

function saveMatchResult() {
  const date = document.getElementById('matchDate').value;
  const team1Name = document.getElementById('matchTeam1Name').value.trim();
  const team2Name = document.getElementById('matchTeam2Name').value.trim();
  const score1 = document.getElementById('matchScore1').value;
  const score2 = document.getElementById('matchScore2').value;

  if (!date) return alert('Selecione a data da partida!');
  if (!team1Name || !team2Name) return alert('Preencha os nomes dos times!');
  if (score1 === '' || score2 === '') return alert('Preencha o placar!');

  const team1Players = [];
  document.querySelectorAll('#matchTeam1Players input:checked').forEach(cb => team1Players.push(cb.value));
  const team2Players = [];
  document.querySelectorAll('#matchTeam2Players input:checked').forEach(cb => team2Players.push(cb.value));

  if (team1Players.length === 0 && team2Players.length === 0) return alert('Selecione pelo menos alguns jogadores!');

  // Collect goals
  const goals = {};
  document.querySelectorAll('#matchTeam1Goals .match-goal-row, #matchTeam2Goals .match-goal-row').forEach(row => {
    const name = row.dataset.player;
    const count = parseInt(row.querySelector('.goal-count').textContent);
    if (count > 0) goals[name] = count;
  });

  // Validate goal totals vs score
  let team1GoalSum = 0, team2GoalSum = 0;
  team1Players.forEach(p => { team1GoalSum += (goals[p] || 0); });
  team2Players.forEach(p => { team2GoalSum += (goals[p] || 0); });
  const s1 = parseInt(score1), s2 = parseInt(score2);
  if (team1GoalSum > s1) {
    if (!confirm(`Gols individuais do ${team1Name} (${team1GoalSum}) são maiores que o placar (${s1}). Continuar mesmo assim?`)) return;
  }
  if (team2GoalSum > s2) {
    if (!confirm(`Gols individuais do ${team2Name} (${team2GoalSum}) são maiores que o placar (${s2}). Continuar mesmo assim?`)) return;
  }

  // Collect MVPs
  const mvps = [
    document.getElementById('matchMvp1A').value,
    document.getElementById('matchMvp1B').value,
    document.getElementById('matchMvp2A').value,
    document.getElementById('matchMvp2B').value,
  ].filter(v => v);

  const matchResult = {
    id: Date.now(),
    date,
    team1: { name: team1Name, score: s1, players: team1Players },
    team2: { name: team2Name, score: s2, players: team2Players },
    goals,
    mvps
  };

  const results = LS.get('match_results', []);
  results.push(matchResult);
  LS.set('match_results', results);

  // Reset form
  document.getElementById('matchScore1').value = 0;
  document.getElementById('matchScore2').value = 0;
  document.querySelectorAll('#matchTeam1Players input, #matchTeam2Players input').forEach(cb => {
    cb.checked = false;
    cb.closest('.match-player-check').classList.remove('selected');
  });
  document.getElementById('matchTeam1Goals').innerHTML = '';
  document.getElementById('matchTeam2Goals').innerHTML = '';
  document.querySelectorAll('.match-team-goals-label').forEach(el => el.style.display = 'none');
  ['matchMvp1A','matchMvp1B','matchMvp2A','matchMvp2B'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = '<option value="">— Selecionar —</option>';
  });

  renderMatches();
  renderAdminMatchList();
  initPlayerCards(); // Update stats
  initStatsTables(); // Refresh MVP ranking
  // Show success feedback
  const btn = document.getElementById('addMatch');
  const origHTML = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-check"></i> PARTIDA REGISTRADA!';
  btn.style.background = 'linear-gradient(135deg, #27AE60, #2ECC71)';
  setTimeout(() => { btn.innerHTML = origHTML; btn.style.background = ''; }, 2500);
}

function renderAdminPlayers() {
  const list = document.getElementById('adminPlayersList');
  list.innerHTML = '';
  const posOptions = (selected) => `<option value="">—</option>${POSICOES_LIST.map(p => `<option value="${p}" ${selected === p ? 'selected' : ''}>${p}</option>`).join('')}`;

  // Add new player form at the top
  const addForm = document.createElement('div');
  addForm.className = 'admin-add-player-form';
  addForm.innerHTML = `
    <h4><i class="fas fa-user-plus"></i> Adicionar Jogador</h4>
    <div class="admin-add-player-row">
      <input type="text" id="newPlayerName" placeholder="Nome do jogador" class="admin-add-input">
      <select id="newPlayerStars" class="admin-star-select">
        ${[1,2,3,4,5].map(s => `<option value="${s}" ${s === 3 ? 'selected' : ''}>${'★'.repeat(s)}</option>`).join('')}
      </select>
      <button id="btnAddPlayer" class="btn-add-player"><i class="fas fa-plus"></i> Adicionar</button>
    </div>`;
  list.appendChild(addForm);
  document.getElementById('btnAddPlayer').addEventListener('click', () => {
    const nameInput = document.getElementById('newPlayerName');
    const nome = nameInput.value.trim();
    if (!nome) return;
    if (ELENCO.find(p => normalizeName(p.nome) === normalizeName(nome))) {
      nameInput.style.borderColor = '#ff4444';
      setTimeout(() => nameInput.style.borderColor = '', 2000);
      return;
    }
    const estrelas = parseInt(document.getElementById('newPlayerStars').value);
    addNewPlayer(nome, estrelas);
  });

  // Player count
  const countEl = document.createElement('div');
  countEl.className = 'admin-player-count';
  countEl.textContent = `${ELENCO.length} jogadores no elenco`;
  list.appendChild(countEl);

  ELENCO.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(p => {
    const key = normalizeName(p.nome);
    const photo = getPlayerPhoto(p.nome);
    const pos = p.posicoes || ['', '', ''];
    const initials = p.nome.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const item = document.createElement('div');
    item.className = 'admin-player-item';
    item.dataset.playerKey = key;
    item.dataset.playerName = p.nome;
    item.innerHTML = `
      <div class="admin-player-top">
        <div class="admin-player-photo-wrapper">
          <div class="admin-player-photo" data-player="${key}">
            ${photo ? `<img src="${photo}" alt="">` : initials}
          </div>
          <button class="admin-player-photo-btn" data-player-name="${p.nome}" title="Alterar foto"><i class="fas fa-camera"></i></button>
          <input type="file" accept="image/*" style="display:none" class="admin-photo-input" data-player-name="${p.nome}">
        </div>
        <div class="admin-player-info">
          <div class="admin-player-name-display">
            <span class="admin-player-name">${p.nome}</span>
            <button class="admin-btn-edit-name" title="Editar nome"><i class="fas fa-pen"></i></button>
          </div>
          <div class="admin-player-name-edit" style="display:none">
            <input type="text" class="admin-edit-name-input" value="${p.nome}">
            <button class="admin-btn-save-name" title="Salvar"><i class="fas fa-check"></i></button>
            <button class="admin-btn-cancel-name" title="Cancelar"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div class="admin-player-controls">
          <select class="admin-star-select" data-player="${key}">
            ${[1,2,3,4,5].map(s => `<option value="${s}" ${p.estrelas === s ? 'selected' : ''}>${'★'.repeat(s)}</option>`).join('')}
          </select>
          <button class="admin-btn-delete-player" title="Excluir jogador"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="admin-player-bottom">
        <div class="admin-pos-group"><span class="admin-pos-label">Posição 1</span><select class="admin-pos-select">${posOptions(pos[0])}</select></div>
        <div class="admin-pos-group"><span class="admin-pos-label">Posição 2</span><select class="admin-pos-select">${posOptions(pos[1])}</select></div>
        <div class="admin-pos-group"><span class="admin-pos-label">Posição 3</span><select class="admin-pos-select">${posOptions(pos[2])}</select></div>
      </div>`;
    list.appendChild(item);

    // Edit name handler
    const editBtn = item.querySelector('.admin-btn-edit-name');
    const nameDisplay = item.querySelector('.admin-player-name-display');
    const nameEdit = item.querySelector('.admin-player-name-edit');
    const nameInput = item.querySelector('.admin-edit-name-input');
    const saveNameBtn = item.querySelector('.admin-btn-save-name');
    const cancelNameBtn = item.querySelector('.admin-btn-cancel-name');
    editBtn.addEventListener('click', () => {
      nameDisplay.style.display = 'none';
      nameEdit.style.display = 'flex';
      nameInput.focus();
      nameInput.select();
    });
    cancelNameBtn.addEventListener('click', () => {
      nameDisplay.style.display = 'flex';
      nameEdit.style.display = 'none';
      nameInput.value = p.nome;
    });
    saveNameBtn.addEventListener('click', () => {
      const newName = nameInput.value.trim();
      if (!newName || newName === p.nome) { cancelNameBtn.click(); return; }
      if (ELENCO.find(x => normalizeName(x.nome) === normalizeName(newName) && x !== p)) {
        nameInput.style.borderColor = '#ff4444';
        setTimeout(() => nameInput.style.borderColor = '', 2000);
        return;
      }
      renamePlayer(p.nome, newName);
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveNameBtn.click();
      if (e.key === 'Escape') cancelNameBtn.click();
    });

    // Delete player handler
    item.querySelector('.admin-btn-delete-player').addEventListener('click', () => {
      if (!confirm(`Tem certeza que deseja excluir "${p.nome}" do elenco?`)) return;
      deletePlayer(p.nome);
    });

    // Photo upload handler
    const photoBtn = item.querySelector('.admin-player-photo-btn');
    const photoInput = item.querySelector('.admin-photo-input');
    photoBtn.addEventListener('click', () => photoInput.click());
    photoInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const playerName = this.dataset.playerName;
      const photoEl = item.querySelector('.admin-player-photo');
      photoEl.innerHTML = '<span style="font-size:0.7rem;color:var(--text-muted)">Processando...</span>';

      function removeDarkBg(canvas) {
        const ctx = canvas.getContext('2d');
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data;
        const w = canvas.width, h = canvas.height;
        const darkLimit = 50;
        const visited = new Uint8Array(w * h);
        const queue = [];
        function tryAdd(i) {
          if (i < 0 || i >= w * h || visited[i]) return;
          const p = i * 4;
          if ((d[p] + d[p+1] + d[p+2]) / 3 < darkLimit) {
            visited[i] = 1;
            d[p+3] = 0;
            queue.push(i);
          }
        }
        for (let x = 0; x < w; x++) { tryAdd(x); tryAdd((h-1)*w + x); }
        for (let y = 0; y < h; y++) { tryAdd(y*w); tryAdd(y*w + w-1); }
        let head = 0;
        while (head < queue.length) {
          const i = queue[head++];
          const x = i % w, y = (i / w) | 0;
          if (x > 0) tryAdd(i-1);
          if (x < w-1) tryAdd(i+1);
          if (y > 0) tryAdd(i-w);
          if (y < h-1) tryAdd(i+w);
        }
        ctx.putImageData(img, 0, 0);
      }

      const reader = new FileReader();
      reader.onload = function(ev) {
        const img = new Image();
        img.onload = function() {
          const canvas = document.createElement('canvas');
          canvas.width = 300; canvas.height = 300;
          const ctx = canvas.getContext('2d');
          const min = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, 300, 300);
          removeDarkBg(canvas);
          const dataUrl = canvas.toDataURL('image/png');
          savePlayerPhoto(playerName, dataUrl);
          photoEl.innerHTML = `<img src="${dataUrl}" alt="">`;
          initPlayerCards();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  });
}

window.deleteItem = function(key, index) {
  if (!confirm('Tem certeza que deseja excluir?')) return;
  const data = LS.get(key, []);
  data.sort((a, b) => new Date(b.date) - new Date(a.date));
  data.splice(index, 1);
  LS.set(key, data);
  if (key === 'mvp_history') { renderMVP(); renderAdminMvpList(); }
};

window.deleteMatchResult = function(index) {
  if (!confirm('Tem certeza que deseja excluir esta partida? Os dados serão removidos das estatísticas.')) return;
  const data = LS.get('match_results', []);
  data.sort((a, b) => new Date(b.date) - new Date(a.date));
  data.splice(index, 1);
  LS.set('match_results', data);
  renderMatches();
  renderAdminMatchList();
  initPlayerCards(); // Refresh stats
  initStatsTables(); // Refresh MVP ranking
};
