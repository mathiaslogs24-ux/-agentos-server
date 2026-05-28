// ═══════════════════════════════════════════════════════════════
//  AgentOS — Marketplace Server + PostgreSQL
// ═══════════════════════════════════════════════════════════════
'use strict';
const crypto     = require('crypto');
const express    = require('express');
const TelegramBot= require('node-telegram-bot-api');
const { Pool }   = require('pg');
const fs         = require('fs');
const path       = require('path');

try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath,'utf8').split('\n').forEach(line=>{
      const [k,...v]=line.split('=');
      if(k&&!k.startsWith('#')&&v.length) process.env[k.trim()]=v.join('=').trim();
    });
  }
} catch(e){}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*');
  res.header('Access-Control-Allow-Headers','Content-Type, X-Secret');
  res.header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, PATCH, OPTIONS');
  if(req.method==='OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({limit:'2mb'}));

// ─────────────────────────────────────────
//  POSTGRESQL
// ─────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});

async function db(sql, params=[]) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function initDB() {
  await db(`CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS sellers (
    id BIGINT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS orders (
    id BIGINT PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await db(`CREATE TABLE IF NOT EXISTS logs (
    id SERIAL PRIMARY KEY,
    type TEXT,
    msg TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  addLog('ok','PostgreSQL initialisé ✓');
}

// ─────────────────────────────────────────
//  CONFIG (stockée en DB)
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
  stripeKey     : process.env.STRIPE_SECRET_KEY     || '',
  stripeWebhook : process.env.STRIPE_WEBHOOK_SECRET || '',
  commissionRate: 0.05,
  commissionMode: 'flat',
  commissionFlat: 1.00,
};

let stock     = [];
let shopItems = [];

async function loadConfig() {
  try {
    const r = await db("SELECT value FROM config WHERE key='main'");
    if(r.rows.length) {
      const saved = r.rows[0].value;
      cfg       = { ...cfg, ...saved.cfg };
      stock     = saved.stock     || [];
      shopItems = saved.shopItems || [];
    }
  } catch(e) { addLog('warn','loadConfig: '+e.message); }
  if(process.env.TELEGRAM_TOKEN)        cfg.telegramToken  = process.env.TELEGRAM_TOKEN;
  if(process.env.CLAUDE_KEY)            cfg.claudeKey      = process.env.CLAUDE_KEY;
  if(process.env.SECRET)                cfg.secret         = process.env.SECRET;
  if(process.env.CRYPTOBOT_TOKEN)       cfg.cryptoBotToken = process.env.CRYPTOBOT_TOKEN;
  if(process.env.STRIPE_SECRET_KEY)     cfg.stripeKey      = process.env.STRIPE_SECRET_KEY;
  if(process.env.STRIPE_WEBHOOK_SECRET) cfg.stripeWebhook  = process.env.STRIPE_WEBHOOK_SECRET;
}

async function saveConfig() {
  try {
    await db(`INSERT INTO config(key,value,updated_at) VALUES('main',$1,NOW())
              ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()`,
      [JSON.stringify({ cfg, stock, shopItems })]);
  } catch(e) { addLog('err','saveConfig: '+e.message); }
}

// ─────────────────────────────────────────
//  SELLERS (DB)
// ─────────────────────────────────────────
async function getSellers() {
  const r = await db('SELECT data FROM sellers ORDER BY created_at ASC');
  return r.rows.map(x=>x.data);
}

async function getSeller(id) {
  const r = await db('SELECT data FROM sellers WHERE id=$1',[id]);
  return r.rows[0]?.data || null;
}

async function saveSeller(seller) {
  await db(`INSERT INTO sellers(id,data,updated_at) VALUES($1,$2,NOW())
            ON CONFLICT(id) DO UPDATE SET data=$2, updated_at=NOW()`,
    [seller.id, JSON.stringify(seller)]);
}

async function deleteSeller(id) {
  await db('DELETE FROM sellers WHERE id=$1',[id]);
}

// ─────────────────────────────────────────
//  ORDERS (DB)
// ─────────────────────────────────────────
async function getOrders() {
  const r = await db('SELECT data FROM orders ORDER BY created_at DESC LIMIT 500');
  return r.rows.map(x=>x.data);
}

async function getOrder(id) {
  const r = await db('SELECT data FROM orders WHERE id=$1',[id]);
  return r.rows[0]?.data || null;
}

async function saveOrder(order) {
  await db('INSERT INTO orders(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2',
    [order.id, JSON.stringify(order)]);
}

async function deleteOrder(id) {
  await db('DELETE FROM orders WHERE id=$1',[id]);
}

// ─────────────────────────────────────────
//  LOGS (mémoire)
// ─────────────────────────────────────────
let logs    = [];
let history = [];
const MAX_LOGS = 200;

function addLog(type, msg) {
  const entry = { type, msg, time: new Date().toLocaleTimeString('fr-FR'), ts: Date.now() };
  logs.unshift(entry);
  if(logs.length > MAX_LOGS) logs.splice(MAX_LOGS);
  const e={ok:'✓',err:'✗',warn:'⚠',info:'ℹ'}[type]||'·';
  console.log(`[${new Date().toISOString()}] ${e} ${msg}`);
}

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────
let bot           = null;
let running       = false;
let startedAt     = null;
let conversations = {};
let stats         = { day:0,month:0,msgs:0,input:0,output:0,lastReset:today() };

function today() { return new Date().toISOString().slice(0,10); }
function checkDailyReset() {
  if(stats.lastReset!==today()){ stats.day=0; stats.lastReset=today(); }
}

// ─────────────────────────────────────────
//  STOCK TEXT
// ─────────────────────────────────────────
function buildStockText() {
  if(!stock.length) return 'Aucun article en stock.';
  return stock.map(s=>{
    const st=s.qty===0?'❌ RUPTURE':s.qty<=(s.alert||5)?'⚠ BAS':'✓ OK';
    return `- ${s.name}: ${s.qty} · ${s.price}€ · ${st}`;
  }).join('\n');
}

function buildSystemPrompt(userName, userId) {
  const sp=cfg.systemPrompt||'Tu es un assistant commercial. Réponds en français.';
  const now=new Date();
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
  if(!conversations[userId]) conversations[userId]=[];
  conversations[userId].push({role:'user',content:userMessage});
  const msgs=conversations[userId].slice(-(cfg.contextWindow*2));
  const t0=Date.now();
  const res=await fetch('https://api.anthropic.com/v1/messages',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':cfg.claudeKey,'anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:cfg.claudeModel,max_tokens:cfg.maxTokens,system:buildSystemPrompt(userName,userId),messages:msgs}),
  });
  if(!res.ok){const e=await res.json().catch(()=>{});throw new Error(e?.error?.message||`HTTP ${res.status}`);}
  const data=await res.json();
  const elapsed=((Date.now()-t0)/1000).toFixed(2);
  if(!data.content) throw new Error('Réponse invalide');
  const reply=data.content.map(c=>c.text||'').join('').trim();
  const tokIn=data.usage?.input_tokens||0,tokOut=data.usage?.output_tokens||0,total=tokIn+tokOut;
  conversations[userId].push({role:'assistant',content:reply});
  stats.day+=total;stats.month+=total;stats.msgs+=1;stats.input+=tokIn;stats.output+=tokOut;
  history.unshift({time:new Date().toLocaleTimeString('fr-FR'),userId:String(userId),userName:userName||'?',
    msg:userMessage.slice(0,60),reply:reply.slice(0,100),tokIn,tokOut,total,duration:elapsed+'s'});
  if(history.length>100) history.pop();
  addLog('ok',`@${userName} | ${total} tok | ${elapsed}s`);
  return reply;
}

