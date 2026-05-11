'use strict';

async function notifyVendor(telegramId, orderData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !telegramId) return;

  const lines = [
    `🛍 *Nouvelle commande !*`,
    ``,
    `📦 Produit: ${orderData.productName || 'N/A'}`,
    `💶 Montant: ${orderData.amount}€`,
    `👤 Acheteur: ${orderData.buyerName || 'Inconnu'}`,
    orderData.buyerTelegramId ? `📱 Telegram: ${orderData.buyerTelegramId}` : null,
    `🔑 ID: \`${orderData.orderId}\``,
    ``,
    `Connecte-toi au dashboard pour voir le détail.`,
  ].filter(l => l !== null).join('\n');

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramId,
        text: lines,
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.error('[telegram] notifyVendor failed:', e.message);
  }
}

module.exports = { notifyVendor };
