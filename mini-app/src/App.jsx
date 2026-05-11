import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Catalogue      from './pages/Catalogue.jsx';
import ProductDetail  from './pages/ProductDetail.jsx';
import Cart           from './pages/Cart.jsx';
import Checkout       from './pages/Checkout.jsx';
import Confirmation   from './pages/Confirmation.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/"              element={<Catalogue />} />
      <Route path="/product/:id"   element={<ProductDetail />} />
      <Route path="/cart"          element={<Cart />} />
      <Route path="/checkout"      element={<Checkout />} />
      <Route path="/confirmation"  element={<Confirmation />} />
      <Route path="*"              element={<Navigate to="/" replace />} />
    </Routes>
  );
}
