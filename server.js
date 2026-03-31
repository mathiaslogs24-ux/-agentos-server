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
const ORDERS_FILE  = path.join(DATA_DIR, 'orders.json');  // ⭐ NOUVEAU
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
  cryptoBotToken: process.env.CRYPTOBOT_TOKEN || '',
  botUsername   : process.env.BOT_USERNAME    || '',
};

// 💰 CATALOGUE DES ARTICLES PAYANTS
// Prix en USDT (ex: 5.00 = 5 dollars)
let shopItems = [
  {
    key        : 'premium',
    title      : '⭐ Accès Premium',
    description: 'Débloque toutes les fonctionnalités avancées du bot.',
    price      : '5.00',   // en USDT
    asset      : 'USDT',
    payload    : 'shop_premium',
  },
  // Ajoute d'autres articles ici si besoin :
  // {
  //   key        : 'rapport',
  //   title      : '📊 Rapport personnalisé',
  //   description: 'Reçois un rapport détaillé sur mesure.',
  //   price      : 100,
  //   payload    : 'shop_rapport',
  // },
];

let stock         = [];
let bot           = null;
let running       = false;
let startedAt     = null;
let conversations = {};   // userId → [{role, content}]
let logs          = [];
let history       = [];
let stats         = { day: 0, month: 0, msgs: 0, input: 0, output: 0, lastReset: today() };
let orders        = [];   // ⭐ NOUVEAU — tableau des commandes payées

// ─────────────────────────────────────────
//  PERSISTANCE
// ─────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }

function loadData() {
  try { cfg   = { ...cfg,   ...JSON.parse(fs.readFileSync(CFG_FILE,   'utf8')) }; } catch(e) {}
  try { stock = JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8')); }
  catch(e) { stock = []; }
  try { stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch(e) {}
  try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }  // ⭐ NOUVEAU
  catch(e) { orders = []; }
  // Override avec variables d'environnement si définies
  if (process.env.TELEGRAM_TOKEN) cfg.telegramToken = process.env.TELEGRAM_TOKEN;
  if (process.env.CLAUDE_KEY)     cfg.claudeKey     = process.env.CLAUDE_KEY;
  if (process.env.SECRET)         cfg.secret        = process.env.SECRET;
  if (process.env.CRYPTOBOT_TOKEN) cfg.cryptoBotToken = process.env.CRYPTOBOT_TOKEN;
  if (process.env.BOT_USERNAME)    cfg.botUsername    = process.env.BOT_USERNAME;
}

function saveData() {
  try {
    const safeCfg = { ...cfg };
    fs.writeFileSync(CFG_FILE,    JSON.stringify(safeCfg, null, 2));
    fs.writeFileSync(STOCK_FILE,  JSON.stringify(stock,   null, 2));
    fs.writeFileSync(STATS_FILE,  JSON.stringify(stats,   null, 2));
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders,  null, 2));  // ⭐ NOUVEAU
  } catch(e) { addLog('err', 'Sauvegarde échouée: ' + e.message); }
}

// Reset stats quotidiennes si nouveau jour
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
  const entry = {
    type,
    msg,
    time: new Date().toLocaleTimeString('fr-FR'),
    ts  : Date.now(),
  };
  logs.unshift(entry);
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
  const emoji = { ok: '✓', err: '✗', warn: '⚠', info: 'ℹ' }[type] || '·';
  console.log(`[${new Date().toISOString()}] ${emoji} ${msg}`);
}

// ─────────────────────────────────────────
//  STOCK — texte pour le prompt
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

