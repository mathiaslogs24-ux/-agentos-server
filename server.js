// ═══════════════════════════════════════════════════════════════
//  AgentOS — Serveur Backend
//  Node.js + Express + Telegram Bot + Claude AI + CryptoBot (@wallet)
//  Déployer sur Railway : railway.app
// ═══════════════════════════════════════════════════════════════

'use strict';
const crypto = require('crypto');

const express     = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs          = require('fs');
const path        = require('path');

// ── Charger les variables d'environnement depuis .env si présent
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && !k.startsWith('#') && v.length) {
        process.env[k.trim()] = v.join('=').trim();
      }
    });
  }
} catch(e) {}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — Autorise le dashboard
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '1mb' }));

// ─────────────────────────────────────────
//  CONSTANTES
// ─────────────────────────────────────────
const DATA_DIR     = path.join(__dirname, 'data');
const CFG_FILE     = path.join(DATA_DIR, 'config.json');
const STOCK_FILE   = path.join(DATA_DIR, 'stock.json');
const STATS_FILE   = path.join(DATA_DIR, 'stats.json');
const ORDERS_FILE  = path.join(DATA_DIR, 'orders.json');
const MAX_LOGS     = 500;
const MAX_HISTORY  = 100;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─────────────────────────────────────────
//  ÉTAT GLOBAL
// ─────────────────────────────────────────
let cfg = {
  telegramToken : process.env.TELEGRAM_TOKEN || '',
  claudeKey     : process.env.CLAUDE_KEY     || '',
  claudeModel   : 'claude-sonnet-4-20250514',
  systemPrompt  : '',
  maxTokens     : 1000,
  temperature   : 0.7,
  contextWindow : 8,
  stockInject   : true,
  stockAlerts   : true,
  secret        : process.env.SECRET || 'changeme',
  cryptoBotToken: process.env.CRYPTOBOT_TOKEN  || '',
  botUsername   : process.env.BOT_USERNAME     || '',
  stripeKey     : process.env.STRIPE_SECRET_KEY     || '',
  stripeWebhook : process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeSuccess : process.env.STRIPE_SUCCESS_URL    || '',
};

let shopItems = [
  {
    key        : 'premium',
    title      : '⭐ Accès Premium',
    description: 'Débloque toutes les fonctionnalités avancées du bot.',
    price      : '5.00',
    asset      : 'USDT',
    payload    : 'shop_premium',
  },
];

let stock         = [];
let bot           = null;
let running       = false;
let startedAt     = null;
let conversations = {};
let logs          = [];
let history       = [];
let stats         = { day: 0, month: 0, msgs: 0, input: 0, output: 0, lastReset: today() };
let orders        = [];

// ─────────────────────────────────────────
//  PERSISTANCE
// ─────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }

function loadData() {
  try { cfg   = { ...cfg,   ...JSON.parse(fs.readFileSync(CFG_FILE,   'utf8')) }; } catch(e) {}
  try { stock = JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8')); }
  catch(e) { stock = []; }
  try { stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch(e) {}
  try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch(e) { orders = []; }
  if (process.env.TELEGRAM_TOKEN)        cfg.telegramToken = process.env.TELEGRAM_TOKEN;
  if (process.env.CLAUDE_KEY)            cfg.claudeKey     = process.env.CLAUDE_KEY;
  if (process.env.SECRET)               cfg.secret        = process.env.SECRET;
  if (process.env.CRYPTOBOT_TOKEN)      cfg.cryptoBotToken = process.env.CRYPTOBOT_TOKEN;
  if (process.env.BOT_USERNAME)         cfg.botUsername    = process.env.BOT_USERNAME;
  if (process.env.STRIPE_SECRET_KEY)    cfg.stripeKey      = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_WEBHOOK_SECRET) cfg.stripeWebhook = process.env.STRIPE_WEBHOOK_SECRET;
}

function saveData() {
  try {
    const safeCfg = { ...cfg };
    fs.writeFileSync(CFG_FILE,    JSON.stringify(safeCfg, null, 2));
    fs.writeFileSync(STOCK_FILE,  JSON.stringify(stock,   null, 2));
    fs.writeFileSync(STATS_FILE,  JSON.stringify(stats,   null, 2));
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders,  null, 2));
  } catch(e) { addLog('err', 'Sauvegarde échouée: ' + e.message); }
}