// ─────────────────────────────────────────
//  BOT ADMIN
// ─────────────────────────────────────────
let adminBot = null;

function startAdminBot() {
  const token = process.env.ADMIN_BOT_TOKEN;
  if(!token){ addLog('warn','ADMIN_BOT_TOKEN non configuré'); return; }
  try {
    adminBot = new TelegramBot(token, {polling:true});
    adminBot.getMe().then(me=>addLog('ok','Administrateur du bot démarré ✓ @'+me.username)).catch(()=>addLog('ok','Bot admin démarré ✓'));

    adminBot.on('message', async(msg)=>{
      if(msg.text?.startsWith('/start')) {
        cfg.adminTelegramId = String(msg.from.id);
        await saveConfig();
        adminBot.sendMessage(msg.chat.id,
          `✅ *Bot admin configuré !*\n\nVotre ID : \`${msg.from.id}\`\n\nVous recevrez maintenant toutes les demandes de retrait ici.`,
          {parse_mode:'Markdown'}
        );
        addLog('ok','Admin Telegram ID configuré: '+msg.from.id);
      }
    });

    adminBot.on('polling_error', err=>addLog('err','AdminBot polling: '+(err.message||String(err))));

    // Bouton de confirmation de paiement retrait
    adminBot.on('callback_query', async(query)=>{
      const data = query.data;
      if(!data?.startsWith('confirm_wd_')) return;

      const parts    = data.split('_');
      const sellerId = parts[2];
      const wdId     = parseInt(parts[3]);
      const amount   = parseFloat(parts[4]);

      try {
        const sellers = await getSellers();
        const v = sellers.find(x=>String(x.id)===String(sellerId));
        if(!v) { adminBot.answerCallbackQuery(query.id,{text:'Vendeur introuvable'}); return; }

        const wd = (v.withdrawals||[]).find(w=>w.id===wdId);
        if(wd) wd.status='paid';

        v.balance = parseFloat((parseFloat(v.balance||0) - amount).toFixed(2));
        if(v.balance < 0) v.balance = 0;
        await saveSeller(v);

        if(v.telegramId && vendorBot) {
          vendorBot.sendMessage(v.telegramId,
            `✅ *Virement effectué !*\n\nMontant : *${amount.toFixed(2)}€*\n\nVotre paiement a bien été envoyé. Merci ! 🙏`,
            {parse_mode:'Markdown'}
          ).catch(()=>{});
        }

        adminBot.editMessageReplyMarkup(
          {inline_keyboard:[[{text:`✅ Payé — ${amount.toFixed(2)}€ à ${v.name}`, callback_data:'done'}]]},
          {chat_id:query.message.chat.id, message_id:query.message.message_id}
        ).catch(()=>{});

        adminBot.answerCallbackQuery(query.id,{text:'✅ Paiement confirmé ! Vendeur notifié.'});
        addLog('ok',`Retrait confirmé: ${v.name} · ${amount.toFixed(2)}€`);
      } catch(e) {
        adminBot.answerCallbackQuery(query.id,{text:'Erreur: '+e.message});
        addLog('err','Confirmation retrait: '+e.message);
      }
    });
  } catch(e) {
    addLog('err','AdminBot démarrage: '+e.message);
  }
}

// ─────────────────────────────────────────
//  BOT CLIENT
// ─────────────────────────────────────────
function startBot() {
  if(running)            return {ok:false,reason:'Déjà démarré'};
  if(!cfg.telegramToken) return {ok:false,reason:'Token manquant'};
  if(!cfg.claudeKey)     return {ok:false,reason:'Clé Claude manquante'};
  try {
    bot=new TelegramBot(cfg.telegramToken,{polling:true});
    running=true;startedAt=new Date().toISOString();
    addLog('ok',`Bot client démarré · ${cfg.claudeModel}`);

    bot.on('message',async(msg)=>{
      const userId=msg.from.id,userName=msg.from.username||msg.from.first_name||String(userId),text=msg.text;
      if(!text) return;
      if(text.startsWith('/start')||text.startsWith('/shop')){
        const shopUrl=`https://agentos-server-production-a5b4.up.railway.app/shop-app`;
        bot.sendMessage(msg.chat.id,
          `👋 Bienvenue ${msg.from.first_name||''} sur le Marketplace !\n\n🛍 Découvrez nos produits.`,
          {reply_markup:{inline_keyboard:[[{text:'🛍 Ouvrir le Marketplace',web_app:{url:shopUrl}}]]}}
        );
        addLog('info',`@${userName} → marketplace`);
        return;
      }
      addLog('info',`@${userName}: ${text.slice(0,60)}`);
      try {
        await bot.sendChatAction(msg.chat.id,'typing');
        const reply=await callClaude(userId,userName,text);
        await bot.sendMessage(msg.chat.id,reply,{parse_mode:'Markdown',disable_web_page_preview:true});
      }catch(e){
        addLog('err',`@${userName}: ${e.message}`);
        bot.sendMessage(msg.chat.id,'⚠️ Une erreur est survenue.');
      }
    });
    bot.on('polling_error',err=>addLog('err','Polling: '+(err.message||String(err))));
    bot.on('error',        err=>addLog('err','Bot: '+(err.message||String(err))));
    return {ok:true};
  }catch(e){running=false;addLog('err','Démarrage: '+e.message);return {ok:false,reason:e.message};}
}

// ─────────────────────────────────────────
//  BOT VENDEUR
// ─────────────────────────────────────────
let vendorBot = null;
let vendorBotUsername = '';

