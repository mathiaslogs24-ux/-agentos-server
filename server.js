// ═══════════════════════════════════════════════════════════════
//  AgentOS — Marketplace Server
//  Node.js + Express + Telegram Bot + Claude AI + Stripe
// ═══════════════════════════════════════════════════════════════
'use strict';
const crypto = require('crypto');
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && !k.startsWith('#') && v.length) process.env[k.trim()] = v.join('=').trim();
    });
  }
} catch(e) {}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Secret');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '2mb' }));

// ─────────────────────────────────────────
//  FICHIERS DE DONNÉES
// ─────────────────────────────────────────
const DATA_DIR      = path.join(__dirname, 'data');
const CFG_FILE      = path.join(DATA_DIR, 'config.json');
const STOCK_FILE    = path.join(DATA_DIR, 'stock.json');
const STATS_FILE    = path.join(DATA_DIR, 'stats.json');
const ORDERS_FILE   = path.join(DATA_DIR, 'orders.json');
const SELLERS_FILE  = path.join(DATA_DIR, 'sellers.json');
const MAX_LOGS = 500; const MAX_HISTORY = 100;
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
  secret        : process.env.SECRET         || 'changeme',
  cryptoBotToken: process.env.CRYPTOBOT_TOKEN || '',
  botUsername   : process.env.BOT_USERNAME    || '',
  stripeKey     : process.env.STRIPE_SECRET_KEY      || '',
  stripeWebhook : process.env.STRIPE_WEBHOOK_SECRET  || '',
  commissionRate: 0.05,
  commissionMode: 'flat',   // 'flat' = 1€/article | 'percent' = %
  commissionFlat: 1.00,     // 1€ par article
};

// sellers = [ { id, name, secret, active, balance, totalSales, createdAt, shopName, description } ]
let sellers   = [];
// stock global admin
let stock     = [];
let shopItems = [];
let bot = null; let running = false; let startedAt = null;
let conversations = {}; let logs = []; let history = [];
let stats  = { day:0, month:0, msgs:0, input:0, output:0, lastReset: today() };
let orders = [];

// ─────────────────────────────────────────
//  PERSISTANCE
// ─────────────────────────────────────────
function today() { return new Date().toISOString().slice(0,10); }

function loadData() {
  try { cfg     = { ...cfg,     ...JSON.parse(fs.readFileSync(CFG_FILE,    'utf8')) }; } catch(e){}
  try { stock   = JSON.parse(fs.readFileSync(STOCK_FILE,   'utf8')); } catch(e){ stock=[]; }
  try { stats   = { ...stats,   ...JSON.parse(fs.readFileSync(STATS_FILE,  'utf8')) }; } catch(e){}
  try { orders  = JSON.parse(fs.readFileSync(ORDERS_FILE,  'utf8')); } catch(e){ orders=[]; }
  try { sellers = JSON.parse(fs.readFileSync(SELLERS_FILE, 'utf8')); } catch(e){ sellers=[]; }
  if (process.env.TELEGRAM_TOKEN)         cfg.telegramToken  = process.env.TELEGRAM_TOKEN;
  if (process.env.CLAUDE_KEY)             cfg.claudeKey      = process.env.CLAUDE_KEY;
  if (process.env.SECRET)                 cfg.secret         = process.env.SECRET;
  if (process.env.CRYPTOBOT_TOKEN)        cfg.cryptoBotToken = process.env.CRYPTOBOT_TOKEN;
  if (process.env.STRIPE_SECRET_KEY)      cfg.stripeKey      = process.env.STRIPE_SECRET_KEY;
  if (process.env.STRIPE_WEBHOOK_SECRET)  cfg.stripeWebhook  = process.env.STRIPE_WEBHOOK_SECRET;
}

function saveData() {
  try {
    fs.writeFileSync(CFG_FILE,    JSON.stringify(cfg,     null, 2));
    fs.writeFileSync(STOCK_FILE,  JSON.stringify(stock,   null, 2));
    fs.writeFileSync(STATS_FILE,  JSON.stringify(stats,   null, 2));
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders,  null, 2));
    fs.writeFileSync(SELLERS_FILE,JSON.stringify(sellers, null, 2));
  } catch(e) { addLog('err','Sauvegarde échouée: '+e.message); }
}

function checkDailyReset() {
  if (stats.lastReset !== today()) { stats.day=0; stats.lastReset=today(); saveData(); }
}

