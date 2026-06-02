/**
 * 汇率实时提醒助手 - 多货币核心逻辑
 * 数据源：
 * - FawazAhmed Currency API (支持 CNH 离岸人民币，170+ 币种)
 * - Open Exchange Rates API (备用)
 */

/* ===========================
   常量 & 配置
   =========================== */
const isServerMode = window.location.protocol.startsWith('http');

const CURRENCY_LIST = [
  { code: 'USD', name: '美元', flag: '🇺🇸', symbol: '$' },
  { code: 'CNH', name: '离岸人民币', flag: '🇨🇳', symbol: '¥' },
  { code: 'CNY', name: '在岸人民币', flag: '🇨🇳', symbol: '¥' },
  { code: 'EUR', name: '欧元', flag: '🇪🇺', symbol: '€' },
  { code: 'GBP', name: '英镑', flag: '🇬🇧', symbol: '£' },
  { code: 'JPY', name: '日元', flag: '🇯🇵', symbol: '¥' },
  { code: 'AUD', name: '澳元', flag: '🇦🇺', symbol: 'A$' },
  { code: 'CAD', name: '加元', flag: '🇨🇦', symbol: 'C$' },
  { code: 'CHF', name: '瑞士法郎', flag: '🇨🇭', symbol: 'Fr' },
  { code: 'HKD', name: '港币', flag: '🇭🇰', symbol: 'HK$' },
  { code: 'SGD', name: '新加坡元', flag: '🇸🇬', symbol: 'S$' },
  { code: 'KRW', name: '韩元', flag: '🇰🇷', symbol: '₩' },
  { code: 'THB', name: '泰铢', flag: '🇹🇭', symbol: '฿' },
  { code: 'MYR', name: '马来西亚林吉特', flag: '🇲🇾', symbol: 'RM' },
  { code: 'PHP', name: '菲律宾比索', flag: '🇵🇭', symbol: '₱' },
  { code: 'VND', name: '越南盾', flag: '🇻🇳', symbol: '₫' },
  { code: 'TWD', name: '新台币', flag: '🇹🇼', symbol: 'NT$' },
  { code: 'INR', name: '印度卢比', flag: '🇮🇳', symbol: '₹' },
  { code: 'MXN', name: '墨西哥比索', flag: '🇲🇽', symbol: 'Mex$' },
  { code: 'BRL', name: '巴西雷亚尔', flag: '🇧🇷', symbol: 'R$' },
  { code: 'ZAR', name: '南非兰特', flag: '🇿🇦', symbol: 'R' },
  { code: 'NZD', name: '新西兰元', flag: '🇳🇿', symbol: 'NZ$' },
  { code: 'SEK', name: '瑞典克朗', flag: '🇸🇪', symbol: 'kr' },
  { code: 'NOK', name: '挪威克朗', flag: '🇳🇴', symbol: 'kr' },
  { code: 'DKK', name: '丹麦克朗', flag: '🇩🇰', symbol: 'kr' },
  { code: 'AED', name: '阿联酋迪拉姆', flag: '🇦🇪', symbol: 'د.إ' },
  { code: 'SAR', name: '沙特里亚尔', flag: '🇸🇦', symbol: 'ر.س' },
  { code: 'RUB', name: '俄罗斯卢布', flag: '🇷🇺', symbol: '₽' }
];

/* ===========================
   状态
   =========================== */
let state = {
  fromCurrency: 'USD',
  toCurrency: 'CNH',
  currentRate: null,
  prevRate: null,
  allRates: {},         // 存放所有基于 USD 的汇率，键值全大写
  history: [],          // 当前币对的汇率历史 [{ ts, rate, change }]
  settings: {
    interval: 3600,     // 默认 3600 秒（1小时）刷新一次
    soundEnabled: false,// 默认不开启提示音（防吵闹）
    monitorEnabled: true,
    fromCurrency: 'USD',
    toCurrency: 'CNH',
    targetRate: null,
    direction: 'above', // 'above' | 'below'
    // 多平台结汇参数配置（万里汇 0.38%、Wise 约 0.45%、连连支付 0.40%）
    platforms: [
      { id: 'wf', name: '万里汇', fee: 0.38, offset: -0.0037 },
      { id: 'wise', name: 'Wise', fee: 0.45, offset: 0.0000 },
      { id: 'lianlian', name: '连连支付', fee: 0.40, offset: 0.0000 }
    ],
    activePlatformId: 'wf',
    alertBase: 'wf',    // 默认以激活平台估算结汇价作为提醒和监控的依据
    pairs: {}           // 存放各个币对的具体提醒设置 { 'USD_CNH': { targetRate, direction } }
  },
  intervalTimer: null,
  alertFired: false,    // 避免单次达标事件中重复触发通知
  alertFiredPairs: {},  // 记录各个币对是否已经发出警报以防重复轰炸 { 'USD_CNH': true }
  displayRange: '12h',  // 图表默认显示范围为 12 小时
  boardBase: 'CNH'      // 行情板基准货币
};

/* ===========================
   DOM 引用
   =========================== */
const $ = (id) => document.getElementById(id);

const dom = {
  // 页头及连接状态
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  lastFetchBadge: $('last-fetch-badge'),

  // 主汇率区币种选择
  fromCurrency: $('from-currency'),
  toCurrency: $('to-currency'),
  fromFlag: $('from-flag'),
  toFlag: $('to-flag'),
  swapBtn: $('swap-btn'),

  // 主汇率区数值显示
  rateMain: $('rate-main'),
  rateChangeBadge: $('rate-change-badge'),
  rateChangeIcon: $('rate-change-icon'),
  rateChangeValue: $('rate-change-value'),
  rateChangePct: $('rate-change-pct'),
  rateMetaFrom: $('rate-meta-from'),
  rateMetaValue: $('rate-meta-value'),
  rateMetaTo: $('rate-meta-to'),
  lastUpdateTime: $('last-update-time'),
  cnhNote: $('cnh-note'),

  // 走势图
  rateChart: $('rate-chart'),
  chartTooltip: $('chart-tooltip'),
  statHigh: $('stat-high'),
  statLow: $('stat-low'),
  statAvg: $('stat-avg'),
  statCount: $('stat-count'),

  // 多货币行情板
  boardBase: $('board-base'),
  rateBoard: $('rate-board'),

  // 目标提醒设置
  monitorToggle: $('monitor-toggle'),
  btnAbove: $('btn-above'),
  btnBelow: $('btn-below'),
  targetRate: $('target-rate'),
  targetPrefix: $('target-prefix'),
  labelPair: $('label-pair'),
  useCurrentBtn: $('use-current-btn'),
  refreshInterval: $('refresh-interval'),
  soundToggle: $('sound-toggle-check'),
  saveSettings: $('save-settings'),

  // 监控状态面板
  displayPair: $('display-pair'),
  displayTarget: $('display-target'),
  displayDirection: $('display-direction'),
  displayDiff: $('display-diff'),
  displayMonitorStatus: $('display-monitor-status'),
  progressFill: $('progress-fill'),
  progressPct: $('progress-pct'),

  // 货币换算器
  calcSwapBtn: $('calc-swap-btn'),
  calcFrom: $('calc-from'),
  calcTo: $('calc-to'),
  calcFromFlag: $('calc-from-flag'),
  calcToFlag: $('calc-to-flag'),
  calcAmountFrom: $('calc-amount-from'),
  calcAmountTo: $('calc-amount-to'),
  calcRateDisplay: $('calc-rate-display'),

  // 历史日志
  historyPairLabel: $('history-pair-label'),
  clearHistory: $('clear-history'),
  historyBody: $('history-body'),

  // 警告弹窗及 Toast
  alertBanner: $('alert-banner'),
  alertIcon: $('alert-icon'),
  alertTitle: $('alert-title'),
  alertMsg: $('alert-msg'),
  alertClose: $('alert-close'),
  toastContainer: $('toast-container'),

  // API 与 data source 资源配置
  apiKeyInput: $('api-key-input'),
  toggleKeyVisibility: $('toggle-key-visibility'),
  activeApiBadge: $('active-api-badge'),
  apiHint: $('api-hint'),
  apiBudgetWarning: $('api-budget-warning'),
  btnSaveApi: $('btn-save-api'),

  // 平台估算结汇价 & 提醒判定
  wfEstimatePill: $('wf-estimate-pill'),
  wfEstimateName: $('wf-estimate-name'),
  wfEstimateValue: $('wf-estimate-value'),
  wfEstimateTo: $('wf-estimate-to'),
  wfEstimateFee: $('wf-estimate-fee'),
  wfEstimateOffset: $('wf-estimate-offset'),
  btnBaseMarket: $('btn-base-market'),
  btnBaseWf: $('btn-base-wf'),

  // 结汇多平台管理 DOM 映射
  activePlatformSelect: $('active-platform-select'),
  platformNameInput: $('platform-name-input'),
  platformFeeInput: $('platform-fee-input'),
  platformOffsetInput: $('platform-offset-input'),
  btnSavePlatform: $('btn-save-platform'),
  btnAddPlatform: $('btn-add-platform'),
  btnDeletePlatform: $('btn-delete-platform'),

  // 提醒配置与弹窗 DOM 映射
  btnAddAlertTrigger: $('btn-add-alert-trigger'),
  panelAlertsList: $('panel-alerts-list'),
  alertsModal: $('alerts-modal'),
  closeAlertsModal: $('close-alerts-modal'),
  modalAlertTitle: $('modal-alert-title'),
  modalFromCurrency: $('modal-from-currency'),
  modalToCurrency: $('modal-to-currency'),
  monitorDotsContainer: $('monitor-dots-container')
};

/* ===========================
   粒子背景画布
   =========================== */
