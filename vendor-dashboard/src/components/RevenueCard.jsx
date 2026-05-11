import React from 'react';

export default function RevenueCard({ label, amount, orderCount }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: '#8899b0', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#1a1a2e' }}>
        {parseFloat(amount || 0).toFixed(2)} €
      </div>
      <div style={{ fontSize: 13, color: '#8899b0', marginTop: 4 }}>
        {orderCount} commande{orderCount !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

const card = {
  background: '#fff',
  borderRadius: 12,
  padding: '20px 24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
  minWidth: 180,
};
