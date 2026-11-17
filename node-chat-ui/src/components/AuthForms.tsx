import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { isAuthUser, type AuthState } from '../auth';
import { API_BASE_URL } from '../constants';
import './AuthForms.css';

type AuthMode = 'login' | 'register';
type FieldName = 'name' | 'email' | 'password' | 'mobileNumber' | 'country';
type FieldErrors = Partial<Record<FieldName, string>>;

interface LoginValues {
  email: string;
  password: string;
}

interface RegisterValues {
  name: string;
  email: string;
  password: string;
  mobileNumber: string;
  country: string;
}

interface AuthFormsProps {
  onLoginSuccess: (auth: AuthState) => void;
}

interface TextFieldProps {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: 'text' | 'email' | 'password' | 'tel';
  autoComplete?: string;
  placeholder?: string;
  inputMode?: 'text' | 'email' | 'tel' | 'numeric';
  maxLength?: number;
  pattern?: string;
  error?: string;
}

const INITIAL_LOGIN: LoginValues = { email: '', password: '' };
const INITIAL_REGISTER: RegisterValues = {
  name: '',
  email: '',
  password: '',
  mobileNumber: '',
  // 10-digit mobile numbers align with the default India (+91) format.
  country: 'India',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^\d{10}$/;

// Alphabetically sorted by country name. Values sent to the API are the
// country names; dial codes are display/help text only and are never sent.
const COUNTRIES = [
  { name: 'Argentina', dialCode: '+54' },
  { name: 'Australia', dialCode: '+61' },
  { name: 'Austria', dialCode: '+43' },
  { name: 'Bangladesh', dialCode: '+880' },
  { name: 'Belgium', dialCode: '+32' },
  { name: 'Brazil', dialCode: '+55' },
  { name: 'Canada', dialCode: '+1' },
  { name: 'Chile', dialCode: '+56' },
  { name: 'China', dialCode: '+86' },
  { name: 'Colombia', dialCode: '+57' },
  { name: 'Czech Republic', dialCode: '+420' },
  { name: 'Denmark', dialCode: '+45' },
  { name: 'Egypt', dialCode: '+20' },
  { name: 'Finland', dialCode: '+358' },
  { name: 'France', dialCode: '+33' },
  { name: 'Germany', dialCode: '+49' },
  { name: 'Greece', dialCode: '+30' },
  { name: 'Hong Kong', dialCode: '+852' },
  { name: 'Hungary', dialCode: '+36' },
  { name: 'India', dialCode: '+91' },
  { name: 'Indonesia', dialCode: '+62' },
  { name: 'Ireland', dialCode: '+353' },
  { name: 'Israel', dialCode: '+972' },
  { name: 'Italy', dialCode: '+39' },
  { name: 'Japan', dialCode: '+81' },
  { name: 'Kenya', dialCode: '+254' },
  { name: 'Malaysia', dialCode: '+60' },
  { name: 'Mexico', dialCode: '+52' },
  { name: 'Netherlands', dialCode: '+31' },
  { name: 'New Zealand', dialCode: '+64' },
  { name: 'Nigeria', dialCode: '+234' },
  { name: 'Norway', dialCode: '+47' },
  { name: 'Pakistan', dialCode: '+92' },
  { name: 'Peru', dialCode: '+51' },
  { name: 'Philippines', dialCode: '+63' },
  { name: 'Poland', dialCode: '+48' },
  { name: 'Portugal', dialCode: '+351' },
  { name: 'Romania', dialCode: '+40' },
  { name: 'Russia', dialCode: '+7' },
  { name: 'Saudi Arabia', dialCode: '+966' },
  { name: 'Singapore', dialCode: '+65' },
  { name: 'South Africa', dialCode: '+27' },
  { name: 'South Korea', dialCode: '+82' },
  { name: 'Spain', dialCode: '+34' },
  { name: 'Sri Lanka', dialCode: '+94' },
  { name: 'Sweden', dialCode: '+46' },
  { name: 'Switzerland', dialCode: '+41' },
  { name: 'Taiwan', dialCode: '+886' },
  { name: 'Thailand', dialCode: '+66' },
  { name: 'Turkey', dialCode: '+90' },
  { name: 'United Arab Emirates', dialCode: '+971' },
  { name: 'United Kingdom', dialCode: '+44' },
  { name: 'United States', dialCode: '+1' },
  { name: 'Vietnam', dialCode: '+84' },
] as const;

function getDialCode(countryName: string): string | undefined {
  return COUNTRIES.find((country) => country.name === countryName)?.dialCode;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readServerError(body: unknown, fallback: string): string {
  const record = asRecord(body);
  if (
    record &&
    typeof record.error === 'string' &&
    record.error.trim().length > 0
  ) {
    return record.error;
  }
  return fallback;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function isFetchFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|fetch failed|networkerror|load failed/i.test(error.message)
  );
}

function TextField({
  id,
  name,
  label,
  value,
  onChange,
  disabled,
  type = 'text',
  autoComplete,
  placeholder,
  inputMode,
  maxLength,
  pattern,
  error,
}: TextFieldProps) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        pattern={pattern}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

export default function AuthForms({ onLoginSuccess }: AuthFormsProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginValues, setLoginValues] = useState<LoginValues>(INITIAL_LOGIN);
  const [registerValues, setRegisterValues] =
    useState<RegisterValues>(INITIAL_REGISTER);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isPending, setIsPending] = useState(false);

  const selectedDialCode = getDialCode(registerValues.country);

  const errorMessages = Object.values(fieldErrors).filter(
    (message): message is string => typeof message === 'string',
  );
  const hasErrors = formError.length > 0 || errorMessages.length > 0;

  const switchMode = (nextMode: AuthMode) => {
    if (nextMode === mode || isPending) return;
    setMode(nextMode);
    setFieldErrors({});
    setFormError('');
    setSuccessMessage('');
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextMode: AuthMode = mode === 'login' ? 'register' : 'login';
    switchMode(nextMode);
    document.getElementById(`auth-tab-${nextMode}`)?.focus();
  };

  const validateLogin = (): FieldErrors => {
    const errors: FieldErrors = {};
    const email = loginValues.email.trim();
    if (!email) {
      errors.email = 'Email is required.';
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!loginValues.password) {
      errors.password = 'Password is required.';
    }
    return errors;
  };

  const validateRegister = (): FieldErrors => {
    const errors: FieldErrors = {};
    const email = registerValues.email.trim();
    if (!registerValues.name.trim()) errors.name = 'Name is required.';
    if (!email) {
      errors.email = 'Email is required.';
    } else if (!EMAIL_PATTERN.test(email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (!registerValues.password) errors.password = 'Password is required.';
    const mobileNumber = registerValues.mobileNumber.replace(/\D/g, '');
    if (!mobileNumber) {
      errors.mobileNumber = 'Mobile number is required.';
    } else if (!MOBILE_PATTERN.test(mobileNumber)) {
      errors.mobileNumber = 'Mobile number must be exactly 10 digits.';
    }
    if (!registerValues.country.trim()) {
      errors.country = 'Country is required.';
    }
    return errors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;

    const errors = mode === 'login' ? validateLogin() : validateRegister();
    setFieldErrors(errors);
    setFormError('');
    setSuccessMessage('');
    if (Object.keys(errors).length > 0) return;

    setIsPending(true);
    try {
      if (mode === 'login') {
        const response = await fetch(`${API_BASE_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: loginValues.email.trim(),
            password: loginValues.password,
          }),
        });
        const body = await parseResponseBody(response);
        if (!response.ok) {
          setFormError(
            readServerError(body, 'Unable to sign in. Please try again.'),
          );
          return;
        }

        const record = asRecord(body);
        const token = record?.token;
        const user = record?.user;
        if (typeof token !== 'string' || !token || !isAuthUser(user)) {
          setFormError('The sign-in response was incomplete. Please try again.');
          return;
        }

        setLoginValues((current) => ({ ...current, password: '' }));
        onLoginSuccess({ token, user });
      } else {
        const response = await fetch(`${API_BASE_URL}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: registerValues.name.trim(),
            password: registerValues.password,
            email: registerValues.email.trim(),
            // Public registration always creates a regular user; the backend
            // ignores client-supplied roles, so there is nothing to choose here.
            role: 'user',
            mobileNumber: registerValues.mobileNumber.trim(),
            country: registerValues.country.trim(),
          }),
        });
        const body = await parseResponseBody(response);
        if (!response.ok) {
          setFormError(
            readServerError(body, 'Unable to create the account. Please try again.'),
          );
          return;
        }

        const user = asRecord(body)?.user;
        if (!isAuthUser(user)) {
          setFormError('The registration response was incomplete. Please try again.');
          return;
        }

        // Registration never auto-logs-in: send the user to Login with a message.
        setRegisterValues(INITIAL_REGISTER);
        setLoginValues({ email: registerValues.email.trim(), password: '' });
        setMode('login');
        setSuccessMessage('Account created. Please sign in with your new credentials.');
      }
    } catch (error) {
      setFormError(
        isFetchFailure(error)
          ? 'Unable to connect to the server. Please try again.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-header">
          <span className="auth-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 1.76.45 3.42 1.24 4.86L2 22l5.27-1.2A9.96 9.96 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2Zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3Zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22Z" />
            </svg>
          </span>
          <h1 id="auth-title">Chatbot</h1>
          <p>
            {mode === 'login'
              ? 'Sign in to continue your conversations.'
              : 'Create an account to start chatting.'}
          </p>
        </header>

        <div
          className="auth-tabs"
          role="tablist"
          aria-label="Authentication"
          onKeyDown={handleTabKeyDown}
        >
          <button
            id="auth-tab-login"
            type="button"
            role="tab"
            className={`auth-tab ${mode === 'login' ? 'is-active' : ''}`}
            aria-selected={mode === 'login'}
            aria-controls="auth-panel-login"
            tabIndex={mode === 'login' ? 0 : -1}
            disabled={isPending}
            onClick={() => switchMode('login')}
          >
            Log in
          </button>
          <button
            id="auth-tab-register"
            type="button"
            role="tab"
            className={`auth-tab ${mode === 'register' ? 'is-active' : ''}`}
            aria-selected={mode === 'register'}
            aria-controls="auth-panel-register"
            tabIndex={mode === 'register' ? 0 : -1}
            disabled={isPending}
            onClick={() => switchMode('register')}
          >
            Sign up
          </button>
        </div>

        {successMessage && (
          <div className="auth-success" role="status">
            {successMessage}
          </div>
        )}

        {hasErrors && (
          <div className="auth-alert" role="alert">
            {formError && <p>{formError}</p>}
            {errorMessages.length > 0 && (
              <ul>
                {errorMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div id="auth-panel-login" role="tabpanel" aria-labelledby="auth-tab-login" hidden={mode !== 'login'}>
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <TextField
              id="login-email"
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={loginValues.email}
              onChange={(value) =>
                setLoginValues((current) => ({ ...current, email: value }))
              }
              error={fieldErrors.email}
              disabled={isPending}
            />
            <TextField
              id="login-password"
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={loginValues.password}
              onChange={(value) =>
                setLoginValues((current) => ({ ...current, password: value }))
              }
              error={fieldErrors.password}
              disabled={isPending}
            />
            <button type="submit" className="auth-submit" disabled={isPending}>
              {isPending ? 'Signing in…' : 'Log in'}
            </button>
          </form>
        </div>

        <div id="auth-panel-register" role="tabpanel" aria-labelledby="auth-tab-register" hidden={mode !== 'register'}>
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <TextField
              id="register-name"
              name="name"
              label="Name"
              autoComplete="name"
              placeholder="Your full name"
              value={registerValues.name}
              onChange={(value) =>
                setRegisterValues((current) => ({ ...current, name: value }))
              }
              error={fieldErrors.name}
              disabled={isPending}
            />
            <TextField
              id="register-email"
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={registerValues.email}
              onChange={(value) =>
                setRegisterValues((current) => ({ ...current, email: value }))
              }
              error={fieldErrors.email}
              disabled={isPending}
            />
            <TextField
              id="register-password"
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder="Choose a password"
              value={registerValues.password}
              onChange={(value) =>
                setRegisterValues((current) => ({ ...current, password: value }))
              }
              error={fieldErrors.password}
              disabled={isPending}
            />
            <div className="auth-field">
              <label htmlFor="register-role">Role</label>
              <select
                id="register-role"
                name="role"
                value="user"
                disabled
                aria-describedby="register-role-help"
              >
                <option value="user">User</option>
              </select>
              <span id="register-role-help" className="field-hint">
                New accounts are always created as regular users.
              </span>
            </div>
            <TextField
              id="register-mobile"
              name="mobileNumber"
              label="Mobile number"
              type="tel"
              autoComplete="tel"
              inputMode="numeric"
              maxLength={10}
              pattern="[0-9]{10}"
              placeholder="9876543210"
              value={registerValues.mobileNumber}
              onChange={(value) =>
                setRegisterValues((current) => ({
                  ...current,
                  // Keep digits only, including on paste, capped at 10 digits.
                  mobileNumber: value.replace(/\D/g, '').slice(0, 10),
                }))
              }
              error={fieldErrors.mobileNumber}
              disabled={isPending}
            />
            <div className="auth-field">
              <label htmlFor="country">Country</label>
              <select
                id="country"
                name="country"
                autoComplete="country-name"
                value={registerValues.country}
                disabled={isPending}
                onChange={(event) =>
                  setRegisterValues((current) => ({
                    ...current,
                    country: event.target.value,
                  }))
                }
                aria-invalid={fieldErrors.country ? true : undefined}
                aria-describedby={`country-dial-help${
                  fieldErrors.country ? ' country-error' : ''
                }`}
              >
                {COUNTRIES.map((country) => (
                  <option key={country.name} value={country.name}>
                    {country.name} ({country.dialCode})
                  </option>
                ))}
              </select>
              <span id="country-dial-help" className="field-hint">
                {selectedDialCode ? `Dial code: ${selectedDialCode}` : 'Select your country'}
              </span>
              {fieldErrors.country && (
                <span id="country-error" className="field-error">
                  {fieldErrors.country}
                </span>
              )}
            </div>
            <button type="submit" className="auth-submit" disabled={isPending}>
              {isPending ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="auth-footer-note">Maximum upload size: 20 MB · PDF, DOCX, CSV, XLS, XLSX</p>
      </section>
    </div>
  );
}