function initBgCanvas() {
  const canvas = $('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  resize();
  window.addEventListener('resize', resize);

  // 初始化粒子
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: Math.random() * 1.5 + 0.3,
      dx: (Math.random() - 0.5) * 0.25,
      dy: (Math.random() - 0.5) * 0.25,
      opacity: Math.random() * 0.35 + 0.05
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height;
      if (p.y > canvas.height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110, 231, 247, ${p.opacity})`;
      ctx.fill();
    });

    // 粒子连线
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 90) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(110, 231, 247, ${0.05 * (1 - dist / 90)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(animate);
  }

  animate();
}

/* ===========================
   选择器动态填充与标志更新
   =========================== */
function populateSelects() {
  const optionsHTML = CURRENCY_LIST.map(
    (c) => `<option value="${c.code}">${c.code} - ${c.name}</option>`
  ).join('');

  dom.fromCurrency.innerHTML = optionsHTML;
  dom.toCurrency.innerHTML = optionsHTML;
  dom.boardBase.innerHTML = optionsHTML;
  dom.calcFrom.innerHTML = optionsHTML;
  dom.calcTo.innerHTML = optionsHTML;
  if (dom.modalFromCurrency) dom.modalFromCurrency.innerHTML = optionsHTML;
  if (dom.modalToCurrency) dom.modalToCurrency.innerHTML = optionsHTML;
}

function updateFlags() {
  const fromCode = dom.fromCurrency.value;
  const toCode = dom.toCurrency.value;
  const calcFromCode = dom.calcFrom.value;
  const calcToCode = dom.calcTo.value;

  const fromCurr = CURRENCY_LIST.find((c) => c.code === fromCode);
  const toCurr = CURRENCY_LIST.find((c) => c.code === toCode);
  const calcFromCurr = CURRENCY_LIST.find((c) => c.code === calcFromCode);
  const calcToCurr = CURRENCY_LIST.find((c) => c.code === calcToCode);

  if (fromCurr) dom.fromFlag.textContent = fromCurr.flag;
  if (toCurr) dom.toFlag.textContent = toCurr.flag;
  if (calcFromCurr) dom.calcFromFlag.textContent = calcFromCurr.flag;
  if (calcToCurr) dom.calcToFlag.textContent = calcToCurr.flag;

  // 万里汇 CNH 专业说明提示显隐控制
  if (fromCode === 'CNH' || toCode === 'CNH') {
    dom.cnhNote.classList.remove('hidden');
  } else {
    dom.cnhNote.classList.add('hidden');
  }

  // 目标汇率输入框前缀符号更新
  if (toCurr) {
    dom.targetPrefix.textContent = toCurr.symbol;
  }
}

/* ===========================
   汇率获取及运算引擎 (含备用源逻辑)
   =========================== */

// 记录数据日期和来源，用于 UI 数据说明
let lastDataDate = '';
let lastApiName = '';
let cnhIsApprox = false; // 标记 CNH 是否用 CNY 近似替代

async function fetchHistoryFromServer(from, to) {
  try {
    const res = await fetch(`/api/history?from=${from}&to=${to}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json(); // [{ ts, rate }]
    
    // 计算 change 并构成 state.history
    const mapped = [];
    for (let i = 0; i < data.length; i++) {
      const prevRate = i > 0 ? data[i - 1].rate : null;
      mapped.push({
        ts: data[i].ts,
        rate: data[i].rate,
        change: prevRate ? data[i].rate - prevRate : 0
      });
    }
    return mapped;
  } catch (err) {
    console.warn('[服务端历史] 获取服务端历史数据失败, 降级使用本地存储:', err.message);
    return loadHistoryForPair(from, to);
  }
}

