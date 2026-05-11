// Handler /shop — à ajouter au bot Telegram existant.
// Ouvre la Mini App marketplace via un bouton web_app.
//
// Usage dans le bot principal :
//   const { registerShopCommand } = require('./bot/shop_handler');
//   registerShopCommand(bot);

'use strict';

function registerShopCommand(bot) {
  const miniAppUrl = process.env.MINI_APP_URL;
  if (!miniAppUrl) {
    console.warn('[shop_handler] MINI_APP_URL non définie — commande /shop désactivée');
    return;
  }

  bot.onText(/\/shop/, (msg) => {
    bot.sendMessage(msg.chat.id, '🛍 Découvrez notre boutique :', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🛒 Voir les produits', web_app: { url: miniAppUrl } }
        ]],
      },
    });
  });

  // /become_vendor — envoie le lien dashboard avec pré-remplissage du Telegram ID
  bot.onText(/\/become_vendor/, (msg) => {
    const dashboardUrl = process.env.VENDOR_DASHBOARD_URL;
    if (!dashboardUrl) return;
    const url = `${dashboardUrl}/register?telegram_id=${msg.from.id}&name=${encodeURIComponent(msg.from.first_name || '')}`;
    bot.sendMessage(msg.chat.id,
      `👔 Vous souhaitez vendre sur notre marketplace ?\n\nInscrivez-vous en tant que vendeur :`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📝 Créer mon compte vendeur', url }
          ]],
        },
      }
    );
  });
}

module.exports = { registerShopCommand };