function checkDailyReset() {
  if (stats.lastReset !== today()) {
    stats.day = 0;
    stats.lastReset = today();
    saveData();
    addLog('info', 'Compteur quotidien réinitialisé');
  }
}

// ─────────────────────────────────────────
//  LOGS
// ─────────────────────────────────────────
function addLog(type, msg) {
  const entry = { type, msg, time: new Date().toLocaleTimeString('fr-FR'), ts: Date.now() };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
  const emoji = { ok: '✓', err: '✗', warn: '⚠', info: 'ℹ' }[type] || '·';
  console.log(`[${new Date().toISOString()}] ${emoji} ${msg}`);
}

// ─────────────────────────────────────────
//  STOCK
// ─────────────────────────────────────────
function buildStockText() {
  if (!stock.length) return 'Aucun article en stock.';
  const lines = stock.map(s => {
    const status = s.qty === 0 ? '❌ RUPTURE' : s.qty <= s.alert ? '⚠ STOCK BAS' : '✓ Disponible';
    return `- ${s.name} (${s.ref}): ${s.qty} unités · ${s.price}€ · ${status}`;
  });
  const alerts = stock.filter(s => s.qty <= s.alert);
  let txt = lines.join('\n');
  if (cfg.stockAlerts && alerts.length) {
    txt += '\n\n⚠ ALERTES STOCK:\n' + alerts.map(s =>
      s.qty === 0 ? `- ${s.name}: EN RUPTURE` : `- ${s.name}: seulement ${s.qty} restant(s)`
    ).join('\n');
  }
  return txt;
}

function buildSystemPrompt(userName, userId) {
  let sp = cfg.systemPrompt || 'Tu es un assistant commercial professionnel et utile. Réponds toujours en français de manière concise et claire.';
  const now = new Date();
  return sp
    .replace(/\{stock\}/g,     buildStockText())
    .replace(/\{user_name\}/g, userName || 'Utilisateur')
    .replace(/\{user_id\}/g,   String(userId || ''))
    .replace(/\{date\}/g,      now.toLocaleDateString('fr-FR'))
    .replace(/\{heure\}/g,     now.toLocaleTimeString('fr-FR'));
}

// ─────────────────────────────────────────
//  CLAUDE API
// ─────────────────────────────────────────
async function callClaude(userId, userName, userMessage) {
  checkDailyReset();
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: 'user', content: userMessage });
  const msgs = conversations[userId].slice(-(cfg.contextWindow * 2));
  const t0   = Date.now();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.claudeKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.claudeModel, max_tokens: cfg.maxTokens, system: buildSystemPrompt(userName, userId), messages: msgs }),
  });

  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `HTTP ${res.status}`); }

  const data    = await res.json();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  if (!data.content) throw new Error('Réponse invalide de Claude');

  const reply  = data.content.map(c => c.text || '').join('').trim();
  const tokIn  = data.usage?.input_tokens  || 0;
  const tokOut = data.usage?.output_tokens || 0;
  const total  = tokIn + tokOut;

  conversations[userId].push({ role: 'assistant', content: reply });
  stats.day += total; stats.month += total; stats.msgs += 1; stats.input += tokIn; stats.output += tokOut;

  history.unshift({
    time: new Date().toLocaleTimeString('fr-FR'), userId: String(userId), userName: userName || 'Inconnu',
    msg: userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : ''),
    reply: reply.slice(0, 100) + (reply.length > 100 ? '…' : ''),
    tokIn, tokOut, total, duration: elapsed + 's',
  });
  if (history.length > MAX_HISTORY) history.pop();

  saveData();
  addLog('ok', `@${userName} | ${total} tok | ${elapsed}s`);
  return reply;
}