async function fetchRate() {
  setStatus('connecting');

  if (isServerMode) {
    try {
      const res = await fetch('/api/rates', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (data && data.rates && typeof data.rates === 'object') {
        state.allRates = {};
        for (let key in data.rates) {
          state.allRates[key.toUpperCase()] = parseFloat(data.rates[key]);
        }
        state.allRates['USD'] = 1.0;

        cnhIsApprox = false;
        if (!state.allRates['CNH'] && state.allRates['CNY']) {
          state.allRates['CNH'] = state.allRates['CNY'];
          cnhIsApprox = true;
        }
        if (!state.allRates['CNY'] && state.allRates['CNH']) {
          state.allRates['CNY'] = state.allRates['CNH'];
        }

        lastDataDate = data.date || '未知';
        lastApiName = data.source || '服务端数据源';

        saveRatesToCache();
        setStatus('connected');

        dom.activeApiBadge.textContent = lastApiName;
        if (lastApiName.includes('Open Exchange Rates')) {
          dom.activeApiBadge.className = 'badge badge-green';
          dom.apiHint.innerHTML = `
            🎉 <strong>已启用 Open Exchange Rates 官方源（通过服务端）</strong>。<br>
            当前服务端正以每小时更新的频率获取真实 <strong>CNH 离岸人民币</strong> 汇率。
          `;
        } else {
          dom.activeApiBadge.className = 'badge badge-amber';
          dom.apiHint.innerHTML = `
            当前服务端正使用免密钥的 <strong>${lastApiName}</strong>。<br>
            您可以在下方配置您的 Open Exchange Rates APP ID 密钥，以启用官方每小时更新源。
          `;
        }

        if (data.nextUpdate) {
          dom.lastFetchBadge.textContent = `📅 ${lastDataDate}  ·  下次更新 ${data.nextUpdate}`;
          dom.lastFetchBadge.title =
            `数据来源: ${lastApiName} (服务端)\n数据时间: ${lastDataDate}\n下次更新: ${data.nextUpdate}\n` +
            `来源说明: 服务端自动同步，支持 24 小时后台记录`;
        } else {
          dom.lastFetchBadge.textContent = `📅 数据日期 ${lastDataDate}`;
          dom.lastFetchBadge.title =
            `数据来源: ${lastApiName} (服务端)\n数据时间: ${lastDataDate}`;
        }

        onRatesReceived();
        return;
      }
    } catch (err) {
      console.warn('[服务端抓取失败] 正在自动降级到客户端直接获取:', err.message);
    }
  }

  const oerAppId = localStorage.getItem('rate_oer_app_id') || '';
  const APIS = [];

  if (oerAppId) {
    APIS.push({
      name: 'Open Exchange Rates (官方源)',
      url: `https://openexchangerates.org/api/latest.json?app_id=${oerAppId}`,
      parse: (data) => {
        const lastUpdateTs = data.timestamp ? data.timestamp * 1000 : Date.now();
        return {
          rates: data.rates,
          date: new Date(lastUpdateTs).toLocaleDateString('zh-CN') + ' ' + new Date(lastUpdateTs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
          // 免费版固定每小时更新一次，下次更新即时间戳 + 1小时
          nextUpdate: new Date(lastUpdateTs + 3600000).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
          })
        };
      }
    });
  }

  APIS.push(
    {
      // ✅ 备用数据源 1：open.er-api.com
      name: 'Open ER-API (备用源)',
      url: 'https://open.er-api.com/v6/latest/USD',
      parse: (data) => ({
        rates: data.rates,
        date: data.time_last_update_utc
          ? new Date(data.time_last_update_utc).toLocaleDateString('zh-CN')
          : '',
        nextUpdate: data.time_next_update_utc
          ? new Date(data.time_next_update_utc).toLocaleString('zh-CN', {
              month: 'numeric', day: 'numeric',
              hour: '2-digit', minute: '2-digit'
            })
          : ''
      })
    },
    {
      // ⬇️ 备用数据源 2：fawazahmed0
      name: 'FawazAhmed (备用源)',
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      parse: (data) => ({ rates: data.usd || data.USD, date: data.date || '', nextUpdate: '' })
    }
  );

  for (let api of APIS) {
    try {
      const res = await fetch(api.url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP 状态码异常 ${res.status}`);
      
      const json = await res.json();
      const parsed = api.parse(json);
      const rawRates = parsed.rates;
      if (!rawRates || typeof rawRates !== 'object') {
        throw new Error('返回的汇率数据格式不正确');
      }

      // 将键名全部转为大写，确保代码内部访问一致
      state.allRates = {};
      for (let key in rawRates) {
        state.allRates[key.toUpperCase()] = parseFloat(rawRates[key]);
      }

      // 强行插入基准
      state.allRates['USD'] = 1.0;
      
      // CNH 支持检测：若 API 没有真实 CNH，用 CNY 近似并标记
      cnhIsApprox = false;
      if (!state.allRates['CNH'] && state.allRates['CNY']) {
        state.allRates['CNH'] = state.allRates['CNY'];
        cnhIsApprox = true;
      }
      if (!state.allRates['CNY'] && state.allRates['CNH']) {
        state.allRates['CNY'] = state.allRates['CNH'];
      }

      // 记录数据日期和来源
      lastDataDate = parsed.date || '未知';
      lastApiName = api.name;

      // 写入本地缓存以备离线使用
      saveRatesToCache();

      setStatus('connected');

      // 更新 API 设置卡片里的徽章和提示语
      dom.activeApiBadge.textContent = api.name;
      if (api.name === 'Open Exchange Rates (官方源)') {
        dom.activeApiBadge.className = 'badge badge-green';
        dom.apiHint.innerHTML = `
          🎉 <strong>已启用 Open Exchange Rates 官方源</strong>。<br>
          当前正以每小时更新的频率获取真实 <strong>CNH 离岸人民币</strong> 汇率。
        `;
      } else {
        dom.activeApiBadge.className = 'badge badge-amber';
        if (oerAppId) {
          dom.apiHint.innerHTML = `
            ⚠️ <strong>官方数据源连接失败：</strong>已自动平滑启用 <strong>${api.name}</strong>。<br>
            请检查您的 Open Exchange Rates APP ID 密钥是否有效，或稍后重试。
          `;
        } else {
          dom.apiHint.innerHTML = `
            未配置密钥，当前正使用免密钥的 <strong>${api.name}</strong>（每日更新）。<br>
            配置密钥后可启用 <strong>Open Exchange Rates 官方源</strong> 获得每小时更新的真实 CNH 离岸价。<a href="https://openexchangerates.org/signup/free" target="_blank" rel="noopener" style="color:var(--accent-cyan);text-decoration:none;">点此免费注册 ➔</a>
          `;
        }
      }

      // 更新页头连接指示牌：显示数据日期 + 下次更新时间
      if (parsed.nextUpdate) {
        dom.lastFetchBadge.textContent = `📅 ${lastDataDate}  ·  下次更新 ${parsed.nextUpdate}`;
        dom.lastFetchBadge.title =
          `数据来源: ${api.name}\n数据时间: ${lastDataDate}\n下次更新: ${parsed.nextUpdate}\n` +
          `来源说明: ${api.name === 'Open Exchange Rates (官方源)' ? '免费账户每小时自动更新，支持真实离岸 CNH 汇率' : '每日更新一次参考汇率'}`;
      } else {
        dom.lastFetchBadge.textContent = `📅 数据日期 ${lastDataDate}`;
        dom.lastFetchBadge.title =
          `数据来源: ${api.name}\n数据时间: ${lastDataDate}\n来源说明: 每日更新一次，非实时报价`;
      }

      onRatesReceived();
      return;
    } catch (err) {
      console.warn(`[汇率数据源异常] ${api.name} 错误:`, err.message);
    }
  }

  // 发生网络故障，自动尝试平滑降级至本地缓存
  if (loadRatesFromCache()) {
    setStatus('connected');
    dom.statusText.textContent = '本地离线缓存数据中';
    dom.activeApiBadge.textContent = lastApiName;
    dom.activeApiBadge.className = 'badge badge-amber';
    dom.apiHint.innerHTML = `
      ⚠️ <strong>网络连接故障：</strong>服务器请求失败，当前已启用本地离线缓存数据。<br>
      请检查您的网络连接或稍后重试。
    `;
    
    // 更新页头连接指示牌
    dom.lastFetchBadge.textContent = `📅 缓存日期 ${lastDataDate}`;
    dom.lastFetchBadge.title = `数据来源: ${lastApiName} (缓存)\n缓存日期: ${lastDataDate}`;

    onRatesReceived();
    showToast('⚠️', '网络连接异常', '已自动载入本地历史缓存汇率数据', 3000);
    return;
  }

  setStatus('error');
  showToast('⚠️', '获取汇率失败', '所有数据源均未响应，且暂无本地离线缓存，请检查您的网络连接', 5000);
}

function onRatesReceived() {
  const fromCode = state.fromCurrency;
  const toCode = state.toCurrency;

  const usdToFrom = state.allRates[fromCode];
  const usdToTo = state.allRates[toCode];

  if (!usdToFrom || !usdToTo) {
    console.error(`无法获取币种 ${fromCode} 或 ${toCode} 的对应 USD 汇率`);
    return;
  }

  // 核心交叉汇率计算: Rate = Target_USD_value / Source_USD_value
  const calculatedRate = usdToTo / usdToFrom;
  state.prevRate = state.currentRate;
  state.currentRate = calculatedRate;

  // 记录历史
  const now = Date.now();
  const entry = {
    ts: now,
    rate: calculatedRate,
    change: state.prevRate ? calculatedRate - state.prevRate : 0
  };

  if (isServerMode) {
    // 服务端模式下，只在汇率有变动或超过一分钟时，才追加最新点，避免重复点膨胀
    const lastEntry = state.history[state.history.length - 1];
    if (!lastEntry || lastEntry.rate !== calculatedRate || (now - lastEntry.ts > 60000)) {
      state.history.push(entry);
    }
    // 限制客户端最大缓存量为服务端历史容量
    if (state.history.length > 1500) {
      state.history.shift();
    }
  } else {
    // 客户端单机模式自愈记录逻辑：
    // 一次 API 响应会拉回所有 170+ 币种的最新汇率（state.allRates）。
    // 因此，我们不仅记录当前的活动币对，还自动为用户配置的所有“到价提醒”币对在 localStorage 里记录一个实时点。
    // 这做到了 100% 零额外网络请求/零额度消耗，同步积累多组监控任务的实时采样折线！
    
    // 1. 记录并保存当前活动币对的实时点
    state.history.push(entry);
    if (state.history.length > 200) {
      state.history.shift();
    }
    saveHistory();

    // 2. 同步遍历并记录所有已添加提醒的币对，同步更新它们的历史
    const pairs = state.settings.pairs;
    if (pairs && typeof pairs === 'object') {
      const activePairKey = `${fromCode}_${toCode}`;
      for (let pairKey in pairs) {
        if (pairKey === activePairKey) continue; // 活动对刚才已经单独记录了
        const spec = pairs[pairKey];
        if (!spec || !spec.targetRate) continue;

        const parts = pairKey.split('_');
        if (parts.length !== 2) continue;
        const pFrom = parts[0];
        const pTo = parts[1];

        const uToFrom = state.allRates[pFrom];
        const uToTo = state.allRates[pTo];
        if (uToFrom && uToTo) {
          const cRate = uToTo / uToFrom;
          const pHistory = loadHistoryForPair(pFrom, pTo);
          
          // 限制频繁点写入，至少间隔 50 秒以上才记录，防止多次触发膨胀
          const pLast = pHistory[pHistory.length - 1];
          if (!pLast || (now - pLast.ts > 50000)) {
            pHistory.push({
              ts: now,
              rate: cRate,
              change: pLast ? cRate - pLast.rate : 0
            });
            if (pHistory.length > 200) {
              pHistory.shift();
            }
            saveHistoryForPair(pFrom, pTo, pHistory);
          }
        }
      }
    }
  }

  // 更新所有关联 UI 块
  updateRateDisplay();
  addHistoryRow(entry);
  updateChartStats();
  drawChart();
  updateTargetStatus();
  checkAlerts();
  updateRateBoard();
  updateCalculator();
}

/* ===========================
   数据渲染与视图控制
   =========================== */
function getActivePlatform() {
  const activeId = state.settings.activePlatformId || 'wf';
  const platforms = state.settings.platforms || [
    { id: 'wf', name: '万里汇', fee: 0.30, offset: -0.0037 }
  ];
  return platforms.find(p => p.id === activeId) || { name: '估算', fee: 0.30, offset: 0.0 };
}

function updateRateDisplay() {
  const rate = state.currentRate;
  if (rate === null) return;

  dom.rateMain.textContent = rate.toFixed(4);
  dom.rateMain.classList.add('updating');
  setTimeout(() => dom.rateMain.classList.remove('updating'), 450);

  // 计算并渲染当前激活平台的估算结汇价
  const platform = getActivePlatform();
  const estimatedRate = rate * (1 - platform.fee / 100) + platform.offset;
  
  dom.wfEstimateName.textContent = platform.name;
  dom.wfEstimateValue.textContent = estimatedRate.toFixed(4);
  dom.wfEstimateFee.textContent = platform.fee.toFixed(2);
  dom.wfEstimateOffset.textContent = (platform.offset >= 0 ? '+' : '') + platform.offset.toFixed(4);
  dom.wfEstimateTo.textContent = state.toCurrency;
  dom.wfEstimatePill.classList.remove('hidden');

  // 汇率小字说明
  dom.rateMetaFrom.textContent = state.fromCurrency;
  dom.rateMetaValue.textContent = rate.toFixed(4);
  dom.rateMetaTo.textContent = ` ${state.toCurrency}`;

  // 底部最后刷新字样：显示数据日期，不是当前时间
  dom.lastUpdateTime.textContent = lastDataDate
    ? `数据日期 ${lastDataDate}`
    : new Date().toLocaleTimeString('zh-CN');

  // 主变动徽章
  if (state.prevRate !== null) {
    const diff = rate - state.prevRate;
    const pct = (diff / state.prevRate) * 100;
    dom.rateChangeValue.textContent = (diff >= 0 ? '+' : '') + diff.toFixed(4);
    dom.rateChangePct.textContent = `(${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%)`;
    dom.rateChangeIcon.textContent = diff >= 0 ? '▲' : '▼';
    dom.rateChangeBadge.className = 'rate-change-badge ' + (diff >= 0 ? 'up' : 'down');
  } else {
    dom.rateChangeValue.textContent = '0.0000';
    dom.rateChangePct.textContent = '(0.000%)';
    dom.rateChangeIcon.textContent = '—';
    dom.rateChangeBadge.className = 'rate-change-badge';
  }

  // 更新 CNH 说明内容
  updateCnhNote();
}

function setStatus(type) {
  dom.statusDot.className = 'status-dot';
  if (type === 'connected') {
    dom.statusDot.classList.add('connected');
    dom.statusText.textContent = '已连接';
  } else if (type === 'error') {
    dom.statusDot.classList.add('error');
    dom.statusText.textContent = '未连接';
  } else {
    dom.statusText.textContent = '正在连接';
  }
}

/* ===========================
   CNH 说明区动态更新
   =========================== */
function updateCnhNote() {
  const fromCode = state.fromCurrency;
  const toCode = state.toCurrency;
  const involvesCnh = fromCode === 'CNH' || toCode === 'CNH';

  // 如果未涉及 CNH，或者有包含 CNH 且有真实的离岸汇率（不需要警告提示），则直接隐藏说明栏
  if (!involvesCnh || !cnhIsApprox) {
    dom.cnhNote.classList.add('hidden');
    return;
  }

  dom.cnhNote.classList.remove('hidden');

  // 仅在 CNH 数据是用 CNY 近似替代时才显示提示说明
  dom.cnhNote.innerHTML = `
    <span class="cnh-badge">⚠ CNH ≈ CNY</span>
    <span>当前数据源 <strong>${lastApiName}</strong> 无真实 CNH 离岸报价，已采用在岸 CNY 近似替代。<br>
    CNH 与 CNY 存在约 <strong>±0.1%~0.5%</strong> 汇差，与平台结汇实际离岸价存在出入属正常。</span>
  `;
}


/* ===========================
   折线走势图绘制 (Bezier / DPI适配)
   =========================== */
let chartCtx = null;

function initChart() {
  if (dom.rateChart) {
    chartCtx = dom.rateChart.getContext('2d');
  }
}

function getFilteredHistory() {
  const now = Date.now();
  const ranges = {
    '12h': 12 * 3600000,
    '24h': 24 * 3600000,
    '7d': 7 * 86400000,
    '15d': 15 * 86400000,
    '30d': 30 * 86400000
  };
  const cutoff = now - (ranges[state.displayRange] || 12 * 3600000);
  
  let filtered = state.history.filter((h) => h.ts >= cutoff);
  
  // 智能补充边界线：如果当前 12h/24h 周期内实时记录数少于 2 个（导致折线画不出），
  // 但我们有前几天 EOD 历史数据，我们就向上追溯引入 cutoff 之前最近的数据点，确保折线能够连通绘制
  if (filtered.length < 2) {
    const olderPoints = state.history.filter((h) => h.ts < cutoff);
    const needed = 2 - filtered.length;
    if (olderPoints.length >= needed) {
      const addition = olderPoints.slice(-needed);
      filtered = [...addition, ...filtered];
    } else if (olderPoints.length > 0) {
      filtered = [...olderPoints, ...filtered];
    }
  }
  
  return filtered;
}

function drawChart() {
  if (!chartCtx) return;
  const canvas = dom.rateChart;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  const ctx = chartCtx;
  ctx.scale(dpr, dpr);

  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  ctx.clearRect(0, 0, W, H);

  const data = getFilteredHistory();
  if (data.length < 2) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.font = '13px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('正在积累当前监控对的实时变动数据...', W / 2, H / 2);
    return;
  }

  const rates = data.map((d) => d.rate);
  const minR = Math.min(...rates);
  const maxR = Math.max(...rates);
  const range = maxR - minR || 0.001;

  const padX = 14;
  const padY = 22;
  const w = W - padX * 2;
  const h = H - padY * 2;

  const toX = (i) => padX + (i / (data.length - 1)) * w;
  const toY = (r) => padY + h - ((r - minR) / range) * h;

  // 1. 目标汇率虚线绘制
  if (state.settings.targetRate) {
    const ty = toY(state.settings.targetRate);
    if (ty >= padY && ty <= H - padY) {
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.moveTo(padX, ty);
      ctx.lineTo(W - padX, ty);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
      ctx.font = '10px JetBrains Mono';
      ctx.textAlign = 'right';
      ctx.fillText(`目标 ${state.settings.targetRate.toFixed(4)}`, W - padX - 4, ty - 4);
    }
  }

  // 2. 曲线渐变包络区域
  const areaGrad = ctx.createLinearGradient(0, padY, 0, H - padY);
  areaGrad.addColorStop(0, 'rgba(110, 231, 247, 0.22)');
  areaGrad.addColorStop(1, 'rgba(110, 231, 247, 0)');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0].rate));
  for (let i = 1; i < data.length; i++) {
    const x0 = toX(i - 1), y0 = toY(data[i - 1].rate);
    const x1 = toX(i), y1 = toY(data[i].rate);
    const cpx = (x0 + x1) / 2;
    ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
  }
  ctx.lineTo(toX(data.length - 1), H - padY);
  ctx.lineTo(toX(0), H - padY);
  ctx.closePath();
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // 3. 渐变贝塞尔折线本体
  const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
  lineGrad.addColorStop(0, '#6ee7f7');
  lineGrad.addColorStop(0.5, '#3b82f6');
  lineGrad.addColorStop(1, '#7c3aed');

  ctx.beginPath();
  ctx.moveTo(toX(0), toY(data[0].rate));
  for (let i = 1; i < data.length; i++) {
    const x0 = toX(i - 1), y0 = toY(data[i - 1].rate);
    const x1 = toX(i), y1 = toY(data[i].rate);
    const cpx = (x0 + x1) / 2;
    ctx.bezierCurveTo(cpx, y0, cpx, y1, x1, y1);
  }
  ctx.strokeStyle = lineGrad;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // 4. 最新点脉冲环
  const lastX = toX(data.length - 1);
  const lastY = toY(data[data.length - 1].rate);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#6ee7f7';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(110, 231, 247, 0.25)';
  ctx.fill();

  // 5. Y轴横线网格与刻度
  ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.font = '10px JetBrains Mono';
  ctx.textAlign = 'left';
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = minR + (range * i) / steps;
    const y = toY(v);
    ctx.fillText(v.toFixed(4), 2, y + 3);

    ctx.beginPath();
    ctx.moveTo(padX + 22, y);
    ctx.lineTo(W - padX, y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 6. 交互悬停十字光标与提示框
  canvas.onmousemove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const idx = Math.round(((mx - padX) / w) * (data.length - 1));
    if (idx < 0 || idx >= data.length) {
      dom.chartTooltip.style.opacity = 0;
      return;
    }
    const d = data[idx];
    dom.chartTooltip.style.opacity = 1;
    dom.chartTooltip.style.left = `${e.clientX - rect.left + 14}px`;
    dom.chartTooltip.style.top = `${e.clientY - rect.top - 34}px`;
    const dateObj = new Date(d.ts);
    const isMultiDay = state.displayRange.endsWith('d');
    let timeLabel = '';
    if (isMultiDay) {
      // 7天、15天、30天显示具体日期：2026-05-28
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      timeLabel = `${year}-${month}-${day}`;
    } else {
      // 12小时、24小时显示：月-日 时:分:秒
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      timeLabel = `${month}-${day} ${timeStr}`;
    }

    dom.chartTooltip.innerHTML = `<strong>${d.rate.toFixed(5)}</strong> &nbsp; <span style="opacity:0.7">${timeLabel}</span>`;
  };

  canvas.onmouseleave = () => {
    dom.chartTooltip.style.opacity = 0;
  };
}

function updateChartStats() {
  const data = getFilteredHistory();
  if (data.length === 0) {
    dom.statHigh.textContent = '--';
    dom.statLow.textContent = '--';
    dom.statAvg.textContent = '--';
    dom.statCount.textContent = '0';
    return;
  }

  const rates = data.map((d) => d.rate);
  const high = Math.max(...rates);
  const low = Math.min(...rates);
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;

  dom.statHigh.textContent = high.toFixed(4);
  dom.statLow.textContent = low.toFixed(4);
  dom.statAvg.textContent = avg.toFixed(4);
  dom.statCount.textContent = data.length;
}

/* ===========================
   多货币行情板渲染
   =========================== */
function updateRateBoard() {
  const base = state.boardBase;
  const boardEl = dom.rateBoard;
  if (!boardEl) return;

  const baseRate = state.allRates[base];
  if (!baseRate) {
    boardEl.innerHTML = '<div class="board-loading">等待汇率数据...</div>';
    return;
  }

  // 行情网格挑选 10 种有代表性的跨国商贸核心货种
  const boardCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'HKD', 'SGD', 'CNH', 'CNY'].filter(
    (c) => c !== base
  );

  let html = '';
  boardCurrencies.forEach((code) => {
    const targetVal = state.allRates[code];
    if (!targetVal) return;

    // 计算基准货币折算汇率
    const rate = targetVal / baseRate;

    const curr = CURRENCY_LIST.find((c) => c.code === code) || { flag: '🏳️', name: code };
    
    // 标记当前主监控对的状态，亮起呼吸边框
    const isCurrentActive =
      (state.fromCurrency === code && state.toCurrency === base) ||
      (state.fromCurrency === base && state.toCurrency === code);
    const activeClass = isCurrentActive ? 'board-card active-pair' : 'board-card';

    // 默认展示扁平态变动字样
    const changeClass = 'bc-change flat';
    const changeText = '— 0.00%';

    html += `
      <div class="${activeClass}" data-currency="${code}">
        <div class="bc-head">
          <span class="bc-flag">${curr.flag}</span>
          <span class="bc-code">${code}</span>
          <span class="bc-name">${curr.name}</span>
        </div>
        <span class="bc-rate">${rate.toFixed(4)}</span>
        <span class="${changeClass}">${changeText}</span>
      </div>
    `;
  });

  boardEl.innerHTML = html;

  // 绑定行情板卡片点击：支持对调并进入监控
  boardEl.querySelectorAll('.board-card').forEach((card) => {
    card.addEventListener('click', () => {
      const code = card.dataset.currency;
      let from, to;

      // 卖家结汇最常用途径：外汇转人民币。所以只要基底/卡片包含人民币，就智能将外汇设定为“转出”，人民币设为“转入”
      if (base === 'CNH' || base === 'CNY') {
        from = code;
        to = base;
      } else if (code === 'CNH' || code === 'CNY') {
        from = base;
        to = code;
      } else {
        from = base;
        to = code;
      }

      dom.fromCurrency.value = from;
      dom.toCurrency.value = to;

      onPairChanged(from, to);
      showToast('🔄', '监控切换', `已自动切换主监控币对为 ${from} → ${to}`, 2500);
    });
  });
}

/* ===========================
   提醒与报警系统 (Chord 提示音 / Title 闪烁)
   =========================== */
function checkAlerts() {
  const { monitorEnabled, alertBase, pairs } = state.settings;
  if (!monitorEnabled || !pairs || typeof pairs !== 'object') return;

  if (!state.alertFiredPairs) {
    state.alertFiredPairs = {};
  }

  const platform = getActivePlatform();
  const isWfBase = alertBase === 'wf';

  for (let pairKey in pairs) {
    const spec = pairs[pairKey];
    if (!spec || !spec.targetRate) continue;

    const parts = pairKey.split('_');
    if (parts.length !== 2) continue;

    const fromCode = parts[0];
    const toCode = parts[1];

    const usdToFrom = state.allRates[fromCode];
    const usdToTo = state.allRates[toCode];
    if (!usdToFrom || !usdToTo) continue;

    // 核心交叉汇率计算: Rate = Target_USD_value / Source_USD_value
    const currentRate = usdToTo / usdToFrom;
    const evalRate = isWfBase ? currentRate * (1 - platform.fee / 100) + platform.offset : currentRate;
    const { targetRate, direction } = spec;

    const triggered =
      (direction === 'above' && evalRate >= targetRate) ||
      (direction === 'below' && evalRate <= targetRate);

    if (triggered) {
      if (!state.alertFiredPairs[pairKey]) {
        state.alertFiredPairs[pairKey] = true;
        fireAlert(fromCode, toCode, evalRate, targetRate, direction, isWfBase, platform.name);
      }
    } else {
      state.alertFiredPairs[pairKey] = false;
    }
  }
}

function fireAlert(from, to, rate, target, direction, isWfBase, platformName) {
  const dirLabel = direction === 'above' ? '已上涨到' : '已下跌到';
  const title = `🎯 汇率目标价位已达成！`;
  const baseLabel = isWfBase ? `（${platformName}估算价）` : '（市场参考价）';
  const msg = `${from}/${to}${baseLabel}${dirLabel} ${rate.toFixed(4)}，已满足设定目标 ${target.toFixed(4)}`;

  // 显示顶部通知栏
  dom.alertBanner.classList.remove('hidden');
  dom.alertTitle.textContent = title;
  dom.alertMsg.textContent = msg;

  // 闪烁浏览器标题
  let flashCount = 0;
  const originalTitle = document.title;
  const titleTimer = setInterval(() => {
    document.title = flashCount % 2 === 0 ? `🔔 【${rate.toFixed(4)}】${from}/${to} 达标！` : originalTitle;
    flashCount++;
    if (flashCount > 12) {
      clearInterval(titleTimer);
      document.title = originalTitle;
    }
  }, 800);

  // 提示音发声
  if (state.settings.soundEnabled) {
    playAlertSound();
  }

  // 弹出固定 Toast，需要用户手动滑动关闭或永不消失
  showToast('🎯', `汇率提醒 (${from}/${to})`, msg, 0);
}

function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    // 大三和弦 C5 - E5 - G5 - C6 营造欢快清脆的提醒效果
    const chordFreqs = [523.25, 659.25, 783.99, 1046.5];
    chordFreqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = ctx.currentTime + idx * 0.12;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.2, startTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

      osc.start(startTime);
      osc.stop(startTime + 0.35);
    });
  } catch (err) {
    console.error('音频播放出错:', err);
  }
}

/* ===========================
   实时双向货币换算器
   =========================== */
function updateCalculator(direction = 'from') {
  const fromCode = dom.calcFrom.value;
  const toCode = dom.calcTo.value;

  const usdToFrom = state.allRates[fromCode];
  const usdToTo = state.allRates[toCode];

  if (!usdToFrom || !usdToTo) {
    dom.calcRateDisplay.textContent = '暂无对应汇率';
    return;
  }

  const rate = usdToTo / usdToFrom;
  dom.calcRateDisplay.textContent = `1 ${fromCode} = ${rate.toFixed(4)} ${toCode}`;

  if (direction === 'from') {
    const amount = parseFloat(dom.calcAmountFrom.value);
    if (!isNaN(amount) && amount >= 0) {
      dom.calcAmountTo.value = (amount * rate).toFixed(2);
    } else {
      dom.calcAmountTo.value = '';
    }
  } else {
    const amount = parseFloat(dom.calcAmountTo.value);
    if (!isNaN(amount) && amount >= 0) {
      dom.calcAmountFrom.value = (amount / rate).toFixed(2);
    } else {
      dom.calcAmountFrom.value = '';
    }
  }
}

/* ===========================
   设置持久化存储与合并
   =========================== */
function checkApiBudgetWarning() {
  const apiKey = localStorage.getItem('rate_oer_app_id') || '';
  const interval = parseInt(dom.refreshInterval.value, 10) || 60;
  
  if (apiKey && interval < 3600) {
    dom.apiBudgetWarning.classList.remove('hidden');
  } else {
    dom.apiBudgetWarning.classList.add('hidden');
  }
}

function saveSettingsDataOnly() {
  try {
    localStorage.setItem('rate_settings_v3', JSON.stringify(state.settings));
  } catch (err) {
    console.error('配置备份出错:', err);
  }
}

function saveApiSettings() {
  const prevKey = localStorage.getItem('rate_oer_app_id') || '';
  const newKey = dom.apiKeyInput.value.trim();
  localStorage.setItem('rate_oer_app_id', newKey);

  checkApiBudgetWarning();

  if (isServerMode) {
    fetch('/api/settings/apikey', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ oerAppId: newKey })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showToast('🔑', '密钥同步成功', 'API 密钥已同步到 NAS 后端，并在后台应用', 3000);
        fetchRate();
      } else {
        showToast('⚠️', '同步失败', '服务端保存密钥失败，请检查连接', 3000);
      }
    })
    .catch(err => {
      showToast('⚠️', '同步异常', '无法连接到服务端以同步密钥', 3000);
    });
  } else {
    if (newKey !== prevKey) {
      fetchRate();
      showToast('🔑', '密钥已更新', '新 API 密钥已保存，正在重新加载汇率...', 2500);
    } else {
      showToast('💾', '密钥已保存', 'API 密钥配置已保存', 2000);
    }
  }
}

function saveSettings() {
  state.settings.interval = parseInt(dom.refreshInterval.value, 10) || 60;
  state.settings.soundEnabled = dom.soundToggle.checked;
  state.settings.monitorEnabled = dom.monitorToggle.checked;
  state.settings.fromCurrency = state.fromCurrency;
  state.settings.toCurrency = state.toCurrency;

  // 保存提醒依据
  state.settings.alertBase = dom.btnBaseWf.classList.contains('active') ? 'wf' : 'market';

  // 币对特异性设置
  const from = dom.modalFromCurrency.value || state.fromCurrency;
  const to = dom.modalToCurrency.value || state.toCurrency;
  const pairKey = `${from}_${to}`;
  if (!state.settings.pairs) state.settings.pairs = {};

  const inputVal = parseFloat(dom.targetRate.value);
  if (!isNaN(inputVal) && inputVal > 0) {
    const prevPair = state.settings.pairs[pairKey];
    // 智能锁定价格保存时刻的实时价格作为进度条 of 0% 起跑线
    const currentBase = state.modalCurrentRate || state.currentRate || inputVal;
    const baseRate = (prevPair && prevPair.targetRate === inputVal && prevPair.direction === state.settings.direction) 
      ? (prevPair.baseRate || currentBase) 
      : currentBase;

    state.settings.pairs[pairKey] = {
      targetRate: inputVal,
      direction: state.settings.direction || 'above',
      baseRate: baseRate
    };
    if (from === state.fromCurrency && to === state.toCurrency) {
      state.settings.targetRate = inputVal;
    }
  } else {
    delete state.settings.pairs[pairKey];
    if (from === state.fromCurrency && to === state.toCurrency) {
      state.settings.targetRate = null;
    }
  }

  state.alertFired = false; // 重置触发状态，以便在达标时发出声音
  if (!state.alertFiredPairs) state.alertFiredPairs = {};
  state.alertFiredPairs[pairKey] = false;

  try {
    localStorage.setItem('rate_settings_v3', JSON.stringify(state.settings));
  } catch (err) {
    console.error('设置保存出错:', err);
  }

  restartTimer();
  updateRateDisplay();
  updateTargetStatus();
  drawChart();
  checkApiBudgetWarning();

  // 自动重新渲染右侧提醒列表并关闭配置弹窗
  renderAlertsList();
  closeAlertsModal();

  showToast('💾', '配置已保存', '到价提醒规则设置已保存并开启监控', 2500);
}

function loadSettings() {
  try {
    const saved = localStorage.getItem('rate_settings_v3');
    if (saved) {
      const parsed = JSON.parse(saved);
      state.settings = Object.assign({}, state.settings, parsed);
    }
  } catch (err) {
    console.error('设置载入出错:', err);
  }

  // 确保 pairs 是个有效对象
  if (!state.settings.pairs || typeof state.settings.pairs !== 'object') {
    state.settings.pairs = {};
  }

  // 平滑迁移旧版本的万里汇点差配置到多平台系统（更严谨的 Array 判定，使用真实费率：万里汇 0.38%、Wise 0.45%、连连支付 0.40%）
  if (!state.settings.platforms || !Array.isArray(state.settings.platforms) || state.settings.platforms.length === 0) {
    state.settings.platforms = [
      { id: 'wf', name: '万里汇', fee: state.settings.wfFee || 0.38, offset: state.settings.wfOffset || -0.0037 },
      { id: 'wise', name: 'Wise', fee: 0.45, offset: 0.0 },
      { id: 'lianlian', name: '连连支付', fee: 0.40, offset: 0.0 }
    ];
    state.settings.activePlatformId = 'wf';
  } else {
    // 自动修正此前遗留的硬编码脏数据，确保用户的默认费率是最精确的官方标准
    state.settings.platforms.forEach(p => {
      if (p.id === 'wf' && (p.fee === 0.30 || p.fee === 0.3)) {
        p.fee = 0.38;
        p.offset = -0.0037; // 自动校正偏移
      }
      if (p.id === 'wise' && (p.fee === 0.50 || p.fee === 0.5)) {
        p.fee = 0.45;
      }
      if (p.id === 'lianlian' && (p.fee === 0.70 || p.fee === 0.7)) {
        p.fee = 0.40;
      }
    });
  }

  // 加载 API Key 到 input 框中
  const apiKey = (localStorage.getItem('rate_oer_app_id') || '').trim();
  dom.apiKeyInput.value = apiKey;

  // 填充多平台下拉列表并载入当前平台
  populatePlatformSelect();
  syncPlatformEditor();

  // 加载判定依据状态
  const isWfBase = state.settings.alertBase === 'wf';
  dom.btnBaseWf.classList.toggle('active', isWfBase);
  dom.btnBaseMarket.classList.toggle('active', !isWfBase);

  // 应用通用设置到 DOM
  // 智能旧缓存校验迁移：若本地 localStorage 缓存了废弃秒数，自动安全迁移到 3600 秒（1小时）
  if (state.settings.interval !== 900 && state.settings.interval !== 3600 && state.settings.interval !== 7200 && state.settings.interval !== 86400) {
    state.settings.interval = 3600;
  }
  dom.refreshInterval.value = state.settings.interval;
  dom.soundToggle.checked = !!state.settings.soundEnabled;
  dom.monitorToggle.checked = !!state.settings.monitorEnabled;

  checkApiBudgetWarning();

  // 解析并对齐当前币对
  const from = state.settings.fromCurrency || 'USD';
  const to = state.settings.toCurrency || 'CNH';
  dom.fromCurrency.value = from;
  dom.toCurrency.value = to;

  onPairChanged(from, to);
  renderAlertsList();
}

function loadSettingsForPair(from, to) {
  const pairKey = `${from}_${to}`;
  const spec = state.settings.pairs && state.settings.pairs[pairKey];

  if (spec) {
    dom.targetRate.value = spec.targetRate || '';
    state.settings.targetRate = spec.targetRate || null;
    state.settings.direction = spec.direction || 'above';
  } else {
    dom.targetRate.value = '';
    state.settings.targetRate = null;
    state.settings.direction = 'above';
  }

  dom.btnAbove.classList.toggle('active', state.settings.direction === 'above');
  dom.btnBelow.classList.toggle('active', state.settings.direction === 'below');

  state.alertFired = false;
  updateTargetStatus();
}

/* ===========================
   本地离线数据缓存机制
   =========================== */
const CACHE_KEY = 'rate_cached_data_v3';

function saveRatesToCache() {
  try {
    const cacheData = {
      allRates: state.allRates,
      lastDataDate: lastDataDate,
      lastApiName: lastApiName,
      cnhIsApprox: cnhIsApprox,
      ts: Date.now()
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  } catch (err) {
    console.error('缓存写入失败:', err);
  }
}

function loadRatesFromCache() {
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved) {
      const cacheData = JSON.parse(saved);
      if (cacheData && cacheData.allRates && typeof cacheData.allRates === 'object') {
        state.allRates = cacheData.allRates;
        lastDataDate = cacheData.lastDataDate || '';
        lastApiName = cacheData.lastApiName || '';
        cnhIsApprox = !!cacheData.cnhIsApprox;
        return true;
      }
    }
  } catch (err) {
    console.error('离线缓存载入失败:', err);
  }
  return false;
}

/* ===========================
   汇率变动历史存储 (隔离加载)
   =========================== */
function loadHistoryForPair(from, to) {
  try {
    const key = `rate_history_v3_${from}_${to}`;
    const saved = localStorage.getItem(key);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.error('历史加载失败:', err);
  }
  return [];
}

function saveHistoryForPair(from, to, history) {
  try {
    const key = `rate_history_v3_${from}_${to}`;
    localStorage.setItem(key, JSON.stringify(history));
  } catch (err) {
    console.error('历史存储失败:', err);
  }
}

async function bootstrapHistoryInClient(from, to) {
  try {
    console.log(`[客户端自愈] 正在为本地浏览器币对 ${from}/${to} 并发拉取 30 天 CDN 汇率铺底...`);
    const daysToFetch = 30;
    const now = Date.now();
    const fetchPromises = [];

    for (let i = daysToFetch; i > 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      fetchPromises.push((async () => {
        const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateStr}/v1/currencies/usd.json`;
        try {
          const res = await fetch(url);
          if (!res.ok) return null;
          const data = await res.json();
          const rawRates = data.usd || data.USD;
          if (!rawRates) return null;

          const rates = {};
          for (let key in rawRates) {
            rates[key.toUpperCase()] = parseFloat(rawRates[key]);
          }
          rates['USD'] = 1.0;
          
          if (!rates['CNH'] && rates['CNY']) rates['CNH'] = rates['CNY'];
          if (!rates['CNY'] && rates['CNH']) rates['CNY'] = rates['CNH'];

          const usdToFrom = rates[from.toUpperCase()];
          const usdToTo = rates[to.toUpperCase()];
          if (!usdToFrom || !usdToTo) return null;

          return {
            ts: date.getTime(),
            rate: usdToTo / usdToFrom,
            change: 0
          };
        } catch {
          return null;
        }
      })());
    }

    const results = await Promise.all(fetchPromises);
    const validResults = results.filter(r => r !== null).sort((a, b) => a.ts - b.ts);

    if (validResults.length > 0) {
      for (let i = 1; i < validResults.length; i++) {
        validResults[i].change = validResults[i].rate - validResults[i - 1].rate;
      }
      console.log(`[客户端自愈] 成功为 ${from}/${to} 补全并去重导入了 ${validResults.length} 天的历史走势数据`);
      return validResults;
    }
  } catch (err) {
    console.warn('[客户端自愈] 铺底拉取失败:', err.message);
  }
  return [];
}

