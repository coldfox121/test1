(function () {
  'use strict';

  /* ---------------- 基础配置 ---------------- */

  const SAVE_VERSION = 1;
  const AUTOSAVE_MS = 15000;
  const TICK_MS = 100;
  const OFFLINE_BASE_HOURS = 2;
  const OFFLINE_MAX_HOURS = 8;
  const PRESTIGE_REQUIREMENT = 1000000;

  const CFG = window.GAME_CONFIG || {};
  const CLOUD_CONFIGURED = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);

  // 设施：基础价格、价格增长率、每秒产量
  const BUILDINGS = [
    { id: 'pickaxe', name: '矿镐', desc: '最基础的手工工具。', baseCost: 10, growth: 1.15, rate: 0.1 },
    { id: 'miner', name: '矿工', desc: '雇一名矿工持续开采。', baseCost: 100, growth: 1.15, rate: 1 },
    { id: 'mine', name: '矿井', desc: '向地下开掘一条矿道。', baseCost: 1200, growth: 1.15, rate: 8 },
    { id: 'drill', name: '钻机', desc: '机械钻头昼夜不停。', baseCost: 15000, growth: 1.15, rate: 47 },
    { id: 'vein', name: '矿脉', desc: '整条富矿脉归你所有。', baseCost: 200000, growth: 1.15, rate: 260 },
    { id: 'fleet', name: '采掘舰队', desc: '成建制的自动化采掘队伍。', baseCost: 2500000, growth: 1.15, rate: 1400 }
  ];

  // 本循环技能：消耗当前持有的矿石
  const SKILLS = [
    {
      id: 'click', name: '强化矿镐', desc: '提升每次点击的基础产量。',
      baseCost: 25, growth: 1.5, max: null,
      effect: function (lv) { return '每次点击 +' + lv + ' 基础矿石'; }
    },
    {
      id: 'prod', name: '矿脉勘探', desc: '提升所有设施与点击的产量。',
      baseCost: 200, growth: 1.7, max: null,
      effect: function (lv) { return '全局产量 +' + (lv * 10) + '%'; }
    },
    {
      id: 'offline', name: '离线延长', desc: '提高离线收益的结算上限。',
      baseCost: 1000, growth: 3, max: 6,
      effect: function (lv) { return '离线上限 ' + (OFFLINE_BASE_HOURS + lv) + ' 小时'; }
    },
    {
      id: 'crit', name: '精准开采', desc: '点击时有概率造成 5 倍收益。',
      baseCost: 500, growth: 4, max: 10,
      effect: function (lv) { return '暴击率 ' + (lv * 2) + '%，暴击 5 倍'; }
    }
  ];

  // 全局加成：消耗转生获得的星尘（首版仅保留数据接口）
  const GLOBAL_SKILLS = [
    {
      id: 'g_prod', name: '星辉共鸣', desc: '转生后所有产量永久提升。',
      baseCost: 1, growth: 2,
      effect: function (lv) { return '全局产量 +' + (lv * 25) + '%'; }
    },
    {
      id: 'g_click', name: '星尘之手', desc: '转生后点击产量永久提升。',
      baseCost: 2, growth: 2,
      effect: function (lv) { return '点击产量 +' + (lv * 100) + '%'; }
    },
    {
      id: 'g_start', name: '遗产矿脉', desc: '转生后获得初始矿石。',
      baseCost: 3, growth: 2,
      effect: function (lv) { return '初始矿石 ' + lv * 1000; }
    }
  ];

  const UNITS = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

  /* ---------------- DOM ---------------- */

  const authScreen = document.getElementById('authScreen');
  const cloudAuth = document.getElementById('cloudAuth');
  const localAuth = document.getElementById('localAuth');
  const localNotice = document.getElementById('localNotice');
  const authForm = document.getElementById('authForm');
  const authUser = document.getElementById('authUser');
  const authPass = document.getElementById('authPass');
  const authSubmit = document.getElementById('authSubmit');
  const authError = document.getElementById('authError');
  const guestBtn = document.getElementById('guestBtn');

  const gameScreen = document.getElementById('gameScreen');
  const userTag = document.getElementById('userTag');
  const oreText = document.getElementById('oreText');
  const prodText = document.getElementById('prodText');
  const clickText = document.getElementById('clickText');
  const mineTip = document.getElementById('mineTip');
  const rock = document.getElementById('rock');
  const buildingList = document.getElementById('buildingList');
  const floatLayer = document.getElementById('floatLayer');

  const modalLayer = document.getElementById('modalLayer');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const toastEl = document.getElementById('toast');

  /* ---------------- 运行时状态 ---------------- */

  let state = null;
  let mode = 'guest';
  let cloudName = '';
  let dirty = false;
  let saveChain = Promise.resolve();
  let activeModal = null;
  let authMode = 'login';
  let loopsStarted = false;
  let lastFrameTime = 0;
  let lastHudAt = 0;
  let lastAffordAt = 0;
  let toastTimer = 0;
  const buildingRefs = new Map();

  /* ---------------- 云端账号 ---------------- */

  const Cloud = {
    client: null,
    sdkPromise: null,

    async init() {
      await this.loadSDK();
      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        throw new Error('云端 SDK 加载失败');
      }
      this.client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
    },

    loadSDK() {
      if (window.supabase) return Promise.resolve();
      if (this.sdkPromise) return this.sdkPromise;
      this.sdkPromise = new Promise(function (resolve, reject) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
        script.async = true;
        const timer = setTimeout(function () {
          reject(new Error('云端 SDK 加载超时'));
        }, 10000);
        script.onload = function () {
          clearTimeout(timer);
          resolve();
        };
        script.onerror = function () {
          clearTimeout(timer);
          reject(new Error('云端 SDK 加载失败'));
        };
        document.head.appendChild(script);
      });
      return this.sdkPromise;
    },

    async loadGame() {
      const response = await this.client.rpc('load_game');
      if (response.error) throw response.error;
      const rows = response.data;
      if (Array.isArray(rows)) return rows[0] || null;
      return rows || null;
    },

    async saveGame(save) {
      const response = await this.client.rpc('save_game', { p_save: save });
      if (response.error) throw response.error;
      return response.data;
    }
  };

  /* ---------------- 工具函数 ---------------- */

  function newState() {
    const buildings = {};
    BUILDINGS.forEach(function (b) { buildings[b.id] = 0; });
    const skills = {};
    SKILLS.forEach(function (s) { skills[s.id] = 0; });
    const global = {};
    GLOBAL_SKILLS.forEach(function (g) { global[g.id] = 0; });
    return {
      version: SAVE_VERSION,
      ore: 0,
      totalOre: 0,
      clicks: 0,
      buildings: buildings,
      skills: skills,
      global: global,
      stardust: 0,
      prestigeCount: 0,
      createdAt: Date.now(),
      settings: { fullNumbers: false }
    };
  }

  function safeNumber(value, fallback) {
    const n = Number(value);
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  function migrate(raw) {
    const fresh = newState();
    if (!raw || typeof raw !== 'object') return fresh;

    fresh.ore = safeNumber(raw.ore, 0);
    fresh.totalOre = safeNumber(raw.totalOre, fresh.ore);
    fresh.clicks = safeNumber(raw.clicks, 0);
    fresh.stardust = safeNumber(raw.stardust, 0);
    fresh.prestigeCount = safeNumber(raw.prestigeCount, 0);
    fresh.createdAt = safeNumber(raw.createdAt, Date.now());

    BUILDINGS.forEach(function (b) {
      fresh.buildings[b.id] = safeNumber(raw.buildings && raw.buildings[b.id], 0);
    });
    SKILLS.forEach(function (s) {
      fresh.skills[s.id] = safeNumber(raw.skills && raw.skills[s.id], 0);
    });
    GLOBAL_SKILLS.forEach(function (g) {
      fresh.global[g.id] = safeNumber(raw.global && raw.global[g.id], 0);
    });

    fresh.settings.fullNumbers = !!(raw.settings && raw.settings.fullNumbers);
    fresh.version = SAVE_VERSION;
    return fresh;
  }

  function fmt(n) {
    if (!isFinite(n)) return '0';
    if (state && state.settings && state.settings.fullNumbers) {
      return Math.floor(n).toLocaleString('zh-CN');
    }
    if (n < 1000) return String(Math.floor(n));
    let tier = Math.floor(Math.log10(n) / 3);
    if (tier > UNITS.length - 1) tier = UNITS.length - 1;
    const scaled = n / Math.pow(1000, tier);
    const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    let text = scaled.toFixed(digits);
    if (text.indexOf('.') >= 0) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return text + UNITS[tier];
  }

  function fmtRate(n) {
    if (!isFinite(n) || n <= 0) return '0';
    if (n >= 1000) return fmt(n);
    if (n >= 100) return n.toFixed(0);
    if (n >= 10) return n.toFixed(1).replace(/\.0$/, '');
    return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (h > 0) return h + ' 小时 ' + m + ' 分钟';
    if (m > 0) return m + ' 分钟';
    return total + ' 秒';
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* ---------------- 数值计算 ---------------- */

  function buildingCost(building) {
    const count = state.buildings[building.id] || 0;
    return Math.ceil(building.baseCost * Math.pow(building.growth, count));
  }

  function productionPerSecond() {
    let base = 0;
    BUILDINGS.forEach(function (b) {
      base += (state.buildings[b.id] || 0) * b.rate;
    });
    return base * (1 + state.skills.prod * 0.1) * (1 + state.global.g_prod * 0.25);
  }

  function clickPower() {
    return (1 + state.skills.click) * (1 + state.skills.prod * 0.1) * (1 + state.global.g_click);
  }

  function critChance() {
    return Math.min(0.2, state.skills.crit * 0.02);
  }

  function offlineCapSeconds() {
    const hours = Math.min(OFFLINE_MAX_HOURS, OFFLINE_BASE_HOURS + (state.skills.offline || 0));
    return hours * 3600;
  }

  function skillCost(skill) {
    return Math.ceil(skill.baseCost * Math.pow(skill.growth, state.skills[skill.id] || 0));
  }

  function globalCost(skill) {
    return Math.ceil(skill.baseCost * Math.pow(skill.growth, state.global[skill.id] || 0));
  }

  /* ---------------- 渲染 ---------------- */

  function renderBuildings() {
    buildingList.innerHTML = '';
    buildingRefs.clear();

    BUILDINGS.forEach(function (b) {
      const row = document.createElement('div');
      row.className = 'building';
      row.dataset.id = b.id;
      row.innerHTML =
        '<div class="building-info">' +
          '<div class="building-name">' + b.name + ' <span class="building-count">×0</span></div>' +
          '<div class="building-desc">' + b.desc + '</div>' +
          '<div class="building-rate">+' + fmtRate(b.rate) + '/秒</div>' +
        '</div>' +
        '<button type="button" class="buy-btn" data-buy="' + b.id + '">' +
          '<span class="buy-label">购买</span>' +
          '<span class="buy-cost">' + fmt(b.baseCost) + '</span>' +
        '</button>';

      buildingRefs.set(b.id, {
        row: row,
        count: row.querySelector('.building-count'),
        cost: row.querySelector('.buy-cost'),
        button: row.querySelector('.buy-btn')
      });
      buildingList.appendChild(row);
    });
  }

  function updateBuildings() {
    if (!state) return;
    BUILDINGS.forEach(function (b) {
      const ref = buildingRefs.get(b.id);
      if (!ref) return;
      const cost = buildingCost(b);
      ref.count.textContent = '×' + (state.buildings[b.id] || 0);
      ref.cost.textContent = fmt(cost);
      const affordable = state.ore >= cost;
      ref.button.disabled = !affordable;
      ref.button.classList.toggle('affordable', affordable);
    });
  }

  function updateHud() {
    if (!state) return;
    oreText.textContent = fmt(state.ore);
    prodText.textContent = fmtRate(productionPerSecond());
    clickText.textContent = fmtRate(clickPower());

    let tip = '每点击一次获得 ' + fmtRate(clickPower()) + ' 矿石';
    const crit = critChance();
    if (crit > 0) tip += ' · 暴击率 ' + Math.round(crit * 100) + '%';
    mineTip.textContent = tip;
  }

  function spawnFloat(amount, crit) {
    const rect = rock.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'float-text' + (crit ? ' crit' : '');
    el.textContent = '+' + fmtRate(amount) + (crit ? ' 暴击' : '');
    el.style.left = (rect.left + rect.width / 2 + (Math.random() * 120 - 60)) + 'px';
    el.style.top = (rect.top + rect.height / 2 + (Math.random() * 50 - 25)) + 'px';
    floatLayer.appendChild(el);
    setTimeout(function () { el.remove(); }, 950);
  }

  function toast(message) {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  /* ---------------- 游戏操作 ---------------- */

  function mine() {
    if (!state) return;
    const crit = Math.random() < critChance();
    const amount = clickPower() * (crit ? 5 : 1);

    state.ore += amount;
    state.totalOre += amount;
    state.clicks += 1;
    dirty = true;

    spawnFloat(amount, crit);
    rock.classList.remove('hit');
    void rock.offsetWidth;
    rock.classList.add('hit');
    setTimeout(function () { rock.classList.remove('hit'); }, 180);

    updateHud();
    updateBuildings();
  }

  function buyBuilding(id) {
    if (!state) return;
    const building = BUILDINGS.find(function (b) { return b.id === id; });
    if (!building) return;

    const cost = buildingCost(building);
    if (state.ore < cost) return;

    state.ore -= cost;
    state.buildings[id] = (state.buildings[id] || 0) + 1;
    dirty = true;

    updateHud();
    updateBuildings();
  }

  function buySkill(id) {
    const skill = SKILLS.find(function (s) { return s.id === id; });
    if (!skill) return;

    const level = state.skills[id] || 0;
    if (skill.max != null && level >= skill.max) return;

    const cost = skillCost(skill);
    if (state.ore < cost) return;

    state.ore -= cost;
    state.skills[id] = level + 1;
    dirty = true;

    updateHud();
    updateBuildings();
    refreshModal(false);
    toast(skill.name + ' 提升至 Lv.' + (level + 1));
  }

  function buyGlobal(id) {
    const skill = GLOBAL_SKILLS.find(function (g) { return g.id === id; });
    if (!skill) return;
    toast('转生系统将在后续版本开放');
  }

  /* ---------------- 浮层窗口 ---------------- */

  function openModal(kind) {
    activeModal = kind;
    modalLayer.hidden = false;
    refreshModal(true);
  }

  function closeModal() {
    activeModal = null;
    modalLayer.hidden = true;
    modalBody.innerHTML = '';
  }

  function refreshModal(resetScroll) {
    if (!activeModal || activeModal === 'offline') return;

    let view = null;
    if (activeModal === 'skills') view = buildSkillsModal();
    else if (activeModal === 'prestige') view = buildPrestigeModal();
    else if (activeModal === 'settings') view = buildSettingsModal();
    if (!view) return;

    const scrollTop = resetScroll ? 0 : modalBody.scrollTop;
    modalTitle.textContent = view.title;
    modalBody.innerHTML = view.html;
    if (typeof view.onMount === 'function') view.onMount();
    modalBody.scrollTop = scrollTop;
  }

  function buildSkillsModal() {
    const ore = fmt(state.ore);

    const skillCards = SKILLS.map(function (s) {
      const level = state.skills[s.id] || 0;
      const maxed = s.max != null && level >= s.max;
      const cost = skillCost(s);
      const affordable = !maxed && state.ore >= cost;

      return '<article class="skill-card">' +
        '<div>' +
          '<div class="skill-title">' + s.name +
            '<span class="lv">Lv.' + level + (s.max != null ? ' / ' + s.max : '') + '</span>' +
          '</div>' +
          '<p class="skill-desc">' + s.desc + '</p>' +
          '<p class="skill-effect">当前：' + s.effect(level) + '</p>' +
        '</div>' +
        '<button type="button" class="buy-btn' + (affordable ? ' affordable' : '') + '"' +
          ' data-skill="' + s.id + '"' + (maxed || !affordable ? ' disabled' : '') + '>' +
          '<span class="buy-label">' + (maxed ? '已满级' : '升级') + '</span>' +
          (maxed ? '' : '<span class="buy-cost">' + fmt(cost) + '</span>') +
        '</button>' +
      '</article>';
    }).join('');

    const globalCards = GLOBAL_SKILLS.map(function (g) {
      const level = state.global[g.id] || 0;
      return '<article class="skill-card">' +
        '<div>' +
          '<div class="skill-title">' + g.name + '<span class="lv">Lv.' + level + '</span></div>' +
          '<p class="skill-desc">' + g.desc + '</p>' +
          '<p class="skill-effect">当前：' + g.effect(level) + '</p>' +
        '</div>' +
        '<button type="button" class="buy-btn" disabled>' +
          '<span class="buy-label">星尘</span>' +
          '<span class="buy-cost">' + fmt(globalCost(g)) + '</span>' +
        '</button>' +
      '</article>';
    }).join('');

    return {
      title: '技能',
      html:
        '<section class="modal-section">' +
          '<div class="currency-line"><span>持有矿石</span><strong>' + ore + '</strong></div>' +
          '<h3>本循环技能 <span class="locked-tag">消耗矿石</span></h3>' +
          skillCards +
        '</section>' +
        '<section class="modal-section">' +
          '<h3>全局加成 <span class="locked-tag">转生开放</span></h3>' +
          '<div class="currency-line"><span>星尘</span><strong>' + fmt(state.stardust) + '</strong></div>' +
          '<p class="note">转生系统将在后续版本开放。星尘与全局加成数据已经预留，当前无法购买。</p>' +
          globalCards +
        '</section>'
    };
  }

  function buildPrestigeModal() {
    const gain = Math.floor(Math.sqrt(state.totalOre / PRESTIGE_REQUIREMENT));

    return {
      title: '转生',
      html:
        '<section class="modal-section">' +
          '<p class="note">转生会清空矿石、设施与本循环技能，换取永久货币「星尘」，用于购买全局加成。首版仅保留接口。</p>' +
          '<div class="prestige-stats">' +
            '<div class="prestige-stat"><span>累计开采</span><strong>' + fmt(state.totalOre) + '</strong></div>' +
            '<div class="prestige-stat"><span>可获得星尘</span><strong>' + fmt(gain) + '</strong></div>' +
          '</div>' +
          '<div class="setting-row"><span>转生要求</span><span>累计开采 ' + fmt(PRESTIGE_REQUIREMENT) + ' 矿石</span></div>' +
          '<div class="setting-row"><span>已转生次数</span><span>' + state.prestigeCount + ' 次</span></div>' +
          '<button type="button" class="btn-wide" disabled>转生系统将在后续版本开放</button>' +
          '<p class="setting-hint">数据字段（星尘、全局加成、转生次数）已保留，后续版本可直接接入。</p>' +
        '</section>'
    };
  }

  function buildSettingsModal() {
    const isCloud = mode === 'cloud';

    return {
      title: '设置',
      html:
        '<section class="modal-section">' +
          '<h3>显示</h3>' +
          '<label class="setting-row">' +
            '<span>完整数字（不使用 K/M/B 缩写）</span>' +
            '<input type="checkbox" id="setFullNumbers"' + (state.settings.fullNumbers ? ' checked' : '') + '>' +
          '</label>' +
          '<p class="setting-hint">关闭时显示为 1.23M，开启时显示为 1,234,567。</p>' +
        '</section>' +
        '<section class="modal-section">' +
          '<h3>账号</h3>' +
          '<div class="setting-row"><span>模式</span><span>' + (isCloud ? '云端账号' : '本地试玩') + '</span></div>' +
          '<div class="setting-row"><span>账号名</span><span>' + escapeHtml(isCloud ? cloudName : '本地玩家') + '</span></div>' +
          '<p class="setting-hint">' +
            (isCloud
              ? '进度会自动同步到云端，离线收益按服务器时间结算。'
              : '进度只保存在当前浏览器，清除浏览器数据会丢失。') +
          '</p>' +
        '</section>' +
        '<section class="modal-section">' +
          '<h3>存档</h3>' +
          '<div class="setting-row"><span>离线上限</span><span>' +
            (OFFLINE_BASE_HOURS + (state.skills.offline || 0)) + ' 小时</span></div>' +
          '<div class="setting-row"><span>累计开采</span><span>' + fmt(state.totalOre) + '</span></div>' +
          '<div class="setting-actions">' +
            '<button type="button" class="btn-secondary" id="saveNowBtn">立即保存</button>' +
            '<button type="button" class="btn-secondary danger" id="resetSaveBtn">重置存档</button>' +
            (isCloud ? '<button type="button" class="btn-secondary" id="logoutBtn">退出登录</button>' : '') +
          '</div>' +
        '</section>',
      onMount: function () {
        const fullToggle = document.getElementById('setFullNumbers');
        if (fullToggle) {
          fullToggle.addEventListener('change', function () {
            state.settings.fullNumbers = fullToggle.checked;
            dirty = true;
            updateHud();
            updateBuildings();
          });
        }

        const saveBtn = document.getElementById('saveNowBtn');
        if (saveBtn) saveBtn.addEventListener('click', function () { saveNow(true); });

        const resetBtn = document.getElementById('resetSaveBtn');
        if (resetBtn) resetBtn.addEventListener('click', resetSave);

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.addEventListener('click', logoutCloud);
      }
    };
  }

  function openOfflineModal(elapsed, capped, gain) {
    activeModal = 'offline';
    modalLayer.hidden = false;
    modalTitle.textContent = '离线收益';
    modalBody.innerHTML =
      '<section class="modal-section">' +
        '<p class="note">你离开了 ' + formatDuration(elapsed) + '，矿场仍在自动运转。</p>' +
        '<div class="prestige-stat" style="margin-top:12px">' +
          '<span>本次离线收益</span>' +
          '<strong>+' + fmt(gain) + ' 矿石</strong>' +
        '</div>' +
        '<p class="setting-hint">结算时长 ' + formatDuration(capped) +
          '，当前离线上限 ' + (OFFLINE_BASE_HOURS + (state.skills.offline || 0)) +
          ' 小时。可通过「离线延长」技能提升至 ' + OFFLINE_MAX_HOURS + ' 小时。</p>' +
        '<button type="button" class="btn-wide" data-close-offline>收下</button>' +
      '</section>';
    modalBody.scrollTop = 0;
  }

  /* ---------------- 存档 ---------------- */

  function saveGuestNow() {
    const stamp = Date.now();
    localStorage.setItem('mine.guest.save', JSON.stringify({ state: state, lastSeen: stamp }));
    return stamp;
  }

  function saveNow(feedback) {
    if (!state) return Promise.resolve();
    saveChain = saveChain.then(function () { return doSave(feedback); });
    return saveChain;
  }

  async function doSave(feedback) {
    if (!state) return;

    dirty = false;
    const snapshot = JSON.parse(JSON.stringify(state));

    try {
      if (mode === 'cloud') {
        await Cloud.saveGame(snapshot);
      } else {
        saveGuestNow();
      }
      if (feedback) toast('已保存');
    } catch (err) {
      dirty = true;
      console.error('保存失败', err);
      if (feedback) toast('保存失败：' + ((err && err.message) || '网络错误'));
    }
  }

  async function resetSave() {
    if (!confirm('确定重置当前存档吗？矿石、设施和技能都会清空，且无法恢复。')) return;

    const keepSettings = state.settings;
    state = newState();
    state.settings = keepSettings;
    dirty = true;

    updateHud();
    updateBuildings();
    await saveNow(false);
    refreshModal(false);
    toast('存档已重置');
  }

  async function logoutCloud() {
    if (mode !== 'cloud') return;
    if (!confirm('确定退出当前云端账号吗？')) return;

    await saveNow(false);
    try {
      await Cloud.client.auth.signOut();
    } catch (err) {
      console.error(err);
    }
    location.reload();
  }

  function enterGuest() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('mine.guest.save') || 'null');
    } catch (err) {
      saved = null;
    }

    const loadedState = saved && saved.state ? migrate(saved.state) : newState();
    const lastSeen = saved && saved.lastSeen ? Number(saved.lastSeen) : null;
    beginGame(loadedState, 'guest', '本地玩家', Date.now(), lastSeen);
  }

  async function enterCloud(username) {
    const row = await Cloud.loadGame();

    if (row && row.save && Object.keys(row.save).length > 0) {
      const serverNow = Date.parse(row.server_now) || Date.now();
      const lastSeen = row.last_seen ? Date.parse(row.last_seen) : null;
      beginGame(migrate(row.save), 'cloud', username, serverNow, lastSeen);
      return;
    }

    const initial = newState();
    await Cloud.saveGame(initial);
    beginGame(initial, 'cloud', username, Date.now(), null);
  }

  function beginGame(initialState, nextMode, name, serverNow, lastSeen) {
    state = migrate(initialState);
    mode = nextMode;
    cloudName = name;

    authScreen.hidden = true;
    gameScreen.hidden = false;
    userTag.textContent = mode === 'cloud' ? name : '本地试玩';

    renderBuildings();
    updateHud();
    updateBuildings();

    const elapsed = lastSeen != null && isFinite(lastSeen)
      ? Math.max(0, (serverNow - lastSeen) / 1000)
      : 0;
    const capped = Math.min(elapsed, offlineCapSeconds());
    const gain = productionPerSecond() * capped;
    const showOffline = gain >= 1 && elapsed >= 60;

    if (showOffline) {
      state.ore += gain;
      state.totalOre += gain;
      dirty = true;
      updateHud();
      updateBuildings();
    } else {
      dirty = false;
    }

    if (mode === 'guest') {
      saveGuestNow();
    } else if (showOffline) {
      saveNow(false);
    }

    startLoops();
    if (showOffline) {
      setTimeout(function () { openOfflineModal(elapsed, capped, gain); }, 260);
    }
  }

  function startLoops() {
    if (loopsStarted) return;
    loopsStarted = true;
    lastFrameTime = Date.now();

    setInterval(gameTick, TICK_MS);
    setInterval(function () {
      if (dirty) saveNow(false);
    }, AUTOSAVE_MS);
    setInterval(function () {
      if (activeModal === 'skills' || activeModal === 'prestige') refreshModal(false);
    }, 1000);
  }

  function gameTick() {
    if (!state) return;

    const now = Date.now();
    const dt = Math.min(Math.max((now - lastFrameTime) / 1000, 0), 300);
    lastFrameTime = now;

    if (dt > 0) {
      const gain = productionPerSecond() * dt;
      if (gain > 0) {
        state.ore += gain;
        state.totalOre += gain;
        dirty = true;
      }
    }

    if (now - lastHudAt >= 100) {
      updateHud();
      lastHudAt = now;
    }
    if (now - lastAffordAt >= 250) {
      updateBuildings();
      lastAffordAt = now;
    }
  }

  /* ---------------- 账号界面 ---------------- */

  function showCloudAuth() {
    cloudAuth.hidden = false;
    localAuth.hidden = true;
  }

  function showLocalAuth(note) {
    cloudAuth.hidden = true;
    localAuth.hidden = false;
    if (note) localNotice.textContent = note;
  }

  function setAuthMode(nextMode) {
    authMode = nextMode;
    document.querySelectorAll('.auth-tab').forEach(function (tab) {
      const active = tab.dataset.tab === nextMode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    authSubmit.textContent = nextMode === 'register' ? '注册' : '登录';
    authPass.autocomplete = nextMode === 'register' ? 'new-password' : 'current-password';
    authError.textContent = '';
  }

  function setAuthBusy(busy) {
    authSubmit.disabled = busy;
    authSubmit.textContent = busy ? '请稍候…' : (authMode === 'register' ? '注册' : '登录');
  }

  function authMessage(err) {
    const msg = (err && err.message) || String(err || '未知错误');
    if (/Invalid login credentials/i.test(msg)) return '账号或密码错误';
    if (/User already registered/i.test(msg)) return '该账号已注册，请直接登录';
    if (/Password should be at least/i.test(msg)) return '密码至少 6 位';
    if (/Email not confirmed/i.test(msg)) return '账号未验证，请在 Supabase 后台关闭邮箱验证后重试';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return '网络连接失败，请检查网络后重试';
    return msg;
  }

  function usernameToEmail(username) {
    return username.toLowerCase() + '@player.test1game.com';
  }

  async function register(username, password) {
    const name = username.toLowerCase();
    const response = await Cloud.client.auth.signUp({
      email: usernameToEmail(name),
      password: password,
      options: { data: { username: name } }
    });
    if (response.error) throw response.error;

    if (!response.data.session) {
      throw new Error('注册已创建，但项目开启了邮箱验证。请在 Supabase 后台关闭 Confirm email 后再登录。');
    }

    const profile = await Cloud.client.from('profiles').insert({
      id: response.data.user.id,
      username: name,
      save: newState()
    });
    if (profile.error) {
      await Cloud.client.auth.signOut();
      if (profile.error.code === '23505') throw new Error('该账号已被占用');
      throw profile.error;
    }

    await enterCloud(name);
  }

  async function login(username, password) {
    const name = username.toLowerCase();
    const response = await Cloud.client.auth.signInWithPassword({
      email: usernameToEmail(name),
      password: password
    });
    if (response.error) throw response.error;

    const metaName = (response.data.user.user_metadata && response.data.user.user_metadata.username) || name;
    await enterCloud(metaName);
  }

  async function onAuthSubmit(event) {
    event.preventDefault();
    authError.textContent = '';

    const username = authUser.value.trim();
    const password = authPass.value;

    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
      authError.textContent = '账号需为 3-16 位字母、数字或下划线';
      return;
    }
    if (password.length < 6) {
      authError.textContent = '密码至少 6 位';
      return;
    }

    setAuthBusy(true);
    try {
      if (authMode === 'register') await register(username, password);
      else await login(username, password);
    } catch (err) {
      authError.textContent = authMessage(err);
    } finally {
      setAuthBusy(false);
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    document.querySelectorAll('.auth-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { setAuthMode(tab.dataset.tab); });
    });

    authForm.addEventListener('submit', onAuthSubmit);
    guestBtn.addEventListener('click', enterGuest);

    rock.addEventListener('click', mine);

    buildingList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-buy]');
      if (button) buyBuilding(button.dataset.buy);
    });

    document.querySelectorAll('[data-modal]').forEach(function (button) {
      button.addEventListener('click', function () { openModal(button.dataset.modal); });
    });

    modalClose.addEventListener('click', closeModal);
    modalLayer.addEventListener('click', function (event) {
      if (event.target === modalLayer) closeModal();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modalLayer.hidden) closeModal();
    });

    modalBody.addEventListener('click', function (event) {
      const skillButton = event.target.closest('[data-skill]');
      if (skillButton) {
        buySkill(skillButton.dataset.skill);
        return;
      }
      const globalButton = event.target.closest('[data-global]');
      if (globalButton) {
        buyGlobal(globalButton.dataset.global);
        return;
      }
      if (event.target.closest('[data-close-offline]')) closeModal();
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && dirty) saveNow(false);
    });
    window.addEventListener('pagehide', function () {
      if (dirty) saveNow(false);
    });
  }

  /* ---------------- 启动 ---------------- */

  async function init() {
    bindEvents();
    setAuthMode('login');

    if (!CLOUD_CONFIGURED) {
      showLocalAuth();
      return;
    }

    showCloudAuth();

    try {
      await Cloud.init();
      const session = await Cloud.client.auth.getSession();
      const user = session.data && session.data.session && session.data.session.user;

      if (user) {
        const username = (user.user_metadata && user.user_metadata.username) || '玩家';
        setAuthBusy(true);
        try {
          await enterCloud(username);
        } catch (err) {
          authError.textContent = authMessage(err);
        } finally {
          setAuthBusy(false);
        }
      }
    } catch (err) {
      showLocalAuth('云端初始化失败：' + ((err && err.message) || '未知错误') + '。当前可先本地试玩。');
    }
  }

  init();
})();
