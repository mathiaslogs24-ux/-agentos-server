// Central hook for Telegram WebApp API access.
// All MainButton / BackButton management goes through here.

const tg = window.Telegram?.WebApp;

let currentMainButtonHandler = null;
let currentBackButtonHandler = null;

function setMainButton(text, onClick) {
  if (!tg?.MainButton) return;
  if (currentMainButtonHandler) {
    tg.MainButton.offClick(currentMainButtonHandler);
  }
  currentMainButtonHandler = onClick;
  tg.MainButton.setText(text);
  tg.MainButton.onClick(onClick);
  tg.MainButton.show();
}

function hideMainButton() {
  if (!tg?.MainButton) return;
  if (currentMainButtonHandler) {
    tg.MainButton.offClick(currentMainButtonHandler);
    currentMainButtonHandler = null;
  }
  tg.MainButton.hide();
}

function showBackButton(onClick) {
  if (!tg?.BackButton) return;
  if (currentBackButtonHandler) {
    tg.BackButton.offClick(currentBackButtonHandler);
  }
  currentBackButtonHandler = onClick;
  tg.BackButton.onClick(onClick);
  tg.BackButton.show();
}

function hideBackButton() {
  if (!tg?.BackButton) return;
  if (currentBackButtonHandler) {
    tg.BackButton.offClick(currentBackButtonHandler);
    currentBackButtonHandler = null;
  }
  tg.BackButton.hide();
}

export function useTelegram() {
  return {
    tg,
    user:        tg?.initDataUnsafe?.user  || null,
    colorScheme: tg?.colorScheme           || 'light',
    themeParams: tg?.themeParams           || {},
    setMainButton,
    hideMainButton,
    showBackButton,
    hideBackButton,
    close:       () => tg?.close(),
    expand:      () => tg?.expand(),
  };
}