// ─────────────────────────────────────────
//  LOGS
// ─────────────────────────────────────────
function addLog(type, msg) {
  logs.unshift({ type, msg, time: new Date().toLocaleTimeString('fr-FR'), ts: Date.now() });
  if (logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
  const e = {ok:'✓',err:'✗',warn:'⚠',info:'ℹ'}[type]||'·';
  console.log(`[${new Date().toISOString()}] ${e} ${msg}`);
}

// ─────────────────────────────────────────
//  HELPERS STOCK
// ─────────────────────────────────────────
function buildStockText() {
  if (!stock.length) return 'Aucun article en stock.';
  return stock.map(s => {
    const st = s.qty===0?'❌ RUPTURE':s.qty<=(s.alert||5)?'⚠ BAS':'✓ OK';
    return `- ${s.name}: ${s.qty} · ${s.price}€ · ${st}`;
  }).join('\n');
}

function buildSystemPrompt(userName, userId) {
  const sp = cfg.systemPrompt || 'Tu es un assistant commercial. Réponds en français.';
  const now = new Date();
  return sp
    .replace(/\{stock\}/g,     buildStockText())
    .replace(/\{user_name\}/g, userName||'Utilisateur')
    .replace(/\{user_id\}/g,   String(userId||''))
    .replace(/\{date\}/g,      now.toLocaleDateString('fr-FR'))
    .replace(/\{heure\}/g,     now.toLocaleTimeString('fr-FR'));
}

// ─────────────────────────────────────────
//  CLAUDE
// ─────────────────────────────────────────
async function callClaude(userId, userName, userMessage) {
  checkDailyReset();
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role:'user', content:userMessage });
  const msgs = conversations[userId].slice(-(cfg.contextWindow*2));
  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':cfg.claudeKey,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({ model:cfg.claudeModel, max_tokens:cfg.maxTokens, system:buildSystemPrompt(userName,userId), messages:msgs }),
  });
  if (!res.ok) { const e=await res.json().catch(()=>{}); throw new Error(e?.error?.message||`HTTP ${res.status}`); }
  const data = await res.json();
  const elapsed = ((Date.now()-t0)/1000).toFixed(2);
  if (!data.content) throw new Error('Réponse invalide');
  const reply  = data.content.map(c=>c.text||'').join('').trim();
  const tokIn  = data.usage?.input_tokens||0;
  const tokOut = data.usage?.output_tokens||0;
  const total  = tokIn+tokOut;
  conversations[userId].push({ role:'assistant', content:reply });
  stats.day+=total; stats.month+=total; stats.msgs+=1; stats.input+=tokIn; stats.output+=tokOut;
  history.unshift({ time:new Date().toLocaleTimeString('fr-FR'), userId:String(userId), userName:userName||'?',
    msg:userMessage.slice(0,60), reply:reply.slice(0,100), tokIn, tokOut, total, duration:elapsed+'s' });
  if (history.length>MAX_HISTORY) history.pop();
  saveData();
  addLog('ok',`@${userName} | ${total} tok | ${elapsed}s`);
  return reply;
}

// ─────────────────────────────────────────
//  BOT TELEGRAM
// ─────────────────────────────────────────
function startBot() {
  if (running)            return { ok:false, reason:'Déjà démarré' };
  if (!cfg.telegramToken) return { ok:false, reason:'Token manquant' };
  if (!cfg.claudeKey)     return { ok:false, reason:'Clé Claude manquante' };
  try {
    bot = new TelegramBot(cfg.telegramToken, { polling:true });
    running=true; startedAt=new Date().toISOString();
    addLog('ok',`Bot démarré · ${cfg.claudeModel}`);

    bot.on('message', async (msg) => {
      const userId   = msg.from.id;
      const userName = msg.from.username||msg.from.first_name||String(userId);
      const text     = msg.text;
      if (!text) return;

      // /start ou /shop → Mini App marketplace
      if (text.startsWith('/start') || text.startsWith('/shop')) {
        const shopUrl = `https://agentos-server-production-a5b4.up.railway.app/shop-app`;
        bot.sendMessage(msg.chat.id,
          `👋 Bienvenue ${msg.from.first_name||''} sur le Marketplace !\n\n🛍 Découvrez nos vendeurs et leurs produits.`,
          { reply_markup: { inline_keyboard: [[{ text:'🛍 Ouvrir le Marketplace', web_app:{ url:shopUrl } }]] } }
        );
        addLog('info',`@${userName} → marketplace`);
        return;
      }

      addLog('info',`@${userName}: ${text.slice(0,60)}`);
      try {
        await bot.sendChatAction(msg.chat.id,'typing');
        const reply = await callClaude(userId, userName, text);
        await bot.sendMessage(msg.chat.id, reply, { parse_mode:'Markdown', disable_web_page_preview:true });
      } catch(e) {
        addLog('err',`@${userName}: ${e.message}`);
        bot.sendMessage(msg.chat.id,'⚠️ Une erreur est survenue, réessayez.');
      }
    });

    bot.on('polling_error', err => addLog('err','Polling: '+(err.message||String(err))));
    bot.on('error',         err => addLog('err','Bot: '+(err.message||String(err))));
    return { ok:true };
  } catch(e) {
    running=false; addLog('err','Démarrage: '+e.message);
    return { ok:false, reason:e.message };
  }
}

function stopBot() {
  if (bot) { try{ bot.stopPolling(); }catch(e){} bot=null; }
  running=false; startedAt=null; addLog('warn','Bot arrêté');
}

// ─────────────────────────────────────────
//  AUTH MIDDLEWARE
// ─────────────────────────────────────────
function auth(req, res, next) {
  const s = req.headers['x-secret'];
  if (!s || s !== cfg.secret) return res.status(401).json({ error:'Non autorisé' });
  next();
}

function sellerAuth(req, res, next) {
  const s = req.headers['x-secret'];
  const seller = sellers.find(v => v.secret === s && v.active);
  if (!seller) return res.status(401).json({ error:'Vendeur non autorisé' });
  req.seller = seller;
  next();
}

// ─────────────────────────────────────────
//  ROUTES ADMIN
// ─────────────────────────────────────────
app.get('/health', (req,res) => res.json({ ok:true, uptime:Math.floor(process.uptime()), running }));
app.get('/status', auth, (req,res) => res.json({ running, startedAt, model:cfg.claudeModel, msgs:stats.msgs, tokDay:stats.day, uptime:Math.floor(process.uptime()), users:Object.keys(conversations).length }));
app.post('/start', auth, (req,res) => { if(req.body.telegramToken) cfg.telegramToken=req.body.telegramToken; if(req.body.claudeKey) cfg.claudeKey=req.body.claudeKey; saveData(); res.json(startBot()); });
app.post('/stop',  auth, (req,res) => { stopBot(); res.json({ ok:true }); });
app.get('/config', auth, (req,res) => { const {telegramToken,claudeKey,secret,...safe}=cfg; res.json(safe); });
app.post('/config', auth, (req,res) => {
  ['claudeModel','systemPrompt','maxTokens','temperature','contextWindow','stockInject','stockAlerts','commissionRate']
    .forEach(k => { if(req.body[k]!==undefined) cfg[k]=req.body[k]; });
  if(req.body.telegramToken) cfg.telegramToken=req.body.telegramToken;
  if(req.body.claudeKey)     cfg.claudeKey=req.body.claudeKey;
  saveData(); addLog('info','Config mise à jour'); res.json({ ok:true });
});
app.get('/logs',  auth, (req,res) => res.json(logs.slice(0, Math.min(parseInt(req.query.limit)||100, MAX_LOGS))));
app.get('/stats', auth, (req,res) => { checkDailyReset(); res.json({ ...stats, history:history.slice(0,30) }); });
app.get('/conversations', auth, (req,res) => res.json(history.slice(0,50)));
app.delete('/conversation/:userId', auth, (req,res) => { delete conversations[req.params.userId]; res.json({ ok:true }); });
app.delete('/conversations', auth, (req,res) => { const c=Object.keys(conversations).length; conversations={}; res.json({ ok:true, cleared:c }); });
app.post('/stats/reset', auth, (req,res) => { stats={day:0,month:0,msgs:0,input:0,output:0,lastReset:today()}; history=[]; saveData(); res.json({ ok:true }); });