// ─────────────────────────────────────────
//  BOT TELEGRAM
// ─────────────────────────────────────────
function startBot() {
  if (running)            return { ok: false, reason: 'Déjà démarré' };
  if (!cfg.telegramToken) return { ok: false, reason: 'Token Telegram manquant' };
  if (!cfg.claudeKey)     return { ok: false, reason: 'Clé Claude manquante' };

  try {
    bot = new TelegramBot(cfg.telegramToken, { polling: true });
    running = true; startedAt = new Date().toISOString();
    addLog('ok', `Bot démarré · ${cfg.claudeModel}`);

    bot.on('message', async (msg) => {
      const userId   = msg.from.id;
      const userName = msg.from.username || msg.from.first_name || String(userId);
      const text     = msg.text;
      if (!text) return;

      if (text.startsWith('/start')) {
        const shopUrl = `https://agentos-server-production-a5b4.up.railway.app/shop-app`;
        bot.sendMessage(msg.chat.id,
          `👋 Bonjour ${msg.from.first_name || ''} !\n\nBienvenue dans notre shop 🛍\nClique sur le bouton pour voir nos articles.`,
          { reply_markup: { inline_keyboard: [[{ text: '🛍 Ouvrir le Shop', web_app: { url: shopUrl } }]] } }
        );
        addLog('info', `Nouveau contact: @${userName}`);
        return;
      }

      if (text.startsWith('/shop')) {
        if (!cfg.stripeKey) { bot.sendMessage(msg.chat.id, "⚠️ Paiements non configurés."); return; }
        const availableItems = shopItems.filter(item => {
          const linkedStock = stock.find(s => s.id === item.stockId);
          if (linkedStock && linkedStock.qty <= 0) return false;
          return true;
        });
        if (!availableItems.length) { bot.sendMessage(msg.chat.id, '🛍 Tous les articles sont en rupture de stock.'); return; }

        for (const item of availableItems) {
          try {
            const priceInCents = Math.round(parseFloat(item.price) * 100);
            const serverUrl = `https://agentos-server-production-a5b4.up.railway.app`;
            const params = new URLSearchParams();
            params.append('payment_method_types[]', 'card');
            params.append('line_items[0][price_data][currency]', 'eur');
            params.append('line_items[0][price_data][product_data][name]', item.title);
            params.append('line_items[0][price_data][product_data][description]', item.description);
            params.append('line_items[0][price_data][unit_amount]', priceInCents);
            params.append('line_items[0][quantity]', '1');
            params.append('mode', 'payment');
            params.append('success_url', `${serverUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`);
            params.append('cancel_url',  `${serverUrl}/payment-cancel`);
            params.append('shipping_address_collection[allowed_countries][]', 'FR');
            params.append('shipping_address_collection[allowed_countries][]', 'BE');
            params.append('shipping_address_collection[allowed_countries][]', 'CH');
            params.append('shipping_address_collection[allowed_countries][]', 'LU');
            params.append('phone_number_collection[enabled]', 'true');
            params.append('metadata[userId]',   String(userId));
            params.append('metadata[userName]', userName);
            params.append('metadata[payload]',  item.payload);
            params.append('metadata[itemTitle]', item.title);
            const linkedStock = stock.find(s => s.id === item.stockId);
            params.append('metadata[stockName]', linkedStock ? linkedStock.name : item.title);

            const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${cfg.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params,
            });
            const session = await res.json();
            if (session.error) throw new Error(session.error.message);

            await bot.sendMessage(msg.chat.id,
              `🛍 *${item.title}*\n${item.description}\n\n💶 Prix : *${item.price} €*`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: `💳 Payer ${item.price} €`, url: session.url }]] } }
            );
          } catch(e) {
            addLog('err', `Stripe error: ${e.message}`);
            bot.sendMessage(msg.chat.id, '⚠️ Erreur lors de la création du paiement.');
          }
        }
        return;
      }

      addLog('info', `@${userName}: ${text.slice(0, 60)}`);
      try {
        await bot.sendChatAction(msg.chat.id, 'typing');
        const reply = await callClaude(userId, userName, text);
        await bot.sendMessage(msg.chat.id, reply, { parse_mode: 'Markdown', disable_web_page_preview: true });
      } catch(e) {
        addLog('err', `@${userName}: ${e.message}`);
        bot.sendMessage(msg.chat.id, '⚠️ Une erreur est survenue, veuillez réessayer.');
      }
    });

    bot.on('polling_error', (err) => addLog('err', 'Polling: ' + (err.message || String(err))));
    bot.on('error',         (err) => addLog('err', 'Bot error: ' + (err.message || String(err))));
    return { ok: true };
  } catch(e) {
    running = false;
    addLog('err', 'Démarrage échoué: ' + e.message);
    return { ok: false, reason: e.message };
  }
}

