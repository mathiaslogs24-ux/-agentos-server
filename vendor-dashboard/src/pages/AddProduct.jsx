import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createProduct } from '../lib/api.js';
import ProductForm from '../components/ProductForm.jsx';

export default function AddProduct() {
  const navigate = useNavigate();
  const [error,  setError]  = useState('');

  async function onSubmit(data) {
    setError('');
    try {
      await createProduct({ ...data, price: String(data.price), stock: String(data.stock) });
      navigate('/products');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link to="/products" style={{ color: '#8899b0', fontSize: 13, textDecoration: 'none' }}>← Retour aux produits</Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Nouveau produit</h1>
      <p style={{ color: '#8899b0', fontSize: 13, marginBottom: 24 }}>
        Le produit sera visible après validation par l'administrateur.
      </p>
      {error && <div style={errBox}>{error}</div>}
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <ProductForm onSubmit={onSubmit} submitLabel="Créer le produit" />
      </div>
    </div>
  );
}

const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#e53935', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 20 };