// ─────────────────────────────────────────
//  PROMPT SYSTÈME
// ─────────────────────────────────────────
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
//  APPEL CLAUDE API
// ─────────────────────────────────────────
async function callClaude(userId, userName, userMessage) {
  checkDailyReset();

  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: 'user', content: userMessage });

  const msgs = conversations[userId].slice(-(cfg.contextWindow * 2));
  const t0   = Date.now();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method : 'POST',
    headers: {
      'Content-Type'      : 'application/json',
      'x-api-key'         : cfg.claudeKey,
      'anthropic-version' : '2023-06-01',
    },
    body: JSON.stringify({
      model      : cfg.claudeModel,
      max_tokens : cfg.maxTokens,
      system     : buildSystemPrompt(userName, userId),
      messages   : msgs,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }

  const data    = await res.json();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  if (!data.content) throw new Error('Réponse invalide de Claude');

  const reply  = data.content.map(c => c.text || '').join('').trim();
  const tokIn  = data.usage?.input_tokens  || 0;
  const tokOut = data.usage?.output_tokens || 0;
  const total  = tokIn + tokOut;

  conversations[userId].push({ role: 'assistant', content: reply });

  stats.day    += total;
  stats.month  += total;
  stats.msgs   += 1;
  stats.input  += tokIn;
  stats.output += tokOut;

  history.unshift({
    time    : new Date().toLocaleTimeString('fr-FR'),
    userId  : String(userId),
    userName: userName || 'Inconnu',
    msg     : userMessage.slice(0, 60) + (userMessage.length > 60 ? '…' : ''),
    reply   : reply.slice(0, 100) + (reply.length > 100 ? '…' : ''),
    tokIn, tokOut, total,
    duration: elapsed + 's',
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
    bot       = new TelegramBot(cfg.telegramToken, { polling: true });
    running   = true;
    startedAt = new Date().toISOString();

    addLog('ok',   `Bot démarré · ${cfg.claudeModel}`);
    addLog('info', `Stock: ${stock.length} articles · Prompt: ${cfg.systemPrompt.length} car.`);

    // ── Message reçu
    bot.on('message', async (msg) => {
      const userId   = msg.from.id;
      const userName = msg.from.username || msg.from.first_name || String(userId);
      const text     = msg.text;

      // (paiements gérés via webhook CryptoBot — voir /cryptobot-webhook)

      if (!text) return;

      // ── Commande /start
      if (text.startsWith('/start')) {
        bot.sendMessage(msg.chat.id, `👋 Bonjour ${msg.from.first_name || 'là'} ! Comment puis-je vous aider ?`);
        addLog('info', `Nouveau contact: @${userName}`);
        return;
      }

      // 💰 COMMANDE /shop — crée une invoice CryptoBot (@wallet)
      if (text.startsWith('/shop')) {
        if (!cfg.cryptoBotToken) {
          bot.sendMessage(msg.chat.id, "⚠️ Paiements non configurés. Contactez l'administrateur.");
          return;
        }
        if (!shopItems.length) {
          bot.sendMessage(msg.chat.id, '🛍 Aucun article disponible pour le moment.');
          return;
        }

        for (const item of shopItems) {
          try {
            const res = await fetch('https://pay.crypt.bot/api/createInvoice', {
              method : 'POST',
              headers: {
                'Crypto-Pay-API-Token': cfg.cryptoBotToken,
                'Content-Type'        : 'application/json',
              },
              body: JSON.stringify({
                currency_type: 'crypto',
                asset        : item.asset || 'USDT',
                amount       : String(item.price),
                description  : item.title,
                payload      : JSON.stringify({ userId: String(userId), userName, payload: item.payload }),
                paid_btn_name: 'callback',
                paid_btn_url : `https://t.me/${cfg.botUsername || 'bot'}`,
              }),
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.error?.name || 'CryptoBot error');

            const invoice = data.result;
            await bot.sendMessage(msg.chat.id,
              `💰 *${item.title}*\n${item.description}\n\nMontant : *${item.price} ${item.asset || 'USDT'}*\n\n👇 Clique pour payer depuis ton @wallet :`,
              {
                parse_mode  : 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    { text: `💳 Payer ${item.price} ${item.asset || 'USDT'}`, url: invoice.bot_invoice_url }
                  ]]
                }
              }
            );
            addLog('info', `Invoice créée — @${userName} · ${item.price} ${item.asset||'USDT'} · ${item.payload}`);
          } catch(e) {
            addLog('err', `CryptoBot invoice error: ${e.message}`);
            bot.sendMessage(msg.chat.id, '⚠️ Erreur lors de la création du paiement.');
          }
        }
        return;
      }

      // ── Réponse Claude
      addLog('info', `@${userName}: ${text.slice(0, 60)}`);
      try {
        await bot.sendChatAction(msg.chat.id, 'typing');
        const reply = await callClaude(userId, userName, text);
        await bot.sendMessage(msg.chat.id, reply, {
          parse_mode              : 'Markdown',
          disable_web_page_preview: true,
        });
      } catch(e) {
        addLog('err', `@${userName}: ${e.message}`);
        bot.sendMessage(msg.chat.id, '⚠️ Une erreur est survenue, veuillez réessayer dans quelques instants.');
      }
    });

    // (pre_checkout_query non nécessaire avec CryptoBot)

    // ── Erreur polling
    bot.on('polling_error', (err) => {
      addLog('err', 'Polling: ' + (err.message || String(err)));
    });

    // ── Erreur générale
    bot.on('error', (err) => {
      addLog('err', 'Bot error: ' + (err.message || String(err)));
    });

    return { ok: true };

  } catch(e) {
    running = false;
    addLog('err', 'Démarrage échoué: ' + e.message);
    return { ok: false, reason: e.message };
  }
}