// ── Stock admin (son propre stock)
app.get('/stock',  auth, (req,res) => res.json(stock));
app.post('/stock', auth, (req,res) => {
  if(!Array.isArray(req.body)) return res.status(400).json({ error:'Format invalide' });
  stock=req.body; saveData(); addLog('ok',`Stock admin · ${stock.length} articles`);
  res.json({ ok:true, count:stock.length });
});
app.get('/shop',  auth, (req,res) => res.json(shopItems));
app.post('/shop', auth, (req,res) => {
  if(!Array.isArray(req.body)) return res.status(400).json({ error:'Format invalide' });
  shopItems=req.body; saveData(); addLog('ok',`Shop admin · ${shopItems.length} articles`);
  res.json({ ok:true, count:shopItems.length });
});
app.get('/orders', auth, (req,res) => res.json(orders));

// ─────────────────────────────────────────
//  ROUTES VENDEURS (admin gère les vendeurs)
// ─────────────────────────────────────────

// Créer un vendeur
app.post('/sellers', auth, async (req,res) => {
  const { name, shopName, description, telegramId } = req.body;
  if(!name) return res.status(400).json({ error:'Nom manquant' });
  const seller = {
    id          : Date.now(),
    name,
    shopName    : shopName || name,
    description : description || '',
    telegramId  : telegramId || '',
    secret      : crypto.randomBytes(16).toString('hex'),
    active      : true,
    stock       : [],
    shopItems   : [],
    balance     : 0,
    totalSales  : 0,
    totalCommission: 0,
    createdAt   : new Date().toISOString(),
  };
  sellers.push(seller);
  saveData();
  addLog('ok',`Vendeur créé: ${name}`);

  // Envoyer le lien au vendeur via Telegram si bot actif et telegramId fourni
  if(telegramId && bot) {
    try {
      await bot.sendMessage(telegramId,
        `🎉 *Bienvenue sur le Marketplace !*\n\nBonjour ${name}, votre espace vendeur est prêt.\n\n🔑 Votre clé secrète :\n\`${seller.secret}\`\n\n👇 Accédez à votre dashboard :`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: '🛍 Ouvrir mon dashboard vendeur',
              url: `https://agentos-server-production-a5b4.up.railway.app/seller-dashboard`
            }]]
          }
        }
      );
      addLog('ok', `Dashboard vendeur envoyé à Telegram ID ${telegramId}`);
    } catch(e) {
      addLog('warn', `Impossible d'envoyer à Telegram ${telegramId}: ${e.message}`);
    }
  }

  res.json({ ok:true, seller: { ...seller } });
});

// Lister tous les vendeurs
app.get('/sellers', auth, (req,res) => {
  res.json(sellers.map(s => ({ ...s, secret:undefined }))); // cache le secret
});

// Voir un vendeur (avec secret pour l'admin)
app.get('/sellers/:id', auth, (req,res) => {
  const s = sellers.find(v => String(v.id)===req.params.id);
  if(!s) return res.status(404).json({ error:'Vendeur introuvable' });
  res.json(s);
});

// Activer/désactiver un vendeur
app.post('/sellers/:id/toggle', auth, (req,res) => {
  const s = sellers.find(v => String(v.id)===req.params.id);
  if(!s) return res.status(404).json({ error:'Introuvable' });
  s.active = !s.active;
  saveData();
  addLog('info',`Vendeur ${s.name} → ${s.active?'actif':'inactif'}`);
  res.json({ ok:true, active:s.active });
});

// Supprimer un vendeur
app.delete('/sellers/:id', auth, (req,res) => {
  sellers = sellers.filter(v => String(v.id)!==req.params.id);
  saveData();
  res.json({ ok:true });
});

// ─────────────────────────────────────────
//  ROUTES VENDEUR (auth par secret vendeur)
// ─────────────────────────────────────────

// Vendeur : voir son profil
app.get('/seller/me', sellerAuth, (req,res) => {
  const { secret, ...safe } = req.seller;
  res.json(safe);
});

// Vendeur : pousser son stock
app.post('/seller/stock', sellerAuth, (req,res) => {
  if(!Array.isArray(req.body)) return res.status(400).json({ error:'Format invalide' });
  req.seller.stock = req.body;
  saveData();
  addLog('ok',`Stock vendeur ${req.seller.name} · ${req.body.length} articles`);
  res.json({ ok:true, count:req.body.length });
});

// Vendeur : pousser son catalogue
app.post('/seller/shop', sellerAuth, (req,res) => {
  if(!Array.isArray(req.body)) return res.status(400).json({ error:'Format invalide' });
  req.seller.shopItems = req.body;
  saveData();
  addLog('ok',`Catalogue vendeur ${req.seller.name} · ${req.body.length} articles`);
  res.json({ ok:true, count:req.body.length });
});

