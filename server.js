const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 80;

// 数据存储路径设置 (支持挂载群晖持久卷)
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

app.use(express.json());
app.use(express.static(__dirname)); // 托管静态网页文件

// 内存中缓存的最新的汇率和时间数据
let currentCache = {
  rates: {},
  date: '',
  nextUpdate: '',
  source: '未激活'
};

/* ===========================
   工具函数
   =========================== */
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // 初始化配置文件
    try {
      await fs.access(CONFIG_FILE);
    } catch {
      await fs.writeFile(CONFIG_FILE, JSON.stringify({ oerAppId: '' }, null, 2));
    }

    // 初始化设置文件
    try {
      await fs.access(SETTINGS_FILE);
    } catch {
      await fs.writeFile(SETTINGS_FILE, JSON.stringify({}, null, 2));
    }

    // 初始化历史文件
    try {
      await fs.access(HISTORY_FILE);
    } catch {
      await fs.writeFile(HISTORY_FILE, JSON.stringify([], null, 2));
    }
  } catch (err) {
    console.error('[初始化] 创建存储失败:', err);
  }
}

async function getConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { oerAppId: '' };
  }
}

async function saveConfig(config) {
  try {
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('[配置] 写入配置失败:', err);
  }
}

async function getHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveHistory(history) {
  try {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error('[历史] 写入历史失败:', err);
  }
}

/* ===========================
   历史数据初始化铺底 (Bootstrap 30天)
   =========================== */
async function bootstrapHistory() {
  try {
    const history = await getHistory();
    // 如果记录数较多（说明已经成功铺底并积累了），则跳过
    if (history.length >= 20) {
      console.log(`[初始化] 历史数据库已有 ${history.length} 条记录，跳过首次铺底。`);
      return;
    }

    console.log('[初始化] 正在开启 30 天历史汇率自动铺底与智能合并程序...');
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

          // 格式化为大写
          const rates = {};
          for (let key in rawRates) {
            rates[key.toUpperCase()] = parseFloat(rawRates[key]);
          }
          rates['USD'] = 1.0;
          
          // CNY/CNH 互补兼容
          if (!rates['CNH'] && rates['CNY']) rates['CNH'] = rates['CNY'];
          if (!rates['CNY'] && rates['CNH']) rates['CNY'] = rates['CNH'];

          const ts = date.getTime();
          return { ts, rates, date: dateStr };
        } catch {
          return null;
        }
      })());
    }

    const results = await Promise.all(fetchPromises);
    const validResults = results.filter(r => r !== null);

    if (validResults.length > 0) {
      // 智能合并：将已有的个别单点记录与铺底的 30 天数据合并，按日期去重并排序，实现完美无缝首屏
      const merged = [...validResults, ...history];
      const uniqueMap = new Map();
      merged.forEach(item => {
        const dStr = item.date || new Date(item.ts).toISOString().split('T')[0];
        uniqueMap.set(dStr, item);
      });
      const finalHistory = Array.from(uniqueMap.values()).sort((a, b) => a.ts - b.ts);

      await saveHistory(finalHistory);
      console.log(`[初始化] 历史记录铺底成功！智能合并后共有 ${finalHistory.length} 条历史汇率数据。`);
    } else {
      console.log('[初始化] 历史记录铺底未获取到有效数据，将在后续刷新中自动积累。');
    }
  } catch (err) {
    console.warn('[初始化] 铺底逻辑发生异常:', err.message);
  }
}

/* ===========================
   后台定时汇率拉取引擎
   =========================== */
