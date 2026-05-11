import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { getToken } from '../lib/auth.js';

export default function ProtectedRoute() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Outlet />;
}