function stopBot() {
  if (bot) { try { bot.stopPolling(); } catch(e) {} bot = null; }
  running = false; startedAt = null;
  addLog('warn', 'Bot arrêté');
}

// ─────────────────────────────────────────
//  MIDDLEWARE AUTH
// ─────────────────────────────────────────
function auth(req, res, next) {
  const secret = req.headers['x-secret'];
  if (!secret || secret !== cfg.secret) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

// ─────────────────────────────────────────
//  ROUTES API
// ─────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, uptime: Math.floor(process.uptime()), running, version: '1.0.0' }));
app.get('/status', auth, (req, res) => res.json({ running, startedAt, model: cfg.claudeModel, msgs: stats.msgs, tokDay: stats.day, uptime: Math.floor(process.uptime()), users: Object.keys(conversations).length }));
app.post('/start', auth, (req, res) => { if (req.body.telegramToken) cfg.telegramToken = req.body.telegramToken; if (req.body.claudeKey) cfg.claudeKey = req.body.claudeKey; saveData(); res.json(startBot()); });
app.post('/stop',  auth, (req, res) => { stopBot(); res.json({ ok: true, running: false }); });
app.get('/config', auth, (req, res) => { const { telegramToken, claudeKey, secret, ...safe } = cfg; res.json(safe); });
app.post('/config', auth, (req, res) => {
  const allowed = ['claudeModel','systemPrompt','maxTokens','temperature','contextWindow','stockInject','stockAlerts'];
  allowed.forEach(k => { if (req.body[k] !== undefined) cfg[k] = req.body[k]; });
  if (req.body.telegramToken) cfg.telegramToken = req.body.telegramToken;
  if (req.body.claudeKey)     cfg.claudeKey     = req.body.claudeKey;
  saveData();
  addLog('info', 'Configuration mise à jour');
  res.json({ ok: true });
});

app.get('/stock', auth, (req, res) => res.json(stock));
app.post('/stock', auth, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Format invalide' });
  stock = req.body; saveData();
  addLog('ok', `Stock synchronisé · ${stock.length} articles`);
  res.json({ ok: true, count: stock.length });
});

// ── Stock public — Mini App (SANS authentification)
app.get('/stock-public', (req, res) => {
  const available = stock
    .filter(s => s.qty > 0)
    .map(s => ({
      id   : s.id,
      name : s.name,
      cat  : s.cat,
      price: s.price,
      qty  : s.qty,
      puffs: s.puffs || 0,
      alert: s.alert || 5,
    }));
  res.json(available);
});

app.get('/logs', auth, (req, res) => { const limit = Math.min(parseInt(req.query.limit) || 100, MAX_LOGS); res.json(logs.slice(0, limit)); });
app.get('/stats', auth, (req, res) => { checkDailyReset(); res.json({ ...stats, history: history.slice(0, 30) }); });
app.get('/conversations', auth, (req, res) => res.json(history.slice(0, 50)));
app.delete('/conversation/:userId', auth, (req, res) => { delete conversations[req.params.userId]; addLog('info', `Mémoire effacée pour ${req.params.userId}`); res.json({ ok: true }); });
app.delete('/conversations', auth, (req, res) => { const count = Object.keys(conversations).length; conversations = {}; addLog('info', `Toutes les mémoires effacées (${count})`); res.json({ ok: true, cleared: count }); });
app.post('/stats/reset', auth, (req, res) => { stats = { day: 0, month: 0, msgs: 0, input: 0, output: 0, lastReset: today() }; history = []; saveData(); addLog('info', 'Stats réinitialisées'); res.json({ ok: true }); });

