import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getMyProducts, updateProduct } from '../lib/api.js';
import ProductForm from '../components/ProductForm.jsx';

export default function EditProduct() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [product, setProduct] = useState(null);
  const [error,   setError]   = useState('');

  useEffect(() => {
    getMyProducts()
      .then(products => {
        const found = products.find(p => p.id === id);
        if (!found) navigate('/products');
        else setProduct(found);
      })
      .catch(() => navigate('/products'));
  }, [id]);

  async function onSubmit(data) {
    setError('');
    try {
      await updateProduct(id, { ...data, price: String(data.price), stock: String(data.stock) });
      navigate('/products');
    } catch (e) {
      setError(e.message);
    }
  }

  if (!product) return <div style={{ color: '#8899b0', padding: 24 }}>Chargement…</div>;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <Link to="/products" style={{ color: '#8899b0', fontSize: 13, textDecoration: 'none' }}>← Retour aux produits</Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Modifier le produit</h1>
      <p style={{ color: '#8899b0', fontSize: 13, marginBottom: 24 }}>
        Modifier le nom ou le prix soumettra le produit à une nouvelle validation.
      </p>
      {error && <div style={errBox}>{error}</div>}
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <ProductForm
          defaultValues={{
            name:        product.name,
            description: product.description,
            price:       parseFloat(product.price),
            image_url:   product.image_url,
            category:    product.category,
            stock:       parseInt(product.stock, 10),
          }}
          onSubmit={onSubmit}
          submitLabel="Enregistrer les modifications"
        />
      </div>
    </div>
  );
}

const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#e53935', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 20 };
