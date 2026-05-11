import React from 'react';
import { useForm } from 'react-hook-form';

export default function ProductForm({ defaultValues = {}, onSubmit, submitLabel = 'Enregistrer' }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues });

  return (
    <form onSubmit={handleSubmit(onSubmit)} style={{ maxWidth: 520 }}>
      <Field label="Nom du produit *" error={errors.name?.message}>
        <input
          {...register('name', { required: 'Nom requis' })}
          style={input}
          placeholder="Ex: T-shirt premium"
        />
      </Field>

      <Field label="Description" error={null}>
        <textarea
          {...register('description')}
          rows={3}
          style={{ ...input, resize: 'vertical' }}
          placeholder="Décrivez votre produit…"
        />
      </Field>

      <Field label="Prix (€) *" error={errors.price?.message}>
        <input
          {...register('price', {
            required: 'Prix requis',
            min: { value: 0.01, message: 'Prix doit être supérieur à 0' },
            valueAsNumber: true,
          })}
          type="number"
          step="0.01"
          min="0.01"
          style={input}
          placeholder="9.99"
        />
      </Field>

      <Field label="URL image" error={null}>
        <input
          {...register('image_url')}
          style={input}
          placeholder="https://exemple.com/image.jpg"
        />
      </Field>

      <Field label="Catégorie" error={null}>
        <input
          {...register('category')}
          style={input}
          placeholder="Ex: Vêtements, Électronique…"
        />
      </Field>

      <Field label="Stock *" error={errors.stock?.message}>
        <input
          {...register('stock', {
            required: 'Stock requis',
            min: { value: 0, message: 'Stock ne peut pas être négatif' },
            valueAsNumber: true,
          })}
          type="number"
          min="0"
          style={input}
          placeholder="10"
        />
      </Field>

      <button
        type="submit"
        disabled={isSubmitting}
        style={{ ...btn, opacity: isSubmitting ? 0.6 : 1 }}
      >
        {isSubmitting ? 'Enregistrement…' : submitLabel}
      </button>
    </form>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#4a5568' }}>{label}</label>
      {children}
      {error && <div style={{ color: '#e53935', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

const input = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1.5px solid #e2e8f0',
  fontSize: 14,
  outline: 'none',
  transition: 'border-color .15s',
  background: '#fff',
};

const btn = {
  padding: '10px 24px',
  borderRadius: 8,
  border: 'none',
  background: '#2481cc',
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
  marginTop: 8,
};
