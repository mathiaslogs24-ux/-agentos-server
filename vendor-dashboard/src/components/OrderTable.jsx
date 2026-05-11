import React, { useState } from 'react';

const STATUS_COLORS = { paid: '#4ade80', pending: '#fbbf24', failed: '#f87171' };

export default function OrderTable({ orders }) {
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  function toggleSort(key) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const sorted = [...orders].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (sortKey === 'amount') { av = parseFloat(av); bv = parseFloat(bv); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  if (!orders.length) {
    return <div style={{ color: '#8899b0', padding: 16 }}>Aucune commande</div>;
  }

  const Th = ({ k, label }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
    >
      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f5f7fa' }}>
            <Th k="created_at" label="Date" />
            <Th k="product_id" label="Produit" />
            <Th k="buyer_name" label="Acheteur" />
            <Th k="amount"     label="Montant" />
            <th style={th}>Statut</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o, i) => (
            <tr key={o.id || i} style={{ borderBottom: '1px solid #f0f2f5' }}>
              <td style={td}>{formatDate(o.created_at)}</td>
              <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product_id}</td>
              <td style={td}>{o.buyer_name || '—'}</td>
              <td style={{ ...td, fontWeight: 700 }}>{parseFloat(o.amount || 0).toFixed(2)} €</td>
              <td style={td}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  background: STATUS_COLORS[o.status] || '#e5e7eb',
                  color: '#fff',
                }}>
                  {o.status || 'paid'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const th = { padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#4a5568', fontSize: 13 };
const td = { padding: '10px 12px', color: '#1a1a2e' };
