import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken, decodeToken, getToken } from '../lib/auth.js';

export default function Layout() {
  const navigate = useNavigate();
  const vendor   = decodeToken(getToken() || '') || {};

  function logout() {
    clearToken();
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar */}
      <nav style={sidebar}>
        <div style={{ padding: '24px 20px 12px' }}>
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>🛍 Marketplace</div>
          <div style={{ fontSize: 13, color: '#8899b0' }}>{vendor.name || 'Vendeur'}</div>
        </div>
        <div style={{ flex: 1, padding: '8px 12px' }}>
          <NavItem to="/dashboard" label="📊 Dashboard" />
          <NavItem to="/products"  label="📦 Produits" />
          <NavItem to="/orders"    label="🧾 Commandes" />
        </div>
        <div style={{ padding: '12px 20px 24px' }}>
          <button onClick={logout} style={logoutBtn}>Déconnexion</button>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, padding: 32, overflowY: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'block',
        padding: '10px 12px',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 14,
        textDecoration: 'none',
        color: isActive ? '#fff' : '#ccd6e8',
        background: isActive ? '#2481cc' : 'transparent',
        marginBottom: 2,
      })}
    >
      {label}
    </NavLink>
  );
}

const sidebar = {
  width: 220,
  background: '#0d1220',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
};

const logoutBtn = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'rgba(255,255,255,0.08)',
  color: '#ccd6e8',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'left',
};
