import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  CheckCircle,
  Clock,
  Database,
  FileText,
  Key,
  Lock,
  LogOut,
  ScanLine,
  Trash2,
  Upload,
  UserCheck
} from 'lucide-react';
import axios from 'axios';

const API_URL = (import.meta.env.VITE_API_URL || 'https://idbi-kyc-backend-759039332755.us-central1.run.app/api').replace(/\/$/, '');
const TOKEN_KEY = 'token';
const USER_KEY = 'user';

function getStoredUser() {
  try {
    const rawValue = window.sessionStorage.getItem(USER_KEY);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function formatDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

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
        {user ? (
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-sm font-semibold text-slate-700">{user.username}</span>
              <span className="text-xs text-slate-400 uppercase tracking-widest">{user.role}</span>
            </div>
            <button onClick={logout} className="neu-btn-sm text-rose-400 hover:text-rose-500">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

function AuthScreen({ setAuth }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('CUSTOMER');
  const [registrationCode, setRegistrationCode] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { username, password }
        : { username, password, role, registrationCode: role !== 'CUSTOMER' ? registrationCode : undefined };

      const response = await axios.post(`${API_URL}${endpoint}`, payload);
      setAuth(response.data.token, response.data.user);

      if (response.data.user.role === 'VERIFIER') {
        navigate('/bank');
      } else if (response.data.user.role === 'CUSTOMER') {
        navigate('/customer');
      } else {
        navigate('/partner');
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Authentication failed.');
    }
  };

  return (
    <div className="relative flex justify-center items-center min-h-[78vh] px-4 overflow-hidden">
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
          {isLogin
            ? 'Sign in to the secure identity network.'
            : 'Select your role to register a new account.'}
        </p>
        <form onSubmit={handleSubmit} className="space-y-5">
          {!isLogin && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="neu-input w-full">
                <option value="CUSTOMER">Customer</option>
                <option value="VERIFIER">Verifier (Bank Admin)</option>
                <option value="PARTNER">Partner</option>
              </select>
            </div>
          )}
          {!isLogin && role !== 'CUSTOMER' && (
             <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Registration Code</label>
              <input
                type="password"
                placeholder="Admin authorization code"
                value={registrationCode}
                onChange={(event) => setRegistrationCode(event.target.value)}
                required
                className="neu-input w-full"
              />
              <p className="text-xs text-indigo-500 mt-2 font-medium">
                Hackathon Demo Code: {role === 'VERIFIER' ? 'IDBI-BANK-ADMIN' : 'PARTNER-ADMIN'}
              </p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Username</label>
            <input
              type="text"
              placeholder="e.g. john"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              className="neu-input"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Password</label>
            <input
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              className="neu-input"
            />
          </div>
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
}

function BankDashboard({ token }) {
  const [customerId, setCustomerId] = useState('');
  const [fullName, setFullName] = useState('');
  const [govId, setGovId] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [ocrRawText, setOcrRawText] = useState('');
  const [fileName, setFileName] = useState('');

  const handleOCR = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setOcrLoading(true);
    setStatusMsg('Scanning document with OCR...');

    try {
      const formData = new FormData();
      formData.append('document', file);
      const response = await axios.post(`${API_URL}/ocr/extract`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.extracted.fullName) {
        setFullName(response.data.extracted.fullName);
      }

      if (response.data.extracted.govId) {
        setGovId(response.data.extracted.govId);
      }

      setOcrRawText(response.data.rawText || '');
      setStatusMsg('OCR completed. Review the extracted values before submitting.');
    } catch (error) {
      setStatusMsg(`OCR error: ${error.response?.data?.error || error.message}`);
    } finally {
      setOcrLoading(false);
    }
  };

  const handleMint = async () => {
    if (!customerId.trim() || !fullName.trim()) {
      alert('Please fill in customer ID and full name.');
      return;
    }

    setLoading(true);
    setStatusMsg('Encrypting PII and submitting the on-chain proof...');

    try {
      const response = await axios.post(
        `${API_URL}/kyc/verify`,
        {
          customerId: customerId.trim(),
          pii: {
            fullName: fullName.trim(),
            govId: govId.trim()
          }
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setStatusMsg(`Verification complete. Tx hash: ${response.data.txHash}`);
    } catch (error) {
      setStatusMsg(`Verification error: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
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
        <div className="md:col-span-3 neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-4 flex items-center pb-3" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <Upload className="w-5 h-5 mr-2 text-indigo-400" /> Document OCR
          </h3>
          <div className="flex flex-col sm:flex-row gap-4 items-center">
            <label className="neu-inset flex-1 w-full p-6 flex flex-col items-center justify-center cursor-pointer hover:opacity-80 transition-opacity" style={{ borderRadius: '16px', minHeight: '100px' }}>
              <FileText className="w-8 h-8 text-slate-400 mb-2" />
              <span className="text-sm font-medium text-slate-500">{fileName || 'Click to upload Aadhaar, PAN, or PDF'}</span>
              <span className="text-xs text-slate-400 mt-1">JPG, PNG, WEBP, or PDF</span>
              <input type="file" accept="image/*,.pdf" onChange={handleOCR} className="hidden" />
            </label>
            {ocrLoading ? (
              <div className="flex items-center text-indigo-500 text-sm font-medium">
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mr-2" />
                Scanning...
              </div>
            ) : null}
          </div>
          {ocrRawText ? (
            <details className="mt-4">
              <summary className="text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-500">View raw OCR output</summary>
              <div className="neu-inset mt-2 p-3 text-xs text-slate-500 font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">{ocrRawText}</div>
            </details>
          ) : null}
        </div>

        <div className="md:col-span-2 neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-6 flex items-center pb-4" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <Activity className="w-5 h-5 mr-2 text-indigo-400" /> Submit KYC Application
          </h3>
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Customer Public ID</label>
              <input type="text" placeholder="e.g. demo_user_1" value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="neu-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
              <input type="text" placeholder="Alice Wonderland" value={fullName} onChange={(event) => setFullName(event.target.value)} className="neu-input" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Government ID</label>
              <input type="text" placeholder="XXXX-XXXX-XXXX" value={govId} onChange={(event) => setGovId(event.target.value)} className="neu-input" />
            </div>
            <div className="pt-2">
              <button onClick={handleMint} disabled={loading} className="neu-btn">
                {loading ? 'Processing...' : 'Encrypt and Mint Proof'}
              </button>
            </div>
          </div>
        </div>

        <div className="md:col-span-1 neu-card flex flex-col justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-600 mb-3">Ledger Status</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">PII is encrypted before storage, and partner consent is now bound to the authenticated account.</p>
            <div className="flex items-center text-emerald-500 text-sm font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-2 animate-pulse" /> Secure flow active
            </div>
          </div>
          {statusMsg ? (
            <div className="neu-inset mt-5 p-3 text-xs break-all text-slate-500 font-mono leading-relaxed">{statusMsg}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CustomerPortal({ token, user, logout }) {
  const [partnerId, setPartnerId] = useState('');
  const [otpPartnerId, setOtpPartnerId] = useState('');
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

  const fetchAudit = async () => {
    setAuditLoading(true);

    try {
      const response = await axios.get(`${API_URL}/audit/${user.bankId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setAuditTrail(response.data.auditTrail || []);
      setExpiresAt(response.data.expiresAt || null);
    } catch {
      setAuditTrail([]);
      setExpiresAt(null);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
  }, [token, user.bankId]);

  const handleGrant = async () => {
    if (!partnerId.trim()) {
      return;
    }

    setLoading(true);
    setStatusMsg('Granting partner consent on-chain...');

    try {
      const response = await axios.post(
        `${API_URL}/consent/grant`,
        { partnerId: partnerId.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setStatusMsg(`Consent granted for ${response.data.partnerId}. Tx hash: ${response.data.txHash}`);
      await fetchAudit();
    } catch (error) {
      setStatusMsg(`Grant failed: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!partnerId.trim()) {
      return;
    }

    setLoading(true);
    setStatusMsg('Revoking partner consent on-chain...');

    try {
      const response = await axios.post(
        `${API_URL}/consent/revoke`,
        { partnerId: partnerId.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setStatusMsg(`Consent revoked for ${response.data.partnerId}. Tx hash: ${response.data.txHash}`);
      await fetchAudit();
    } catch (error) {
      setStatusMsg(`Revoke failed: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateOTP = async () => {
    if (!otpPartnerId.trim()) {
      alert('Enter the partner account that should be able to use this OTP.');
      return;
    }

    setOtpLoading(true);

    try {
      const response = await axios.post(
        `${API_URL}/otp/generate`,
        {
          partnerId: otpPartnerId.trim(),
          disclosureType
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setOtp(response.data.otp);
      setStatusMsg(`OTP generated for ${response.data.partnerId}. It expires in 5 minutes.`);
    } catch (error) {
      alert(error.response?.data?.error || error.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleSetExpiry = async (minutes) => {
    setLoading(true);

    try {
      const response = await axios.post(
        `${API_URL}/kyc/set-expiry`,
        { minutes },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setExpiresAt(response.data.expiresAt || null);
      setStatusMsg(minutes === 0 ? 'Self-destruct timer cleared.' : `Self-destruct timer set for ${minutes} minutes.`);
      await fetchAudit();
    } catch (error) {
      alert(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForget = async () => {
    const confirmed = window.confirm(
      'This permanently deletes all off-chain PII for your account. The on-chain proof will remain as an orphaned hash. Continue?'
    );

    if (!confirmed) {
      return;
    }

    setForgetLoading(true);

    try {
      const response = await axios.delete(`${API_URL}/kyc/forget`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert(response.data.message);
      logout();
      navigate('/');
    } catch (error) {
      alert(error.response?.data?.error || error.message);
    } finally {
      setForgetLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-4 animate-fade-up">
      <div className="flex items-center space-x-3 mb-8">
        <div className="neu-inset p-2" style={{ borderRadius: '12px' }}>
          <UserCheck className="w-6 h-6 text-indigo-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-700">Identity Vault</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 neu-card">
          <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: '1px solid rgba(163,177,198,0.3)' }}>
            <div>
              <h3 className="text-base font-semibold text-slate-600">Consent Management</h3>
              <p className="text-sm text-slate-400">Grant or revoke a specific partner's access to your verified record.</p>
            </div>
            <span className="neu-badge text-emerald-600 bg-emerald-50">
              <CheckCircle className="w-3.5 h-3.5 mr-1" /> Protected
            </span>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input type="text" placeholder="Partner username or bank ID" value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className="neu-input flex-1" />
            <button onClick={handleGrant} disabled={loading} className="neu-btn" style={{ width: 'auto', minWidth: '140px' }}>
              {loading ? 'Working...' : 'Grant Access'}
            </button>
            <button onClick={handleRevoke} disabled={loading} className="neu-btn text-rose-500 border-rose-500 hover:bg-rose-50" style={{ width: 'auto', minWidth: '140px' }}>
              {loading ? 'Working...' : 'Revoke Access'}
            </button>
          </div>
          {statusMsg ? <div className="neu-inset p-3 text-sm break-all text-slate-500 font-mono">{statusMsg}</div> : null}
        </div>

        <div className="md:col-span-1 neu-card flex flex-col items-center">
          <h3 className="text-base font-semibold text-slate-600 mb-2 flex items-center">
            <ScanLine className="w-5 h-5 mr-2 text-indigo-400" /> OTP Share
          </h3>
          <p className="text-xs text-slate-400 text-center mb-4">Each OTP is bound to one partner account, expires in 5 minutes, and has limited attempts.</p>

          <input
            type="text"
            placeholder="Partner username or bank ID"
            value={otpPartnerId}
            onChange={(event) => setOtpPartnerId(event.target.value)}
            className="neu-input text-xs w-full mb-4"
          />

          <select value={disclosureType} onChange={(event) => setDisclosureType(event.target.value)} className="neu-input text-xs w-full mb-4">
            <option value="FULL">Full Identity</option>
            <option value="NAME_ONLY">Name Only</option>
            <option value="PROOF_OF_EXISTENCE">Proof of Existence</option>
          </select>

          {otp ? (
            <div className="neu-inset w-full p-4 mb-4 flex flex-col items-center justify-center text-center" style={{ borderRadius: '16px' }}>
              <span className="text-3xl font-black tracking-[0.2em] text-indigo-500 mb-1">{otp}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Valid for 5 minutes</span>
            </div>
          ) : null}

          <button onClick={handleGenerateOTP} disabled={otpLoading} className="neu-btn text-sm mt-auto">
            {otpLoading ? 'Generating...' : otp ? 'Regenerate OTP' : 'Generate OTP'}
          </button>
        </div>

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
              {auditTrail.map((event, index) => (
                <div key={`${event.type}-${event.timestamp}-${index}`} className="neu-inset p-4" style={{ borderRadius: '14px' }}>
                  <p className="text-sm font-semibold text-slate-700">{event.title}</p>
                  <p className="text-xs text-slate-400 mt-1">{event.description}</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">{formatDate(event.timestamp)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-1 neu-card flex flex-col">
          <h3 className="text-base font-semibold text-slate-600 mb-2 flex items-center">
            <Trash2 className="w-5 h-5 mr-2 text-rose-400" /> Data Lifecycle
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            You can set an expiry timer or permanently remove your off-chain PII. Deleting the data does not erase the historic on-chain hash.
          </p>

          <div className="mb-4">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Self-Destruct Timer</h4>
            {expiresAt ? (
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-md mb-2">
                <p className="text-sm font-bold text-rose-600">Active until {formatDate(expiresAt)}</p>
              </div>
            ) : null}
            <div className="flex gap-2">
              <button onClick={() => handleSetExpiry(1)} className="neu-btn text-xs text-rose-500 border-rose-500 flex-1">1 Min</button>
              <button onClick={() => handleSetExpiry(60)} className="neu-btn text-xs text-rose-500 border-rose-500 flex-1">1 Hr</button>
              {expiresAt ? <button onClick={() => handleSetExpiry(0)} className="neu-btn text-xs flex-1">Cancel</button> : null}
            </div>
          </div>

          <div className="mt-auto">
            <button onClick={handleForget} disabled={forgetLoading} className="neu-btn text-rose-500 text-sm">
              {forgetLoading ? 'Deleting...' : 'Delete My Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PartnerConsole({ token }) {
  const [searchId, setSearchId] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [otpCustomerId, setOtpCustomerId] = useState('');
  const [otpValue, setOtpValue] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpResult, setOtpResult] = useState(null);

  const handleFetch = async () => {
    if (!searchId.trim()) {
      return;
    }

    setLoading(true);
    setResult(null);
    setErrorMsg('');

    try {
      const response = await axios.get(`${API_URL}/kyc/access/${searchId.trim()}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setResult(response.data);
    } catch (error) {
      setErrorMsg(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOTPVerify = async () => {
    if (!otpCustomerId.trim() || !otpValue.trim()) {
      return;
    }

    setOtpLoading(true);
    setOtpResult(null);

    try {
      const response = await axios.post(
        `${API_URL}/otp/verify`,
        {
          customerId: otpCustomerId.trim(),
          otp: otpValue.trim()
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setOtpResult(response.data);
    } catch (error) {
      setOtpResult({ error: error.response?.data?.error || error.message });
    } finally {
      setOtpLoading(false);
    }
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
        <div className="neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-1 flex items-center">
            <Database className="w-5 h-5 mr-2 text-indigo-400" /> Query via Consent
          </h3>
          <p className="text-sm text-slate-400 mb-5">Requires active consent for the authenticated partner account.</p>
          <div className="flex flex-col gap-3 mb-5">
            <input type="text" placeholder="Customer public ID" value={searchId} onChange={(event) => setSearchId(event.target.value)} className="neu-input" />
            <button onClick={handleFetch} disabled={loading} className="neu-btn">
              {loading ? 'Verifying...' : 'Verify and Fetch'}
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
                  <CheckCircle className="w-4 h-4 mr-2" /> Smart contract verified
                </div>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Name:</span> {result.pii.fullName}</p>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Gov ID:</span> {result.pii.govId}</p>
                <p className="text-xs text-slate-400 mt-3">Verified at: {formatDate(result.verifiedAt)}</p>
              </div>
            ) : (
              <div className="text-center">
                <Database className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Awaiting verification...</p>
              </div>
            )}
          </div>
        </div>

        <div className="neu-card">
          <h3 className="text-base font-semibold text-slate-600 mb-1 flex items-center">
            <ScanLine className="w-5 h-5 mr-2 text-indigo-400" /> Verify via OTP
          </h3>
          <p className="text-sm text-slate-400 mb-5">OTP access is bound to the partner account that the customer selected.</p>
          <div className="flex flex-col gap-3 mb-5">
            <input type="text" placeholder="Customer public ID" value={otpCustomerId} onChange={(event) => setOtpCustomerId(event.target.value)} className="neu-input" />
            <input type="text" placeholder="6-digit OTP" value={otpValue} onChange={(event) => setOtpValue(event.target.value)} maxLength={6} className="neu-input font-mono tracking-widest" />
            <button onClick={handleOTPVerify} disabled={otpLoading} className="neu-btn">
              {otpLoading ? 'Verifying...' : 'Verify OTP'}
            </button>
          </div>
          <div className="neu-inset p-5 min-h-[140px] flex items-center justify-center" style={{ borderRadius: '14px' }}>
            {otpResult?.error ? (
              <div className="text-center">
                <AlertTriangle className="w-7 h-7 text-rose-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-rose-500">{otpResult.error}</p>
              </div>
            ) : otpResult?.success ? (
              <div className="text-left w-full space-y-2">
                <div className="flex items-center text-emerald-500 font-semibold text-sm mb-2">
                  <CheckCircle className="w-4 h-4 mr-2" /> OTP verified
                </div>
                {otpResult.pii.status ? (
                  <p className="text-sm text-indigo-600 font-bold mb-2 p-2 bg-indigo-50 rounded-md border border-indigo-100">{otpResult.pii.status}</p>
                ) : null}
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Name:</span> {otpResult.pii.fullName}</p>
                <p className="text-sm text-slate-600"><span className="font-semibold text-slate-700">Gov ID:</span> {otpResult.pii.govId}</p>
                <p className="text-xs text-slate-400 mt-3">Verified via: {otpResult.verifiedVia}</p>
              </div>
            ) : (
              <div className="text-center">
                <ScanLine className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-400">Enter the OTP above...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => getStoredUser());

  const setAuth = (newToken, newUser) => {
    window.sessionStorage.setItem(TOKEN_KEY, newToken);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  useEffect(() => {
    if (token && !user) {
      logout();
    }
  }, [token, user]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#e0e5ec' }}>
      <Navigation user={user} logout={logout} />
      <main className="flex-1 w-full py-4">
        <Routes>
          <Route
            path="/"
            element={!token || !user ? <AuthScreen setAuth={setAuth} /> : <Navigate to={user.role === 'VERIFIER' ? '/bank' : user.role === 'CUSTOMER' ? '/customer' : '/partner'} />}
          />
          <Route path="/bank" element={token && user?.role === 'VERIFIER' ? <BankDashboard token={token} /> : <Navigate to="/" />} />
          <Route path="/customer" element={token && user?.role === 'CUSTOMER' ? <CustomerPortal token={token} user={user} logout={logout} /> : <Navigate to="/" />} />
          <Route path="/partner" element={token && user?.role === 'PARTNER' ? <PartnerConsole token={token} /> : <Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
