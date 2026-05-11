import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartCount } from '../hooks/useCart.js';

export default function CartButton() {
  const navigate = useNavigate();
  const count    = useCartCount();

  if (count === 0) return null;

  return (
    <button
      onClick={() => navigate('/cart')}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 20,
        width: 56,
        height: 56,
        borderRadius: '50%',
        background: 'var(--tg-button-color, #2481cc)',
        color: 'var(--tg-button-text-color, #fff)',
        border: 'none',
        cursor: 'pointer',
        fontSize: 22,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      aria-label={`Panier (${count} articles)`}
    >
      🛒
      <span style={{
        position: 'absolute',
        top: 4,
        right: 4,
        background: '#e53935',
        color: '#fff',
        borderRadius: '50%',
        fontSize: 10,
        fontWeight: 700,
        width: 16,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {count > 9 ? '9+' : count}
      </span>
    </button>
  );
}
