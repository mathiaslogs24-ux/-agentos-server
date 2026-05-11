import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { login } from '../lib/api.js';

export default function Login() {
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm();
  const [apiError, setApiError] = useState('');

  async function onSubmit({ email, password }) {
    setApiError('');
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (e) {
      setApiError(e.message);
    }
  }

  return (
    <div style={page}>
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>🛍 Espace vendeur</h1>
        <p style={{ color: '#8899b0', fontSize: 14, marginBottom: 24 }}>Connectez-vous à votre compte</p>

        <form onSubmit={handleSubmit(onSubmit)}>
          <Field label="Email" error={errors.email?.message}>
            <input
              {...register('email', { required: 'Email requis', pattern: { value: /\S+@\S+/, message: 'Email invalide' } })}
              type="email"
              style={input}
              placeholder="vous@exemple.com"
            />
          </Field>
          <Field label="Mot de passe" error={errors.password?.message}>
            <input
              {...register('password', { required: 'Mot de passe requis' })}
              type="password"
              style={input}
              placeholder="••••••••"
            />
          </Field>

          {apiError && <div style={errBox}>{apiError}</div>}

          <button type="submit" disabled={isSubmitting} style={{ ...btn, opacity: isSubmitting ? 0.6 : 1 }}>
            {isSubmitting ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 13, color: '#8899b0', textAlign: 'center' }}>
          Pas encore vendeur ?{' '}
          <Link to="/register" style={{ color: '#2481cc', fontWeight: 600 }}>S'inscrire</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#4a5568' }}>{label}</label>
      {children}
      {error && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

const page  = { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: 24, background: '#f5f7fa' };
const card  = { background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' };
const input = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', background: '#fff' };
const btn   = { width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: '#2481cc', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 8 };
const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#e53935', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 };
