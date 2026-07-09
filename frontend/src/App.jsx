import React, { useState } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, UserCheck, Key, BookOpen, LogOut, Lock, Activity, CheckCircle, Database, AlertTriangle } from 'lucide-react';
import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

/* ═══════════════════════════════════════════
   Navigation Bar
   ═══════════════════════════════════════════ */
function Navigation({ user, logout }) {
  return (
    <header className="mx-6 mt-6 mb-2">
      <div className="neu-card flex items-center justify-between" style={{ padding: '0.75rem 1.5rem', borderRadius: '16px' }}>
        <div className="flex items-center space-x-3">
          <div className="neu-inset p-2 flex items-center justify-center" style={{ borderRadius: '12px' }}>
            <ShieldCheck className="h-6 w-6 text-indigo-500" />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-700">KYC Vault</span>
        </div>
        {user && (
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-sm font-semibold text-slate-700">{user.username}</span>
              <span className="text-xs text-slate-400 uppercase tracking-widest">{user.role}</span>
            </div>
            <button onClick={logout} className="neu-btn-sm text-rose-400 hover:text-rose-500">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════
   Auth Screen (Login / Register)
   ═══════════════════════════════════════════ */
const AuthScreen = ({ setAuth }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('CUSTOMER');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin ? { username, password } : { username, password, role };
      const res = await axios.post(`${API_URL}${endpoint}`, payload);
      setAuth(res.data.token, res.data.user);
      if (res.data.user.role === 'VERIFIER') navigate('/bank');
      else if (res.data.user.role === 'CUSTOMER') navigate('/customer');
      else navigate('/partner');
    } catch (err) {
      alert(err.response?.data?.error || 'Authentication failed.');
    }
  };

  return (
    <div className="flex justify-center items-center min-h-[78vh] px-4">
      <div className="neu-card w-full max-w-md animate-fade-up">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="neu-inset p-4 flex items-center justify-center" style={{ borderRadius: '50%' }}>
            <Lock className="w-7 h-7 text-indigo-500" />
          </div>
        </div>

        <h2 className="text-2xl font-bold text-center text-slate-700 mb-1">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>
        <p className="text-center text-sm text-slate-400 mb-8">
          {isLogin ? 'Sign in to the secure identity network.' : 'Register on the decentralized ledger.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Username</label>
            <input type="text" placeholder="e.g. bankA, john, bankB" value={username} onChange={e => setUsername(e.target.value)} required className="neu-input" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Password</label>
            <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required className="neu-input" />
          </div>

          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Account Role</label>
              <select value={role} onChange={e => setRole(e.target.value)} className="neu-select">
                <option value="CUSTOMER">Individual Customer</option>
                <option value="VERIFIER">Verifier Bank (Originator)</option>
                <option value="PARTNER">Relying Partner (NBFC / Bank)</option>
              </select>
            </div>
          )}

          <button type="submit" className="neu-btn mt-2">
            {isLogin ? 'Sign In' : 'Register Securely'}
          </button>
        </form>

        <div className="mt-8 pt-5 text-center" style={{ borderTop: '1px solid rgba(163,177,198,0.3)' }}>
          <span className="text-sm text-slate-400">
            {isLogin ? "Don't have an account? " : 'Already registered? '}
          </span>
          <button onClick={() => setIsLogin(!isLogin)} className="text-sm font-semibold text-indigo-500 hover:text-indigo-600 transition-colors">
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Bank Verifier Dashboard
   ═══════════════════════════════════════════ */
const BankDashboard = ({ token }) => {
  const [customerId, setCustomerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [govId, setGovId] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const handleMint = async () => {
    if (!customerId || !fullName) return alert('Please fill in Customer ID and Full Name.');
    setLoading(true);
    setStatusMsg('Encrypting PII → Google Cloud SQL  •  Minting proof → Ethereum Sepolia...');
    try {
      const res = await axios.post(`${API_URL}/kyc/verify`, {
        customerId,
        pii: { fullName, govId }
      }, { headers: { Authorization: `Bearer ${token}` } });
      setStatusMsg(`✓ Success — TxHash: ${res.data.txHash}`);
    } catch (err) {
      setStatusMsg(`✕ Error: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <BookOpen className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Bank Verifier Node</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Form */}
        <div className="md:col-span-2 neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-6 flex items-center pb-4" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <Activity className="w-5 h-5 mr-2 text-indigo-400" /> Submit KYC Application
          </h3>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Customer Public ID</label>
              <input type="text" placeholder="e.g. demo_user_1" value={customerId} onChange={e => setCustomerId(e.target.value)} className="neu-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
              <input type="text" placeholder="Alice Wonderland" value={fullName} onChange={e => setFullName(e.target.value)} className="neu-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Government ID (Aadhaar / SSN)</label>
              <input type="text" placeholder="XXXX-XXXX-XXXX" value={govId} onChange={e => setGovId(e.target.value)} className="neu-input" />
            </div>
            <div className="pt-2">
              <button onClick={handleMint} disabled={loading} className="neu-btn">
                {loading ? 'Processing Transaction...' : 'Encrypt & Mint On-Chain Proof'}
              </button>
            </div>
          </div>
        </div>

        {/* Status panel */}
        <div className="md:col-span-1 neu-card flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-600 mb-3">Ledger Status</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">Connected to the permissioned EVM. All PII is AES-256-GCM encrypted before storage on Google Cloud.</p>
            <div className="flex items-center text-emerald-500 text-sm font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-2 animate-pulse"></span> Network Active
            </div>
          </div>

          {statusMsg && (
            <div className="neu-inset mt-5 p-3 text-xs break-all text-slate-500 font-mono leading-relaxed">
              {statusMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Customer Identity Vault
   ═══════════════════════════════════════════ */
const CustomerPortal = ({ token }) => {
  const [partnerId, setPartnerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const handleGrant = async () => {
    if (!partnerId) return;
    setLoading(true);
    setStatusMsg('Writing consent to Ethereum Sepolia...');
    try {
      const res = await axios.post(`${API_URL}/consent/grant`, {
        partnerId
      }, { headers: { Authorization: `Bearer ${token}` } });
      setStatusMsg(`✓ Consent granted — TxHash: ${res.data.txHash}`);
    } catch (err) {
      setStatusMsg(`✕ Error: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <UserCheck className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Identity Vault</h2>
      </div>

      <div className="neu-card">
        <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
          <div>
            <h3 className="text-base font-semibold text-slate-600">Your KYC Status</h3>
            <p className="text-sm text-slate-400">Data secured by cryptographic proofs on the blockchain.</p>
          </div>
          <span className="neu-badge text-emerald-600 bg-emerald-50">
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> Verified
          </span>
        </div>

        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Grant Partner Access</h4>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input type="text" placeholder="Enter Partner Username (e.g. bankB)" value={partnerId} onChange={e => setPartnerId(e.target.value)} className="neu-input flex-1" />
          <button onClick={handleGrant} disabled={loading} className="neu-btn sm:w-auto w-full" style={{ width: 'auto', minWidth: '160px' }}>
            {loading ? 'Mining...' : 'Grant Access'}
          </button>
        </div>

        {statusMsg && (
          <div className="neu-inset p-3 text-sm break-all text-slate-500 font-mono">
            {statusMsg}
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Partner Console
   ═══════════════════════════════════════════ */
const PartnerConsole = ({ token }) => {
  const [searchId, setSearchId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleFetch = async () => {
    if (!searchId) return;
    setLoading(true);
    setResult(null);
    setErrorMsg('');
    try {
      const res = await axios.get(`${API_URL}/kyc/access/${searchId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setResult(res.data);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <Key className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Partner Console</h2>
      </div>

      <div className="neu-card">
        <h3 className="text-base font-semibold text-slate-600 mb-1">Query Shared Ledger</h3>
        <p className="text-sm text-slate-400 mb-6">The smart contract will reject requests without explicit customer consent.</p>

        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input type="text" placeholder="Customer Public ID (e.g. demo_user_1)" value={searchId} onChange={e => setSearchId(e.target.value)} className="neu-input flex-1" />
          <button onClick={handleFetch} disabled={loading} className="neu-btn sm:w-auto w-full" style={{ width: 'auto', minWidth: '160px' }}>
            {loading ? 'Verifying...' : 'Verify & Fetch'}
          </button>
        </div>

        {/* Results area */}
        <div className="neu-inset p-6 min-h-[160px] flex items-center justify-center">
          {errorMsg ? (
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-rose-500">{errorMsg}</p>
            </div>
          ) : result ? (
            <div className="text-left w-full space-y-2">
              <div className="flex items-center text-emerald-500 font-semibold text-sm mb-3">
                <CheckCircle className="w-4 h-4 mr-2" /> Smart Contract Verified
              </div>
              <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Full Name:</span> {result.pii.fullName}</p>
              <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Government ID:</span> {result.pii.govId}</p>
              <p className="text-xs text-slate-400 mt-4">Verified At: {result.verifiedAt}</p>
            </div>
          ) : (
            <div className="text-center">
              <Database className="w-8 h-8 text-slate-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-400">Awaiting cryptographic verification...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Root App
   ═══════════════════════════════════════════ */
function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));

  const setAuth = (newToken, newUser) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#e0e5ec' }}>
      <Navigation user={user} logout={logout} />
      <main className="flex-1 w-full py-4">
        <Routes>
          <Route path="/" element={!token ? <AuthScreen setAuth={setAuth} /> : <Navigate to={user.role === 'VERIFIER' ? '/bank' : user.role === 'CUSTOMER' ? '/customer' : '/partner'} />} />
          <Route path="/bank" element={token && user.role === 'VERIFIER' ? <BankDashboard token={token} /> : <Navigate to="/" />} />
          <Route path="/customer" element={token && user.role === 'CUSTOMER' ? <CustomerPortal token={token} /> : <Navigate to="/" />} />
          <Route path="/partner" element={token && user.role === 'PARTNER' ? <PartnerConsole token={token} /> : <Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