function startVendorBot() {
  const token = process.env.VENDOR_BOT_TOKEN;
  if(!token){ addLog('warn','VENDOR_BOT_TOKEN non configuré'); return; }
  try {
    vendorBot = new TelegramBot(token, {polling:true});
    vendorBot.getMe().then(me => {
      vendorBotUsername = me.username || '';
      addLog('ok','Bot vendeur démarré ✓ @'+vendorBotUsername);
    }).catch(()=>{ addLog('ok','Bot vendeur démarré ✓'); });

    vendorBot.on('message', async(msg)=>{
      const userId = msg.from.id;
      const text   = msg.text||'';
      if(!text) return;

      const sellers = await getSellers();
      const seller  = sellers.find(v=>String(v.telegramId)===String(userId));

      if(text.startsWith('/start')) {
        if(!seller) {
          vendorBot.sendMessage(userId,
            `👋 Bonjour !\n\nCe bot est réservé aux vendeurs du marketplace.\nContactez l'administrateur pour obtenir votre accès.`
          );
          return;
        }
        const appUrl = `https://agentos-server-production-a5b4.up.railway.app/seller-dashboard`;
        vendorBot.sendMessage(userId,
          `👋 Bonjour *${seller.shopName||seller.name}* !\n\n`
          + `🛍 Accédez à votre espace vendeur directement ici :\n\n`
          + `📦 /commandes — Vos dernières ventes\n`
          + `💰 /solde — Votre solde\n`
          + `📊 /stock — État du stock\n`
          + `💸 /retrait — Demander un virement`,
          {
            parse_mode:'Markdown',
            reply_markup:{
              inline_keyboard:[[{
                text: '🛍 Ouvrir mon dashboard',
                web_app: { url: appUrl }
              }]]
            }
          }
        );
        return;
      }

      if(!seller){
        vendorBot.sendMessage(userId,'⚠️ Accès non autorisé. Contactez l\'administrateur.');
        return;
      }

      if(text.startsWith('/commandes')) {
        const orders = await getOrders();
        const myOrders = orders.filter(o=>
          o.cartItems?.some(ci=>String(ci.sellerId)===String(seller.id))
        ).slice(0,10);

        if(!myOrders.length){
          vendorBot.sendMessage(userId,'📦 Aucune commande pour le moment.');
          return;
        }
        let msg2 = `📦 *Vos 10 dernières ventes :*\n\n`;
        myOrders.forEach((o,i)=>{
          const myItems = o.cartItems.filter(ci=>String(ci.sellerId)===String(seller.id));
          const total   = myItems.reduce((s,ci)=>s+parseFloat(ci.price||0)*parseInt(ci.qty||1),0);
          const com     = myItems.reduce((s,ci)=>s+cfg.commissionFlat*parseInt(ci.qty||1),0);
          const net     = total-com;
          const c       = o.client||{};
          msg2 += `*${i+1}. ${o.date}*\n`
            + myItems.map(ci=>`  📦 ${ci.qty}x article #${ci.id}`).join('\n')+'\n'
            + `  💰 Net: *${net.toFixed(2)}€*\n`
            + `  👤 ${c.name||'—'} · ${c.city||'—'}\n\n`;
        });
        vendorBot.sendMessage(userId, msg2, {parse_mode:'Markdown'});
        return;
      }

      if(text.startsWith('/solde')) {
        vendorBot.sendMessage(userId,
          `💰 *Votre solde*\n\n`
          + `Disponible : *${parseFloat(seller.balance||0).toFixed(2)}€*\n`
          + `Ventes totales : ${parseFloat(seller.totalSales||0).toFixed(2)}€\n`
          + `Commission versée : ${parseFloat(seller.totalCommission||0).toFixed(2)}€\n\n`
          + `Pour demander un virement : /retrait`,
          {parse_mode:'Markdown'}
        );
        return;
      }

      if(text.startsWith('/stock')) {
        const sellerStock = seller.stock||[];
        if(!sellerStock.length){
          vendorBot.sendMessage(userId,'📦 Votre stock est vide.');
          return;
        }
        let msg3 = `📊 *État de votre stock :*\n\n`;
        sellerStock.forEach(s=>{
          const status = s.qty===0?'❌ RUPTURE':s.qty<=(s.alert||5)?'⚠️ BAS':'✅ OK';
          msg3 += `${status} *${s.name}* — ${s.qty} unité(s)\n`;
        });
        vendorBot.sendMessage(userId, msg3, {parse_mode:'Markdown'});
        return;
      }

      if(text.startsWith('/retrait')) {
        const solde = parseFloat(seller.balance||0);
        if(solde<=0){
          vendorBot.sendMessage(userId,'💰 Votre solde est de 0€ — aucun retrait possible.');
          return;
        }
        vendorBot.sendMessage(userId,
          `💸 *Demande de virement*\n\nVotre solde disponible : *${solde.toFixed(2)}€*\n\nEnvoyez votre demande au format :\n\n\`/virement [montant] [Nom Prénom] [IBAN ou PayPal]\`\n\nExemple :\n\`/virement 50 Jean Dupont FR76 1234...\`\nou\n\`/virement 50 Jean Dupont paypal@email.com\``,
          {parse_mode:'Markdown'}
        );
        return;
      }

      if(text.startsWith('/virement')) {
        const parts  = text.split(' ');
        const amount = parseFloat(parts[1]);
        const solde  = parseFloat(seller.balance||0);

        if(!amount||amount<=0)    { vendorBot.sendMessage(userId,'⚠️ Montant invalide.'); return; }
        if(amount < 30)           { vendorBot.sendMessage(userId,'⚠️ Montant minimum : *30€*.',{parse_mode:'Markdown'}); return; }
        if(amount > solde)        { vendorBot.sendMessage(userId,`⚠️ Solde insuffisant (${solde.toFixed(2)}€ disponible).`); return; }
        if(parts.length < 4)      { vendorBot.sendMessage(userId,'⚠️ Format invalide. Exemple :\n`/virement 50 Jean Dupont FR76...`',{parse_mode:'Markdown'}); return; }

        const name   = parts[2]+' '+parts[3];
        const coords = parts.slice(4).join(' ');
        if(!coords) { vendorBot.sendMessage(userId,'⚠️ IBAN ou PayPal manquant.'); return; }

        const wdId = Date.now();

        if(adminBot && cfg.adminTelegramId) {
          adminBot.sendMessage(cfg.adminTelegramId,
            `💸 *Nouvelle demande de virement*\n\n`
            + `👤 Vendeur : *${seller.shopName||seller.name}*\n`
            + `💰 Montant : *${amount.toFixed(2)}€*\n`
            + `🧾 Bénéficiaire : ${name}\n`
            + `💳 ${coords}`,
            {
              parse_mode:'Markdown',
              reply_markup:{
                inline_keyboard:[[
                  {text:'✅ Confirmer le paiement', callback_data:`confirm_wd_${seller.id}_${wdId}_${amount}`}
                ]]
              }
            }
          ).catch(e=>addLog('warn','AdminBot notif: '+e.message));
        }

        vendorBot.sendMessage(userId,
          `✅ *Demande envoyée !*\n\nMontant : *${amount.toFixed(2)}€*\nBénéficiaire : ${name}\n${coords}\n\nVotre virement sera traité sous 24-48h.`,
          {parse_mode:'Markdown'}
        );

        if(!seller.withdrawals) seller.withdrawals=[];
        seller.withdrawals.unshift({id:wdId,amount:amount.toFixed(2),name,coords,date:new Date().toLocaleString('fr-FR'),status:'pending'});
        await saveSeller(seller);
        addLog('ok',`Retrait demandé: ${seller.name} · ${amount.toFixed(2)}€`);
        return;
      }

      if(text.startsWith('/fonctions')||text.startsWith('/aide')||text.startsWith('/help')) {
        vendorBot.sendMessage(userId,
          `📋 *Toutes les commandes disponibles*\n\n`
          + `📦 /commandes — Vos 10 dernières ventes\n`
          + `💰 /solde — Votre solde disponible\n`
          + `📊 /stock — État de votre stock\n`
          + `💸 /retrait — Instructions pour demander un virement\n`
          + `🔑 /virement [montant] [Nom Prénom] [IBAN/PayPal] — Envoyer une demande de virement\n\n`
          + `_Minimum de retrait : 30€_\n\n`
          + `🛍 Ou utilisez le bouton ci-dessous pour accéder à votre dashboard complet :`,
          {
            parse_mode:'Markdown',
            reply_markup:{
              inline_keyboard:[[{
                text:'🛍 Ouvrir mon dashboard',
                web_app:{url:`https://agentos-server-production-a5b4.up.railway.app/seller-dashboard`}
              }]]
            }
          }
        );
        return;
      }

      vendorBot.sendMessage(userId,
        `Commandes disponibles :\n\n`
        + `📦 /commandes\n💰 /solde\n📊 /stock\n💸 /retrait`
      );
    });

    vendorBot.on('polling_error', err=>addLog('err','VendorBot: '+(err.message||String(err))));
    vendorBot.on('error',         err=>addLog('err','VendorBot: '+(err.message||String(err))));
  } catch(e) {
    addLog('err','VendorBot démarrage: '+e.message);
  }
}