// ─────────────────────────────────────────
//  CATALOGUE PUBLIC — MARKETPLACE
// ─────────────────────────────────────────

// Tous les vendeurs actifs avec leurs produits
app.get('/marketplace', (req,res) => {
  const result = [];

  // Admin (toi) — ses propres articles
  const adminItems = shopItems
    .map(item => {
      const s = stock.find(x => x.id===item.stockId);
      if(!s||s.qty<=0) return null;
      return {
        id          : item.stockId,
        sellerId    : 'admin',
        sellerName  : 'Boutique Officielle',
        sellerShop  : 'Boutique Officielle',
        title       : item.title,
        description : item.description||'',
        price       : parseFloat(item.price||0),
        qty         : s.qty,
        puffs       : s.puffs||0,
        cat         : s.cat||'',
        alert       : s.alert||5,
        payload     : item.payload,
      };
    }).filter(Boolean);
  if(adminItems.length) result.push({ sellerId:'admin', sellerName:'Boutique Officielle', items:adminItems });

  // Autres vendeurs
  sellers.filter(v=>v.active).forEach(v => {
    const items = (v.shopItems||[]).map(item => {
      const s = (v.stock||[]).find(x=>x.id===item.stockId);
      if(!s||s.qty<=0) return null;
      return {
        id          : item.stockId,
        sellerId    : v.id,
        sellerName  : v.name,
        sellerShop  : v.shopName||v.name,
        title       : item.title,
        description : item.description||'',
        price       : parseFloat(item.price||0),
        qty         : s.qty,
        puffs       : s.puffs||0,
        cat         : s.cat||'',
        alert       : s.alert||5,
        payload     : item.payload,
      };
    }).filter(Boolean);
    if(items.length) result.push({ sellerId:v.id, sellerName:v.name, sellerShop:v.shopName||v.name, items });
  });

  res.json(result);
});

// Route legacy
app.get('/shop-catalogue', (req,res) => {
  const all = [];
  shopItems.forEach(item => {
    const s = stock.find(x=>x.id===item.stockId);
    if(s&&s.qty>0) all.push({ ...item, qty:s.qty, puffs:s.puffs||0, cat:s.cat||'', alert:s.alert||5 });
  });
  sellers.filter(v=>v.active).forEach(v => {
    (v.shopItems||[]).forEach(item => {
      const s = (v.stock||[]).find(x=>x.id===item.stockId);
      if(s&&s.qty>0) all.push({ ...item, sellerId:v.id, sellerName:v.name, qty:s.qty, puffs:s.puffs||0, cat:s.cat||'' });
    });
  });
  res.json(all);
});

app.get('/stock-public', (req,res) => {
  const all = [];
  stock.filter(s=>s.enVente&&s.qty>0).forEach(s=>all.push({ id:s.id,name:s.name,cat:s.cat,price:s.price,qty:s.qty,puffs:s.puffs||0,sellerId:'admin' }));
  sellers.filter(v=>v.active).forEach(v=>{
    (v.stock||[]).filter(s=>s.enVente&&s.qty>0).forEach(s=>all.push({ id:s.id,name:s.name,cat:s.cat,price:s.price,qty:s.qty,puffs:s.puffs||0,sellerId:v.id,sellerName:v.name }));
  });
  res.json(all);
});

// ─────────────────────────────────────────
//  CHECKOUT MULTI-VENDEUR
// ─────────────────────────────────────────
app.post('/shop-checkout', async (req,res) => {
  const { cart, userId, userName } = req.body;
  if(!cart||!cart.length) return res.status(400).json({ error:'Panier vide' });
  if(!cfg.stripeKey)       return res.status(400).json({ error:'Stripe non configuré' });

  try {
    const serverUrl = `https://agentos-server-production-a5b4.up.railway.app`;
    const params    = new URLSearchParams();
    params.append('payment_method_types[]','card');
    params.append('mode','payment');
    params.append('success_url',`${serverUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${serverUrl}/payment-cancel`);
    params.append('shipping_address_collection[allowed_countries][]','FR');
    params.append('shipping_address_collection[allowed_countries][]','BE');
    params.append('shipping_address_collection[allowed_countries][]','CH');
    params.append('shipping_address_collection[allowed_countries][]','LU');
    params.append('phone_number_collection[enabled]','true');
    params.append('metadata[userId]',   userId||'');
    params.append('metadata[userName]', userName||'');
    params.append('metadata[cartJson]', JSON.stringify(cart.map(i=>({ sellerId:i.sellerId, id:i.id, price:i.price, qty:i.qty }))));

    cart.forEach((item,idx) => {
      const cents = Math.round(parseFloat(item.price)*100);
      params.append(`line_items[${idx}][price_data][currency]`,'eur');
      params.append(`line_items[${idx}][price_data][product_data][name]`,item.title);
      params.append(`line_items[${idx}][price_data][product_data][description]`,item.description||'');
      params.append(`line_items[${idx}][price_data][unit_amount]`,cents);
      params.append(`line_items[${idx}][quantity]`,'1');
    });

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method:'POST',
      headers:{'Authorization':`Bearer ${cfg.stripeKey}`,'Content-Type':'application/x-www-form-urlencoded'},
      body:params,
    });
    const session = await stripeRes.json();
    if(session.error) throw new Error(session.error.message);
    addLog('info',`Checkout · @${userName} · ${cart.length} article(s)`);
    res.json({ url:session.url });
  } catch(e) {
    addLog('err','Checkout: '+e.message);
    res.status(500).json({ error:e.message });
  }
});

