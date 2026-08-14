import axios from 'axios';

export const API_URL = (
  import.meta.env.VITE_API_URL || 'https://idbi-kyc-backend-759039332755.us-central1.run.app/api'
).replace(/\/$/, '');

export const EXPLORER_URL = (import.meta.env.VITE_EXPLORER_URL || 'https://sepolia.etherscan.io').replace(/\/$/, '');

export const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME || 'Sepolia Testnet';

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || '';

export const TOKEN_KEY = 'token';
export const USER_KEY = 'user';

export const api = axios.create({ baseURL: API_URL });

// The token lives in sessionStorage, so reading it per request keeps every call
// authenticated without threading the token through each component.
api.interceptors.request.use((config) => {
  const token = window.sessionStorage.getItem(TOKEN_KEY);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// A 401/403 means the JWT expired or was rejected. Clearing it here means an
// expired session lands on the login screen instead of failing silently on
// every subsequent request.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const isAuthRoute = error.config?.url?.includes('/auth/');

    if ((status === 401 || status === 403) && !isAuthRoute) {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(USER_KEY);
      window.dispatchEvent(new Event('kyc-vault:session-expired'));
    }

    return Promise.reject(error);
  }
);

// Every screen used to render `error.response?.data?.error || error.message`
// by hand; this keeps the fallback chain in one place.
export function errorMessage(error, fallback = 'Something went wrong.') {
  return error?.response?.data?.error || error?.message || fallback;
}