function stopBot(){
  if(bot){try{bot.stopPolling();}catch(e){}bot=null;}
  running=false;startedAt=null;addLog('warn','Bot arrêté');
}

// ─────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────
function auth(req,res,next){
  if(req.headers['x-secret']!==cfg.secret) return res.status(401).json({error:'Non autorisé'});
  next();
}

async function sellerAuth(req,res,next){
  const s=req.headers['x-secret'];
  const sellers=await getSellers();
  const seller=sellers.find(v=>v.secret===s&&v.active);
  if(!seller) return res.status(401).json({error:'Vendeur non autorisé'});
  req.seller=seller;
  next();
}

// ─────────────────────────────────────────
//  ROUTES ADMIN — SYSTÈME
// ─────────────────────────────────────────
app.get('/health',(req,res)=>res.json({ok:true,uptime:Math.floor(process.uptime()),running}));
app.get('/status',auth,(req,res)=>res.json({running,startedAt,model:cfg.claudeModel,msgs:stats.msgs,tokDay:stats.day,uptime:Math.floor(process.uptime()),users:Object.keys(conversations).length}));
app.post('/start',auth,(req,res)=>{if(req.body.telegramToken)cfg.telegramToken=req.body.telegramToken;if(req.body.claudeKey)cfg.claudeKey=req.body.claudeKey;saveConfig();res.json(startBot());});
app.post('/stop', auth,(req,res)=>{stopBot();res.json({ok:true});});
app.get('/config',auth,(req,res)=>{const{telegramToken,claudeKey,secret,...safe}=cfg;res.json(safe);});
app.post('/config',auth,async(req,res)=>{
  ['claudeModel','systemPrompt','maxTokens','temperature','contextWindow','stockInject','stockAlerts','commissionMode','commissionFlat','commissionRate']
    .forEach(k=>{if(req.body[k]!==undefined) cfg[k]=req.body[k];});
  if(req.body.telegramToken) cfg.telegramToken=req.body.telegramToken;
  if(req.body.claudeKey)     cfg.claudeKey=req.body.claudeKey;
  await saveConfig();addLog('info','Config mise à jour');res.json({ok:true});
});
app.get('/logs', auth,(req,res)=>res.json(logs.slice(0,Math.min(parseInt(req.query.limit)||100,MAX_LOGS))));
app.get('/stats',auth,(req,res)=>{checkDailyReset();res.json({...stats,history:history.slice(0,30)});});
app.get('/conversations',auth,(req,res)=>res.json(history.slice(0,50)));
app.delete('/conversation/:uid',auth,(req,res)=>{delete conversations[req.params.uid];res.json({ok:true});});
app.delete('/conversations',auth,(req,res)=>{const c=Object.keys(conversations).length;conversations={};res.json({ok:true,cleared:c});});
app.post('/stats/reset',auth,(req,res)=>{stats={day:0,month:0,msgs:0,input:0,output:0,lastReset:today()};history=[];res.json({ok:true});});

// ─────────────────────────────────────────
//  ROUTES ADMIN — STOCK
// ─────────────────────────────────────────
app.get('/stock', auth,(req,res)=>res.json(stock));
app.post('/stock',auth,async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  stock=req.body;await saveConfig();
  addLog('ok',`Stock admin · ${stock.length} articles`);res.json({ok:true,count:stock.length});
});
app.get('/shop', auth,(req,res)=>res.json(shopItems));
app.post('/shop',auth,async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  shopItems=req.body;await saveConfig();
  addLog('ok',`Shop admin · ${shopItems.length} articles`);res.json({ok:true,count:shopItems.length});
});

// ─────────────────────────────────────────
//  ROUTES ADMIN — COMMANDES
// ─────────────────────────────────────────

// Lister toutes les commandes (avec filtre optionnel)
app.get('/orders', auth, async(req,res)=>{
  try {
    let orders = await getOrders();
    // Filtrer les archivées si demandé
    if(req.query.archived === 'false') orders = orders.filter(o=>!o.archived);
    if(req.query.archived === 'true')  orders = orders.filter(o=> o.archived);
    res.json(orders);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Voir une commande
app.get('/orders/:id', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});
    res.json(order);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Modifier une commande (note, statut, archivage...)
app.patch('/orders/:id', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});

    if(req.body.adminNote  !== undefined) order.adminNote  = req.body.adminNote;
    if(req.body.archived   !== undefined) order.archived   = req.body.archived;
    if(req.body.status     !== undefined) order.status     = req.body.status;
    if(req.body.shipped    !== undefined) order.shipped    = req.body.shipped;

    await saveOrder(order);
    addLog('ok', `Commande #${order.id} modifiée`);
    res.json({ok:true, order});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Supprimer une commande
app.delete('/orders/:id', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});
    await deleteOrder(req.params.id);
    addLog('warn', `Commande supprimée: #${req.params.id}`);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Supprimer plusieurs commandes (bulk)
app.delete('/orders', auth, async(req,res)=>{
  const ids = req.body?.ids;
  if(!Array.isArray(ids)||!ids.length) return res.status(400).json({error:'IDs manquants'});
  try {
    let deleted = 0;
    for(const id of ids){
      try { await deleteOrder(id); deleted++; } catch(e){}
    }
    addLog('warn', `Suppression bulk: ${deleted}/${ids.length} commandes`);
    res.json({ok:true, deleted});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Archiver une commande (soft delete — reste en DB mais masquée)
app.post('/orders/:id/archive', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});
    order.archived = true;
    await saveOrder(order);
    addLog('info', `Commande archivée: #${req.params.id}`);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Désarchiver
app.post('/orders/:id/unarchive', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});
    order.archived = false;
    await saveOrder(order);
    addLog('info', `Commande désarchivée: #${req.params.id}`);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Marquer une commande expédiée (côté admin — sans vérification vendeur)
app.post('/orders/:id/ship', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});

    if(!order.shipped) order.shipped = {};
    // Marquer tous les vendeurs de cette commande comme expédié
    const sellerIds = [...new Set((order.cartItems||[]).map(ci=>String(ci.sellerId)).filter(Boolean))];
    sellerIds.forEach(sid => order.shipped[sid] = 'shipped');

    await saveOrder(order);
    addLog('ok', `Commande #${order.id} marquée expédiée (admin)`);

    // Notifier le client
    if(order.userId && bot) {
      const names = (order.cartItems||[]).map(ci=>`${ci.qty||1}x Article #${ci.id}`).join(', ');
      bot.sendMessage(order.userId,
        `📦 *Votre commande a été expédiée !*\n\n🛍 ${names}\n\nVous recevrez votre colis prochainement. Merci ! 🙏`,
        {parse_mode:'Markdown'}
      ).catch(()=>{});
    }

    res.json({ok:true, order});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// Ajouter/modifier une note admin sur une commande