// ─────────────────────────────────────────
//  STRIPE WEBHOOK — commission auto 5%
// ─────────────────────────────────────────
app.post('/stripe-webhook', async (req,res) => {
  const event = req.body;
  if(!event||!event.type) return res.sendStatus(400);
  addLog('info',`Stripe webhook · ${event.type}`);

  if(event.type==='checkout.session.completed') {
    const session  = event.data.object;
    const meta     = session.metadata||{};
    const userId   = meta.userId||'';
    const userName = meta.userName||'';
    const amount   = (session.amount_total/100).toFixed(2);
    // Commission : 1€ flat par article ou % selon config
    const nbItems    = cartItems.reduce((s,i)=>s+parseInt(i.qty||1),0);
    const commission = cfg.commissionMode==='flat'
      ? (cfg.commissionFlat * nbItems).toFixed(2)
      : (parseFloat(amount)*cfg.commissionRate).toFixed(2);
    const sellerAmount = (parseFloat(amount)-parseFloat(commission)).toFixed(2);

    // Récupérer les line items pour les noms
    let productNames = [];
    try {
      const li = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,
        { headers:{'Authorization':`Bearer ${cfg.stripeKey}`} });
      const ld = await li.json();
      if(ld.data?.length) productNames = ld.data.map(x=>x.description||x.amount_total);
    } catch(e){}

    // Parser le cart depuis metadata
    let cartItems = [];
    try { cartItems = JSON.parse(meta.cartJson||'[]'); } catch(e){}

    const customer = session.customer_details||{};
    const shipping = session.shipping_details||{};
    const addr     = shipping.address||{};

    const order = {
      id         : Date.now(),
      date       : new Date().toLocaleString('fr-FR'),
      userId, userName, amount, commission, sellerAmount,
      stockName  : productNames.join(', ')||'Commande',
      invoiceId  : session.id,
      provider   : 'stripe',
      cartItems,
      client     : {
        name   : shipping.name||customer.name||'',
        email  : customer.email||'',
        phone  : customer.phone||'',
        address: [addr.line1,addr.line2].filter(Boolean).join(', '),
        city   : addr.city||'',
        postal : addr.postal_code||'',
        country: addr.country||'',
      },
    };
    orders.unshift(order);

    // Créditer les vendeurs concernés + déduire stock
    cartItems.forEach(ci => {
      const qty        = parseInt(ci.qty||1);
      const itemAmount = parseFloat(ci.price||0)*qty;
      const itemCommission = cfg.commissionMode==='flat'
        ? cfg.commissionFlat * qty
        : itemAmount * cfg.commissionRate;
      const itemNet = itemAmount - itemCommission;

      if(ci.sellerId==='admin'||!ci.sellerId) {
        // Stock admin
        const s = stock.find(x=>x.id===ci.id);
        if(s&&s.qty>0) { s.qty=Math.max(0,s.qty-parseInt(ci.qty||1)); addLog('info',`📦 Admin ${s.name} → ${s.qty}`); }
      } else {
        // Vendeur tiers
        const v = sellers.find(x=>String(x.id)===String(ci.sellerId));
        if(v) {
          v.balance        = parseFloat((parseFloat(v.balance||0)+itemNet).toFixed(2));
          v.totalSales     = parseFloat((parseFloat(v.totalSales||0)+itemAmount).toFixed(2));
          v.totalCommission= parseFloat((parseFloat(v.totalCommission||0)+itemCommission).toFixed(2));
          const s = (v.stock||[]).find(x=>x.id===ci.id);
          if(s&&s.qty>0) { s.qty=Math.max(0,s.qty-qty); addLog('info',`📦 ${v.name} ${s.name} → ${s.qty}`); }

          // 🔔 Notification Telegram au vendeur
          if(v.telegramId && bot) {
            const itemName  = s ? s.name : `Article #${ci.id}`;
            const stockLeft = s ? s.qty  : '?';
            const client    = order.client||{};
            const addrLine  = [client.name, client.address, client.postal, client.city, client.country].filter(Boolean).join(', ');
            bot.sendMessage(v.telegramId,
              `🛍 *Nouvelle vente !*\n\n`
              + `📦 ${qty}x *${itemName}*\n`
              + `💰 Montant : ${itemAmount.toFixed(2)}€\n`
              + `💵 Votre gain net : *${itemNet.toFixed(2)}€*\n`
              + `📊 Stock restant : ${stockLeft} unité(s)\n\n`
              + `👤 *Livraison :*\n${addrLine||'Non renseigné'}\n`
              + (client.phone?`📞 ${client.phone}\n`:'')
              + (client.email?`📧 ${client.email}`:''),
              { parse_mode:'Markdown' }
            ).catch(e=>addLog('warn',`Notif vendeur ${v.name}: ${e.message}`));
          }
        }
      }
    });

    saveData();
    addLog('ok',`💳 Stripe · @${userName} · ${amount}€ · com:${commission}€ (${cfg.commissionMode==='flat'?cfg.commissionFlat+'€/art':Math.round(cfg.commissionRate*100)+'%'}) · vendeur:${sellerAmount}€`);

    if(userId&&bot) {
      try {
        await bot.sendMessage(userId,
          `✅ *Commande confirmée !*\n\n🛍 ${productNames.join(', ')||'Votre commande'}\n💶 ${amount}€ payés\n\nMerci ! 🙏`,
          { parse_mode:'Markdown' }
        );
      } catch(e){}
    }
  }
  res.sendStatus(200);
});