function saveHistory() {
  saveHistoryForPair(state.fromCurrency, state.toCurrency, state.history);
}

function loadHistory() {
  state.history = loadHistoryForPair(state.fromCurrency, state.toCurrency);
  if (state.history.length > 0) {
    const last = state.history[state.history.length - 1];
    state.currentRate = last.rate;
    updateRateDisplay();
    renderHistoryTable();
    updateChartStats();
  }
}

function clearHistory() {
  state.history = [];
  saveHistory();
  renderHistoryTable();
  updateChartStats();
  drawChart();
  updateTargetStatus();
  showToast('🧹', '记录已清空', `已清空主监控对 ${state.fromCurrency}/${state.toCurrency} 的本地历史`, 2500);
}

/* ===========================
   监控状态面板与历史行更新
   =========================== */
function updateTargetStatus() {
  const targetRate = state.settings.targetRate;
  const direction = state.settings.direction;
  const rate = state.currentRate;
  const alertBase = state.settings.alertBase || 'wf';
  const isWfBase = alertBase === 'wf';
  const platform = getActivePlatform();

  if (!targetRate) {
    dom.displayTarget.textContent = '未设置';
    dom.displayDirection.textContent = '--';
    dom.displayDiff.textContent = '--';
    dom.displayDiff.style.color = 'var(--text-muted)';
    dom.progressFill.style.width = '0%';
    dom.progressPct.textContent = '0.0%';
    return;
  }

  const currTo = CURRENCY_LIST.find((c) => c.code === state.toCurrency) || { symbol: '¥' };
  dom.displayTarget.textContent = `${currTo.symbol}${targetRate.toFixed(4)} (${isWfBase ? platform.name + '估算价' : '市场价'})`;
  dom.displayDirection.textContent = (direction === 'above' ? '📈 高于' : '📉 低于') + `目标时提醒`;

  if (rate) {
    const evalRate = isWfBase ? rate * (1 - platform.fee / 100) + platform.offset : rate;
    const diff = evalRate - targetRate;
    const diffSign = diff >= 0 ? '+' : '';
    dom.displayDiff.textContent = `${diffSign}${diff.toFixed(4)}`;
    dom.displayDiff.style.color = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

    // 智能读取价格设定时刻的基准起跑线价格，以获得高精确度的进度条指示
    const pairKey = `${state.fromCurrency}_${state.toCurrency}`;
    const spec = state.settings.pairs && state.settings.pairs[pairKey];
    let rawBaseRate = spec && spec.baseRate;
    if (!rawBaseRate) {
      rawBaseRate = state.history.length > 0
        ? state.history[0].rate
        : rate * (direction === 'above' ? 0.98 : 1.02);
    }

    const baseRate = isWfBase ? rawBaseRate * (1 - platform.fee / 100) + platform.offset : rawBaseRate;

    let pct = 0;
    if (direction === 'above') {
      if (evalRate >= targetRate) {
        pct = 100;
      } else if (targetRate !== baseRate) {
        pct = ((evalRate - baseRate) / (targetRate - baseRate)) * 100;
      }
    } else {
      if (evalRate <= targetRate) {
        pct = 100;
      } else if (baseRate !== targetRate) {
        pct = ((baseRate - evalRate) / (baseRate - targetRate)) * 100;
      }
    }

    pct = Math.min(100, Math.max(0, pct));
    dom.progressFill.style.width = `${pct.toFixed(1)}%`;
    dom.progressPct.textContent = `${pct.toFixed(1)}%`;
  }

  const monitorStatus = state.settings.monitorEnabled
    ? `<span class="badge badge-green">运行中 (${isWfBase ? '估算价' : '市场价'})</span>`
    : '<span class="badge badge-amber">已暂停</span>';
  dom.displayMonitorStatus.innerHTML = monitorStatus;
}

