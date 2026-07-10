import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, UserCheck, Key, BookOpen, LogOut, Lock, Activity, CheckCircle, Database, AlertTriangle, Upload, QrCode, Trash2, Clock, FileText, ScanLine } from 'lucide-react';
import axios from 'axios';

const API_URL = 'https://idbi-kyc-backend-759039332755.us-central1.run.app/api'; // Production Cloud Run URL

/* ═══════════════════════════════════════════
   Navigation Bar
   ═══════════════════════════════════════════ */
function Navigation({ user, logout }) {
  return (
    <header className="mx-6 mt-6 mb-2">
      <div className="neu-card flex items-center justify-between" style={{ padding: '0.75rem 1.5rem', borderRadius: '16px' }}>
        <div className="flex items-center space-x-3">
          <div className="neu-inset flex items-center justify-center overflow-hidden" style={{ borderRadius: '12px', width: '54px', height: '54px' }}>
            <img src="/logo.svg" alt="KYC Vault Logo" className="w-full h-full object-contain scale-[1.25]" />
          </div>
          <span className="font-bold text-xl tracking-tight text-slate-700 ml-1">KYC Vault</span>
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
    <div className="relative flex justify-center items-center min-h-[78vh] px-4 overflow-hidden">
      {/* ── Login Card ── */}
      <div className="neu-card w-full max-w-md animate-fade-up relative z-10 bg-[#e0e5ec]/90 backdrop-blur-md">
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
          <span className="text-sm text-slate-400">{isLogin ? "Don't have an account? " : 'Already registered? '}</span>
          <button onClick={() => setIsLogin(!isLogin)} className="text-sm font-semibold text-indigo-500 hover:text-indigo-600 transition-colors">
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Bank Verifier Dashboard (with OCR)
   ═══════════════════════════════════════════ */
const BankDashboard = ({ token }) => {
  const [customerId, setCustomerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [govId, setGovId] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [ocrRawText, setOcrRawText] = useState('');
  const [fileName, setFileName] = useState('');

  const handleOCR = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setOcrLoading(true);
    setStatusMsg('Scanning document with Google Cloud Vision AI...');
    try {
      const formData = new FormData();
      formData.append('document', file);
      const res = await axios.post(`${API_URL}/ocr/extract`, formData, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.extracted.fullName) setFullName(res.data.extracted.fullName);
      if (res.data.extracted.govId) setGovId(res.data.extracted.govId);
      setOcrRawText(res.data.rawText);
      setStatusMsg(`✓ OCR complete — extracted ${res.data.extracted.fullName ? 'name' : ''}${res.data.extracted.govId ? ', ID' : ''} from document.`);
    } catch (err) {
      setStatusMsg(`✕ OCR Error: ${err.response?.data?.error || err.message}`);
    }
    setOcrLoading(false);
  };

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
    <div className="max-w-5xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <BookOpen className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Bank Verifier Node</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* ── OCR Upload Card ── */}
        <div className="md:col-span-3 neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-4 flex items-center pb-3" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <Upload className="w-5 h-5 mr-2 text-indigo-400" /> Document OCR — Auto-Extract PII
          </h3>
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <label className="neu-inset flex-1 w-full p-6 flex flex-col items-center justify-center cursor-pointer hover:opacity-80 transition-opacity" style={{ borderRadius: '16px', minHeight: '100px' }}>
              <FileText className="w-8 h-8 text-slate-400 mb-2" />
              <span className="text-sm font-medium text-slate-500">{fileName || 'Click to upload Aadhaar / PAN image'}</span>
              <span className="text-xs text-slate-400 mt-1">JPG, PNG, or PDF</span>
              <input type="file" accept="image/*,.pdf" onChange={handleOCR} className="hidden" />
            </label>
            {ocrLoading && (
              <div className="flex items-center text-indigo-500 text-sm font-medium">
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2"></div>
                Scanning...
              </div>
            )}
          </div>
          {ocrRawText && (
            <details className="mt-4">
              <summary className="text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-500">View Raw OCR Output</summary>
              <div className="neu-inset mt-2 p-3 text-xs text-slate-500 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{ocrRawText}</div>
            </details>
          )}
        </div>

        {/* ── KYC Form ── */}
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
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Full Name {fullName && <span className="text-emerald-500 normal-case">(auto-filled by OCR)</span>}</label>
              <input type="text" placeholder="Alice Wonderland" value={fullName} onChange={e => setFullName(e.target.value)} className="neu-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Government ID {govId && <span className="text-emerald-500 normal-case">(auto-filled by OCR)</span>}</label>
              <input type="text" placeholder="XXXX-XXXX-XXXX" value={govId} onChange={e => setGovId(e.target.value)} className="neu-input" />
            </div>
            <div className="pt-2">
              <button onClick={handleMint} disabled={loading} className="neu-btn">
                {loading ? 'Processing Transaction...' : 'Encrypt & Mint On-Chain Proof'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Status Panel ── */}
        <div className="md:col-span-1 neu-card flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-600 mb-3">Ledger Status</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">All PII is AES-256-GCM encrypted before storage on Google Cloud SQL.</p>
            <div className="flex items-center text-emerald-500 text-sm font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-2 animate-pulse"></span> Sepolia Active
            </div>
          </div>
          {statusMsg && (
            <div className="neu-inset mt-5 p-3 text-xs break-all text-slate-500 font-mono leading-relaxed">{statusMsg}</div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Customer Portal (QR Code + Forget + Audit)
   ═══════════════════════════════════════════ */
const CustomerPortal = ({ token, user, logout }) => {
  const [partnerId, setPartnerId] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [disclosureType, setDisclosureType] = useState('FULL');
  const [auditTrail, setAuditTrail] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [forgetLoading, setForgetLoading] = useState(false);
  const [expiresAt, setExpiresAt] = useState(null);
  const navigate = useNavigate();

  const handleGrant = async () => {
    if (!partnerId) return;
    setLoading(true);
    setStatusMsg('Writing consent to Ethereum Sepolia...');
    try {
      const res = await axios.post(`${API_URL}/consent/grant`, { partnerId }, { headers: { Authorization: `Bearer ${token}` } });
      setStatusMsg(`✓ Consent granted — TxHash: ${res.data.txHash}`);
      fetchAudit(); // refresh trail
    } catch (err) {
      setStatusMsg(`✕ Error: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  const handleRevoke = async () => {
    if (!partnerId) return;
    setLoading(true);
    setStatusMsg('Revoking consent on Ethereum Sepolia...');
    try {
      const res = await axios.post(`${API_URL}/consent/revoke`, { partnerId }, { headers: { Authorization: `Bearer ${token}` } });
      setStatusMsg(`✓ Consent revoked — TxHash: ${res.data.txHash}`);
      fetchAudit(); // refresh trail
    } catch (err) {
      setStatusMsg(`✕ Error: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  const handleGenerateOTP = async () => {
    setOtpLoading(true);
    try {
      const res = await axios.post(`${API_URL}/otp/generate`, { disclosureType }, { headers: { Authorization: `Bearer ${token}` } });
      setOtp(res.data.otp);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
    setOtpLoading(false);
  };

  const fetchAudit = async () => {
    setAuditLoading(true);
    try {
      const res = await axios.get(`${API_URL}/audit/${user.bankId}`, { headers: { Authorization: `Bearer ${token}` } });
      setAuditTrail(res.data.auditTrail || []);
      setExpiresAt(res.data.expiresAt || null);
    } catch { /* ignore if no data yet */ }
    setAuditLoading(false);
  };

  const handleSetExpiry = async (minutes) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/kyc/set-expiry`, { minutes }, { headers: { Authorization: `Bearer ${token}` } });
      alert(minutes ? `Self-destruct timer set for ${minutes} minutes.` : 'Timer cancelled.');
      fetchAudit(); // Re-fetch to get new expiresAt
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const handleForget = async () => {
    if (!window.confirm('⚠️ This will PERMANENTLY delete all your PII from Google Cloud SQL. The on-chain hash will become an orphan. This action is irreversible.\n\nAre you sure?')) return;
    setForgetLoading(true);
    try {
      const res = await axios.delete(`${API_URL}/kyc/forget`, { headers: { Authorization: `Bearer ${token}` } });
      alert(`✓ ${res.data.message}`);
      logout();
      navigate('/');
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
    setForgetLoading(false);
  };

  useEffect(() => { fetchAudit(); }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <UserCheck className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Identity Vault</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* ── Consent Management ── */}
        <div className="md:col-span-2 neu-card">
          <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <div>
              <h3 className="text-base font-semibold text-slate-600">Consent Management</h3>
              <p className="text-sm text-slate-400">Grant or revoke partner access on-chain.</p>
            </div>
            <span className="neu-badge text-emerald-600 bg-emerald-50">
              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Verified
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input type="text" placeholder="Partner Username (e.g. bankB)" value={partnerId} onChange={e => setPartnerId(e.target.value)} className="neu-input flex-1" />
            <button onClick={handleGrant} disabled={loading} className="neu-btn" style={{ width: 'auto', minWidth: '140px' }}>
              {loading ? 'Mining...' : 'Grant Access'}
            </button>
            <button onClick={handleRevoke} disabled={loading} className="neu-btn text-rose-500 border-rose-500 hover:bg-rose-50" style={{ width: 'auto', minWidth: '140px' }}>
              {loading ? 'Mining...' : 'Revoke Access'}
            </button>
          </div>
          {statusMsg && <div className="neu-inset p-3 text-sm break-all text-slate-500 font-mono">{statusMsg}</div>}
        </div>

        {/* ── OTP Sharing Card ── */}
        <div className="md:col-span-1 neu-card flex flex-col items-center">
          <h3 className="text-base font-semibold text-slate-600 mb-2 flex items-center">
            <ScanLine className="w-5 h-5 mr-2 text-indigo-400" /> Selective OTP Share
          </h3>
          <p className="text-xs text-slate-400 text-center mb-4">Generate a 6-digit OTP (expires in 5 min) for instant partner verification.</p>
          
          <select value={disclosureType} onChange={e => setDisclosureType(e.target.value)} className="neu-input text-xs w-full mb-4">
            <option value="FULL">Full Identity (Name & ID)</option>
            <option value="NAME_ONLY">Name Only (Hide ID)</option>
            <option value="PROOF_OF_EXISTENCE">Zero-Knowledge (Just prove I exist)</option>
          </select>

          {otp ? (
            <div className="neu-inset w-full p-4 mb-4 flex flex-col items-center justify-center text-center" style={{ borderRadius: '16px' }}>
              <span className="text-3xl font-black tracking-[0.2em] text-indigo-500 mb-1">{otp}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Valid for 5 minutes</span>
            </div>
          ) : null}
          <button onClick={handleGenerateOTP} disabled={otpLoading} className="neu-btn text-sm mt-auto">
            {otpLoading ? 'Generating...' : otp ? 'Regenerate OTP' : 'Generate 6-Digit OTP'}
          </button>
        </div>

        {/* ── Audit Trail ── */}
        <div className="md:col-span-2 neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-4 flex items-center pb-3" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <Clock className="w-5 h-5 mr-2 text-indigo-400" /> Consent Audit Trail
          </h3>
          {auditLoading ? (
            <p className="text-sm text-slate-400">Loading audit trail...</p>
          ) : auditTrail.length === 0 ? (
            <div className="neu-inset p-6 text-center">
              <Clock className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No events yet. Your KYC activity will appear here.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {auditTrail.map((event, i) => (
                <div key={i} className="neu-inset p-4 flex items-start space-x-3" style={{ borderRadius: '14px' }}>
                  <span className="text-xl mt-0.5">{event.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700">{event.title}</p>
                    <p className="text-xs text-slate-400 mt-1">{event.description}</p>
                    <p className="text-xs text-slate-400 mt-1 font-mono">{new Date(event.timestamp).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right to be Forgotten ── */}
        <div className="md:col-span-1 neu-card flex flex-col">
          <h3 className="text-base font-semibold text-slate-600 mb-2 flex items-center">
            <Trash2 className="w-5 h-5 mr-2 text-rose-400" /> DPDP Compliance
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Under the Digital Personal Data Protection Act (Section 12), you have the <strong className="text-slate-600">Right to be Forgotten</strong>.
            This permanently deletes all your encrypted PII from Google Cloud SQL. The on-chain hash becomes cryptographically orphaned.
          </p>
          
          {/* Self-Destruct Timers */}
          <div className="mb-4">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Self-Destruct Timer</h4>
            {expiresAt ? (
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-md mb-2">
                <p className="text-sm font-bold text-rose-600">Active: Deletes at {new Date(expiresAt).toLocaleTimeString()}</p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <button onClick={() => handleSetExpiry(1)} className="neu-btn text-xs text-rose-500 border-rose-500 flex-1">1 Min</button>
              <button onClick={() => handleSetExpiry(60)} className="neu-btn text-xs text-rose-500 border-rose-500 flex-1">1 Hr</button>
              {expiresAt && <button onClick={() => handleSetExpiry(0)} className="neu-btn text-xs flex-1">Cancel</button>}
            </div>
          </div>

          <div className="mt-auto">
            <button onClick={handleForget} disabled={forgetLoading} className="neu-btn text-rose-500 text-sm">
              {forgetLoading ? 'Deleting...' : '🗑 Delete All My Data Now'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   Partner Console (+ QR Scan)
   ═══════════════════════════════════════════ */
const PartnerConsole = ({ token }) => {
  const [searchId, setSearchId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [qrToken, setQrToken] = useState(''); // Keep as qrToken internally, but use it for customerId in OTP
  const [otpVal, setOtpVal] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrResult, setQrResult] = useState(null);

  const handleFetch = async () => {
    if (!searchId) return;
    setLoading(true);
    setResult(null);
    setErrorMsg('');
    try {
      const res = await axios.get(`${API_URL}/kyc/access/${searchId}`, { headers: { Authorization: `Bearer ${token}` } });
      setResult(res.data);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const handleOTPVerify = async () => {
    if (!qrToken || !otpVal) return;
    setQrLoading(true);
    setQrResult(null);
    try {
      const res = await axios.post(`${API_URL}/otp/verify`, { customerId: qrToken, otp: otpVal }, { headers: { Authorization: `Bearer ${token}` } });
      setQrResult(res.data);
    } catch (err) {
      setQrResult({ error: err.response?.data?.error || err.message });
    }
    setQrLoading(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <Key className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Partner Console</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ── Consent-Based Query ── */}
        <div className="neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-1 flex items-center">
            <Database className="w-5 h-5 mr-2 text-indigo-400" /> Query via Consent
          </h3>
          <p className="text-sm text-slate-400 mb-5">Requires active on-chain consent from the customer.</p>
          <div className="flex flex-col gap-3 mb-5">
            <input type="text" placeholder="Customer Public ID" value={searchId} onChange={e => setSearchId(e.target.value)} className="neu-input" />
            <button onClick={handleFetch} disabled={loading} className="neu-btn">
              {loading ? 'Verifying...' : 'Verify & Fetch'}
            </button>
          </div>
          <div className="neu-inset p-5 min-h-[140px] flex items-center justify-center" style={{ borderRadius: '14px' }}>
            {errorMsg ? (
              <div className="text-center">
                <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-rose-500">{errorMsg}</p>
              </div>
            ) : result ? (
              <div className="text-left w-full space-y-2">
                <div className="flex items-center text-emerald-500 font-semibold text-sm mb-2">
                  <CheckCircle className="w-4 h-4 mr-2" /> Smart Contract Verified
                </div>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Name:</span> {result.pii.fullName}</p>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Gov ID:</span> {result.pii.govId}</p>
                <p className="text-xs text-slate-400 mt-3">Verified At: {result.verifiedAt}</p>
              </div>
            ) : (
              <div className="text-center">
                <Database className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Awaiting verification...</p>
              </div>
            )}
          </div>
        </div>

        {/* ── OTP Verification ── */}
        <div className="neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-1 flex items-center">
            <ScanLine className="w-5 h-5 mr-2 text-indigo-400" /> Verify via OTP
          </h3>
          <p className="text-sm text-slate-400 mb-5">Enter the customer's ID and 6-digit OTP for instant, temporary access.</p>
          <div className="flex flex-col gap-3 mb-5">
            <input type="text" placeholder="Customer Public ID" value={qrToken} onChange={e => setQrToken(e.target.value)} className="neu-input" />
            <input type="text" placeholder="6-Digit OTP" value={otpVal} onChange={e => setOtpVal(e.target.value)} maxLength={6} className="neu-input font-mono tracking-widest" />
            <button onClick={handleOTPVerify} disabled={qrLoading} className="neu-btn">
              {qrLoading ? 'Verifying OTP...' : 'Verify OTP'}
            </button>
          </div>
          <div className="neu-inset p-5 min-h-[140px] flex items-center justify-center" style={{ borderRadius: '14px' }}>
            {qrResult?.error ? (
              <div className="text-center">
                <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-rose-500">{qrResult.error}</p>
              </div>
            ) : qrResult?.success ? (
              <div className="text-left w-full space-y-2">
                <div className="flex items-center text-emerald-500 font-semibold text-sm mb-2">
                  <CheckCircle className="w-4 h-4 mr-2" /> OTP Verified
                </div>
                {qrResult.pii.status && (
                  <p className="text-sm text-indigo-600 font-bold mb-2 p-2 bg-indigo-50 rounded-md border border-indigo-100">{qrResult.pii.status}</p>
                )}
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Name:</span> {qrResult.pii.fullName}</p>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Gov ID:</span> {qrResult.pii.govId}</p>
                <p className="text-xs text-slate-400 mt-3">Verified via: {qrResult.verifiedVia}</p>
              </div>
            ) : (
              <div className="text-center">
                <ScanLine className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Enter OTP above...</p>
              </div>
            )}
          </div>
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
          <Route path="/customer" element={token && user.role === 'CUSTOMER' ? <CustomerPortal token={token} user={user} logout={logout} /> : <Navigate to="/" />} />
          <Route path="/partner" element={token && user.role === 'PARTNER' ? <PartnerConsole token={token} /> : <Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