// ─────────────────────────────────────────
//  PAGES STATIQUES
// ─────────────────────────────────────────
app.get('/shop-app',        (req,res) => res.sendFile(path.join(__dirname,'shop.html')));
app.get('/seller-dashboard',(req,res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VendorOS</title>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--gold:#F0B429;--gdim:rgba(240,180,41,.08);--bg0:#08080A;--bg1:#0F0F12;--bg2:#161619;--bg3:#1E1E23;--bg4:#26262D;--gb:rgba(255,255,255,.07);--text:#F0EEE8;--t2:#8A8680;--t3:#4A4744;--green:#4ADE80;--grdim:rgba(74,222,128,.08);--red:#F87171;--rdim:rgba(248,113,113,.08);--blue:#4FC3F7;--bdim:rgba(79,195,247,.08);--r:14px;--rs:8px;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg0);color:var(--text);font-family:'Bricolage Grotesque',sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden;}
.login-wrap{flex:1;display:flex;align-items:center;justify-content:center;}
.login-box{width:380px;background:var(--bg2);border:1px solid var(--gb);border-radius:var(--r);padding:32px;}
.login-logo{font-size:22px;font-weight:800;margin-bottom:4px;}.login-logo span{color:var(--gold);}
.login-sub{font-size:13px;color:var(--t2);margin-bottom:24px;}
.fl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:6px;}
.fi{width:100%;background:var(--bg3);border:1px solid var(--gb);color:var(--text);font-family:'Bricolage Grotesque';font-size:13px;padding:10px 13px;border-radius:var(--rs);outline:none;margin-bottom:14px;}
.fi:focus{border-color:var(--gold);}
.topbar{flex-shrink:0;background:var(--bg1);border-bottom:1px solid var(--gb);padding:0 20px;display:flex;align-items:center;height:52px;gap:12px;}
.topbar-logo{font-size:16px;font-weight:800;}.topbar-logo span{color:var(--gold);}
.tnav{padding:7px 14px;border-radius:var(--rs);font-size:12px;font-weight:700;cursor:pointer;color:var(--t2);transition:all .15s;}
.tnav.active{background:var(--gdim);color:var(--gold);}
.app-body{flex:1;display:flex;overflow:hidden;}
.content{flex:1;overflow-y:auto;padding:20px;}
.panel{display:none;}.panel.active{display:block;}
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
.sc{background:var(--bg2);border:1px solid var(--gb);border-radius:var(--r);padding:16px 18px;}
.sl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:8px;}
.sv{font-size:22px;font-weight:800;}.sv.gold{color:var(--gold);}.sv.green{color:var(--green);}.sv.blue{color:var(--blue);}
.card{background:var(--bg2);border:1px solid var(--gb);border-radius:var(--r);margin-bottom:14px;overflow:hidden;}
.ch{padding:12px 16px;border-bottom:1px solid var(--gb);display:flex;align-items:center;justify-content:space-between;}
.ct{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;}
.btn{padding:8px 14px;border-radius:var(--rs);font-family:'Bricolage Grotesque';font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;border:1px solid var(--gb);background:var(--bg3);color:var(--text);}
.btn:active{transform:scale(.97);}
.btn.p{background:var(--gold);color:#000;border-color:var(--gold);}
.btn.d{background:var(--rdim);color:var(--red);border-color:rgba(248,113,113,.25);}
.btn.f{width:100%;padding:11px;}
.btn.sm{padding:5px 10px;font-size:11px;}
.tw{overflow-x:auto;}
table{width:100%;border-collapse:collapse;}
th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);padding:9px 12px;border-bottom:1px solid var(--gb);}
td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.03);font-size:13px;vertical-align:middle;}
tr:last-child td{border:none;}
.ci{background:var(--bg3);border:1px solid var(--gb);color:var(--text);font-family:'Bricolage Grotesque';font-size:12px;padding:6px 10px;border-radius:var(--rs);outline:none;width:100%;}
.ci:focus{border-color:var(--gold);}
.ci.n{font-family:'DM Mono';font-size:14px;font-weight:700;color:var(--gold);text-align:center;width:70px;}
.ci.pr{font-family:'DM Mono';font-size:12px;width:75px;}
.ci.pf{font-family:'DM Mono';font-size:12px;width:65px;}
.ci.ct{max-width:110px;}
.sw{display:inline-block;position:relative;width:40px;height:22px;cursor:pointer;}
.sw input{display:none;}
.sw-t{position:absolute;inset:0;background:var(--bg4);border-radius:11px;transition:.2s;border:1px solid var(--gb);}
.sw input:checked+.sw-t{background:var(--gold);border-color:var(--gold);}
.sw-k{position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.2s;}
.sw input:checked~.sw-k{transform:translateX(18px);}
.bx{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;font-family:'DM Mono';}
.bx.bl{background:var(--bdim);color:var(--blue);}.bx.gr{background:var(--grdim);color:var(--green);}.bx.gd{background:var(--gdim);color:var(--gold);}
.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;padding:14px;}
.cc{background:var(--bg3);border:1px solid var(--gb);border-radius:var(--r);padding:14px;transition:border-color .15s;}
.cc.on{border-color:rgba(240,180,41,.3);background:var(--gdim);}
.cc-name{font-size:13px;font-weight:700;margin-bottom:4px;}
.cc-meta{font-size:11px;color:var(--t3);margin-bottom:10px;}
.cc-price{font-size:18px;font-weight:800;color:var(--gold);margin-bottom:10px;}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--bg3);border:1px solid var(--gb);border-radius:10px;padding:10px 18px;font-size:12px;font-weight:600;z-index:999;transition:transform .3s;box-shadow:0 8px 24px rgba(0,0,0,.5);}
.toast.show{transform:translateX(-50%) translateY(0);}
.chip{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--gb);border-radius:20px;padding:4px 12px 4px 4px;}
.chip-av{width:26px;height:26px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#000;}
.content::-webkit-scrollbar{width:4px;}
.content::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:2px;}
</style>
</head>
<body>
<div id="loginView" class="login-wrap">
  <div class="login-box">
    <div class="login-logo">🛍 <span>Vendor</span>OS</div>
    <div class="login-sub">Votre espace vendeur — entrez votre clé secrète</div>
    <div class="fl">Clé secrète</div>
    <input class="fi" type="password" id="secretInput" placeholder="••••••••••••••••" onkeydown="if(event.key==='Enter')doLogin()">
    <button class="btn p f" onclick="doLogin()">Accéder à mon dashboard</button>
    <div id="loginErr" style="color:var(--red);font-size:12px;margin-top:8px;display:none;">Clé incorrecte — contactez l'administrateur.</div>
  </div>