app.post('/orders/:id/note', auth, async(req,res)=>{
  try {
    const order = await getOrder(req.params.id);
    if(!order) return res.status(404).json({error:'Commande introuvable'});
    order.adminNote = req.body.note||'';
    await saveOrder(order);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ─────────────────────────────────────────
//  ROUTES ADMIN — VENDEURS
// ─────────────────────────────────────────
app.get('/sellers',auth,async(req,res)=>{
  const sellers=await getSellers();
  res.json(sellers.map(s=>({...s,secret:undefined})));
});

app.get('/sellers/:id',auth,async(req,res)=>{
  const v=await getSeller(req.params.id);
  if(!v) return res.status(404).json({error:'Introuvable'});
  res.json(v);
});

app.post('/sellers',auth,async(req,res)=>{
  const{name,shopName,description,telegramId}=req.body;
  if(!name) return res.status(400).json({error:'Nom manquant'});
  const seller={
    id:Date.now(),name,shopName:shopName||name,description:description||'',
    telegramId:telegramId||'',secret:crypto.randomBytes(16).toString('hex'),
    active:true,stock:[],shopItems:[],balance:0,totalSales:0,totalCommission:0,
    remuneration:0,notes:'',createdAt:new Date().toISOString(),
  };
  await saveSeller(seller);
  addLog('ok',`Vendeur créé: ${name}`);

  if(telegramId&&vendorBot){
    try{
      await vendorBot.sendMessage(telegramId,
        `🎉 *Bienvenue sur le Marketplace !*\n\nBonjour ${name}, votre espace vendeur est prêt.\n\n🔑 Votre clé secrète :\n\`${seller.secret}\`\n\n👇 Accédez à votre dashboard :`,
        {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🛍 Ouvrir mon dashboard vendeur',url:`https://agentos-server-production-a5b4.up.railway.app/seller-dashboard`}]]}}
      );
      addLog('ok',`Message de bienvenue envoyé via bot vendeur à ${telegramId}`);
    }catch(e){addLog('warn',`Notif vendeur: ${e.message}`);}
  }
  res.json({ok:true, seller, vendorBotUsername});
});

app.post('/sellers/:id/update',auth,async(req,res)=>{
  const v=await getSeller(req.params.id);
  if(!v) return res.status(404).json({error:'Introuvable'});
  if(req.body.name)                   v.name            = req.body.name;
  if(req.body.shopName)               v.shopName        = req.body.shopName;
  if(req.body.telegramId!==undefined) v.telegramId      = req.body.telegramId;
  if(req.body.balance!==undefined)    v.balance         = parseFloat(req.body.balance)||0;
  if(req.body.remuneration!==undefined) v.remuneration  = parseFloat(req.body.remuneration)||0;
  if(req.body.notes!==undefined)      v.notes           = req.body.notes;
  if(req.body.commissionMode!==undefined) v.commissionMode = req.body.commissionMode;
  if(req.body.commissionFlat!=null&&req.body.commissionFlat!==undefined) v.commissionFlat = parseFloat(req.body.commissionFlat)||0;
  if(req.body.commissionRate!=null&&req.body.commissionRate!==undefined) v.commissionRate = parseFloat(req.body.commissionRate)||0;
  await saveSeller(v);
  addLog('ok',`Vendeur mis à jour: ${v.name}`);
  res.json({ok:true});
});

app.post('/sellers/:id/toggle',auth,async(req,res)=>{
  const v=await getSeller(req.params.id);
  if(!v) return res.status(404).json({error:'Introuvable'});
  v.active=!v.active;await saveSeller(v);
  addLog('info',`Vendeur ${v.name} → ${v.active?'actif':'inactif'}`);
  res.json({ok:true,active:v.active});
});

app.delete('/sellers/:id',auth,async(req,res)=>{
  await deleteSeller(req.params.id);
  addLog('warn',`Vendeur supprimé: ${req.params.id}`);
  res.json({ok:true});
});

app.post('/sellers/:id/add-stock',auth,async(req,res)=>{
  const v=await getSeller(req.params.id);
  if(!v) return res.status(404).json({error:'Vendeur introuvable'});
  const {item}=req.body;
  if(!item||!item.qty) return res.status(400).json({error:'Item invalide'});
  if(!v.stock) v.stock=[];
  const existing=v.stock.find(s=>s.id===item.id);
  if(existing){
    existing.qty+=item.qty;
    existing.name=item.name;existing.cat=item.cat;existing.price=item.price;existing.puffs=item.puffs;
  } else {
    v.stock.push({...item,enVente:false});
  }
  await saveSeller(v);
  addLog('ok',`Transfert → ${v.name} · ${item.qty}x ${item.name}`);
  res.json({ok:true});
});

// ─────────────────────────────────────────
//  ROUTES VENDEUR (auth secret vendeur)
// ─────────────────────────────────────────
app.post('/seller/tg-auth', async(req,res)=>{
  const { telegramId } = req.body;
  if(!telegramId) return res.status(400).json({error:'Telegram ID manquant'});
  const sellers = await getSellers();
  const seller  = sellers.find(v=>String(v.telegramId)===String(telegramId)&&v.active);
  if(!seller) return res.status(401).json({error:'Vendeur non trouvé'});
  res.json({ok:true, seller, secret:seller.secret});
});

app.get('/seller/me',sellerAuth,(req,res)=>{res.json(req.seller);});

app.post('/seller/stock',sellerAuth,async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  req.seller.stock=req.body;await saveSeller(req.seller);
  addLog('ok',`Stock vendeur ${req.seller.name} · ${req.body.length} articles`);
  checkSellerStockAlerts(req.seller);
  res.json({ok:true,count:req.body.length});
});

app.post('/seller/shop',sellerAuth,async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  req.seller.shopItems=req.body;await saveSeller(req.seller);
  addLog('ok',`Catalogue vendeur ${req.seller.name} · ${req.body.length} articles`);
  res.json({ok:true,count:req.body.length});
});

app.get('/seller/orders', sellerAuth, async(req,res)=>{
  const orders = await getOrders();
  const sellerId = String(req.seller.id);
  const myOrders = orders
    .filter(o => !o.archived && o.cartItems?.some(ci=>String(ci.sellerId)===sellerId))
    .map(o => {
      const myItems = o.cartItems.filter(ci=>String(ci.sellerId)===sellerId);
      const myAmount = myItems.reduce((s,ci)=>s+parseFloat(ci.price||0)*parseInt(ci.qty||1),0);
      const myCom = myItems.reduce((s,ci)=>s+(cfg.commissionMode==='flat'?cfg.commissionFlat*parseInt(ci.qty||1):parseFloat(ci.price||0)*parseInt(ci.qty||1)*cfg.commissionRate),0);
      const myNet = myAmount - myCom;
      const itemsWithNames = myItems.map(ci=>{
        const s = (req.seller.stock||[]).find(x=>x.id===ci.id);
        return { id:ci.id, name:s?s.name:`Article #${ci.id}`, qty:ci.qty||1 };
      });
      return {
        id        : o.id,
        date      : o.date,
        amount    : myAmount.toFixed(2),
        net       : myNet.toFixed(2),
        commission: myCom.toFixed(2),
        items     : itemsWithNames,
        client    : o.client || {},
        status    : o.shipped?.[sellerId] || 'pending',
      };
    });
  res.json(myOrders);
});

app.post('/seller/orders/:id/ship', sellerAuth, async(req,res)=>{
  const sellerId = String(req.seller.id);
  const orders   = await getOrders();
  const order    = orders.find(o=>String(o.id)===req.params.id);
  if(!order) return res.status(404).json({error:'Commande introuvable'});

  if(!order.shipped) order.shipped = {};
  order.shipped[sellerId] = 'shipped';
  await saveOrder(order);
  addLog('ok',`Expédition · commande ${order.id} · vendeur ${req.seller.name}`);

  if(order.userId && bot) {
    const itemNames = (order.cartItems||[])
      .filter(ci=>String(ci.sellerId)===sellerId)
      .map(ci=>{ const s=(req.seller.stock||[]).find(x=>x.id===ci.id); return (ci.qty||1)+'x '+(s?s.name:'Article'); })
      .join(', ');
    try {
      await bot.sendMessage(order.userId,
        `📦 *Votre commande a été expédiée !*\n\n`
        + `🛍 ${itemNames}\n`
        + `🏪 Par : ${req.seller.shopName||req.seller.name}\n\n`
        + `Vous recevrez votre colis prochainement. Merci pour votre achat ! 🙏`,
        {parse_mode:'Markdown'}
      );
    } catch(e){ addLog('warn','Notif expédition: '+e.message); }
  }
  res.json({ok:true});
});

app.post('/seller/promos', sellerAuth, async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  req.seller.promos = req.body;
  await saveSeller(req.seller);
  res.json({ok:true, count:req.body.length});
});

app.post('/promo/check', async(req,res)=>{
  const { code, sellerId, cat, amount } = req.body;
  if(!code) return res.status(400).json({error:'Code manquant'});
  const userId = req.body.userId || 'guest';

  let found = null;
  let foundSellerId = null;

  const adminPromos = cfg.promos || [];
  const ap = adminPromos.find(p=>p.code===code.toUpperCase()&&p.active);
  if(ap) { found = ap; foundSellerId = 'admin'; }

  if(!found) {
    const sellers = await getSellers();
    for(const v of sellers) {
      const vp = (v.promos||[]).find(p=>p.code===code.toUpperCase()&&p.active);
      if(vp) { found = vp; foundSellerId = String(v.id); break; }
    }
  }

  if(!found) return res.status(404).json({error:'Code invalide ou expiré'});
  if(found.expiry && new Date(found.expiry) < new Date()) return res.status(400).json({error:'Code expiré'});
  if(found.limitType==='total' && found.usedCount >= found.limitVal) return res.status(400).json({error:'Code épuisé'});
  if(found.limitType==='per_user' && (found.usedBy||[]).includes(userId)) return res.status(400).json({error:'Déjà utilisé'});
  if(found.scope==='seller' && sellerId && foundSellerId!=='admin' && String(foundSellerId)!==String(sellerId)) return res.status(400).json({error:'Code non valide pour ce vendeur'});
  if(found.scope==='category' && cat && found.cat && found.cat.toLowerCase()!==cat.toLowerCase()) return res.status(400).json({error:'Code non valide pour cette catégorie'});

  const discount = found.type==='percent'
    ? parseFloat(amount) * found.value / 100
    : found.value;

  res.json({ ok:true, code:found.code, type:found.type, value:found.value, discount:discount.toFixed(2) });
});

app.post('/seller/withdrawal', sellerAuth, async(req,res)=>{
  const { amount, coords, name, mode } = req.body;
  const v = req.seller;
  if(!amount || amount <= 0)  return res.status(400).json({error:'Montant invalide'});
  if(amount > (v.balance||0)) return res.status(400).json({error:'Solde insuffisant'});
  if(!coords)                 return res.status(400).json({error:'Coordonnées requises'});

  const wd = {
    id    : Date.now(),
    amount: parseFloat(amount).toFixed(2),
    name  : name||'',
    coords,
    mode  : mode||'iban',
    date  : new Date().toLocaleString('fr-FR'),
    status: 'pending',
  };

  if(!v.withdrawals) v.withdrawals = [];
  v.withdrawals.unshift(wd);
  await saveSeller(v);
  addLog('ok', `Retrait demandé · ${v.name} · ${amount}€`);

  if(adminBot && cfg.adminTelegramId) {
    adminBot.sendMessage(cfg.adminTelegramId,
      `💸 *Nouvelle demande de retrait*\n\n`
      + `👤 Vendeur : *${v.shopName||v.name}*\n`
      + `💰 Montant : *${parseFloat(amount).toFixed(2)}€*\n`
      + `🧾 Bénéficiaire : ${wd.name||'—'}\n`
      + `💳 ${coords}`,
      {parse_mode:'Markdown'}
    ).catch(e=>addLog('warn','AdminBot notif: '+e.message));
  } else if(bot && cfg.adminTelegramId) {
    bot.sendMessage(cfg.adminTelegramId,
      `💸 *Demande de retrait*\n\nVendeur : *${v.shopName||v.name}*\nMontant : *${parseFloat(amount).toFixed(2)}€*\nBénéficiaire : ${wd.name||'—'}\n${coords}`,
      {parse_mode:'Markdown'}
    ).catch(()=>{});
  }
  if(v.telegramId && vendorBot) {
    vendorBot.sendMessage(v.telegramId,
      `💸 *Demande de retrait envoyée !*\n\nMontant : *${parseFloat(amount).toFixed(2)}€*\nBénéficiaire : ${wd.name||'—'}\n${coords}\n\nL'administrateur traitera votre demande sous 24-48h.`,
      {parse_mode:'Markdown'}
    ).catch(()=>{});
  }

  res.json({ok:true, seller:{...v, secret:undefined}});
});

app.post('/seller/alert-settings', sellerAuth, async(req,res)=>{
  req.seller.alertSettings = req.body;
  await saveSeller(req.seller);
  res.json({ok:true});
});

app.post('/seller/stock-alert-test', sellerAuth, async(req,res)=>{
  const v = req.seller;
  if(!v.telegramId || !vendorBot)
    return res.status(400).json({error:'Bot vendeur ou Telegram ID non configuré'});
  try {
    await vendorBot.sendMessage(v.telegramId,
      `🔔 *Test d'alerte stock bas*\n\nVos alertes Telegram sont bien configurées ✓\n\nVous recevrez ce type de message quand un goût passe sous son seuil.`,
      {parse_mode:'Markdown'}
    );
    res.json({ok:true});
  } catch(e) {
    res.status(400).json({error: e.message});
  }
});

async function checkSellerStockAlerts(seller) {
  if(!seller.telegramId || !vendorBot) return;
  const settings  = seller.alertSettings || {};
  if(settings.alertsEnabled === false) return;
  const threshold = settings.globalThreshold || 5;
  const lowItems  = (seller.stock||[]).filter(s => {
    if(s.qty <= 0) return false;
    const itemThreshold = settings.perItem?.[s.id] || s.alert || threshold;
    return s.qty <= itemThreshold;
  });
  if(!lowItems.length) return;
  const msg = `⚠️ *Alerte stock bas !*\n\n`
    + lowItems.map(s=>`📦 *${s.name}* : ${s.qty} unité(s) restante(s)`).join('\n')
    + `\n\nPensez à réapprovisionner.`;
  vendorBot.sendMessage(seller.telegramId, msg, {parse_mode:'Markdown'}).catch(()=>{});
}

// ─────────────────────────────────────────
//  ROUTES PUBLIQUES — MARKETPLACE
// ─────────────────────────────────────────
app.get('/marketplace',async(req,res)=>{
  const sellers=await getSellers();
  const result=[];
  const adminItems=shopItems.map(item=>{
    const s=stock.find(x=>x.id===item.stockId);
    if(!s||s.qty<=0) return null;
    return{id:item.stockId,sellerId:'admin',sellerName:'Boutique Officielle',sellerShop:'Boutique Officielle',
      title:item.title,image:item.image||s.image||'',description:item.description||'',price:parseFloat(item.price||0),
      qty:s.qty,puffs:s.puffs||0,cat:s.cat||'',alert:s.alert||5,payload:item.payload,
      carton:s.carton||false,cartonQty:s.cartonQty||0,cartonPrice:s.cartonPrice||0};
  }).filter(Boolean);
  if(adminItems.length) result.push({sellerId:'admin',sellerName:'Boutique Officielle',items:adminItems});

  sellers.filter(v=>v.active).forEach(v=>{
    const items=(v.shopItems||[]).map(item=>{
      const s=(v.stock||[]).find(x=>x.id===item.stockId);
      if(!s||s.qty<=0) return null;
      return{id:item.stockId,sellerId:v.id,sellerName:v.name,sellerShop:v.shopName||v.name,
        title:item.title,image:item.image||s.image||'',description:item.description||'',price:parseFloat(item.price||0),
        qty:s.qty,puffs:s.puffs||0,cat:s.cat||'',alert:s.alert||5,payload:item.payload,
        carton:s.carton||false,cartonQty:s.cartonQty||0,cartonPrice:s.cartonPrice||0};
    }).filter(Boolean);
    if(items.length) result.push({sellerId:v.id,sellerName:v.name,sellerShop:v.shopName||v.name,items});
  });
  res.json(result);
});

app.get('/stock-public',async(req,res)=>{
  const sellers=await getSellers();
  const all=[];
  stock.filter(s=>s.enVente&&s.qty>0).forEach(s=>all.push({id:s.id,name:s.name,cat:s.cat,price:s.price,qty:s.qty,puffs:s.puffs||0,sellerId:'admin'}));
  sellers.filter(v=>v.active).forEach(v=>(v.stock||[]).filter(s=>s.enVente&&s.qty>0).forEach(s=>all.push({id:s.id,name:s.name,cat:s.cat,price:s.price,qty:s.qty,puffs:s.puffs||0,sellerId:v.id,sellerName:v.name})));
  res.json(all);
});

// ─────────────────────────────────────────
//  CHECKOUT STRIPE
// ─────────────────────────────────────────
app.post('/shop-checkout',async(req,res)=>{
  const{cart,userId,userName}=req.body;
  if(!cart||!cart.length) return res.status(400).json({error:'Panier vide'});
  if(!cfg.stripeKey)       return res.status(400).json({error:'Stripe non configuré'});
  try{
    const serverUrl=`https://agentos-server-production-a5b4.up.railway.app`;
    const params=new URLSearchParams();
    params.append('payment_method_types[]','card');
    params.append('mode','payment');
    params.append('success_url',`${serverUrl}/payment-success?session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url', `${serverUrl}/payment-cancel`);
    params.append('shipping_address_collection[allowed_countries][]','FR');
    params.append('shipping_address_collection[allowed_countries][]','BE');
    params.append('shipping_address_collection[allowed_countries][]','CH');
    params.append('shipping_address_collection[allowed_countries][]','LU');
    params.append('phone_number_collection[enabled]','true');
    params.append('billing_address_collection','required');
    params.append('metadata[userId]',userId||'');
    params.append('metadata[userName]',userName||'');
    params.append('metadata[cartJson]',JSON.stringify(cart.map(i=>({sellerId:i.sellerId,id:i.id,price:i.price,qty:i.qty}))));
    cart.forEach((item,idx)=>{
      const cents=Math.round(parseFloat(item.price)*100);
      params.append(`line_items[${idx}][price_data][currency]`,'eur');
      params.append(`line_items[${idx}][price_data][product_data][name]`,item.title);
      params.append(`line_items[${idx}][price_data][product_data][description]`,item.description||'');
      params.append(`line_items[${idx}][price_data][unit_amount]`,cents);
      params.append(`line_items[${idx}][quantity]`,'1');
    });
    const sr=await fetch('https://api.stripe.com/v1/checkout/sessions',{
      method:'POST',headers:{'Authorization':`Bearer ${cfg.stripeKey}`,'Content-Type':'application/x-www-form-urlencoded'},body:params,
    });
    const session=await sr.json();
    if(session.error) throw new Error(session.error.message);
    addLog('info',`Checkout · @${userName} · ${cart.length} article(s)`);
    res.json({url:session.url});
  }catch(e){addLog('err','Checkout: '+e.message);res.status(500).json({error:e.message});}
});

// ─────────────────────────────────────────
//  STRIPE WEBHOOK
// ─────────────────────────────────────────
app.post('/stripe-webhook',async(req,res)=>{
  const event=req.body;
  if(!event||!event.type) return res.sendStatus(400);
  addLog('info',`Stripe webhook · ${event.type}`);

  if(event.type==='checkout.session.completed'){
    const sessionId = event.data.object.id;
    const meta      = event.data.object.metadata||{};
    const userId    = meta.userId||'';
    const userName  = meta.userName||'';
    const amount    = (event.data.object.amount_total/100).toFixed(2);

    // Refetch la session complète avec expand pour avoir TOUTES les infos client
    let shipping = event.data.object.shipping_details || {};
    let customer = event.data.object.customer_details || {};
    let productNames = [];
    try {
      const fullRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${sessionId}`+
        `?expand[]=shipping_details&expand[]=customer_details&expand[]=line_items`,
        { headers:{'Authorization':`Bearer ${cfg.stripeKey}`} }
      );
      const full = await fullRes.json();
      if(full.shipping_details) shipping = full.shipping_details;
      if(full.customer_details) customer = full.customer_details;
      // Noms produits depuis line_items expand
      if(full.line_items?.data?.length){
        productNames = full.line_items.data.map(x=>x.description||x.price?.product?.name||'');
      }
    } catch(e) { addLog('warn','Session fetch: '+e.message); }

    // Fallback noms produits si expand n'a pas marché
    if(!productNames.length){
      try{
        const li=await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}/line_items`,{headers:{'Authorization':`Bearer ${cfg.stripeKey}`}});
        const ld=await li.json();
        if(ld.data?.length) productNames=ld.data.map(x=>x.description||x.price?.product?.name||'');
      }catch(e){}
    }

    // Construire l'adresse — shipping_details prioritaire sur customer_details
    const shippingAddr = shipping.address || {};
    const customerAddr = customer.address || {};
    const addr       = shippingAddr.line1 ? shippingAddr : customerAddr;
    // Le nom : customer_details.name est toujours rempli avec billing requis
    // shipping_details.name l'est aussi mais peut être absent si pas de shipping séparé
    const clientName = customer.name || shipping.name || '';

    let cartItems=[];
    try{cartItems=JSON.parse(meta.cartJson||'[]');}catch(e){}
    const nbItems=cartItems.reduce((s,i)=>s+parseInt(i.qty||1),0);
    const commission=cfg.commissionMode==='flat'
      ?(cfg.commissionFlat*nbItems).toFixed(2)
      :(parseFloat(amount)*cfg.commissionRate).toFixed(2);
    const sellerAmount=(parseFloat(amount)-parseFloat(commission)).toFixed(2);

    const order={
      id:Date.now(),date:new Date().toLocaleString('fr-FR'),userId,userName,amount,commission,sellerAmount,
      stockName:productNames.join(', ')||'Commande',invoiceId:sessionId,provider:'stripe',cartItems,
      archived:false,
      client:{
        name   : clientName,
        email  : customer.email||'',
        phone  : customer.phone||'',
        address: [addr.line1,addr.line2].filter(Boolean).join(', '),
        city   : addr.city||'',
        postal : addr.postal_code||'',
        country: addr.country||'',
      },
    };
    await saveOrder(order);

    const sellers=await getSellers();
    for(const ci of cartItems){
      const qty=parseInt(ci.qty||1);
      const itemAmount=parseFloat(ci.price||0)*qty;

      if(ci.sellerId==='admin'||!ci.sellerId){
        const s=stock.find(x=>x.id===ci.id);
        if(s&&s.qty>0){s.qty=Math.max(0,s.qty-qty);addLog('info',`Admin ${s.name} → ${s.qty}`);}
        await saveConfig();
      } else {
        const v=sellers.find(x=>String(x.id)===String(ci.sellerId));
        if(v){
          const vCommMode = v.commissionMode || cfg.commissionMode || 'flat';
          const vCommFlat = v.commissionFlat !== undefined ? v.commissionFlat : cfg.commissionFlat;
          const vCommRate = v.commissionRate !== undefined ? v.commissionRate : cfg.commissionRate;
          const itemCommission = vCommMode==='flat' ? vCommFlat*qty : itemAmount*vCommRate;
          const itemNet = itemAmount - itemCommission;
          v.balance         = parseFloat((parseFloat(v.balance||0)+itemNet).toFixed(2));
          v.totalSales      = parseFloat((parseFloat(v.totalSales||0)+itemAmount).toFixed(2));
          v.totalCommission = parseFloat((parseFloat(v.totalCommission||0)+itemCommission).toFixed(2));
          const s=(v.stock||[]).find(x=>x.id===ci.id);
          if(s&&s.qty>0){s.qty=Math.max(0,s.qty-qty);addLog('info',`${v.name} ${s.name} → ${s.qty}`);}
          await saveSeller(v);

          if(v.telegramId&&vendorBot){
            const itemName  = s?s.name:`Article #${ci.id}`;
            const stockLeft = s?s.qty:'?';
            const c = order.client;
            const msg = `🛍 *Nouvelle vente !*\n\n`
              + `📦 ${qty}x *${itemName}*\n`
              + `💰 Montant : ${itemAmount.toFixed(2)}€\n`
              + `💵 Gain net : *${itemNet.toFixed(2)}€*\n`
              + `📊 Stock restant : ${stockLeft}\n\n`
              + `━━━━━━━━━━━━━━━\n`
              + `👤 *Nom complet :* ${c.name||'—'}\n`
              + `📍 *Adresse :* ${c.address||'—'}\n`
              + `📮 *Code postal :* ${c.postal||'—'}\n`
              + `🏙 *Ville :* ${c.city||'—'}\n`
              + `🌍 *Pays :* ${c.country||'—'}\n`
              + `📞 *Téléphone :* ${c.phone||'—'}\n`
              + `📧 *Email :* ${c.email||'—'}`;
            vendorBot.sendMessage(v.telegramId, msg, {parse_mode:'Markdown'})
              .catch(e=>addLog('warn',`Notif vendeur: ${e.message}`));
          }
        }
      }
    }
    addLog('ok',`Stripe · @${userName} · ${amount}€ · com:${commission}€`);
    if(userId&&bot){
      try{await bot.sendMessage(userId,`✅ *Commande confirmée !*\n\n🛍 ${productNames.join(', ')||'Votre commande'}\n💶 ${amount}€ payés\n\nMerci ! 🙏`,{parse_mode:'Markdown'});}catch(e){}
    }
  }
  res.sendStatus(200);
});

