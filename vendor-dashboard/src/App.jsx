import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout      from './components/Layout.jsx';
import Login       from './pages/Login.jsx';
import Register    from './pages/Register.jsx';
import Dashboard   from './pages/Dashboard.jsx';
import Products    from './pages/Products.jsx';
import AddProduct  from './pages/AddProduct.jsx';
import EditProduct from './pages/EditProduct.jsx';
import Orders      from './pages/Orders.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard"          element={<Dashboard />} />
          <Route path="/products"           element={<Products />} />
          <Route path="/products/add"       element={<AddProduct />} />
          <Route path="/products/:id/edit"  element={<EditProduct />} />
          <Route path="/orders"             element={<Orders />} />
          <Route path="/"                   element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
