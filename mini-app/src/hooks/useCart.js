import { create } from 'zustand';

export const useCart = create((set, get) => ({
  items: [],

  add(product) {
    set(state => {
      const existing = state.items.find(i => i.product_id === product.id);
      if (existing) {
        return { items: state.items.map(i =>
          i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )};
      }
      return { items: [...state.items, {
        product_id: product.id,
        vendor_id:  product.vendor_id,
        name:       product.name,
        price:      product.price,
        image_url:  product.image_url,
        quantity:   1,
      }]};
    });
  },

  remove(productId) {
    set(state => ({ items: state.items.filter(i => i.product_id !== productId) }));
  },

  update(productId, qty) {
    const q = parseInt(qty, 10);
    if (q <= 0) {
      set(state => ({ items: state.items.filter(i => i.product_id !== productId) }));
    } else {
      set(state => ({ items: state.items.map(i =>
        i.product_id === productId ? { ...i, quantity: q } : i
      )}));
    }
  },

  clear() {
    set({ items: [] });
  },
}));

// Derived selectors
export const useCartTotal  = () => useCart(s => s.items.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0));
export const useCartCount  = () => useCart(s => s.items.reduce((sum, i) => sum + i.quantity, 0));