app.post('/stock-deduct', (req, res) => {
  const { secret, productName } = req.body;
  if (secret !== cfg.secret) return res.status(401).json({ error: 'Secret invalide' });
  if (!productName) return res.status(400).json({ error: 'productName manquant' });
  const pLower = productName.replace(/[^\w\s]/gi, '').trim().toLowerCase();
  const stockItem = stock.find(s => { const sL = s.name.replace(/[^\w\s]/gi,'').trim().toLowerCase(); return sL===pLower||sL.includes(pLower)||pLower.includes(sL); });
  if (!stockItem) return res.json({ ok: false, error: 'Produit non trouvé', stock: stock.map(s => s.name) });
  if (stockItem.qty <= 0) return res.json({ ok: false, error: 'Stock à 0' });
  stockItem.qty -= 1; saveData();
  addLog('info', `📦 ${stockItem.name} : ${stockItem.qty + 1} → ${stockItem.qty}`);
  res.json({ ok: true, name: stockItem.name, remaining: stockItem.qty });
});

app.get('/orders', auth, (req, res) => res.json(orders));

async function cryptoBotCall(method, params = {}) {
  const token = cfg.cryptoBotToken;
  if (!token) throw new Error('Token CryptoBot non configuré');
  const res = await fetch(`https://pay.crypt.bot/api/${method}`, {
    method: 'POST', headers: { 'Crypto-Pay-API-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot error');
  return data.result;
}

app.get('/wallet/me',           auth, async (req, res) => { try { res.json({ ok: true, ...await cryptoBotCall('getMe') }); } catch(e) { res.status(400).json({ ok: false, error: e.message }); } });
app.get('/wallet/balance',      auth, async (req, res) => { try { res.json({ ok: true, balances: await cryptoBotCall('getBalance') }); } catch(e) { res.status(400).json({ ok: false, error: e.message }); } });
app.get('/wallet/transactions', auth, async (req, res) => { try { const d = await cryptoBotCall('getInvoices', { status: 'paid', count: 100 }); res.json({ ok: true, items: d.items || [] }); } catch(e) { res.status(400).json({ ok: false, error: e.message }); } });
app.post('/wallet/token', auth, (req, res) => { if (!req.body.token) return res.status(400).json({ error: 'Token manquant' }); cfg.cryptoBotToken = req.body.token; saveData(); addLog('ok', 'Token CryptoBot mis à jour'); res.json({ ok: true }); });

app.post('/stripe-webhook', async (req, res) => {
  let event;
  try { event = req.body; if (!event || !event.type) return res.sendStatus(400); } catch(e) { return res.sendStatus(400); }
  addLog('info', `Stripe webhook — ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const meta    = session.metadata || {};
    const userId  = meta.userId || ''; const userName = meta.userName || '';
    const amount  = (session.amount_total / 100).toFixed(2);
    const customer = session.customer_details || {}; const shipping = session.shipping_details || {}; const addr = shipping.address || {};
    const clientInfo = { name: shipping.name||customer.name||'', email: customer.email||'', phone: customer.phone||'', address: [addr.line1,addr.line2].filter(Boolean).join(', '), city: addr.city||'', postal: addr.postal_code||'', country: addr.country||'' };

    let productNames = [];
    try {
      const liRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`, { headers: { 'Authorization': `Bearer ${cfg.stripeKey}` } });
      const liData = await liRes.json();
      if (liData.data?.length) productNames = liData.data.map(li => li.description || '');
    } catch(e) {}

    const stockName = productNames.join(', ') || meta.stockName || meta.itemTitle || session.id;
    const order = { id: Date.now(), date: new Date().toLocaleString('fr-FR'), userId, userName, amount, asset: 'EUR', stockName, invoiceId: session.id, provider: 'stripe', client: clientInfo };
    orders.unshift(order); saveData();
    addLog('ok', `💳 Stripe — @${userName} · ${amount}€ · ${stockName}`);

    if (userId && bot) {
      try { await bot.sendMessage(userId, `✅ Paiement confirmé !\n\n🛍 *${stockName}*\n💶 ${amount} € réglés.\n\nMerci ! 🙏`, { parse_mode: 'Markdown' }); } catch(e) {}
    }
  }
  res.sendStatus(200);
});