function addHistoryRow(entry) {
  const tbody = dom.historyBody;
  if (!tbody) return;

  const emptyRow = tbody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  tr.className = 'new-row';

  const time = new Date(entry.ts).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const changeDir = entry.change > 0.00005 ? '▲' : entry.change < -0.00005 ? '▼' : '—';
  const changeClass = entry.change > 0.00005 ? 'rate-up' : entry.change < -0.00005 ? 'rate-down' : 'rate-flat';

  const { targetRate, direction } = state.settings;
  let statusBadge = '';
  if (targetRate) {
    const hit =
      (direction === 'above' && entry.rate >= targetRate) ||
      (direction === 'below' && entry.rate <= targetRate);
    statusBadge = hit
      ? '<span class="badge badge-green">✓ 达标</span>'
      : '<span class="badge badge-amber">监控中</span>';
  } else {
    statusBadge = '<span class="badge" style="color:var(--text-muted)">未设目标</span>';
  }

  tr.innerHTML = `
    <td>${time}</td>
    <td style="color:var(--text-primary);font-weight:600">${entry.rate.toFixed(4)}</td>
    <td class="${changeClass}">${changeDir} ${Math.abs(entry.change).toFixed(4)}</td>
    <td>${statusBadge}</td>
  `;

  tbody.insertBefore(tr, tbody.firstChild);

  while (tbody.children.length > 50) {
    tbody.removeChild(tbody.lastChild);
  }
}

