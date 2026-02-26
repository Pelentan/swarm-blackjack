import React, { useState, useEffect } from 'react';
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || '';
const AUTH_UI     = `${GATEWAY_URL}/api/auth-ui`;

interface Field {
  name:        string;
  label:       string;
  type:        string;
  required:    boolean;
  placeholder: string;
  maxLength?:  number;
}

interface FieldsResponse {
  action: string;
  title:  string;
  submit: string;
  fields: Field[];
}

export interface AuthResult {
  accessToken: string;
  expiresIn:   number;
  playerId:    string;
  playerName:  string;
  email:       string;
}

interface Props {
  onSuccess: (result: AuthResult) => void;
  onClose:   () => void;
}

type Action      = 'register' | 'login';
type ModalState  = 'form' | 'check-email' | 'passkey-pending';

export const AuthModal: React.FC<Props> = ({ onSuccess, onClose }) => {
  const [action, setAction]                   = useState<Action>('login');
  const [modalState, setModalState]           = useState<ModalState>('form');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [fieldDefs, setFieldDefs]             = useState<FieldsResponse | null>(null);
  const [values, setValues]                   = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors]         = useState<Record<string, string>>({});
  const [submitError, setSubmitError]         = useState<string | null>(null);
  const [loading, setLoading]                 = useState(false);

  useEffect(() => {
    if (modalState !== 'form') return;
    setFieldDefs(null);
    setValues({});
    setFieldErrors({});
    setSubmitError(null);

    fetch(`${AUTH_UI}/fields?action=${action}`)
      .then(r => r.json())
      .then((data: FieldsResponse) => {
        setFieldDefs(data);
        const init: Record<string, string> = {};
        data.fields.forEach(f => { init[f.name] = ''; });
        setValues(init);
      })
      .catch(() => setSubmitError('Could not reach auth service'));
  }, [action, modalState]);

  // ── Passkey login flow ──────────────────────────────────────────────────────

  const handlePasskeyLogin = async () => {
    const email = (values['email'] ?? '').trim();
    if (!email) { setFieldErrors({ email: 'Email address is required' }); return; }

    setLoading(true);
    setSubmitError(null);
    setModalState('passkey-pending');

    try {
      // 1. Get challenge from server
      const beginRes = await fetch(`${AUTH_UI}/passkey/login/begin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!beginRes.ok) {
        const err = await beginRes.json();
        throw new Error(err.error ?? 'Failed to start passkey login');
      }

      const options = await beginRes.json();

      // 2. Invoke browser ceremony — shows native passkey UI
      const assertion = await startAuthentication(options);

      // 3. Send assertion to server for verification
      const completeRes = await fetch(`${AUTH_UI}/passkey/login/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(assertion),
      });

      if (!completeRes.ok) {
        const err = await completeRes.json();
        throw new Error(err.error ?? 'Passkey verification failed');
      }

      const result = await completeRes.json() as AuthResult;
      onSuccess(result);
    } catch (e: any) {
      // User cancelled the browser dialog — not an error worth showing
      if (e.name === 'NotAllowedError') {
        setSubmitError('Passkey login cancelled.');
      } else {
        setSubmitError(e.message ?? 'Passkey login failed');
      }
      setModalState('form');
    } finally {
      setLoading(false);
    }
  };

  // ── Registration (email → verify link) ─────────────────────────────────────

  const handleRegister = async () => {
    setSubmitError(null);
    setFieldErrors({});
    setLoading(true);

    try {
      const res  = await fetch(`${AUTH_UI}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register', fields: values }),
      });
      const data = await res.json();

      if (res.status === 422 && data.fields) {
        const errs: Record<string, string> = {};
        (data.fields as { field: string; message: string }[]).forEach(e => { errs[e.field] = e.message; });
        setFieldErrors(errs);
        return;
      }
      if (!res.ok) { setSubmitError(data.error ?? 'Registration failed'); return; }

      setRegisteredEmail(values['email'] ?? '');
      setModalState('check-email');
    } catch {
      setSubmitError('Network error — is the auth service running?');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (action === 'register') {
      await handleRegister();
    } else {
      await handlePasskeyLogin();
    }
  };

  const switchAction = (a: Action) => {
    setAction(a);
    setModalState('form');
    setSubmitError(null);
  };

  // ── Passkey pending state ───────────────────────────────────────────────────

  if (modalState === 'passkey-pending') {
    return (
      <div style={backdropStyle}>
        <div style={modalStyle}>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>🔑</div>
            <h2 style={{ color: '#e6edf3', margin: '0 0 12px', fontSize: '1.2rem' }}>
              Waiting for passkey
            </h2>
            <p style={{ color: '#8b949e', margin: 0, lineHeight: 1.6, fontSize: '0.88rem' }}>
              Check your device for the passkey prompt — approve it to sign in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Check email state ───────────────────────────────────────────────────────

  if (modalState === 'check-email') {
    return (
      <div onClick={onClose} style={backdropStyle}>
        <div onClick={e => e.stopPropagation()} style={modalStyle}>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>✉️</div>
            <h2 style={{ color: '#e6edf3', margin: '0 0 12px', fontSize: '1.2rem' }}>
              Check your email
            </h2>
            <p style={{ color: '#8b949e', margin: '0 0 8px', lineHeight: 1.6, fontSize: '0.9rem' }}>
              We sent a verification link to:
            </p>
            <p style={{ color: '#58a6ff', margin: '0 0 20px', fontWeight: 600, fontSize: '0.95rem' }}>
              {registeredEmail}
            </p>
            <p style={{ color: '#8b949e', margin: '0 0 28px', lineHeight: 1.6, fontSize: '0.82rem' }}>
              Click the link to activate your account. After verifying, sign in with a passkey.
              Link expires in 24 hours.
            </p>
            <button onClick={onClose} style={btnPrimary}>Got it</button>
            <button onClick={() => switchAction('login')} style={btnGhost}>
              Already verified? Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form state ──────────────────────────────────────────────────────────────

  return (
    <div onClick={onClose} style={backdropStyle}>
      <div onClick={e => e.stopPropagation()} style={modalStyle}>

        {/* Tabs */}
        <div style={{ display: 'flex', marginBottom: 24, borderBottom: '1px solid #21262d' }}>
          {(['login', 'register'] as Action[]).map(a => (
            <button key={a} onClick={() => switchAction(a)} style={{
              flex: 1, padding: '10px 0', background: 'none', border: 'none',
              borderBottom: action === a ? '2px solid #58a6ff' : '2px solid transparent',
              color: action === a ? '#58a6ff' : '#8b949e',
              fontWeight: action === a ? 700 : 400,
              fontSize: '0.85rem', cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: 1, transition: 'all 0.15s',
            }}>
              {a === 'register' ? 'Create Account' : 'Sign In'}
            </button>
          ))}
        </div>

        {!fieldDefs ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#8b949e', fontSize: '0.8rem' }}>
            Loading...
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {fieldDefs.fields.map(field => (
              <div key={field.name} style={{ marginBottom: 16 }}>
                <label style={{
                  display: 'block', fontSize: '0.75rem', color: '#8b949e',
                  marginBottom: 6, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
                }}>
                  {field.label}
                  {field.required && <span style={{ color: '#e53e3e', marginLeft: 4 }}>*</span>}
                </label>
                <input
                  type={field.type}
                  value={values[field.name] ?? ''}
                  onChange={e => setValues(v => ({ ...v, [field.name]: e.target.value }))}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  required={field.required}
                  disabled={loading}
                  style={{
                    width: '100%', padding: '10px 12px', background: '#0d1117',
                    border: `1px solid ${fieldErrors[field.name] ? '#e53e3e' : '#30363d'}`,
                    borderRadius: 8, color: '#e6edf3', fontSize: '0.9rem',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                  onFocus={e => { e.target.style.borderColor = '#58a6ff'; }}
                  onBlur={e => { e.target.style.borderColor = fieldErrors[field.name] ? '#e53e3e' : '#30363d'; }}
                />
                {fieldErrors[field.name] && (
                  <div style={{ color: '#fc8181', fontSize: '0.72rem', marginTop: 4 }}>
                    {fieldErrors[field.name]}
                  </div>
                )}
              </div>
            ))}

            {/* Passkey hint for login */}
            {action === 'login' && (
              <div style={{
                background: '#0d1a2e', border: '1px solid #1f4a7a', borderRadius: 8,
                padding: '10px 14px', marginBottom: 16, fontSize: '0.78rem', color: '#7ab3e0',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>🔑</span>
                <span>Your device will prompt you to approve the sign-in with a passkey.</span>
              </div>
            )}

            {submitError && (
              <div style={{
                background: '#2d1515', border: '1px solid #e53e3e', borderRadius: 8,
                padding: '10px 14px', color: '#fc8181', fontSize: '0.8rem', marginBottom: 16,
              }}>
                {submitError}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <button type="button" onClick={onClose} disabled={loading} style={btnCancel}>
                Cancel
              </button>
              <button type="submit" disabled={loading} style={{
                ...btnPrimary,
                flex: 2,
                background: loading ? '#1f6feb55' : '#1f6feb',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}>
                {loading ? 'Working...' : fieldDefs.submit}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const backdropStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  zIndex: 1000, backdropFilter: 'blur(4px)',
};

const modalStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 16,
  padding: '28px 32px', width: '100%', maxWidth: 420,
  boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
};

const btnPrimary: React.CSSProperties = {
  display: 'block', width: '100%', padding: '10px 32px',
  background: '#1f6feb', border: '1px solid #1f6feb',
  borderRadius: 8, color: '#fff', fontWeight: 700,
  fontSize: '0.9rem', cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  display: 'block', width: '100%', marginTop: 10,
  padding: '8px 0', background: 'none', border: 'none',
  color: '#8b949e', fontSize: '0.78rem', cursor: 'pointer',
};

const btnCancel: React.CSSProperties = {
  flex: 1, padding: '10px 0', background: 'none',
  border: '1px solid #30363d', borderRadius: 8,
  color: '#8b949e', cursor: 'pointer', fontSize: '0.85rem',
};