function stopBot() {
  if (bot) {
    try { bot.stopPolling(); } catch(e) {}
    bot = null;
  }
  running   = false;
  startedAt = null;
  addLog('warn', 'Bot arrêté');
}

// ─────────────────────────────────────────
//  MIDDLEWARE AUTH
// ─────────────────────────────────────────
function auth(req, res, next) {
  const secret = req.headers['x-secret'];
  if (!secret || secret !== cfg.secret) {
    return res.status(401).json({ error: 'Non autorisé — vérifiez votre clé secrète' });
  }
  next();
}

// ─────────────────────────────────────────
//  ROUTES API
// ─────────────────────────────────────────

// Santé (pas d'auth — pour Railway health check)
app.get('/health', (req, res) => {
  res.json({
    ok     : true,
    uptime : Math.floor(process.uptime()),
    running,
    version: '1.0.0',
  });
});

// ── Statut complet
app.get('/status', auth, (req, res) => {
  res.json({
    running,
    startedAt,
    model    : cfg.claudeModel,
    msgs     : stats.msgs,
    tokDay   : stats.day,
    uptime   : Math.floor(process.uptime()),
    users    : Object.keys(conversations).length,
  });
});

// ── Démarrer le bot
app.post('/start', auth, (req, res) => {
  if (req.body.telegramToken) cfg.telegramToken = req.body.telegramToken;
  if (req.body.claudeKey)     cfg.claudeKey     = req.body.claudeKey;
  saveData();
  const result = startBot();
  res.json(result);
});

// ── Arrêter le bot
app.post('/stop', auth, (req, res) => {
  stopBot();
  res.json({ ok: true, running: false });
});

// ── Configuration — lire
app.get('/config', auth, (req, res) => {
  const { telegramToken, claudeKey, secret, ...safe } = cfg;
  res.json(safe);
});

// ── Configuration — mettre à jour
app.post('/config', auth, (req, res) => {
  const allowed = ['claudeModel','systemPrompt','maxTokens','temperature','contextWindow','stockInject','stockAlerts'];
  allowed.forEach(k => { if (req.body[k] !== undefined) cfg[k] = req.body[k]; });
  if (req.body.telegramToken) cfg.telegramToken = req.body.telegramToken;
  if (req.body.claudeKey)     cfg.claudeKey     = req.body.claudeKey;
  saveData();
  addLog('info', 'Configuration mise à jour depuis le dashboard');
  res.json({ ok: true });
});

