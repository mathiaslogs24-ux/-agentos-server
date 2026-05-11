import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getMyProducts, deleteProduct } from '../lib/api.js';

const STATUS = {
  approved: { label: 'Approuvé',  bg: '#dcfce7', color: '#16a34a' },
  pending:  { label: 'En attente', bg: '#fef9c3', color: '#ca8a04' },
  rejected: { label: 'Rejeté',    bg: '#fee2e2', color: '#dc2626' },
};

export default function Products() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [loading,  setLoading]  = useState(true);

  function load() {
    setLoading(true);
    getMyProducts().then(setProducts).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleDelete(id, name) {
    if (!confirm(`Supprimer "${name}" ?`)) return;
    await deleteProduct(id);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>Mes produits</h1>
        <Link to="/products/add" style={addBtn}>+ Ajouter</Link>
      </div>

      {loading && <div style={hint}>Chargement…</div>}

      {!loading && products.length === 0 && (
        <div style={emptyBox}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <div style={{ marginBottom: 16, color: '#8899b0' }}>Aucun produit pour l'instant</div>
          <Link to="/products/add" style={addBtn}>Créer mon premier produit</Link>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {products.map(p => {
          const s = STATUS[p.status] || STATUS.pending;
          return (
            <div key={p.id} style={card}>
              {p.image_url && (
                <img src={p.image_url} alt={p.name} style={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: '8px 8px 0 0' }} />
              )}
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>{p.name}</div>
                  <span style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, flexShrink: 0, marginLeft: 8 }}>
                    {s.label}
                  </span>
                </div>
                <div style={{ marginTop: 6, fontWeight: 700, color: '#2481cc' }}>{parseFloat(p.price).toFixed(2)} €</div>
                <div style={{ fontSize: 12, color: '#8899b0', marginTop: 2 }}>Stock : {p.stock}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={() => navigate(`/products/${p.id}/edit`)} style={editBtn}>Modifier</button>
                  <button onClick={() => handleDelete(p.id, p.name)} style={delBtn}>Supprimer</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const addBtn  = { padding: '9px 18px', background: '#2481cc', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, textDecoration: 'none', border: 'none', cursor: 'pointer', display: 'inline-block' };
const card    = { background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' };
const editBtn = { flex: 1, padding: '7px', borderRadius: 7, border: '1.5px solid #2481cc', background: 'transparent', color: '#2481cc', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const delBtn  = { flex: 1, padding: '7px', borderRadius: 7, border: '1.5px solid #e53935', background: 'transparent', color: '#e53935', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const hint    = { color: '#8899b0', padding: 16 };
const emptyBox = { textAlign: 'center', padding: '48px 24px', background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' };
