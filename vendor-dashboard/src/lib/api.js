import { getToken, setToken, clearToken } from './auth.js';

const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    return;
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// Auth
export async function login(email, password) {
  const data = await apiFetch('/api/vendors/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data.vendor;
}

export async function register(name, email, password, telegram_id) {
  const data = await apiFetch('/api/vendors/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, telegram_id }),
  });
  // Auto-login after registration
  return login(email, password);
}

// Vendor profile
export const getMe      = ()   => apiFetch('/api/vendors/me');
export const getRevenue = ()   => apiFetch('/api/vendors/me/revenue');
export const getMyOrders = ()  => apiFetch('/api/vendors/me/orders');

// Products
export const getMyProducts = ()     => apiFetch('/api/products/mine');
export const getProduct    = (id)   => apiFetch(`/api/products/${id}`);

export const createProduct = (data) => apiFetch('/api/products', {
  method: 'POST',
  body: JSON.stringify(data),
});

export const updateProduct = (id, data) => apiFetch(`/api/products/${id}`, {
  method: 'PUT',
  body: JSON.stringify(data),
});

export const deleteProduct = (id) => apiFetch(`/api/products/${id}`, {
  method: 'DELETE',
});