function renderHistoryTable() {
  const tbody = dom.historyBody;
  if (!tbody) return;

  tbody.innerHTML = '';
  if (state.history.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">暂无数据，等待第一次刷新...</td></tr>';
    return;
  }

  const reversed = [...state.history].reverse();
  reversed.forEach((entry) => {
    const tr = document.createElement('tr');
    const time = new Date(entry.ts).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const changeDir = entry.change > 0.00005 ? '▲' : entry.change < -0.00005 ? '▼' : '—';
    const changeClass = entry.change > 0.00005 ? 'rate-up' : entry.change < -0.00005 ? 'rate-down' : 'rate-flat';

    const { targetRate, direction } = state.settings;
    let statusBadge = '';
    if (targetRate) {
      const hit =
        (direction === 'above' && entry.rate >= targetRate) ||
        (direction === 'below' && entry.rate <= targetRate);
      statusBadge = hit
        ? '<span class="badge badge-green">✓ 达标</span>'
        : '<span class="badge badge-amber">监控中</span>';
    } else {
      statusBadge = '<span class="badge" style="color:var(--text-muted)">未设目标</span>';
    }

    tr.innerHTML = `
      <td>${time}</td>
      <td style="color:var(--text-primary);font-weight:600">${entry.rate.toFixed(4)}</td>
      <td class="${changeClass}">${changeDir} ${Math.abs(entry.change).toFixed(4)}</td>
      <td>${statusBadge}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===========================
   事件总线与币对切换
   =========================== */
function onPairChanged(from, to) {
  state.fromCurrency = from;
  state.toCurrency = to;
  state.prevRate = null;
  state.currentRate = null;

  updateFlags();

  // 1. 动态加载币对历史并重刷表格
  if (isServerMode) {
    fetchHistoryFromServer(from, to).then(history => {
      if (state.fromCurrency === from && state.toCurrency === to) {
        state.history = history;
        renderHistoryTable();
        updateChartStats();
        drawChart();
        updateTargetStatus();
      }
    });
  } else {
    state.history = loadHistoryForPair(from, to);
    // 客户端自愈铺底：若本地 localStorage 缓存为空，则开启异步 30 天历史快照获取，拉满首开图表
    if (state.history.length === 0) {
      bootstrapHistoryInClient(from, to).then(history => {
        if (state.fromCurrency === from && state.toCurrency === to && history.length > 0) {
          state.history = history;
          saveHistoryForPair(from, to, history);
          renderHistoryTable();
          updateChartStats();
          drawChart();
          updateTargetStatus();
        }
      });
    }
    renderHistoryTable();
  }

  // 2. 更新面板和标签
  dom.labelPair.textContent = `${from}/${to}`;
  dom.historyPairLabel.textContent = `${from}/${to}`;
  dom.displayPair.textContent = `${from} → ${to}`;

  // 3. 动态载入当前币对的提醒参数
  loadSettingsForPair(from, to);

  // 4. 重算并触发绘图
  if (Object.keys(state.allRates).length > 0) {
    onRatesReceived();
  } else {
    fetchRate();
  }

  // 5. 刷新下方指示小点以对齐高亮状态
  renderMonitorDots();
}

/* ===========================
   多平台结汇管理配置逻辑
   =========================== */
function populatePlatformSelect() {
  const select = dom.activePlatformSelect;
  if (!select) return;
  select.innerHTML = state.settings.platforms.map(
    p => `<option value="${p.id}">${p.name}</option>`
  ).join('');
  select.value = state.settings.activePlatformId;
}

function syncPlatformEditor() {
  const activeId = state.settings.activePlatformId;
  const platform = state.settings.platforms.find(p => p.id === activeId);
  if (!platform) return;
  dom.platformNameInput.value = platform.name;
  dom.platformFeeInput.value = platform.fee.toFixed(2);
  dom.platformOffsetInput.value = platform.offset.toFixed(4);
  
  // 同步更新到价提醒的判定切换按钮文字
  dom.btnBaseWf.textContent = `${platform.name}估算价`;
  
  // 刷新状态判定
  updateTargetStatus();
}

/* ===========================
   管理多组提醒的渲染与删除逻辑
   =========================== */
function renderAlertsList() {
  const container = dom.panelAlertsList;
  if (!container) return;
  container.innerHTML = '';

  // 同步刷新监控状态卡片底部的切换指示小点
  renderMonitorDots();

  const pairs = state.settings.pairs;
  if (!pairs || Object.keys(pairs).length === 0) {
    container.innerHTML = `
      <div class="no-alerts-hint" style="padding: 25px 10px;">
        📂 暂无任何监控提醒规则。<br>
        <span style="font-size:0.75rem; opacity:0.75; display:block; margin-top:4px;">您可以点击下方按钮添加新监控。</span>
      </div>
    `;
    return;
  }

  const platform = getActivePlatform();
  const alertBase = state.settings.alertBase || 'wf';
  const isWfBase = alertBase === 'wf';

  for (let pairKey in pairs) {
    const spec = pairs[pairKey];
    if (!spec || !spec.targetRate) continue;

    const parts = pairKey.split('_');
    if (parts.length !== 2) continue;
    const fromCode = parts[0];
    const toCode = parts[1];

    const card = document.createElement('div');
    card.className = 'alert-item-card';
    card.dataset.pair = pairKey;
    card.dataset.from = fromCode;
    card.dataset.to = toCode;
    card.style.padding = '8px 10px';
    card.style.marginBottom = '6px';

    const dirBadge = spec.direction === 'above' 
      ? '<span class="alert-item-badge above" style="padding:1px 4px; font-size:0.65rem;">📈 高于</span>' 
      : '<span class="alert-item-badge below" style="padding:1px 4px; font-size:0.65rem;">📉 低于</span>';

    const baseName = isWfBase ? `${platform.name}估算` : '市场价';

    card.innerHTML = `
      <div class="alert-item-left" style="gap:2px;">
        <span class="alert-item-pair" style="font-size:0.85rem;">${fromCode} → ${toCode}</span>
        <div class="alert-item-details" style="font-size:0.7rem; gap:4px;">
          ${dirBadge}
          <span style="color:var(--accent-cyan); font-weight:600;">🎯 ${spec.targetRate.toFixed(4)}</span>
          <span style="opacity:0.6; font-size:0.68rem;">(${baseName})</span>
        </div>
      </div>
      <div style="display: flex; gap: 4px;">
        <button class="btn-delete-alert btn-edit-alert" data-pair="${pairKey}" style="background:rgba(124,58,237,0.08); border-color:rgba(124,58,237,0.25); color:var(--accent-purple); padding:4px 8px; font-size:0.68rem;" type="button">✏️ 编辑</button>
        <button class="btn-delete-alert" data-pair="${pairKey}" style="padding:4px 8px; font-size:0.68rem;" type="button">🗑️</button>
      </div>
    `;

    // 点击卡片主体：载入当前币对并高亮图表
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-alert') || e.target.classList.contains('btn-edit-alert')) return;
      const from = card.dataset.from;
      const to = card.dataset.to;

      dom.fromCurrency.value = from;
      dom.toCurrency.value = to;

      onPairChanged(from, to);
      showToast('🔄', '图表监控对已载入', `已切换折线走势图为 ${from} → ${to}`, 2500);
    });

    // 编辑按钮：打开弹窗进行编辑修改
    card.querySelector('.btn-edit-alert').addEventListener('click', (e) => {
      e.stopPropagation();
      const from = card.dataset.from;
      const to = card.dataset.to;

      // 切换主页面选择
      dom.fromCurrency.value = from;
      dom.toCurrency.value = to;
      onPairChanged(from, to);

      // 加载并打开编辑弹窗
      openAlertsModal('edit');
    });

    // 删除按钮
    card.querySelector('.btn-delete-alert:not(.btn-edit-alert)').addEventListener('click', (e) => {
      e.stopPropagation();
      const key = e.target.dataset.pair;
      deleteAlertPair(key);
    });

    container.appendChild(card);
  }
}

function deleteAlertPair(pairKey) {
  if (confirm(`确定要彻底删除 [${pairKey.replace('_', ' → ')}] 的到价提醒规则吗？`)) {
    if (state.settings.pairs) {
      delete state.settings.pairs[pairKey];
    }

    const currentPairKey = `${state.fromCurrency}_${state.toCurrency}`;
    if (currentPairKey === pairKey) {
      dom.targetRate.value = '';
      state.settings.targetRate = null;
    }

    saveSettingsDataOnly();
    updateTargetStatus();
    drawChart();
    renderAlertsList();

    showToast('🗑️', '提醒已删除', '该汇率提醒规则已被彻底删除', 2500);
  }
}

function renderMonitorDots() {
  const container = dom.monitorDotsContainer;
  if (!container) return;
  container.innerHTML = '';

  const pairs = state.settings.pairs;
  if (!pairs || Object.keys(pairs).length === 0) {
    return;
  }

  const pairKeys = Object.keys(pairs).filter(key => pairs[key] && pairs[key].targetRate);
  if (pairKeys.length === 0) return;

  const currentPairKey = `${state.fromCurrency}_${state.toCurrency}`;

  pairKeys.forEach((pairKey) => {
    const parts = pairKey.split('_');
    if (parts.length !== 2) return;
    const fromCode = parts[0];
    const toCode = parts[1];

    const dot = document.createElement('div');
    dot.className = 'monitor-dot';
    if (pairKey === currentPairKey) {
      dot.classList.add('active');
    }
    
    // 悬停气泡提示，提升操作直观度
    dot.title = `${fromCode} → ${toCode} (🎯 ${pairs[pairKey].targetRate.toFixed(4)})`;

    dot.addEventListener('click', () => {
      if (pairKey !== currentPairKey) {
        dom.fromCurrency.value = fromCode;
        dom.toCurrency.value = toCode;
        onPairChanged(fromCode, toCode);
        showToast('🔄', '切换监控对', `已切换主监控为 ${fromCode} → ${toCode}`, 2000);
      }
    });

    container.appendChild(dot);
  });
}

function onModalPairChanged() {
  const fromCode = dom.modalFromCurrency.value;
  const toCode = dom.modalToCurrency.value;

  // 1. 更新模态框标题和提示标签
  const isEdit = state.modalMode === 'edit';
  dom.modalAlertTitle.textContent = isEdit
    ? `✏️ 编辑到价提醒 (${fromCode}/${toCode})` 
    : `➕ 新增到价提醒 (${fromCode}/${toCode})`;

  // 2. 更新输入框前缀符号
  const toCurr = CURRENCY_LIST.find((c) => c.code === toCode) || { symbol: '¥' };
  dom.targetPrefix.textContent = toCurr.symbol;

  // 3. 计算并动态更新当前汇率
  const usdToFrom = state.allRates[fromCode];
  const usdToTo = state.allRates[toCode];
  
  if (usdToFrom && usdToTo) {
    const calculatedRate = usdToTo / usdToFrom;
    state.modalCurrentRate = calculatedRate;
  } else {
    state.modalCurrentRate = null;
  }

  // 4. 更新 label-pair 展示，在旁边直观展示当前的本地汇率，免去额外网络查询
  if (state.modalCurrentRate) {
    dom.labelPair.innerHTML = `${fromCode}/${toCode} <span style="font-weight: normal; opacity: 0.8; margin-left: 8px;">当前本地汇率: <strong style="color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace;">${state.modalCurrentRate.toFixed(4)}</strong></span>`;
  } else {
    dom.labelPair.textContent = `${fromCode}/${toCode}`;
  }

  // 5. 如果是新增模式，币种改变时默认将当前计算出的汇率填入输入框
  if (state.modalMode === 'add' && state.modalCurrentRate) {
    dom.targetRate.value = state.modalCurrentRate.toFixed(4);
  }
}

function openAlertsModal(mode = 'add') {
  state.modalMode = mode;
  
  const from = state.fromCurrency;
  const to = state.toCurrency;
  
  // 初始化模态框中的币种下拉选择框
  if (dom.modalFromCurrency) dom.modalFromCurrency.value = from;
  if (dom.modalToCurrency) dom.modalToCurrency.value = to;

  // 初始化模态框相关的标签和当前值汇率
  onModalPairChanged();

  // 同步提醒依据的选中状态
  const alertBase = state.settings.alertBase || 'wf';
  if (dom.btnBaseMarket) dom.btnBaseMarket.classList.toggle('active', alertBase === 'market');
  if (dom.btnBaseWf) dom.btnBaseWf.classList.toggle('active', alertBase === 'wf');

  if (mode === 'add') {
    state.settings.direction = 'above';
    dom.btnAbove.classList.add('active');
    dom.btnBelow.classList.remove('active');
  } else {
    loadSettingsForPair(from, to);
  }

  dom.alertsModal.classList.remove('hidden');
}

function closeAlertsModal() {
  dom.alertsModal.classList.add('hidden');
}

function bindEvents() {
  // 主面板下拉框监听
  dom.fromCurrency.addEventListener('change', () => {
    onPairChanged(dom.fromCurrency.value, dom.toCurrency.value);
  });

  dom.toCurrency.addEventListener('change', () => {
    onPairChanged(dom.fromCurrency.value, dom.toCurrency.value);
  });

  // 主面板币对互换
  dom.swapBtn.addEventListener('click', () => {
    const from = dom.fromCurrency.value;
    const to = dom.toCurrency.value;

    dom.fromCurrency.value = to;
    dom.toCurrency.value = from;

    onPairChanged(to, from);
    showToast('⇄', '币种对调', `监控方向已对调为 ${to} → ${from}`, 2000);
  });

  // 提醒方向设置切换
  dom.btnAbove.addEventListener('click', () => {
    dom.btnAbove.classList.add('active');
    dom.btnBelow.classList.remove('active');
    state.settings.direction = 'above';
  });

  dom.btnBelow.addEventListener('click', () => {
    dom.btnBelow.classList.add('active');
    dom.btnAbove.classList.remove('active');
    state.settings.direction = 'below';
  });

  // 填充当前值按钮
  dom.useCurrentBtn.addEventListener('click', () => {
    const rate = state.modalCurrentRate || state.currentRate;
    if (rate) {
      dom.targetRate.value = rate.toFixed(4);
    } else {
      showToast('⚠️', '提示', '请等待最新汇率数据加载完成', 2000);
    }
  });

  // 模态框币种切换联动
  if (dom.modalFromCurrency) {
    dom.modalFromCurrency.addEventListener('change', onModalPairChanged);
  }
  if (dom.modalToCurrency) {
    dom.modalToCurrency.addEventListener('change', onModalPairChanged);
  }

  // 快捷微调加减按钮（仅对目标提醒内的快捷增减按钮生效，避开平台配置按钮）
  document.querySelectorAll('.quick-targets .quick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const offset = parseFloat(btn.dataset.offset);
      const base = state.currentRate || parseFloat(dom.targetRate.value) || 0.0;
      if (!base) {
        showToast('⚠️', '提示', '暂无可用汇率基数，无法微调', 2500);
        return;
      }
      dom.targetRate.value = (base + offset).toFixed(4);
    });
  });

  // 刷新时段设定
  dom.refreshInterval.addEventListener('change', () => {
    state.settings.interval = parseInt(dom.refreshInterval.value, 10) || 60;
    checkApiBudgetWarning();
  });

  // API 密钥可见性切换
  dom.toggleKeyVisibility.addEventListener('click', () => {
    if (dom.apiKeyInput.type === 'password') {
      dom.apiKeyInput.type = 'text';
      dom.toggleKeyVisibility.textContent = '🙈';
    } else {
      dom.apiKeyInput.type = 'password';
      dom.toggleKeyVisibility.textContent = '👁️';
    }
  });

  // 判定依据选择切换
  dom.btnBaseMarket.addEventListener('click', () => {
    dom.btnBaseMarket.classList.add('active');
    dom.btnBaseWf.classList.remove('active');
    state.settings.alertBase = 'market';
    updateTargetStatus();
  });

  dom.btnBaseWf.addEventListener('click', () => {
    dom.btnBaseWf.classList.add('active');
    dom.btnBaseMarket.classList.remove('active');
    state.settings.alertBase = 'wf';
    updateTargetStatus();
  });

  // 监控开关
  dom.monitorToggle.addEventListener('change', () => {
    state.settings.monitorEnabled = dom.monitorToggle.checked;
    updateTargetStatus();
  });

  // 音频声音复选框
  dom.soundToggle.addEventListener('change', () => {
    state.settings.soundEnabled = dom.soundToggle.checked;
  });

  // 警告横幅关闭
  dom.alertClose.addEventListener('click', () => {
    dom.alertBanner.classList.add('hidden');
  });

  // 保存 API 密钥按钮监听
  dom.btnSaveApi.addEventListener('click', saveApiSettings);

  // 保存设置按钮
  dom.saveSettings.addEventListener('click', saveSettings);

  // 清空历史按钮
  dom.clearHistory.addEventListener('click', () => {
    if (confirm(`确定要清空 ${state.fromCurrency}/${state.toCurrency} 的所有汇率日志记录吗？`)) {
      clearHistory();
    }
  });

  // 图表时间间隔 Tab
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.displayRange = btn.dataset.range;
      drawChart();
    });
  });

  // 换算器下拉选择
  dom.calcFrom.addEventListener('change', () => {
    updateFlags();
    updateCalculator('from');
  });

  dom.calcTo.addEventListener('change', () => {
    updateFlags();
    updateCalculator('from');
  });

  // 换算器双向数据监听
  dom.calcAmountFrom.addEventListener('input', () => updateCalculator('from'));
  dom.calcAmountTo.addEventListener('input', () => updateCalculator('to'));

  // 换算器对换按钮
  dom.calcSwapBtn.addEventListener('click', () => {
    const fromCode = dom.calcFrom.value;
    const toCode = dom.calcTo.value;
    const fromVal = dom.calcAmountFrom.value;

    dom.calcFrom.value = toCode;
    dom.calcTo.value = fromCode;
    dom.calcAmountFrom.value = fromVal;

    updateFlags();
    updateCalculator('from');
  });

  // 行情网格基准切换
  dom.boardBase.addEventListener('change', () => {
    state.boardBase = dom.boardBase.value;
    updateRateBoard();
  });

  // 窗口重设大小以重绘 Canvas 折线
  window.addEventListener('resize', () => {
    drawChart();
  });

  // 多平台下拉列表切换监听
  dom.activePlatformSelect.addEventListener('change', () => {
    state.settings.activePlatformId = dom.activePlatformSelect.value;
    syncPlatformEditor();
    saveSettingsDataOnly();
    updateRateDisplay();
  });

  // 保存平台参数按钮监听
  dom.btnSavePlatform.addEventListener('click', () => {
    const activeId = state.settings.activePlatformId;
    const platform = state.settings.platforms.find(p => p.id === activeId);
    if (!platform) return;

    const newName = dom.platformNameInput.value.trim();
    if (!newName) {
      showToast('⚠️', '保存失败', '平台名称不能为空', 2500);
      return;
    }

    platform.name = newName;
    platform.fee = parseFloat(dom.platformFeeInput.value) || 0.0;
    platform.offset = parseFloat(dom.platformOffsetInput.value) || 0.0;

    populatePlatformSelect();
    saveSettingsDataOnly();
    updateRateDisplay();

    showToast('💾', '平台更改已保存', `平台 [${platform.name}] 点差与校准偏移量已生效`, 2500);
  });

  // 新增平台配置按钮监听
  dom.btnAddPlatform.addEventListener('click', () => {
    const newId = 'platform_' + Date.now();
    const newPlatform = {
      id: newId,
      name: '新平台',
      fee: 0.30,
      offset: 0.0
    };
    state.settings.platforms.push(newPlatform);
    state.settings.activePlatformId = newId;

    populatePlatformSelect();
    syncPlatformEditor();
    saveSettingsDataOnly();
    updateRateDisplay();

    showToast('➕', '已新增平台', '平台创建成功，请在上方输入参数并保存', 3000);
  });

  // 删除平台配置按钮监听
  dom.btnDeletePlatform.addEventListener('click', () => {
    if (state.settings.platforms.length <= 1) {
      showToast('⚠️', '无法删除', '必须保留至少一个结汇平台配置', 2500);
      return;
    }
    const activeId = state.settings.activePlatformId;
    const index = state.settings.platforms.findIndex(p => p.id === activeId);
    const name = state.settings.platforms[index].name;

    if (confirm(`确定要彻底删除平台 [${name}] 的所有参数配置吗？`)) {
      state.settings.platforms.splice(index, 1);
      state.settings.activePlatformId = state.settings.platforms[0].id;

      populatePlatformSelect();
      syncPlatformEditor();
      saveSettingsDataOnly();
      updateRateDisplay();

      showToast('🗑️', '已删除平台', `平台 [${name}] 的配置已被彻底删除`, 2500);
    }
  });

  // 管理多组提醒 Modal 事件绑定
  if (dom.btnAddAlertTrigger) {
    dom.btnAddAlertTrigger.addEventListener('click', () => openAlertsModal('add'));
  }
  if (dom.closeAlertsModal) {
    dom.closeAlertsModal.addEventListener('click', closeAlertsModal);
  }
  if (dom.alertsModal) {
    dom.alertsModal.addEventListener('click', (e) => {
      if (e.target === dom.alertsModal) {
        closeAlertsModal();
      }
    });
  }

  // 禁用所有数字输入框滚动滚轮修改数值的默认浏览器行为，并失去焦点防止滚动误触
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    input.addEventListener('wheel', (e) => {
      e.preventDefault();
      input.blur();
    }, { passive: false });
  });
}

function restartTimer() {
  if (state.intervalTimer) clearInterval(state.intervalTimer);
  const seconds = state.settings.interval || 60;
  state.intervalTimer = setInterval(fetchRate, seconds * 1000);
}

/* ===========================
   弹出式 Toast 通知构造器
   =========================== */
function showToast(icon, title, msg, duration = 4000) {
  const container = dom.toastContainer;
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-body" style="flex: 1; min-width: 0;">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div>
    </div>
    <button class="toast-close-btn" type="button" title="关闭">✕</button>
  `;
  container.appendChild(toast);

  // 绑定关闭按钮事件
  const closeBtn = toast.querySelector('.toast-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toast.style.animation = 'toastOut 0.35s ease forwards';
      setTimeout(() => toast.remove(), 350);
    });
  }

  if (duration > 0) {
    setTimeout(() => {
      // 检查 toast 元素是否依然在 DOM 中再进行淡出移除
      if (toast.parentNode) {
        toast.style.animation = 'toastOut 0.35s ease forwards';
        setTimeout(() => toast.remove(), 350);
      }
    }, duration);
  }
}

/* ===========================
   初始化装载入口
   =========================== */
async function init() {
  populateSelects();
  updateFlags();
  
  initBgCanvas();
  initChart();
  bindEvents();

  // 优先从本地加载缓存汇率，实现瞬间首屏渲染
  loadRatesFromCache();

  // 从 localstorage 读取系统配置
  loadSettings();

  // 首次运行获取最新数据（后台异步刷新）
  fetchRate();

  // 开启主轮询
  restartTimer();
}

document.addEventListener('DOMContentLoaded', init);