// ─────────────────────────────────────────
//  PAGES STATIQUES
// ─────────────────────────────────────────
app.get('/shop-app',(req,res)=>res.sendFile(path.join(__dirname,'shop.html')));
app.get('/seller-dashboard',(req,res)=>res.sendFile(path.join(__dirname,'seller.html')));
app.get('/payment-success',(req,res)=>res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>✅</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}.box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}.icon{font-size:64px;margin-bottom:16px;}h1{color:#4ade80;}p{color:#8899b0;font-size:14px;}</style></head><body><div class="box"><div class="icon">✅</div><h1>Paiement réussi !</h1><p>Retourne dans Telegram pour voir ta confirmation.</p></div></body></html>`));
app.get('/payment-cancel',(req,res)=>res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>❌</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}.box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}.icon{font-size:64px;margin-bottom:16px;}h1{color:#f87171;}p{color:#8899b0;font-size:14px;}</style></head><body><div class="box"><div class="icon">❌</div><h1>Paiement annulé</h1><p>Retourne dans Telegram et réessaye.</p></div></body></html>`));

// ─────────────────────────────────────────
//  DÉMARRAGE
// ─────────────────────────────────────────
async function main() {
  addLog('info','═══════════════════════════════');
  addLog('info',`AgentOS Marketplace · Port ${PORT}`);
  await initDB();
  await loadConfig();
  addLog('info',`Commission: ${cfg.commissionMode==='flat'?cfg.commissionFlat+'€/article':(cfg.commissionRate*100)+'%'}`);
  addLog('info','═══════════════════════════════');
  app.listen(PORT, ()=>addLog('info',`Serveur démarré sur le port ${PORT}`));
  if(cfg.telegramToken&&cfg.claudeKey) setTimeout(()=>startBot(),2000);
  setTimeout(()=>startVendorBot(), 2500);
  setTimeout(()=>startAdminBot(), 3000);
}

main().catch(e=>{ console.error('Startup error:', e); process.exit(1); });
process.on('SIGTERM',()=>{stopBot();process.exit(0);});
process.on('SIGINT', ()=>{stopBot();process.exit(0);});