// ── Stock — lire
app.get('/stock', auth, (req, res) => res.json(stock));

// ── Stock — remplacer entièrement
app.post('/stock', auth, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Format invalide, attendu un tableau' });
  stock = req.body;
  saveData();
  addLog('ok', `Stock synchronisé · ${stock.length} articles`);
  res.json({ ok: true, count: stock.length });
});

// ── Logs
app.get('/logs', auth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, MAX_LOGS);
  res.json(logs.slice(0, limit));
});

// ── Stats et historique
app.get('/stats', auth, (req, res) => {
  checkDailyReset();
  res.json({ ...stats, history: history.slice(0, 30) });
});

// ── Conversations
app.get('/conversations', auth, (req, res) => res.json(history.slice(0, 50)));

// ── Effacer la mémoire d'un utilisateur
app.delete('/conversation/:userId', auth, (req, res) => {
  delete conversations[req.params.userId];
  addLog('info', `Mémoire effacée pour l'utilisateur ${req.params.userId}`);
  res.json({ ok: true });
});

// ── Effacer toutes les mémoires
app.delete('/conversations', auth, (req, res) => {
  const count = Object.keys(conversations).length;
  conversations = {};
  addLog('info', `Toutes les mémoires effacées (${count} utilisateurs)`);
  res.json({ ok: true, cleared: count });
});

// ── Réinitialiser les stats
app.post('/stats/reset', auth, (req, res) => {
  stats = { day: 0, month: 0, msgs: 0, input: 0, output: 0, lastReset: today() };
  history = [];
  saveData();
  addLog('info', 'Stats réinitialisées');
  res.json({ ok: true });
});

// 💰 COMMANDES CRYPTOBOT — Routes pour le dashboard
// ── Lire toutes les commandes
app.get('/orders', auth, (req, res) => {
  res.json(orders);
});