</div>
<div id="dashView" style="display:none;flex:1;flex-direction:column;overflow:hidden;">
  <div class="topbar">
    <div class="topbar-logo">🛍 <span>Vendor</span>OS</div>
    <div style="display:flex;gap:2px;flex:1;">
      <div class="tnav active" id="nav-stock" onclick="switchTab('stock')">📦 Stock</div>
      <div class="tnav" id="nav-catalogue" onclick="switchTab('catalogue')">🛍 Catalogue</div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
      <div class="chip"><div class="chip-av" id="sellerAv">?</div><span style="font-size:12px;font-weight:700;" id="sellerNm">—</span></div>
      <button class="btn sm d" onclick="doLogout()">Déconnexion</button>
    </div>
  </div>
  <div class="app-body">
    <div class="content">
      <div class="stats-row">
        <div class="sc"><div class="sl">Solde disponible</div><div class="sv gold" id="stBal">0.00€</div></div>
        <div class="sc"><div class="sl">Ventes totales</div><div class="sv green" id="stSales">0.00€</div></div>
        <div class="sc"><div class="sl">Valeur du stock</div><div class="sv blue" id="stVal">0.00€</div></div>
        <div class="sc"><div class="sl">Articles en vente</div><div class="sv" id="stActive">0</div></div>
      </div>
      <div class="panel active" id="panel-stock">
        <div class="card">
          <div class="ch">
            <div class="ct">📦 Mon Stock <span class="bx bl" id="stockCount">0</span></div>
            <div style="display:flex;gap:8px;">
              <button class="btn sm" onclick="addRow()">+ Ajouter</button>
              <button class="btn sm p" onclick="pushAll()">🖥 Pousser</button>
            </div>
          </div>
          <div class="tw"><table>
            <thead><tr><th>Produit</th><th>Catégorie</th><th>Quantité</th><th>Prix €</th><th>Puffs K</th><th>Seuil</th><th></th></tr></thead>
            <tbody id="stockBody"></tbody>
          </table></div>
        </div>
      </div>
      <div class="panel" id="panel-catalogue">
        <div class="card">
          <div class="ch">
            <div class="ct">🛍 Catalogue <span class="bx gd" id="catCount">0 en vente</span></div>
            <div style="display:flex;gap:8px;">
              <button class="btn sm" onclick="catAll(true)">Tout activer</button>
              <button class="btn sm" onclick="catAll(false)">Tout désactiver</button>
              <button class="btn sm p" onclick="pushAll()">🖥 Pousser</button>
            </div>
          </div>
          <div class="cg" id="catGrid"></div>
        </div>
        <div style="background:var(--gdim);border:1px solid rgba(240,180,41,.2);border-radius:var(--r);padding:14px 16px;font-size:12px;color:var(--t2);">
          💡 Activez les articles à mettre en vente puis cliquez "Pousser".
        </div>
      </div>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
