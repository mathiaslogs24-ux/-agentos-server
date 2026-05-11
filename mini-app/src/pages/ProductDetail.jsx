import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getProduct } from '../lib/api.js';
import { useTelegram } from '../hooks/useTelegram.js';
import { useCart } from '../hooks/useCart.js';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400"%3E%3Crect width="400" height="400" fill="%23eee"/%3E%3C/svg%3E';

export default function ProductDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { setMainButton, hideMainButton, showBackButton, hideBackButton } = useTelegram();
  const add       = useCart(s => s.add);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qty,     setQty]     = useState(1);

  useEffect(() => {
    getProduct(id)
      .then(setProduct)
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!product) return;
    showBackButton(() => navigate('/'));
    setMainButton(`Ajouter au panier — ${(parseFloat(product.price) * qty).toFixed(2)} €`, () => {
      for (let i = 0; i < qty; i++) add(product);
      navigate('/cart');
    });
    return () => { hideMainButton(); hideBackButton(); };
  }, [product, qty]);

  if (loading || !product) return <div style={centered}>Chargement…</div>;

  const price = (parseFloat(product.price) * qty).toFixed(2);

  return (
    <div style={{ paddingBottom: 80 }}>
      <img
        src={product.image_url || PLACEHOLDER}
        alt={product.name}
        onError={e => { e.target.src = PLACEHOLDER; }}
        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
      />
      <div style={{ padding: '16px 16px 0' }}>
        {product.category && (
          <div style={{ fontSize: 12, color: 'var(--tg-hint-color, #999)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: .5, marginBottom: 6 }}>
            {product.category}
          </div>
        )}
        <h1 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>{product.name}</h1>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--tg-button-color, #2481cc)', marginTop: 8 }}>
          {parseFloat(product.price).toFixed(2)} €
        </div>
        {product.description && (
          <p style={{ marginTop: 12, lineHeight: 1.6, color: 'var(--tg-text-color, #000)', opacity: .8 }}>
            {product.description}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 20 }}>
          <span style={{ fontWeight: 600 }}>Quantité :</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <QtyBtn onClick={() => setQty(q => Math.max(1, q - 1))} label="−" />
            <span style={{ fontSize: 18, fontWeight: 700, minWidth: 24, textAlign: 'center' }}>{qty}</span>
            <QtyBtn onClick={() => setQty(q => Math.min(parseInt(product.stock || '99', 10), q + 1))} label="+" />
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--tg-hint-color, #999)' }}>
          Stock : {product.stock} disponible(s)
        </div>
      </div>
    </div>
  );
}

function QtyBtn({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'var(--tg-secondary-bg-color, #eee)', fontSize: 18, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {label}
    </button>
  );
}

const centered = { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', color: 'var(--tg-hint-color, #999)' };
