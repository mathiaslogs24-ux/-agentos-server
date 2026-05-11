import React, { useEffect, useState } from 'react';
import { getProducts } from '../lib/api.js';
import { useTelegram } from '../hooks/useTelegram.js';
import ProductCard from '../components/ProductCard.jsx';
import CartButton  from '../components/CartButton.jsx';

export default function Catalogue() {
  const { hideMainButton, hideBackButton } = useTelegram();
  const [products,  setProducts]  = useState([]);
  const [category,  setCategory]  = useState('');
  const [categories, setCategories] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  useEffect(() => {
    hideMainButton();
    hideBackButton();
  }, []);

  useEffect(() => {
    setLoading(true);
    getProducts(category || undefined)
      .then(data => {
        setProducts(data);
        if (!categories.length) {
          const cats = [...new Set(data.map(p => p.category).filter(Boolean))];
          setCategories(cats);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [category]);

  if (loading) return <div style={centered}>Chargement…</div>;
  if (error)   return <div style={centered}>Erreur : {error}</div>;

  return (
    <div style={{ padding: '16px 16px 80px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Boutique</h1>

      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 16, paddingBottom: 4 }}>
          <Chip label="Tout" active={category === ''} onClick={() => setCategory('')} />
          {categories.map(c => (
            <Chip key={c} label={c} active={category === c} onClick={() => setCategory(c)} />
          ))}
        </div>
      )}

      {products.length === 0
        ? <div style={centered}>Aucun produit disponible</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {products.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )
      }
      <CartButton />
    </div>
  );
}

function Chip({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: '6px 14px',
        borderRadius: 20,
        border: 'none',
        cursor: 'pointer',
        fontWeight: 600,
        fontSize: 13,
        background: active ? 'var(--tg-button-color, #2481cc)' : 'var(--tg-secondary-bg-color, #eee)',
        color: active ? 'var(--tg-button-text-color, #fff)' : 'var(--tg-text-color, #000)',
      }}
    >
      {label}
    </button>
  );
}

const centered = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--tg-hint-color, #999)' };
