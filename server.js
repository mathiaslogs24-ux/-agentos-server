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
  res.header('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
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

// stock admin + shopItems stockés en config
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
  // Variables d'env ont priorité
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

async function saveOrder(order) {
  await db('INSERT INTO orders(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2',
    [order.id, JSON.stringify(order)]);
}

// ─────────────────────────────────────────
//  LOGS (mémoire + DB)
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
//  BOT
// ─────────────────────────────────────────
function startBot() {
  if(running)            return {ok:false,reason:'Déjà démarré'};
  if(!cfg.telegramToken) return {ok:false,reason:'Token manquant'};
  if(!cfg.claudeKey)     return {ok:false,reason:'Clé Claude manquante'};
  try {
    bot=new TelegramBot(cfg.telegramToken,{polling:true});
    running=true;startedAt=new Date().toISOString();
    addLog('ok',`Bot démarré · ${cfg.claudeModel}`);

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
//  ROUTES ADMIN
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

// ── Stock admin
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

app.get('/orders',auth,async(req,res)=>res.json(await getOrders()));

// ─────────────────────────────────────────
//  ROUTES VENDEURS (admin)
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

  if(telegramId&&bot){
    try{
      await bot.sendMessage(telegramId,
        `🎉 *Bienvenue sur le Marketplace !*\n\nBonjour ${name}, votre espace vendeur est prêt.\n\n🔑 Votre clé secrète :\n\`${seller.secret}\`\n\n👇 Accédez à votre dashboard :`,
        {parse_mode:'Markdown',reply_markup:{inline_keyboard:[[{text:'🛍 Ouvrir mon dashboard vendeur',url:`https://agentos-server-production-a5b4.up.railway.app/seller-dashboard`}]]}}
      );
    }catch(e){addLog('warn',`Notif vendeur: ${e.message}`);}
  }
  res.json({ok:true,seller});
});

app.post('/sellers/:id/update',auth,async(req,res)=>{
  const v=await getSeller(req.params.id);
  if(!v) return res.status(404).json({error:'Introuvable'});
  if(req.body.name)                 v.name         =req.body.name;
  if(req.body.shopName)             v.shopName     =req.body.shopName;
  if(req.body.telegramId!==undefined) v.telegramId =req.body.telegramId;
  if(req.body.balance!==undefined)    v.balance    =parseFloat(req.body.balance)||0;
  if(req.body.remuneration!==undefined) v.remuneration=parseFloat(req.body.remuneration)||0;
  if(req.body.notes!==undefined)    v.notes        =req.body.notes;
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
app.get('/seller/me',sellerAuth,(req,res)=>{const{secret,...safe}=req.seller;res.json(safe);});

app.post('/seller/stock',sellerAuth,async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  req.seller.stock=req.body;await saveSeller(req.seller);
  addLog('ok',`Stock vendeur ${req.seller.name} · ${req.body.length} articles`);
  res.json({ok:true,count:req.body.length});
});

app.post('/seller/shop',sellerAuth,async(req,res)=>{
  if(!Array.isArray(req.body)) return res.status(400).json({error:'Format invalide'});
  req.seller.shopItems=req.body;await saveSeller(req.seller);
  addLog('ok',`Catalogue vendeur ${req.seller.name} · ${req.body.length} articles`);
  res.json({ok:true,count:req.body.length});
});

// ─────────────────────────────────────────
//  MARKETPLACE PUBLIC
// ─────────────────────────────────────────
app.get('/marketplace',async(req,res)=>{
  const sellers=await getSellers();
  const result=[];
  const adminItems=shopItems.map(item=>{
    const s=stock.find(x=>x.id===item.stockId);
    if(!s||s.qty<=0) return null;
    return{id:item.stockId,sellerId:'admin',sellerName:'Boutique Officielle',sellerShop:'Boutique Officielle',
      title:item.title,description:item.description||'',price:parseFloat(item.price||0),
      qty:s.qty,puffs:s.puffs||0,cat:s.cat||'',alert:s.alert||5,payload:item.payload};
  }).filter(Boolean);
  if(adminItems.length) result.push({sellerId:'admin',sellerName:'Boutique Officielle',items:adminItems});

  sellers.filter(v=>v.active).forEach(v=>{
    const items=(v.shopItems||[]).map(item=>{
      const s=(v.stock||[]).find(x=>x.id===item.stockId);
      if(!s||s.qty<=0) return null;
      return{id:item.stockId,sellerId:v.id,sellerName:v.name,sellerShop:v.shopName||v.name,
        title:item.title,description:item.description||'',price:parseFloat(item.price||0),
        qty:s.qty,puffs:s.puffs||0,cat:s.cat||'',alert:s.alert||5,payload:item.payload};
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
    const session=event.data.object,meta=session.metadata||{};
    const userId=meta.userId||'',userName=meta.userName||'';
    const amount=(session.amount_total/100).toFixed(2);
    let cartItems=[];
    try{cartItems=JSON.parse(meta.cartJson||'[]');}catch(e){}
    const nbItems=cartItems.reduce((s,i)=>s+parseInt(i.qty||1),0);
    const commission=cfg.commissionMode==='flat'
      ?(cfg.commissionFlat*nbItems).toFixed(2)
      :(parseFloat(amount)*cfg.commissionRate).toFixed(2);
    const sellerAmount=(parseFloat(amount)-parseFloat(commission)).toFixed(2);

    let productNames=[];
    try{
      const li=await fetch(`https://api.stripe.com/v1/checkout/sessions/${session.id}/line_items`,{headers:{'Authorization':`Bearer ${cfg.stripeKey}`}});
      const ld=await li.json();
      if(ld.data?.length) productNames=ld.data.map(x=>x.description||'');
    }catch(e){}

    const customer=session.customer_details||{},shipping=session.shipping_details||{},addr=shipping.address||{};
    const order={
      id:Date.now(),date:new Date().toLocaleString('fr-FR'),userId,userName,amount,commission,sellerAmount,
      stockName:productNames.join(', ')||'Commande',invoiceId:session.id,provider:'stripe',cartItems,
      client:{name:shipping.name||customer.name||'',email:customer.email||'',phone:customer.phone||'',
        address:[addr.line1,addr.line2].filter(Boolean).join(', '),city:addr.city||'',postal:addr.postal_code||'',country:addr.country||''},
    };
    await saveOrder(order);

    const sellers=await getSellers();
    for(const ci of cartItems){
      const qty=parseInt(ci.qty||1);
      const itemAmount=parseFloat(ci.price||0)*qty;
      const itemCommission=cfg.commissionMode==='flat'?cfg.commissionFlat*qty:itemAmount*cfg.commissionRate;
      const itemNet=itemAmount-itemCommission;

      if(ci.sellerId==='admin'||!ci.sellerId){
        const s=stock.find(x=>x.id===ci.id);
        if(s&&s.qty>0){s.qty=Math.max(0,s.qty-qty);addLog('info',`📦 Admin ${s.name} → ${s.qty}`);}
        await saveConfig();
      } else {
        const v=sellers.find(x=>String(x.id)===String(ci.sellerId));
        if(v){
          v.balance        =parseFloat((parseFloat(v.balance||0)+itemNet).toFixed(2));
          v.totalSales     =parseFloat((parseFloat(v.totalSales||0)+itemAmount).toFixed(2));
          v.totalCommission=parseFloat((parseFloat(v.totalCommission||0)+itemCommission).toFixed(2));
          const s=(v.stock||[]).find(x=>x.id===ci.id);
          if(s&&s.qty>0){s.qty=Math.max(0,s.qty-qty);addLog('info',`📦 ${v.name} ${s.name} → ${s.qty}`);}
          await saveSeller(v);

          if(v.telegramId&&bot){
            const itemName=s?s.name:`Article #${ci.id}`;
            const stockLeft=s?s.qty:'?';
            const addrLine=[order.client.name,order.client.address,order.client.postal,order.client.city,order.client.country].filter(Boolean).join(', ');
            bot.sendMessage(v.telegramId,
              `🛍 *Nouvelle vente !*\n\n📦 ${qty}x *${itemName}*\n💰 Montant : ${itemAmount.toFixed(2)}€\n💵 Votre gain net : *${itemNet.toFixed(2)}€*\n📊 Stock restant : ${stockLeft}\n\n👤 *Livraison :*\n${addrLine||'Non renseigné'}\n`
              +(order.client.phone?`📞 ${order.client.phone}\n`:'')
              +(order.client.email?`📧 ${order.client.email}`:''),
              {parse_mode:'Markdown'}
            ).catch(e=>addLog('warn',`Notif vendeur: ${e.message}`));
          }
        }
      }
    }
    addLog('ok',`💳 Stripe · @${userName} · ${amount}€ · com:${commission}€`);
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

app.get('/seller-dashboard',(req,res)=>{
  res.send(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>VendorOS</title><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"><style>:root{--gold:#F0B429;--gdim:rgba(240,180,41,.08);--bg0:#08080A;--bg1:#0F0F12;--bg2:#161619;--bg3:#1E1E23;--bg4:#26262D;--gb:rgba(255,255,255,.07);--text:#F0EEE8;--t2:#8A8680;--t3:#4A4744;--green:#4ADE80;--grdim:rgba(74,222,128,.08);--red:#F87171;--rdim:rgba(248,113,113,.08);--blue:#4FC3F7;--bdim:rgba(79,195,247,.08);--r:14px;--rs:8px;}*{margin:0;padding:0;box-sizing:border-box;}body{background:var(--bg0);color:var(--text);font-family:'Bricolage Grotesque',sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden;}.lw{flex:1;display:flex;align-items:center;justify-content:center;}.lb{width:380px;background:var(--bg2);border:1px solid var(--gb);border-radius:var(--r);padding:32px;}.ll{font-size:22px;font-weight:800;margin-bottom:4px;}.ll span{color:var(--gold);}.ls{font-size:13px;color:var(--t2);margin-bottom:24px;}.fl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);margin-bottom:6px;}.fi{width:100%;background:var(--bg3);border:1px solid var(--gb);color:var(--text);font-family:'Bricolage Grotesque';font-size:13px;padding:10px 13px;border-radius:var(--rs);outline:none;margin-bottom:14px;}.fi:focus{border-color:var(--gold);}.topbar{flex-shrink:0;background:var(--bg1);border-bottom:1px solid var(--gb);padding:0 20px;display:flex;align-items:center;height:52px;gap:12px;}.tl{font-size:16px;font-weight:800;}.tl span{color:var(--gold);}.tnav{padding:7px 14px;border-radius:var(--rs);font-size:12px;font-weight:700;cursor:pointer;color:var(--t2);transition:all .15s;}.tnav.active{background:var(--gdim);color:var(--gold);}.ab{flex:1;display:flex;overflow:hidden;}.co{flex:1;overflow-y:auto;padding:20px;}.panel{display:none;}.panel.active{display:block;}.sg{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}.sc{background:var(--bg2);border:1px solid var(--gb);border-radius:var(--r);padding:16px 18px;}.sl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--t3);margin-bottom:8px;}.sv{font-size:22px;font-weight:800;}.sv.gold{color:var(--gold);}.sv.green{color:var(--green);}.sv.blue{color:var(--blue);}.card{background:var(--bg2);border:1px solid var(--gb);border-radius:var(--r);margin-bottom:14px;overflow:hidden;}.ch{padding:12px 16px;border-bottom:1px solid var(--gb);display:flex;align-items:center;justify-content:space-between;}.ct{font-size:13px;font-weight:700;display:flex;align-items:center;gap:8px;}.btn{padding:8px 14px;border-radius:var(--rs);font-family:'Bricolage Grotesque';font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;border:1px solid var(--gb);background:var(--bg3);color:var(--text);}.btn:active{transform:scale(.97);}.btn.p{background:var(--gold);color:#000;border-color:var(--gold);}.btn.d{background:var(--rdim);color:var(--red);border-color:rgba(248,113,113,.25);}.btn.f{width:100%;padding:11px;}.btn.sm{padding:5px 10px;font-size:11px;}.tw{overflow-x:auto;}table{width:100%;border-collapse:collapse;}th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--t3);padding:9px 12px;border-bottom:1px solid var(--gb);}td{padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.03);font-size:13px;vertical-align:middle;}tr:last-child td{border:none;}.ci{background:var(--bg3);border:1px solid var(--gb);color:var(--text);font-family:'Bricolage Grotesque';font-size:12px;padding:6px 10px;border-radius:var(--rs);outline:none;width:100%;}.ci:focus{border-color:var(--gold);}.ci.n{font-family:'DM Mono';font-size:14px;font-weight:700;color:var(--gold);text-align:center;width:70px;}.ci.pr{font-family:'DM Mono';font-size:12px;width:75px;}.ci.pf{font-family:'DM Mono';font-size:12px;width:65px;}.ci.ct{max-width:110px;}.sw{display:inline-block;position:relative;width:40px;height:22px;cursor:pointer;}.sw input{display:none;}.sw-t{position:absolute;inset:0;background:var(--bg4);border-radius:11px;transition:.2s;border:1px solid var(--gb);}.sw input:checked+.sw-t{background:var(--gold);border-color:var(--gold);}.sw-k{position:absolute;top:3px;left:3px;width:16px;height:16px;background:#fff;border-radius:50%;transition:.2s;}.sw input:checked~.sw-k{transform:translateX(18px);}.bx{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;font-family:'DM Mono';}.bx.bl{background:var(--bdim);color:var(--blue);}.bx.gd{background:var(--gdim);color:var(--gold);}.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;padding:14px;}.cc{background:var(--bg3);border:1px solid var(--gb);border-radius:var(--r);padding:14px;transition:border-color .15s;}.cc.on{border-color:rgba(240,180,41,.3);background:var(--gdim);}.cc-name{font-size:13px;font-weight:700;margin-bottom:4px;}.cc-meta{font-size:11px;color:var(--t3);margin-bottom:10px;}.cc-price{font-size:18px;font-weight:800;color:var(--gold);margin-bottom:10px;}.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(80px);background:var(--bg3);border:1px solid var(--gb);border-radius:10px;padding:10px 18px;font-size:12px;font-weight:600;z-index:999;transition:transform .3s;box-shadow:0 8px 24px rgba(0,0,0,.5);}.toast.show{transform:translateX(-50%) translateY(0);}.chip{display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--gb);border-radius:20px;padding:4px 12px 4px 4px;}.chip-av{width:26px;height:26px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#000;}.co::-webkit-scrollbar{width:4px;}.co::-webkit-scrollbar-thumb{background:var(--bg4);border-radius:2px;}</style></head><body>
<div id="lv" class="lw"><div class="lb"><div class="ll">🛍 <span>Vendor</span>OS</div><div class="ls">Votre espace vendeur — entrez votre clé secrète</div><div class="fl">Clé secrète</div><input class="fi" type="password" id="si" placeholder="••••••••••••••••" onkeydown="if(event.key==='Enter')login()"><button class="btn p f" onclick="login()">Accéder à mon dashboard</button><div id="le" style="color:var(--red);font-size:12px;margin-top:8px;display:none;">Clé incorrecte</div></div></div>
<div id="dv" style="display:none;flex:1;flex-direction:column;overflow:hidden;">
  <div class="topbar"><div class="tl">🛍 <span>Vendor</span>OS</div><div style="display:flex;gap:2px;flex:1;"><div class="tnav active" id="nav-stock" onclick="tab('stock')">📦 Stock</div><div class="tnav" id="nav-catalogue" onclick="tab('catalogue')">🛍 Catalogue</div></div><div style="display:flex;align-items:center;gap:10px;margin-left:auto;"><div class="chip"><div class="chip-av" id="av">?</div><span style="font-size:12px;font-weight:700;" id="nm">—</span></div><button class="btn sm d" onclick="logout()">Déconnexion</button></div></div>
  <div class="ab"><div class="co">
    <div class="sg"><div class="sc"><div class="sl">Solde</div><div class="sv gold" id="sb">0€</div></div><div class="sc"><div class="sl">Ventes</div><div class="sv green" id="ss">0€</div></div><div class="sc"><div class="sl">Valeur stock</div><div class="sv blue" id="sv">0€</div></div><div class="sc"><div class="sl">En vente</div><div class="sv" id="sa">0</div></div></div>
    <div class="panel active" id="panel-stock"><div class="card"><div class="ch"><div class="ct">📦 Mon Stock <span class="bx bl" id="sc2">0</span></div><div style="display:flex;gap:8px;"><button class="btn sm" onclick="add()">+ Ajouter</button><button class="btn sm p" onclick="push()">🖥 Pousser</button></div></div><div class="tw"><table><thead><tr><th>Produit</th><th>Catégorie</th><th>Quantité</th><th>Prix €</th><th>Puffs K</th><th>Seuil</th><th></th></tr></thead><tbody id="sb2"></tbody></table></div></div></div>
    <div class="panel" id="panel-catalogue"><div class="card"><div class="ch"><div class="ct">🛍 Catalogue <span class="bx gd" id="cc2">0 en vente</span></div><div style="display:flex;gap:8px;"><button class="btn sm" onclick="catAll(true)">Tout activer</button><button class="btn sm" onclick="catAll(false)">Tout désactiver</button><button class="btn sm p" onclick="push()">🖥 Pousser</button></div></div><div class="cg" id="cg2"></div></div><div style="background:var(--gdim);border:1px solid rgba(240,180,41,.2);border-radius:var(--r);padding:14px 16px;font-size:12px;color:var(--t2);">💡 Activez les articles à vendre puis cliquez "Pousser".</div></div>
  </div></div>
</div>
<div class="toast" id="toast"></div>
<script>
const SRV='https://agentos-server-production-a5b4.up.railway.app';
let sec='',seller=null,stock=[],nid=1;
async function login(){
  const s=document.getElementById('si').value.trim();if(!s)return;
  try{const r=await fetch(SRV+'/seller/me',{headers:{'x-secret':s}});if(!r.ok)throw new Error();
  seller=await r.json();sec=s;stock=seller.stock||[];nid=stock.length?Math.max(...stock.map(x=>x.id||0))+1:1;
  document.getElementById('lv').style.display='none';document.getElementById('dv').style.display='flex';
  document.getElementById('av').textContent=(seller.shopName||seller.name||'?')[0].toUpperCase();
  document.getElementById('nm').textContent=seller.shopName||seller.name;
  document.getElementById('sb').textContent=parseFloat(seller.balance||0).toFixed(2)+'€';
  document.getElementById('ss').textContent=parseFloat(seller.totalSales||0).toFixed(2)+'€';
  renderStock();renderCat();stats();}catch(e){document.getElementById('le').style.display='block';}
}
function logout(){sec='';seller=null;stock=[];document.getElementById('lv').style.display='flex';document.getElementById('dv').style.display='none';document.getElementById('si').value='';document.getElementById('le').style.display='none';}
function tab(t){document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.tnav').forEach(n=>n.classList.remove('active'));document.getElementById('panel-'+t).classList.add('active');document.getElementById('nav-'+t).classList.add('active');if(t==='catalogue')renderCat();}
function stats(){const val=stock.reduce((s,x)=>s+(x.qty||0)*(x.price||0),0),act=stock.filter(x=>x.enVente&&x.qty>0).length;document.getElementById('sv').textContent=val.toFixed(2)+'€';document.getElementById('sa').textContent=act;document.getElementById('sc2').textContent=stock.length;document.getElementById('cc2').textContent=act+' en vente';}
function renderStock(){stats();const b=document.getElementById('sb2');if(!stock.length){b.innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:28px;">Aucun article</td></tr>';return;}b.innerHTML=stock.map((s,i)=>'<tr><td><input class="ci" value="'+(s.name||'')+'" oninput="stock['+i+'].name=this.value;stats()"></td><td><input class="ci ct" value="'+(s.cat||'')+'" oninput="stock['+i+'].cat=this.value"></td><td><input class="ci n" type="number" value="'+(s.qty||0)+'" oninput="stock['+i+'].qty=parseInt(this.value)||0;stats()"></td><td><input class="ci pr" type="number" step="0.01" value="'+(s.price||0)+'" oninput="stock['+i+'].price=parseFloat(this.value)||0;stats()"></td><td style="display:flex;align-items:center;gap:4px;"><input class="ci pf" type="number" value="'+(s.puffs?s.puffs/1000:'')+'" placeholder="18" oninput="stock['+i+'].puffs=(parseFloat(this.value)||0)*1000"><span style="font-size:10px;color:var(--t3);">K</span></td><td><input class="ci" type="number" value="'+(s.alert||5)+'" style="width:55px;" oninput="stock['+i+'].alert=parseInt(this.value)||5"></td><td><button class="btn sm d" onclick="del('+i+')">✕</button></td></tr>').join('');}
function add(){stock.push({id:nid++,name:'',cat:'',qty:0,price:0,puffs:0,alert:5,enVente:false});renderStock();}
function del(i){stock.splice(i,1);renderStock();renderCat();}
function renderCat(){stats();const g=document.getElementById('cg2'),av=stock.filter(s=>s.qty>0);if(!av.length){g.innerHTML='<div style="text-align:center;color:var(--t3);padding:32px;grid-column:1/-1;">Aucun article en stock</div>';return;}g.innerHTML=av.map(s=>{const i=stock.indexOf(s),pf=s.puffs?(s.puffs>=1000?(s.puffs/1000).toFixed(0)+'K':s.puffs)+' puffs':'';return'<div class="cc'+(s.enVente?' on':'')+'"><div class="cc-name">'+(s.name||'Sans nom')+'</div><div class="cc-meta">'+(s.cat||'')+(pf?' · '+pf:'')+'</div><div class="cc-price">'+parseFloat(s.price||0).toFixed(2)+'€</div><div style="display:flex;align-items:center;gap:8px;"><label class="sw"><input type="checkbox" '+(s.enVente?'checked':'')+' onchange="stock['+i+'].enVente=this.checked;renderCat()"><span class="sw-t"></span><span class="sw-k"></span></label><span style="font-size:11px;color:'+(s.enVente?'var(--green)':'var(--t2)')+';">'+(s.enVente?'En vente ✓':'Désactivé')+'</span></div></div>';}).join('');}
function catAll(st){stock.forEach(s=>{if(s.qty>0)s.enVente=st;});renderCat();}
async function push(){const btn=event.target;btn.disabled=true;btn.textContent='⏳…';try{const r1=await fetch(SRV+'/seller/stock',{method:'POST',headers:{'Content-Type':'application/json','x-secret':sec},body:JSON.stringify(stock)});if(!r1.ok)throw new Error('Erreur stock');const items=stock.filter(s=>s.enVente&&s.qty>0).map(s=>({title:s.name,description:s.puffs?(s.puffs>=1000?(s.puffs/1000).toFixed(0)+'K':s.puffs)+' puffs'+(s.cat?' · '+s.cat:''):(s.cat||''),price:String(s.price||0),asset:'EUR',payload:'stock_'+s.id,stockId:s.id}));const r2=await fetch(SRV+'/seller/shop',{method:'POST',headers:{'Content-Type':'application/json','x-secret':sec},body:JSON.stringify(items)});if(!r2.ok)throw new Error('Erreur catalogue');stats();toast('✓ Synchronisé · '+stock.length+' articles · '+items.length+' en vente');}catch(e){toast('⚠ '+e.message);}finally{btn.disabled=false;btn.textContent=btn.textContent.includes('marketplace')?'🖥 Pousser vers marketplace':'🖥 Pousser';}}
let tt;function toast(m){const el=document.getElementById('toast');el.textContent=m;el.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('show'),3000);}
</script></body></html>`);
});

app.get('/payment-success',(req,res)=>res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>✅</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}.box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}.icon{font-size:64px;margin-bottom:16px;}h1{color:#4ade80;}p{color:#8899b0;font-size:14px;}</style></head><body><div class="box"><div class="icon">✅</div><h1>Paiement réussi !</h1><p>Retourne dans Telegram pour voir ta confirmation.</p></div></body></html>`));
app.get('/payment-cancel', (req,res)=>res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>❌</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0d1220;color:#e8edf5;}.box{text-align:center;padding:40px;border:1px solid rgba(255,255,255,.1);border-radius:16px;}.icon{font-size:64px;margin-bottom:16px;}h1{color:#f87171;}p{color:#8899b0;font-size:14px;}</style></head><body><div class="box"><div class="icon">❌</div><h1>Paiement annulé</h1><p>Retourne dans Telegram et réessaye.</p></div></body></html>`));

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
}

main().catch(e=>{ console.error('Startup error:', e); process.exit(1); });

process.on('SIGTERM',()=>{stopBot();process.exit(0);});
process.on('SIGINT', ()=>{stopBot();process.exit(0);});
