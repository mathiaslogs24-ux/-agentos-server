import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';

// Apply Telegram theme colors as CSS variables before React renders
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.expand();
  const t = tg.themeParams || {};
  const root = document.documentElement.style;
  if (t.bg_color)          root.setProperty('--tg-bg-color',          t.bg_color);
  if (t.text_color)        root.setProperty('--tg-text-color',        t.text_color);
  if (t.hint_color)        root.setProperty('--tg-hint-color',        t.hint_color);
  if (t.link_color)        root.setProperty('--tg-link-color',        t.link_color);
  if (t.button_color)      root.setProperty('--tg-button-color',      t.button_color);
  if (t.button_text_color) root.setProperty('--tg-button-text-color', t.button_text_color);
  if (t.secondary_bg_color) root.setProperty('--tg-secondary-bg-color', t.secondary_bg_color);
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);