// ── Proxy CryptoBot — évite les erreurs CORS du navigateur
// Le dashboard appelle ces routes, le serveur fait la vraie requête à pay.crypt.bot
async function cryptoBotCall(method, params = {}) {
  const token = cfg.cryptoBotToken;
  if (!token) throw new Error('Token CryptoBot non configuré sur le serveur');
  const res = await fetch(`https://pay.crypt.bot/api/${method}`, {
    method : 'POST',
    headers: { 'Crypto-Pay-API-Token': token, 'Content-Type': 'application/json' },
    body   : JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error?.name || 'CryptoBot error');
  return data.result;
}

// ── Tester la connexion + infos de l'app
app.get('/wallet/me', auth, async (req, res) => {
  try {
    const info = await cryptoBotCall('getMe');
    res.json({ ok: true, ...info });
  } catch(e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── Soldes
app.get('/wallet/balance', auth, async (req, res) => {
  try {
    const balances = await cryptoBotCall('getBalance');
    res.json({ ok: true, balances });
  } catch(e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── Transactions reçues
app.get('/wallet/transactions', auth, async (req, res) => {
  try {
    const data = await cryptoBotCall('getInvoices', { status: 'paid', count: 100 });
    res.json({ ok: true, items: data.items || [] });
  } catch(e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── Sauvegarder le token CryptoBot depuis le dashboard
app.post('/wallet/token', auth, (req, res) => {
  if (!req.body.token) return res.status(400).json({ error: 'Token manquant' });
  cfg.cryptoBotToken = req.body.token;
  saveData();
  addLog('ok', 'Token CryptoBot mis à jour depuis le dashboard');
  res.json({ ok: true });
});


// À enregistrer sur : https://pay.crypt.bot → ton app → Webhooks → ton URL/cryptobot-webhook
app.post('/cryptobot-webhook', async (req, res) => {
  try {
    // Vérifier la signature HMAC
    const token     = cfg.cryptoBotToken;
    const secret    = crypto.createHash('sha256').update(token).digest();
    const signature = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== req.headers['crypto-pay-api-signature']) {
      addLog('warn', 'Webhook CryptoBot — signature invalide');
      return res.sendStatus(401);
    }

    if (req.body.update_type === 'invoice_paid') {
      const invoice = req.body.payload;
      let userId = '', userName = '', payload = '';

      try {
        const meta = JSON.parse(invoice.payload || '{}');
        userId   = meta.userId   || '';
        userName = meta.userName || '';
        payload  = meta.payload  || '';
      } catch(e) {}

      const order = {
        id       : Date.now(),
        date     : new Date().toLocaleString('fr-FR'),
        userId,
        userName,
        amount   : invoice.amount,
        asset    : invoice.asset,
        payload,
        invoiceId: invoice.invoice_id,
      };
      orders.unshift(order);
      saveData();

      addLog('ok', `💰 Paiement reçu — @${userName} · ${invoice.amount} ${invoice.asset} · ${payload}`);

      // Notifier l'utilisateur dans Telegram
      if (userId && bot) {
        try {
          await bot.sendMessage(userId,
            `✅ Paiement confirmé !\n${invoice.amount} ${invoice.asset} reçus.\n\nMerci pour ton achat ! 🙏`
          );
        } catch(e) { /* silencieux si l'utilisateur a bloqué le bot */ }
      }
    }

    res.sendStatus(200);
  } catch(e) {
    addLog('err', 'Webhook CryptoBot: ' + e.message);
    res.sendStatus(500);
  }
});

// ── Lire le catalogue shop
app.get('/shop', auth, (req, res) => {
  res.json(shopItems);
});

// ── Mettre à jour le catalogue shop
app.post('/shop', auth, (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Format invalide, attendu un tableau' });
  shopItems = req.body;
  addLog('ok', `Catalogue shop mis à jour · ${shopItems.length} articles`);
  res.json({ ok: true, count: shopItems.length });
});

// ── Rembourser une commande
app.post('/orders/:id/refund', auth, async (req, res) => {
  const order = orders.find(o => String(o.id) === req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable' });

  try {
    // Remboursement via CryptoBot API
    const res2 = await fetch('https://pay.crypt.bot/api/deleteInvoice', {
      method : 'POST',
      headers: { 'Crypto-Pay-API-Token': cfg.cryptoBotToken, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ invoice_id: order.invoiceId }),
    });
    const data = await res2.json();
    if (!data.ok) throw new Error(data.error?.name || 'CryptoBot refund error');
    orders = orders.filter(o => String(o.id) !== req.params.id);
    saveData();
    addLog('ok', `Remboursement effectué — order ${order.id} · @${order.userName}`);
    res.json({ ok: true });
  } catch(e) {
    addLog('err', `Remboursement échoué: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────
//  DÉMARRAGE
// ─────────────────────────────────────────
loadData();

app.listen(PORT, () => {
  addLog('info', `═══════════════════════════════`);
  addLog('info', `AgentOS Server — Port ${PORT}`);
  addLog('info', `Secret: ${cfg.secret === 'changeme' ? '⚠ CHANGEZ LE SECRET !' : '✓ Défini'}`);
  addLog('info', `Telegram: ${cfg.telegramToken ? '✓ Token présent' : '✗ Non configuré'}`);
  addLog('info', `Claude:   ${cfg.claudeKey     ? '✓ Clé présente'  : '✗ Non configurée'}`);
  addLog('info', `CryptoBot:${cfg.cryptoBotToken ? '✓ Token présent' : '✗ Non configuré'}`);
  addLog('info', `Shop:     ${shopItems.length} article(s) configuré(s)`);
  addLog('info', `═══════════════════════════════`);

  if (cfg.telegramToken && cfg.claudeKey) {
    setTimeout(() => startBot(), 1500);
  }
});

// ── Arrêt propre
process.on('SIGTERM', () => { stopBot(); saveData(); process.exit(0); });
process.on('SIGINT',  () => { stopBot(); saveData(); process.exit(0); });
