import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRevenue, getMyOrders } from '../lib/api.js';
import RevenueCard from '../components/RevenueCard.jsx';
import OrderTable  from '../components/OrderTable.jsx';

export default function Dashboard() {
  const [revenue, setRevenue] = useState(null);
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getRevenue(), getMyOrders()])
      .then(([rev, ords]) => {
        setRevenue(rev);
        setOrders(ords);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={hint}>Chargement…</div>;

  return (
    <div>
      <h1 style={pageTitle}>Dashboard</h1>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
        <RevenueCard
          label="Ce mois"
          amount={revenue?.month}
          orderCount={revenue?.monthOrderCount || 0}
        />
        <RevenueCard
          label="Total"
          amount={revenue?.total}
          orderCount={revenue?.orderCount || 0}
        />
      </div>

      <section style={section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={sectionTitle}>Dernières commandes</h2>
          <Link to="/orders" style={linkStyle}>Voir tout →</Link>
        </div>
        <OrderTable orders={orders.slice(0, 5)} />
      </section>

      <section style={{ ...section, marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={sectionTitle}>Produits</h2>
          <Link to="/products" style={linkStyle}>Gérer →</Link>
        </div>
        <Link to="/products/add" style={addBtn}>+ Ajouter un produit</Link>
      </section>
    </div>
  );
}

const pageTitle   = { fontSize: 24, fontWeight: 800, marginBottom: 24 };
const section     = { background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' };
const sectionTitle = { fontSize: 16, fontWeight: 700 };
const linkStyle   = { color: '#2481cc', fontWeight: 600, fontSize: 13, textDecoration: 'none' };
const hint        = { color: '#8899b0', padding: 32 };
const addBtn      = { display: 'inline-block', padding: '9px 18px', background: '#2481cc', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none' };
