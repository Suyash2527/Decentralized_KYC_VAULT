import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ShieldCheck, User } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { ROLE_HOME } from '../lib/format';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import { Button, Card, Field } from '../components/ui';

const ROLES = [
  { value: 'CUSTOMER', label: 'Customer', description: 'Own and share your identity', icon: User },
  { value: 'VERIFIER', label: 'Verifier Bank', description: 'Verify and anchor KYC', icon: ShieldCheck },
  { value: 'PARTNER', label: 'Partner', description: 'Consume verified identity', icon: Building2 }
];

export function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('CUSTOMER');
  const [registrationCode, setRegistrationCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const { setAuth } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const validate = () => {
    const errors = {};

    if (!username.trim()) {
      errors.username = 'Username is required.';
    }

    if (!isLogin && password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    } else if (!password) {
      errors.password = 'Password is required.';
    }

    if (!isLogin && role !== 'CUSTOMER' && !registrationCode.trim()) {
      errors.registrationCode = 'An authorization code is required for this role.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    setSubmitting(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const payload = isLogin
        ? { username: username.trim(), password }
        : {
            username: username.trim(),
            password,
            role,
            registrationCode: role !== 'CUSTOMER' ? registrationCode.trim() : undefined
          };

      const response = await api.post(endpoint, payload);
      setAuth(response.data.token, response.data.user);
      navigate(ROLE_HOME[response.data.user.role] || '/');
    } catch (error) {
      toast.error(errorMessage(error, 'Authentication failed.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center px-4 py-10">
      <Card className="animate-fade-up w-full">
        <div className="card-body">
          <h1 className="t-display">{isLogin ? 'Sign in' : 'Create an account'}</h1>
          <p className="t-body mt-1">
            {isLogin
              ? 'Access your role dashboard on the identity network.'
              : 'Choose the role this account will operate as.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
            {!isLogin ? (
              <fieldset>
                <legend className="t-label mb-1.5">Role</legend>
                <div className="grid gap-2">
                  {ROLES.map((option) => {
                    const Icon = option.icon;
                    const selected = role === option.value;

                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors"
                        style={{
                          borderColor: selected ? 'var(--primary)' : 'var(--border)',
                          background: selected ? 'var(--primary-soft)' : 'var(--surface)'
                        }}
                      >
                        <input
                          type="radio"
                          name="role"
                          value={option.value}
                          checked={selected}
                          onChange={(event) => setRole(event.target.value)}
                          className="sr-only"
                          aria-label={`${option.label} — ${option.description}`}
                        />
                        <Icon
                          className="h-4 w-4 shrink-0"
                          style={{ color: selected ? 'var(--primary)' : 'var(--text-subtle)' }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{option.label}</span>
                          <span className="block text-xs text-[color:var(--text-subtle)]">{option.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {!isLogin && role !== 'CUSTOMER' ? (
              <Field
                label="Authorization code"
                hint="Institutional roles must be provisioned by an administrator."
                error={fieldErrors.registrationCode}
              >
                <input
                  className="input"
                  type="password"
                  value={registrationCode}
                  onChange={(event) => setRegistrationCode(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            ) : null}

            <Field label="Username" error={fieldErrors.username}>
              <input
                className="input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="e.g. john"
              />
            </Field>

            <Field
              label="Password"
              hint={isLogin ? undefined : 'At least 8 characters.'}
              error={fieldErrors.password}
            >
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
            </Field>

            <Button type="submit" loading={submitting} className="w-full">
              {isLogin ? 'Sign in' : 'Create account'}
            </Button>
          </form>
        </div>

        <div className="border-t px-5 py-3 text-center">
          <span className="t-body">{isLogin ? "Don't have an account? " : 'Already registered? '}</span>
          <button
            type="button"
            onClick={() => {
              setIsLogin((current) => !current);
              setFieldErrors({});
            }}
            className="text-sm font-semibold text-[color:var(--primary)] hover:underline"
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </Card>
    </div>
  );
}