// ── Mini App
app.get('/shop-app', (req, res) => res.sendFile(path.join(__dirname, 'shop.html')));

// ── Stock public catalogue (shopItems — ancien endpoint)
app.get('/shop-public', (req, res) => {
  const available = shopItems.filter(item => {
    const linkedStock = stock.find(s => s.id === item.stockId);
    if (linkedStock && linkedStock.qty <= 0) return false;
    return true;
  });
  res.json(available);
});

// ── Checkout Mini App via Stripe
app.post('/shop-checkout', async (req, res) => {
  const { cart, userId, userName } = req.body;
  if (!cart || !cart.length) return res.status(400).json({ error: 'Panier vide' });
  if (!cfg.stripeKey) return res.status(400).json({ error: 'Stripe non configuré' });

  try {
    const serverUrl = `https://agentos-server-production-a5b4.up.railway.app`;
    const params    = new URLSearchParams();
    params.append('payment_method_types[]', 'card');
    params.append('mode', 'payment');
    params.append('success_url', `${serverUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url',  `${serverUrl}/payment-cancel`);
    params.append('shipping_address_collection[allowed_countries][]', 'FR');
    params.append('shipping_address_collection[allowed_countries][]', 'BE');
    params.append('shipping_address_collection[allowed_countries][]', 'CH');
    params.append('shipping_address_collection[allowed_countries][]', 'LU');
    params.append('phone_number_collection[enabled]', 'true');
    params.append('metadata[userId]',   userId   || '');
    params.append('metadata[userName]', userName || '');
    params.append('metadata[payload]',  cart.map(i => i.payload).join(','));
    params.append('metadata[itemTitle]', cart.map(i => i.title).join(', '));
    const stockNames = cart.map(i => { const ls = stock.find(s => s.id === i.stockId); return ls ? ls.name : i.title; });
    params.append('metadata[stockName]', stockNames.join(', '));

    cart.forEach((item, idx) => {
      const cents = Math.round(parseFloat(item.price) * 100);
      params.append(`line_items[${idx}][price_data][currency]`, 'eur');
      params.append(`line_items[${idx}][price_data][product_data][name]`, item.title);
      params.append(`line_items[${idx}][price_data][product_data][description]`, item.description || '');
      params.append(`line_items[${idx}][price_data][unit_amount]`, cents);
      params.append(`line_items[${idx}][quantity]`, '1');
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { 'Authorization': `Bearer ${cfg.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
    });
    const session = await stripeRes.json();
    if (session.error) throw new Error(session.error.message);
    addLog('info', `Mini App checkout — @${userName} · ${cart.length} article(s)`);
    res.json({ url: session.url });
  } catch(e) {
    addLog('err', 'Mini App checkout: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/payment-success', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Paiement réussi</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}
  .box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}
  .icon{font-size:64px;margin-bottom:16px;} h1{color:#4ade80;} p{color:#8899b0;font-size:14px;}</style>
  </head><body><div class="box"><div class="icon">✅</div><h1>Paiement réussi !</h1>
  <p>Retourne dans Telegram pour voir la confirmation.</p></div></body></html>`);
});

app.get('/payment-cancel', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Paiement annulé</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}
  .box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}
  .icon{font-size:64px;margin-bottom:16px;} h1{color:#f87171;} p{color:#8899b0;font-size:14px;}</style>
  </head><body><div class="box"><div class="icon">❌</div><h1>Paiement annulé</h1>
  <p>Tu peux retourner dans Telegram et réessayer.</p></div></body></html>`);
});

