'use strict';
// Routes des avis clients — extraites de server.js sans changement de comportement.
// `ctx` donne accès aux fonctions partagées ; cfg et reviewBot sont lus à chaque appel (ils peuvent être remplacés).
module.exports = function registerReviewRoutes(app, ctx) {
  const { auth, addLog, getReviews, getReview, saveReview, deleteReview } = ctx;
// ─────────────────────────────────────────
//  ROUTES ADMIN — AVIS
// ─────────────────────────────────────────
app.get('/reviews', auth, async(req,res)=>{
  try {
    let reviews = await getReviews();
    if(req.query.status) reviews = reviews.filter(r=>r.status===req.query.status);
    res.json(reviews);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/reviews/:id/approve', auth, async(req,res)=>{
  try {
    const r = await getReview(req.params.id);
    if(!r) return res.status(404).json({error:'Avis introuvable'});
    r.status = 'approved';
    await saveReview(r);
    addLog('ok', `Avis approuvé: #${r.id}`);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/reviews/:id/reject', auth, async(req,res)=>{
  try {
    const r = await getReview(req.params.id);
    if(!r) return res.status(404).json({error:'Avis introuvable'});
    r.status = 'rejected';
    await saveReview(r);
    addLog('info', `Avis refusé: #${r.id}`);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.delete('/reviews/:id', auth, async(req,res)=>{
  try {
    await deleteReview(req.params.id);
    res.json({ok:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Route PUBLIQUE — avis approuvés pour un produit
app.get('/reviews/public/:productId', async(req,res)=>{
  try {
    const reviews = await getReviews();
    const approved = reviews.filter(r=>r.status==='approved' && String(r.productId)===req.params.productId);
    res.json(approved);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Route PUBLIQUE — avis vendeur approuvés (type='seller')
app.get('/reviews/seller/:sellerId', async(req,res)=>{
  try {
    const reviews = await getReviews();
    const approved = reviews.filter(r=>
      r.status==='approved' &&
      r.type==='seller' &&
      String(r.sellerId)===req.params.sellerId
    );
    res.json(approved);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─────────────────────────────────────────
//  ✅ FIX #2 — AVIS : notification Telegram manquante
//  AVANT : ctx.cfg.adminTelegramId pouvait être undefined si le bot admin n'avait
//          jamais reçu /start → ctx.reviewBot.sendMessage() jamais appelé → 0 notif
//  MAINTENANT : fallback sur process.env.ADMIN_TELEGRAM_ID en priorité,
//               puis ctx.cfg.adminTelegramId comme second choix
// ─────────────────────────────────────────
app.post('/reviews', async(req,res)=>{
  const{productId, productTitle, sellerId, sellerName, stars, text, userId, type}=req.body;
  if(!stars||stars<1||stars>5) return res.status(400).json({error:'Données invalides'});
  // Pour un avis vendeur, productId n'est pas requis
  if(type!=='seller' && !productId) return res.status(400).json({error:'Données invalides'});

  const review = {
    id         : Date.now(),
    type       : type||'product',
    productId  : String(productId||''),
    productTitle: productTitle||'',
    sellerId   : String(sellerId||''),
    sellerName : sellerName||'',
    stars      : parseInt(stars),
    text       : (text||'').slice(0,500),
    userId     : String(userId||'guest'),
    date       : new Date().toLocaleString('fr-FR'),
    status     : 'pending',
    createdAt  : new Date().toISOString(),
  };
  await saveReview(review);
  addLog('info', `Nouvel avis · ${productTitle} · ${stars}★`);

  // ✅ FIX #2 — Priorité : variable d'environnement > ctx.cfg.adminTelegramId
  const adminTelegramId = process.env.ADMIN_TELEGRAM_ID || ctx.cfg.adminTelegramId;

  if(ctx.reviewBot && adminTelegramId) {
    const stars_display = '★'.repeat(parseInt(stars)) + '☆'.repeat(5-parseInt(stars));
    const isSellerReview = (type==='seller');
    const msg = `${isSellerReview?'🏪':'⭐'} *Nouvel avis ${isSellerReview?'vendeur':'produit'} à modérer*\n\n`
      +`${stars_display} *${parseInt(stars)}/5*\n\n`
      +(isSellerReview
        ? `🏪 *Vendeur :* ${sellerName||'?'}\n`
        : `📦 *Produit :* ${productTitle||'?'}\n`
          +(sellerName?`🏪 *Vendeur :* ${sellerName}\n`:''))
      +(text?`\n💬 *Commentaire :*\n"${text}"\n`:' _Pas de commentaire_\n')
      +`\n👤 *Client :* ${userId==='guest'?'Invité':'#'+userId}`
      +`\n📅 *Date :* ${new Date().toLocaleString('fr-FR')}`;

    ctx.reviewBot.sendMessage(adminTelegramId, msg, {
      parse_mode:'Markdown',
      reply_markup:{inline_keyboard:[[
        {text:'✅ Approuver', callback_data:`review_approve_${review.id}`},
        {text:'❌ Refuser',   callback_data:`review_reject_${review.id}`},
      ]]}
    }).catch(e=>addLog('warn','ReviewBot notif: '+e.message));
  } else {
    // Log pour aider au diagnostic si la notif ne part toujours pas
    if(!ctx.reviewBot)        addLog('warn','ReviewBot: bot non démarré (REVIEW_BOT_TOKEN manquant ?)');
    if(!adminTelegramId)  addLog('warn','ReviewBot: ADMIN_TELEGRAM_ID non configuré — ajoutez-le dans .env ou envoyez /start au bot admin');
  }

  res.json({ok:true, review});
});

};