async function fetchAndRecordRates() {
  console.log('[定时轮询] 正在拉取云端最新汇率数据...');
  const config = await getConfig();
  const oerAppId = config.oerAppId ? config.oerAppId.trim() : '';

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
          nextUpdate: new Date(lastUpdateTs + 3600000).toLocaleString('zh-CN', {
            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
          })
        };
      }
    });
  }

  APIS.push(
    {
      name: 'Open ER-API (备用源)',
      url: 'https://open.er-api.com/v6/latest/USD',
      parse: (data) => ({
        rates: data.rates,
        date: data.time_last_update_utc ? new Date(data.time_last_update_utc).toLocaleDateString('zh-CN') : '',
        nextUpdate: data.time_next_update_utc ? new Date(data.time_next_update_utc).toLocaleString('zh-CN', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
        }) : ''
      })
    },
    {
      name: 'FawazAhmed (备用源)',
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      parse: (data) => ({
        rates: data.usd || data.USD,
        date: data.date || '',
        nextUpdate: ''
      })
    }
  );

  for (let api of APIS) {
    try {
      const res = await fetch(api.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const parsed = api.parse(json);
      const rawRates = parsed.rates;

      if (!rawRates || typeof rawRates !== 'object') {
        throw new Error('格式有误');
      }

      // 格式化为大写
      const rates = {};
      for (let key in rawRates) {
        rates[key.toUpperCase()] = parseFloat(rawRates[key]);
      }
      rates['USD'] = 1.0;

      // CNY/CNH 互补兼容
      if (!rates['CNH'] && rates['CNY']) rates['CNH'] = rates['CNY'];
      if (!rates['CNY'] && rates['CNH']) rates['CNY'] = rates['CNH'];

      // 更新系统缓存
      currentCache = {
        rates,
        date: parsed.date,
        nextUpdate: parsed.nextUpdate,
        source: api.name
      };

      // 写入到历史记录文件中
      const ts = Date.now();
      const history = await getHistory();
      
      // 防止重复写入（10分钟内不重复记录同一数据点）
      const lastEntry = history[history.length - 1];
      if (!lastEntry || (ts - lastEntry.ts > 600000)) {
        history.push({ ts, rates, date: parsed.date });
        
        // 限制存储总量，历史只保留 60 天的小时采样点（60 * 24 = 1440点），防止文件过大
        if (history.length > 1500) {
          history.shift();
        }
        await saveHistory(history);
      }

      console.log(`[定时轮询] 汇率抓取成功，当前数据源：${api.name}，更新时间：${parsed.date}`);
      
      // 触发服务器多通道汇率警报检测
      checkServerAlerts(rates);
      
      return;
    } catch (err) {
      console.warn(`[定时轮询] 尝试使用 ${api.name} 失败:`, err.message);
    }
  }
  console.error('[定时轮询] 严重错误：所有数据源均无法访问！');
}

/* ===========================
   API 路由定义
   =========================== */

// 1. 获取当前最新汇率缓存
app.get('/api/rates', (req, res) => {
  if (Object.keys(currentCache.rates).length === 0) {
    // 缓存为空则触发即时获取
    fetchAndRecordRates().then(() => {
      res.json(currentCache);
    }).catch(() => {
      res.status(503).json({ error: '数据源暂不可用' });
    });
  } else {
    res.json(currentCache);
  }
});

// 2. 获取某一币对的历史走势曲线
app.get('/api/history', async (req, res) => {
  const { from = 'USD', to = 'CNH' } = req.query;
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  try {
    let history = await getHistory();
    
    // 智能自愈：如果检测到当前磁盘记录数太少（如小于 15 条，说明未完成首屏铺底），则在请求时立即触发并合并
    if (history.length < 15) {
      console.log(`[自动修复] 检测到历史记录偏少 (${history.length} 条)，正立即执行 30 天自动铺底自愈...`);
      await bootstrapHistory();
      history = await getHistory(); // 重新读取最新合并的数据
    }

    // 映射出该币对的交叉汇率历史
    const mapped = history.map(h => {
      const usdToFrom = h.rates[fromUpper];
      const usdToTo = h.rates[toUpper];
      if (!usdToFrom || !usdToTo) return null;
      return {
        ts: h.ts,
        rate: usdToTo / usdToFrom
      };
    }).filter(h => h !== null);

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: '无法读取历史数据' });
  }
});

// 3. 后端持久化设置 API 密钥
app.post('/api/settings/apikey', async (req, res) => {
  const { oerAppId = '' } = req.body;
  try {
    const config = await getConfig();
    config.oerAppId = oerAppId.trim();
    await saveConfig(config);
    
    // 密钥更改，立刻刷新数据
    fetchAndRecordRates();
    
    res.json({ success: true, message: 'API 密钥已更新且在后台应用' });
  } catch (err) {
    res.status(500).json({ success: false, error: '无法保存配置' });
  }
});