app.post('/cryptobot-webhook', async (req, res) => {
  try {
    const token = cfg.cryptoBotToken;
    const secret = crypto.createHash('sha256').update(token).digest();
    const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
    if (signature !== req.headers['crypto-pay-api-signature']) { addLog('warn', 'Webhook CryptoBot — signature invalide'); return res.sendStatus(401); }

    if (req.body.update_type === 'invoice_paid') {
      const invoice = req.body.payload;
      let userId = '', userName = '', payload = '';
      try { const meta = JSON.parse(invoice.payload || '{}'); userId = meta.userId||''; userName = meta.userName||''; payload = meta.payload||''; } catch(e) {}

      const order = { id: Date.now(), date: new Date().toLocaleString('fr-FR'), userId, userName, amount: invoice.amount, asset: invoice.asset, payload, invoiceId: invoice.invoice_id };
      orders.unshift(order);

      const soldItem = shopItems.find(i => i.payload === payload);
      if (soldItem) {
        const stockItem = stock.find(s => s.name.toLowerCase().includes(soldItem.title.replace(/[^\w\s]/g,'').trim().toLowerCase()));
        if (stockItem && stockItem.qty > 0) { stockItem.qty -= 1; addLog('info', `📦 ${stockItem.name} : ${stockItem.qty+1} → ${stockItem.qty}`); }
      }
      saveData();
      addLog('ok', `💰 CryptoBot — @${userName} · ${invoice.amount} ${invoice.asset}`);
      if (userId && bot) { try { await bot.sendMessage(userId, `✅ Paiement confirmé !\n${invoice.amount} ${invoice.asset} reçus.\n\nMerci ! 🙏`); } catch(e) {} }
    }
    res.sendStatus(200);
  } catch(e) { addLog('err', 'Webhook CryptoBot: ' + e.message); res.sendStatus(500); }
});

app.get('/shop',  auth, (req, res) => res.json(shopItems));
app.post('/shop', auth, (req, res) => { if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Format invalide' }); shopItems = req.body; addLog('ok', `Catalogue shop mis à jour · ${shopItems.length} articles`); res.json({ ok: true, count: shopItems.length }); });

app.post('/orders/:id/refund', auth, async (req, res) => {
  const order = orders.find(o => String(o.id) === req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });
  try {
    const res2 = await fetch('https://pay.crypt.bot/api/deleteInvoice', { method: 'POST', headers: { 'Crypto-Pay-API-Token': cfg.cryptoBotToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: order.invoiceId }) });
    const data = await res2.json();
    if (!data.ok) throw new Error(data.error?.name || 'CryptoBot refund error');
    orders = orders.filter(o => String(o.id) !== req.params.id); saveData();
    addLog('ok', `Remboursement — order ${order.id}`);
    res.json({ ok: true });
  } catch(e) { addLog('err', `Remboursement échoué: ${e.message}`); res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────
//  DÉMARRAGE
// ─────────────────────────────────────────
loadData();

app.listen(PORT, () => {
  addLog('info', `═══════════════════════════════`);
  addLog('info', `AgentOS Server — Port ${PORT}`);
  addLog('info', `Secret: ${cfg.secret === 'changeme' ? '⚠ CHANGEZ LE SECRET !' : '✓ Défini'}`);
  addLog('info', `Telegram: ${cfg.telegramToken ? '✓' : '✗ Non configuré'}`);
  addLog('info', `Claude:   ${cfg.claudeKey     ? '✓' : '✗ Non configurée'}`);
  addLog('info', `═══════════════════════════════`);
  if (cfg.telegramToken && cfg.claudeKey) setTimeout(() => startBot(), 1500);
});

process.on('SIGTERM', () => { stopBot(); saveData(); process.exit(0); });
process.on('SIGINT',  () => { stopBot(); saveData(); process.exit(0); });
