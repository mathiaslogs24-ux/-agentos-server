import React from 'react';
import { useNavigate } from 'react-router-dom';

const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="200"%3E%3Crect width="200" height="200" fill="%23eee"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23999" font-size="14"%3EImage%3C/text%3E%3C/svg%3E';

export default function ProductCard({ product }) {
  const navigate = useNavigate();
  const price = parseFloat(product.price).toFixed(2);

  return (
    <div
      onClick={() => navigate(`/product/${product.id}`)}
      style={{
        cursor: 'pointer',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--tg-secondary-bg-color, #f5f5f5)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        transition: 'transform .15s',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
      onMouseUp={e   => e.currentTarget.style.transform = 'scale(1)'}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.97)'}
      onTouchEnd={e   => e.currentTarget.style.transform = 'scale(1)'}
    >
      <img
        src={product.image_url || PLACEHOLDER}
        alt={product.name}
        loading="lazy"
        onError={e => { e.target.src = PLACEHOLDER; }}
        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }}
      />
      <div style={{ padding: '10px 12px 12px' }}>
        {product.category && (
          <span style={{
            fontSize: 11, fontWeight: 600, letterSpacing: .5,
            color: 'var(--tg-button-color, #2481cc)',
            textTransform: 'uppercase',
          }}>
            {product.category}
          </span>
        )}
        <div style={{ fontWeight: 600, marginTop: 2, fontSize: 14, lineHeight: 1.3 }}>
          {product.name}
        </div>
        <div style={{ marginTop: 4, fontWeight: 700, color: 'var(--tg-button-color, #2481cc)' }}>
          {price} €
        </div>
      </div>
    </div>
  );
}
