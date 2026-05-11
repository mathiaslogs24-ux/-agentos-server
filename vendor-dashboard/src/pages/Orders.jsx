import React, { useEffect, useState } from 'react';
import { getMyOrders } from '../lib/api.js';
import OrderTable from '../components/OrderTable.jsx';

export default function Orders() {
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');

  useEffect(() => {
    getMyOrders().then(setOrders).finally(() => setLoading(false));
  }, []);

  const filtered = orders.filter(o => {
    const d = new Date(o.created_at);
    if (from && d < new Date(from)) return false;
    if (to   && d > new Date(to + 'T23:59:59')) return false;
    return true;
  });

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 20 }}>Commandes</h1>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <label style={labelStyle}>Du :
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateInput} />
        </label>
        <label style={labelStyle}>Au :
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateInput} />
        </label>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); }} style={clearBtn}>
            Réinitialiser
          </button>
        )}
        <span style={{ marginLeft: 'auto', color: '#8899b0', fontSize: 13 }}>
          {filtered.length} commande{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading
        ? <div style={{ color: '#8899b0' }}>Chargement…</div>
        : (
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <OrderTable orders={filtered} />
          </div>
        )
      }
    </div>
  );
}

const labelStyle = { fontSize: 13, fontWeight: 600, color: '#4a5568', display: 'flex', alignItems: 'center', gap: 6 };
const dateInput  = { padding: '6px 10px', borderRadius: 7, border: '1.5px solid #e2e8f0', fontSize: 13 };
const clearBtn   = { padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', fontSize: 13, cursor: 'pointer', color: '#4a5568', fontWeight: 600 };
