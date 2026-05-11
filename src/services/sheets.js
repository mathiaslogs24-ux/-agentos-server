'use strict';
const { google } = require('googleapis');

const SHEET_ID         = process.env.GOOGLE_SHEETS_ID;
const PRODUCTS_SHEET   = 'Products';
const VENDORS_SHEET    = 'Vendors';
const ORDERS_SHEET     = 'Commandes';

const PRODUCTS_HEADERS = ['id','vendor_id','name','description','price','image_url','category','stock','status','created_at'];
const VENDORS_HEADERS  = ['id','telegram_id','name','email','password_hash','stripe_account_id','joined_at'];
const ORDERS_HEADERS   = ['id','product_id','vendor_id','buyer_telegram_id','buyer_name','amount','stripe_payment_id','status','created_at'];

// 30-second in-memory cache for products (rate-limit mitigation)
let productsCache = { data: null, ts: 0 };
const CACHE_TTL = 30_000;

// ── Auth

function getAuth() {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// ── Low-level helpers

async function readSheet(sheetName) {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEETS_ID not configured');
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: sheetName,
  });
  const values = res.data.values || [];
  if (!values.length) return [];
  const [headers, ...rows] = values;
  return rows
    .filter(row => row.some(cell => cell !== '' && cell != null))
    .map((row, i) => {
      const obj = { _rowIndex: i + 2 }; // 1-based sheet row (header = row 1)
      headers.forEach((h, j) => { obj[h] = row[j] ?? ''; });
      return obj;
    });
}

async function appendRow(sheetName, data, headers) {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEETS_ID not configured');
  const sheets = getSheetsClient();
  const values = [headers.map(h => String(data[h] ?? ''))];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

async function updateRow(sheetName, rowIndex, data, headers) {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEETS_ID not configured');
  const sheets = getSheetsClient();
  const values = [headers.map(h => String(data[h] ?? ''))];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

async function deleteRow(sheetName, rowIndex) {
  if (!SHEET_ID) throw new Error('GOOGLE_SHEETS_ID not configured');
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = meta.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex - 1, // convert 1-based to 0-based inclusive
            endIndex: rowIndex,       // 0-based exclusive
          },
        },
      }],
    },
  });
}

// ── Products

function invalidateProductsCache() {
  productsCache = { data: null, ts: 0 };
}

async function getProducts(forceRefresh = false) {
  if (!forceRefresh && productsCache.data && Date.now() - productsCache.ts < CACHE_TTL) {
    return productsCache.data;
  }
  const rows = await readSheet(PRODUCTS_SHEET);
  productsCache = { data: rows, ts: Date.now() };
  return rows;
}

async function getApprovedProducts() {
  const all = await getProducts();
  return all.filter(p => p.status === 'approved' && parseInt(p.stock || '0', 10) > 0);
}

async function getProductById(id) {
  const all = await getProducts(true);
  return all.find(p => p.id === id) || null;
}

async function getProductsByVendorId(vendorId) {
  const all = await getProducts(true);
  return all.filter(p => p.vendor_id === vendorId);
}

async function createProduct(data) {
  const product = {
    id: `prod_${Date.now()}`,
    vendor_id: data.vendor_id || '',
    name: data.name || '',
    description: data.description || '',
    price: String(data.price || '0'),
    image_url: data.image_url || '',
    category: data.category || '',
    stock: String(data.stock || '0'),
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  await appendRow(PRODUCTS_SHEET, product, PRODUCTS_HEADERS);
  invalidateProductsCache();
  return product;
}

async function updateProduct(id, data) {
  const all = await getProducts(true);
  const existing = all.find(p => p.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...data };
  await updateRow(PRODUCTS_SHEET, existing._rowIndex, updated, PRODUCTS_HEADERS);
  invalidateProductsCache();
  const { _rowIndex, ...safe } = updated;
  return safe;
}

async function deleteProduct(id) {
  const all = await getProducts(true);
  const existing = all.find(p => p.id === id);
  if (!existing) return false;
  await deleteRow(PRODUCTS_SHEET, existing._rowIndex);
  invalidateProductsCache();
  return true;
}

// ── Vendors

async function getVendors() {
  return readSheet(VENDORS_SHEET);
}

async function getVendorById(id) {
  const all = await getVendors();
  return all.find(v => v.id === id) || null;
}

async function getVendorByEmail(email) {
  const all = await getVendors();
  return all.find(v => v.email === email) || null;
}

async function getVendorByTelegramId(telegramId) {
  const all = await getVendors();
  return all.find(v => v.telegram_id === String(telegramId)) || null;
}

async function createVendor(data) {
  const vendor = {
    id: `vnd_${Date.now()}`,
    telegram_id: String(data.telegram_id || ''),
    name: data.name || '',
    email: data.email || '',
    password_hash: data.password_hash || '',
    stripe_account_id: data.stripe_account_id || '',
    joined_at: new Date().toISOString(),
  };
  await appendRow(VENDORS_SHEET, vendor, VENDORS_HEADERS);
  return vendor;
}

// ── Orders

async function getOrders() {
  return readSheet(ORDERS_SHEET);
}

async function getOrdersByVendorId(vendorId) {
  const all = await getOrders();
  return all.filter(o => o.vendor_id === vendorId);
}

async function createOrder(data) {
  const order = {
    id: `ord_${Date.now()}`,
    product_id: data.product_id || '',
    vendor_id: data.vendor_id || '',
    buyer_telegram_id: data.buyer_telegram_id || '',
    buyer_name: data.buyer_name || '',
    amount: String(data.amount || '0'),
    stripe_payment_id: data.stripe_payment_id || '',
    status: 'paid',
    created_at: new Date().toISOString(),
  };
  await appendRow(ORDERS_SHEET, order, ORDERS_HEADERS);
  return order;
}

module.exports = {
  // products
  getProducts, getApprovedProducts, getProductById, getProductsByVendorId,
  createProduct, updateProduct, deleteProduct,
  // vendors
  getVendors, getVendorById, getVendorByEmail, getVendorByTelegramId, createVendor,
  // orders
  getOrders, getOrdersByVendorId, createOrder,
};
