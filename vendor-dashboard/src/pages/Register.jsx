import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { register as apiRegister } from '../lib/api.js';

export default function Register() {
  const navigate      = useNavigate();
  const [params]      = useSearchParams();
  const [apiError, setApiError] = useState('');

  // Pre-fill name and telegram_id from bot's /become_vendor link
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      name:        params.get('name')        || '',
      telegram_id: params.get('telegram_id') || '',
    },
  });

  async function onSubmit({ name, email, password, telegram_id }) {
    setApiError('');
    try {
      await apiRegister(name, email, password, telegram_id || undefined);
      navigate('/dashboard');
    } catch (e) {
      setApiError(e.message);
    }
  }

  return (
    <div style={page}>
      <div style={card}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Devenir vendeur</h1>
        <p style={{ color: '#8899b0', fontSize: 14, marginBottom: 24 }}>Créez votre compte vendeur</p>

        <form onSubmit={handleSubmit(onSubmit)}>
          <Field label="Nom *" error={errors.name?.message}>
            <input {...register('name', { required: 'Nom requis' })} style={input} placeholder="Votre nom ou marque" />
          </Field>
          <Field label="Email *" error={errors.email?.message}>
            <input
              {...register('email', { required: 'Email requis', pattern: { value: /\S+@\S+/, message: 'Email invalide' } })}
              type="email"
              style={input}
              placeholder="vous@exemple.com"
            />
          </Field>
          <Field label="Mot de passe *" error={errors.password?.message}>
            <input
              {...register('password', { required: 'Mot de passe requis', minLength: { value: 6, message: '6 caractères minimum' } })}
              type="password"
              style={input}
              placeholder="6 caractères minimum"
            />
          </Field>
          <Field label="Telegram ID (optionnel)" error={null}>
            <input {...register('telegram_id')} style={input} placeholder="Votre ID Telegram numérique" />
          </Field>

          {apiError && <div style={errBox}>{apiError}</div>}

          <button type="submit" disabled={isSubmitting} style={{ ...btn, opacity: isSubmitting ? 0.6 : 1 }}>
            {isSubmitting ? 'Création…' : 'Créer mon compte'}
          </button>
        </form>

        <p style={{ marginTop: 20, fontSize: 13, color: '#8899b0', textAlign: 'center' }}>
          Déjà un compte ?{' '}
          <Link to="/login" style={{ color: '#2481cc', fontWeight: 600 }}>Se connecter</Link>
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
const card  = { background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' };
const input = { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 14, outline: 'none', background: '#fff' };
const btn   = { width: '100%', padding: '11px', borderRadius: 8, border: 'none', background: '#2481cc', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 8 };
const errBox = { background: '#fef2f2', border: '1px solid #fecaca', color: '#e53935', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 12 };
