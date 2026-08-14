import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { ROLE_HOME } from './lib/format';
import { Nav } from './components/Nav';
import { Auth } from './screens/Auth';
import { VerifierDashboard } from './screens/VerifierDashboard';
import { CustomerVault } from './screens/CustomerVault';
import { PartnerConsole } from './screens/PartnerConsole';

function RequireRole({ role, children }) {
  const { token, user } = useAuth();

  if (!token || !user) {
    return <Navigate to="/" replace />;
  }

  if (user.role !== role) {
    return <Navigate to={ROLE_HOME[user.role] || '/'} replace />;
  }

  return children;
}

function Shell() {
  const { token, user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-[color:var(--surface)] focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to content
      </a>
      <Nav user={user} onLogout={logout} />
      <main id="main" className="flex-1">
        <Routes>
          <Route
            path="/"
            element={
              token && user ? <Navigate to={ROLE_HOME[user.role] || '/'} replace /> : <Auth />
            }
          />
          <Route
            path="/bank"
            element={
              <RequireRole role="VERIFIER">
                <VerifierDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/customer"
            element={
              <RequireRole role="CUSTOMER">
                <CustomerVault />
              </RequireRole>
            }
          />
          <Route
            path="/partner"
            element={
              <RequireRole role="PARTNER">
                <PartnerConsole />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AuthProvider>
  );
}
