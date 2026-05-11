const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function getProducts(category) {
  const url = category ? `/api/products?category=${encodeURIComponent(category)}` : '/api/products';
  return apiFetch(url);
}

export function getProduct(id) {
  return apiFetch(`/api/products/${id}`);
}

export function createPaymentIntent(cart, userId, userName) {
  return apiFetch('/api/checkout/intent', {
    method: 'POST',
    body: JSON.stringify({ cart, userId: String(userId || ''), userName: String(userName || '') }),
  });
}
