import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { TOKEN_KEY, USER_KEY } from '../lib/api';

const AuthContext = createContext(null);

function readStoredUser() {
  try {
    const raw = window.sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => readStoredUser());

  const logout = useCallback(() => {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const setAuth = useCallback((nextToken, nextUser) => {
    window.sessionStorage.setItem(TOKEN_KEY, nextToken);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  // The axios interceptor clears storage on a rejected token and fires this
  // event; without it React would keep rendering a logged-in shell around
  // requests that are all failing.
  useEffect(() => {
    const handleExpiry = () => {
      setToken(null);
      setUser(null);
    };

    window.addEventListener('kyc-vault:session-expired', handleExpiry);
    return () => window.removeEventListener('kyc-vault:session-expired', handleExpiry);
  }, []);

  // A token with no matching user record is unusable state.
  useEffect(() => {
    if (token && !user) {
      logout();
    }
  }, [token, user, logout]);

  const value = useMemo(() => ({ token, user, setAuth, logout }), [token, user, setAuth, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }

  return context;
}