const SRV='${`https://agentos-server-production-a5b4.up.railway.app`}';
let sec='',seller=null,stock=[],nid=1;
async function doLogin(){
  const s=document.getElementById('secretInput').value.trim();if(!s)return;
  try{
    const r=await fetch(SRV+'/seller/me',{headers:{'x-secret':s}});
    if(!r.ok)throw new Error();
    seller=await r.json();sec=s;stock=seller.stock||[];
    nid=stock.length?Math.max(...stock.map(x=>x.id||0))+1:1;
    document.getElementById('loginView').style.display='none';
    const dv=document.getElementById('dashView');dv.style.display='flex';
    document.getElementById('sellerAv').textContent=(seller.shopName||seller.name||'?')[0].toUpperCase();
    document.getElementById('sellerNm').textContent=seller.shopName||seller.name;
    document.getElementById('stBal').textContent=parseFloat(seller.balance||0).toFixed(2)+'€';
    document.getElementById('stSales').textContent=parseFloat(seller.totalSales||0).toFixed(2)+'€';
    renderStock();renderCat();updateStats();
  }catch(e){document.getElementById('loginErr').style.display='block';}
}
function doLogout(){sec='';seller=null;stock=[];document.getElementById('loginView').style.display='flex';document.getElementById('dashView').style.display='none';document.getElementById('secretInput').value='';document.getElementById('loginErr').style.display='none';}
function switchTab(t){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tnav').forEach(n=>n.classList.remove('active'));document.getElementById('panel-'+t).classList.add('active');document.getElementById('nav-'+t).classList.add('active');if(t==='catalogue')renderCat();}
function updateStats(){
  const val=stock.reduce((s,x)=>s+(x.qty||0)*(x.price||0),0);
  const active=stock.filter(x=>x.enVente&&x.qty>0).length;
  document.getElementById('stVal').textContent=val.toFixed(2)+'€';
  document.getElementById('stActive').textContent=active;
  document.getElementById('stockCount').textContent=stock.length;
  document.getElementById('catCount').textContent=active+' en vente';
}
function renderStock(){
  updateStats();
  const b=document.getElementById('stockBody');
  if(!stock.length){b.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px;">Aucun article — cliquez sur + Ajouter</td></tr>';return;}
  b.innerHTML=stock.map((s,i)=>
    '<tr>'
    +'<td><input class="ci" value="'+(s.name||'')+'" oninput="stock['+i+'].name=this.value;updateStats()"></td>'
    +'<td><input class="ci ct" value="'+(s.cat||'')+'" oninput="stock['+i+'].cat=this.value"></td>'
    +'<td><input class="ci n" type="number" value="'+(s.qty||0)+'" oninput="stock['+i+'].qty=parseInt(this.value)||0;updateStats()"></td>'
    +'<td><input class="ci pr" type="number" step="0.01" value="'+(s.price||0)+'" oninput="stock['+i+'].price=parseFloat(this.value)||0;updateStats()"></td>'
    +'<td style="display:flex;align-items:center;gap:4px;"><input class="ci pf" type="number" value="'+(s.puffs?s.puffs/1000:'')+'" placeholder="18" oninput="stock['+i+'].puffs=(parseFloat(this.value)||0)*1000"><span style="font-size:10px;color:var(--t3);">K</span></td>'
    +'<td><input class="ci" type="number" value="'+(s.alert||5)+'" style="width:55px;" oninput="stock['+i+'].alert=parseInt(this.value)||5"></td>'
    +'<td><button class="btn sm d" onclick="delRow('+i+')">✕</button></td>'
    +'</tr>'
  ).join('');
}
function addRow(){stock.push({id:nid++,name:'',cat:'',qty:0,price:0,puffs:0,alert:5,enVente:false});renderStock();}
function delRow(i){stock.splice(i,1);renderStock();renderCat();}
function renderCat(){
  updateStats();
  const g=document.getElementById('catGrid');
  const av=stock.filter(s=>s.qty>0);
  if(!av.length){g.innerHTML='<div style="text-align:center;color:var(--t3);padding:32px;grid-column:1/-1;">Aucun article disponible en stock</div>';return;}
  g.innerHTML=av.map(s=>{
    const i=stock.indexOf(s);
    const pf=s.puffs?(s.puffs>=1000?(s.puffs/1000).toFixed(0)+'K':s.puffs)+' puffs':'';
    return '<div class="cc'+(s.enVente?' on':'')+'">'
      +'<div class="cc-name">'+(s.name||'Sans nom')+'</div>'
      +'<div class="cc-meta">'+(s.cat||'')+(pf?' · '+pf:'')+'</div>'
      +'<div class="cc-price">'+parseFloat(s.price||0).toFixed(2)+'€</div>'
      +'<div style="display:flex;align-items:center;gap:8px;">'
      +'<label class="sw"><input type="checkbox" '+(s.enVente?'checked':'')+' onchange="stock['+i+'].enVente=this.checked;renderCat()"><span class="sw-t"></span><span class="sw-k"></span></label>'
      +'<span style="font-size:11px;color:'+(s.enVente?'var(--green)':'var(--t2)')+';">'+(s.enVente?'En vente ✓':'Désactivé')+'</span>'
      +'</div></div>';
  }).join('');
}
function catAll(st){stock.forEach(s=>{if(s.qty>0)s.enVente=st;});renderCat();}
async function pushAll(){
  const btn=event.target;btn.disabled=true;btn.textContent='⏳…';
  try{
    const r1=await fetch(SRV+'/seller/stock',{method:'POST',headers:{'Content-Type':'application/json','x-secret':sec},body:JSON.stringify(stock)});
    if(!r1.ok)throw new Error('Erreur stock');
    const items=stock.filter(s=>s.enVente&&s.qty>0).map(s=>({
      title:s.name,
      description:s.puffs?(s.puffs>=1000?(s.puffs/1000).toFixed(0)+'K':s.puffs)+' puffs'+(s.cat?' · '+s.cat:''):(s.cat||''),
      price:String(s.price||0),asset:'EUR',payload:'stock_'+s.id,stockId:s.id
    }));
    const r2=await fetch(SRV+'/seller/shop',{method:'POST',headers:{'Content-Type':'application/json','x-secret':sec},body:JSON.stringify(items)});
    if(!r2.ok)throw new Error('Erreur catalogue');
    updateStats();
    showToast('✓ Synchronisé · '+stock.length+' articles · '+items.length+' en vente');
  }catch(e){showToast('⚠ '+e.message);}
  finally{btn.disabled=false;btn.textContent=btn.textContent.includes('marketplace')?'🖥 Pousser vers marketplace':'🖥 Pousser';}
}
let tt;
function showToast(m){const el=document.getElementById('toast');el.textContent=m;el.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('show'),3000);}
</script>
</body>
</html>`);
});

app.get('/payment-success', (req,res) => res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>✅ Paiement réussi</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}.box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}.icon{font-size:64px;margin-bottom:16px;}h1{color:#4ade80;}p{color:#8899b0;font-size:14px;}</style>
</head><body><div class="box"><div class="icon">✅</div><h1>Paiement réussi !</h1><p>Retourne dans Telegram pour voir ta confirmation.</p></div></body></html>`));

app.get('/payment-cancel',  (req,res) => res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>❌ Annulé</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}.box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}.icon{font-size:64px;margin-bottom:16px;}h1{color:#f87171;}p{color:#8899b0;font-size:14px;}</style>
</head><body><div class="box"><div class="icon">❌</div><h1>Paiement annulé</h1><p>Retourne dans Telegram et réessaye.</p></div></body></html>`));

// ─────────────────────────────────────────
//  DÉMARRAGE
// ─────────────────────────────────────────
loadData();
app.listen(PORT, () => {
  addLog('info','═══════════════════════════════');
  addLog('info',`AgentOS Marketplace · Port ${PORT}`);
  addLog('info',`Commission: ${cfg.commissionMode==='flat'?cfg.commissionFlat+'€/article':(cfg.commissionRate*100).toFixed(0)+'%'}`);
  addLog('info',`Vendeurs: ${sellers.length}`);
  addLog('info','═══════════════════════════════');
  if(cfg.telegramToken&&cfg.claudeKey) setTimeout(()=>startBot(),1500);
});
process.on('SIGTERM',()=>{ stopBot(); saveData(); process.exit(0); });
process.on('SIGINT', ()=>{ stopBot(); saveData(); process.exit(0); });