// 4. 获取服务端常规设置与 API 密钥
app.get('/api/settings', async (req, res) => {
  try {
    const settingsData = await fs.readFile(SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(settingsData);
    const config = await getConfig();
    res.json({
      settings,
      oerAppId: config.oerAppId || ''
    });
  } catch (err) {
    res.status(500).json({ error: '无法读取设置' });
  }
});

// 5. 保存常规设置
app.post('/api/settings', async (req, res) => {
  try {
    const settings = req.body;
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    // 重置内存中的已发送标志，确保修改规则后能立刻重新检测生效
    serverAlertFiredPairs = {};
    res.json({ success: true, message: '配置保存成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: '无法保存配置' });
  }
});

// 6. 测试通知接口
app.post('/api/settings/test-notify', async (req, res) => {
  const { channel, config } = req.body;
  const title = `🎯 汇率提醒测试`;
  const text = `这是一条汇率助时的测试推送，如果您收到这条消息，说明您的该配置项已经完全通达手机！\n发送时间: ${new Date().toLocaleString('zh-CN')}`;
  const html = `
    <div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 12px; max-width: 500px; border: 1px solid #e2e8f0;">
      <h2 style="color: #7c3aed; margin-top: 0; font-size: 18px;">🎯 汇率提醒测试</h2>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
      <p style="color: #334155; font-size: 14px; line-height: 1.6;">
        这是一条来自您自建的<strong>汇率实时提醒助手</strong>服务端的测试消息。如果收到本消息，说明该配置项已完全通达您的手机！
      </p>
      <p style="color: #64748b; font-size: 12px; margin-top: 20px;">测试时间：${new Date().toLocaleString('zh-CN')}</p>
    </div>
  `;

  try {
    if (channel === 'feishu') {
      await sendFeishuNotification(config.webhookUrl, title, text);
    } else if (channel === 'dingtalk') {
      await sendDingTalkNotification(config.webhookUrl, title, text);
    } else if (channel === 'pushplus') {
      await sendPushplusNotification(config.token, title, html);
    } else if (channel === 'email') {
      await sendEmailNotification(config, title, html);
    } else {
      return res.status(400).json({ success: false, error: '不支持的通知通道' });
    }
    res.json({ success: true, message: '测试消息发送成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ===========================
   手机多通道提醒机制
   =========================== */
let serverAlertFiredPairs = {};

function getActivePlatform(settings) {
  const activeId = settings.activePlatformId || 'wf';
  const platforms = settings.platforms || [
    { id: 'wf', name: '万里汇', fee: 0.38, offset: -0.0037 }
  ];
  return platforms.find(p => p.id === activeId) || { name: '估算', fee: 0.38, offset: 0.0 };
}

async function sendFeishuNotification(webhookUrl, title, text) {
  const payload = {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: title,
          content: [
            [{"tag": "text", "text": text}]
          ]
        }
      }
    }
  };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Feishu status ${res.status}`);
}

async function sendDingTalkNotification(webhookUrl, title, text) {
  const payload = {
    msgtype: "markdown",
    markdown: {
      title: title,
      text: "### " + title + "\n" + text.replace(/\n/g, '\n\n')
    }
  };
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`DingTalk status ${res.status}`);
}

async function sendPushplusNotification(token, title, htmlContent) {
  const payload = {
    token: token,
    title: title,
    content: htmlContent,
    template: "html"
  };
  const res = await fetch('http://www.pushplus.plus/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Pushplus HTTP status ${res.status}`);
  const data = await res.json();
  if (data.code !== 200) throw new Error(`Pushplus error: ${data.msg}`);
}

async function sendEmailNotification(emailConfig, title, htmlContent) {
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: parseInt(emailConfig.smtpPort, 10) || 465,
    secure: parseInt(emailConfig.smtpPort, 10) === 465, // SSL if 465
    auth: {
      user: emailConfig.smtpUser,
      pass: emailConfig.smtpPass
    }
  });

  const mailOptions = {
    from: `"汇率提醒助手" <${emailConfig.smtpUser}>`,
    to: emailConfig.receiver,
    subject: title,
    html: htmlContent
  };

  await transporter.sendMail(mailOptions);
}

async function sendMultiChannelNotifications(pairKey, evalRate, targetRate, direction, alertBase, platform, settings) {
  const fromCode = pairKey.split('_')[0];
  const toCode = pairKey.split('_')[1];
  const dirLabel = direction === 'above' ? '上涨到' : '下跌到';
  const baseLabel = alertBase === 'wf' ? `（${platform.name}估算价）` : '（市场参考价）';
  const timeStr = new Date().toLocaleString('zh-CN');

  const title = `🎯 汇率达标提醒: ${fromCode}/${toCode}`;
  const text = `汇率达标提醒：\n` +
               `- 监控币对: ${fromCode} → ${toCode}\n` +
               `- 判定依据: ${baseLabel}\n` +
               `- 目标汇率: ${targetRate.toFixed(4)}\n` +
               `- 当前汇率: ${evalRate.toFixed(4)} (已${dirLabel}设定值)\n` +
               `- 触发时间: ${timeStr}`;

  const html = `
    <div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; border-radius: 12px; max-width: 500px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <h2 style="color: #7c3aed; margin-top: 0; font-size: 18px;">🎯 汇率达标提醒</h2>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
      <table style="width: 100%; font-size: 14px; color: #334155; border-collapse: collapse; line-height: 1.6;">
        <tr><td style="padding: 6px 0; font-weight: bold; width: 100px; color: #64748b;">监控币对：</td><td style="font-weight: 600;">${fromCode} → ${toCode}</td></tr>
        <tr><td style="padding: 6px 0; font-weight: bold; color: #64748b;">判定依据：</td><td>${baseLabel}</td></tr>
        <tr><td style="padding: 6px 0; font-weight: bold; color: #64748b;">目标汇率：</td><td style="color: #3b82f6; font-weight: bold;">${targetRate.toFixed(4)}</td></tr>
        <tr><td style="padding: 6px 0; font-weight: bold; color: #64748b;">当前汇率：</td><td style="color: #22c55e; font-weight: bold;">${evalRate.toFixed(4)} (已${dirLabel})</td></tr>
        <tr><td style="padding: 6px 0; font-weight: bold; color: #64748b;">提醒时间：</td><td style="color: #64748b;">${timeStr}</td></tr>
      </table>
    </div>
  `;

  const channels = (settings.notification && settings.notification.channels) || {};
  const tasks = [];

  if (channels.feishu && channels.feishu.enabled && channels.feishu.webhookUrl) {
    tasks.push((async () => {
      try {
        await sendFeishuNotification(channels.feishu.webhookUrl, title, text);
        console.log(`[通知] 飞书推送成功: ${pairKey}`);
      } catch (err) {
        console.error(`[通知] 飞书推送失败: ${pairKey}`, err.message);
      }
    })());
  }

  if (channels.dingtalk && channels.dingtalk.enabled && channels.dingtalk.webhookUrl) {
    tasks.push((async () => {
      try {
        await sendDingTalkNotification(channels.dingtalk.webhookUrl, title, text);
        console.log(`[通知] 钉钉推送成功: ${pairKey}`);
      } catch (err) {
        console.error(`[通知] 钉钉推送失败: ${pairKey}`, err.message);
      }
    })());
  }

  if (channels.pushplus && channels.pushplus.enabled && channels.pushplus.token) {
    tasks.push((async () => {
      try {
        await sendPushplusNotification(channels.pushplus.token, title, html);
        console.log(`[通知] Pushplus 推送成功: ${pairKey}`);
      } catch (err) {
        console.error(`[通知] Pushplus 推送失败: ${pairKey}`, err.message);
      }
    })());
  }

  if (channels.email && channels.email.enabled && channels.email.smtpUser && channels.email.smtpPass && channels.email.receiver) {
    tasks.push((async () => {
      try {
        await sendEmailNotification(channels.email, title, html);
        console.log(`[通知] 邮件推送成功: ${pairKey}`);
      } catch (err) {
        console.error(`[通知] 邮件推送失败: ${pairKey}`, err.message);
      }
    })());
  }

  await Promise.allSettled(tasks);
}

async function checkServerAlerts(rates) {
  try {
    const settingsData = await fs.readFile(SETTINGS_FILE, 'utf8');
    const fullConfig = JSON.parse(settingsData);
    const settings = fullConfig.settings || fullConfig;

    if (!settings.notification || !settings.notification.enabled) {
      return;
    }

    const { monitorEnabled, alertBase, pairs } = settings;
    if (!monitorEnabled || !pairs || typeof pairs !== 'object') return;

    const platform = getActivePlatform(settings);
    const isWfBase = alertBase === 'wf';

    for (let pairKey in pairs) {
      const spec = pairs[pairKey];
      if (!spec || !spec.targetRate) continue;

      const parts = pairKey.split('_');
      if (parts.length !== 2) continue;

      const fromCode = parts[0];
      const toCode = parts[1];

      const usdToFrom = rates[fromCode];
      const usdToTo = rates[toCode];
      if (!usdToFrom || !usdToTo) continue;

      const currentRate = usdToTo / usdToFrom;
      const evalRate = isWfBase ? currentRate * (1 - platform.fee / 100) + platform.offset : currentRate;
      const { targetRate, direction } = spec;

      const triggered =
        (direction === 'above' && evalRate >= targetRate) ||
        (direction === 'below' && evalRate <= targetRate);

      if (triggered) {
        if (!serverAlertFiredPairs[pairKey]) {
          serverAlertFiredPairs[pairKey] = true;
          // 异步分发多通道推送通知
          sendMultiChannelNotifications(pairKey, evalRate, targetRate, direction, alertBase, platform, settings);
        }
      } else {
        serverAlertFiredPairs[pairKey] = false;
      }
    }
  } catch (err) {
    console.error('[报警检测] 检测服务器通知时出错:', err);
  }
}

// 启动服务器
async function main() {
  await ensureDataDir();
  await bootstrapHistory(); // 执行历史铺底
  
  // 首次运行抓取最新汇率
  await fetchAndRecordRates();
  
  // 启动 1 小时定时背景轮询 (3600000ms = 1小时)
  setInterval(fetchAndRecordRates, 3600000);

  app.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`🚀 汇率实时提醒助手服务端启动成功！`);
    console.log(`🌍 访问地址: http://localhost:${PORT}`);
    console.log(`💾 数据持久化存储路径: ${DATA_DIR}`);
    console.log(`========================================`);
  });
}

main();
