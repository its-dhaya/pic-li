"use strict";

const fs = require("fs-extra");
const path = require("path");
const { spawnSync } = require("child_process");

const isWin = process.platform === "win32";

// ─── Safe runner ──────────────────────────────────────────────────────────────
// On Windows npm/npx/git are .cmd/.bat — spawnSync shell:false can't find them.
// Wrapping with cmd.exe /c resolves .cmd from PATH while args stay as an array
// so paths with spaces are never mangled.
function run(file, args, { cwd, allowFail = false } = {}) {
  const spawnFile = isWin ? "cmd.exe" : file;
  const spawnArgs = isWin ? ["/c", file, ...args] : args;

  const result = spawnSync(spawnFile, spawnArgs, {
    cwd,
    stdio: "pipe",
    shell: false,
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (!allowFail && result.status !== 0) {
    const msg = ((result.stderr || "") + (result.stdout || "")).trim();
    throw new Error(msg || `Process exited with code ${result.status}`);
  }
  return result;
}

// ─── Write helper ─────────────────────────────────────────────────────────────
const w = (filePath, content) => {
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
};

// ─── Template flags (match stacks.js template names) ─────────────────────────
// stacks.js MERN templates: ["default", "with-auth", "with-tailwind"]
const isAuth = (t) => t.includes("auth") || t.includes("jwt");
const isTailwind = (t) => t.includes("tailwind");

// =============================================================================
// ENTRY POINT
// =============================================================================

async function generate({ name, template, targetDir, onStep }) {
  const slug = name
    .toLowerCase()
    .replace(/[\s_]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const clientDir = path.join(targetDir, "client");
  const serverDir = path.join(targetDir, "server");

  // ── 1. Monorepo skeleton ────────────────────────────────────────────────────
  onStep("Creating monorepo structure");
  fs.ensureDirSync(clientDir);
  fs.ensureDirSync(serverDir);

  // ── 2. React + Vite scaffold ────────────────────────────────────────────────
  onStep("Scaffolding React client with Vite");
  run("npx", ["--yes", "create-vite@latest", "client", "--template", "react"], {
    cwd: targetDir,
  });
  run("npm", ["install"], { cwd: clientDir });

  // react-router-dom used in every template
  onStep("Installing client dependencies");
  run("npm", ["install", "react-router-dom"], { cwd: clientDir });

  // ── 3. Client source files ──────────────────────────────────────────────────
  onStep("Writing client source files");
  buildClient(clientDir, name, template);

  // ── 4. Tailwind (with-tailwind only) ────────────────────────────────────────
  if (isTailwind(template)) {
    onStep("Installing Tailwind CSS");
    run("npm", ["install", "-D", "tailwindcss@3", "postcss", "autoprefixer"], {
      cwd: clientDir,
    });
    w(path.join(clientDir, "tailwind.config.js"), tailwindConfig());
    w(path.join(clientDir, "postcss.config.js"), postcssConfig());
    w(path.join(clientDir, "src", "index.css"), tailwindCss());
  }

  // ── 5. Vite proxy ───────────────────────────────────────────────────────────
  w(path.join(clientDir, "vite.config.js"), viteConfig());

  // ── 6. Express server ───────────────────────────────────────────────────────
  onStep("Setting up Express server");
  buildServer(serverDir, slug, template);

  onStep("Installing server dependencies");
  run("npm", ["install"], { cwd: serverDir });

  // ── 7. Root (concurrently) ──────────────────────────────────────────────────
  onStep("Writing root package.json");
  w(path.join(targetDir, "package.json"), rootPackageJson(slug));
  run("npm", ["install"], { cwd: targetDir });

  // ── 8. Git + README ─────────────────────────────────────────────────────────
  onStep("Initializing Git");
  run("git", ["init"], { cwd: targetDir, allowFail: true });
  w(path.join(targetDir, ".gitignore"), gitignore());

  onStep("Writing README");
  w(path.join(targetDir, "README.md"), readme(name, template));
}

// =============================================================================
// CLIENT BUILDER
// =============================================================================

function buildClient(clientDir, name, template) {
  const src = path.join(clientDir, "src");

  fs.ensureDirSync(path.join(src, "components"));
  fs.ensureDirSync(path.join(src, "pages"));
  fs.ensureDirSync(path.join(src, "hooks"));
  fs.ensureDirSync(path.join(src, "services"));

  if (isTailwind(template)) {
    buildClientTailwind(src, name);
  } else if (isAuth(template)) {
    buildClientAuth(src, name);
  } else {
    buildClientDefault(src, name);
  }
}

// ─── default ──────────────────────────────────────────────────────────────────
//
// src/
// ├── App.jsx
// ├── main.jsx
// ├── components/
// ├── pages/Home.jsx
// ├── hooks/
// └── services/

function buildClientDefault(src, name) {
  w(
    path.join(src, "App.jsx"),
    `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
`
  );

  w(
    path.join(src, "main.jsx"),
    `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`
  );

  // FIX: retry loop so a slow server start doesn't show a permanent "offline"
  w(
    path.join(src, "pages", "Home.jsx"),
    `import { useState, useEffect, useRef } from 'react';

const MAX_RETRIES  = 5;
const RETRY_DELAY  = 2000; // ms between retries

export default function Home() {
  const [status, setStatus]   = useState('connecting...');
  const [dbInfo, setDbInfo]   = useState('');
  const retryCount            = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const res  = await fetch('/api/health');
        const data = await res.json();
        if (!cancelled) {
          setStatus(data.status);
          setDbInfo(data.db || '');
        }
      } catch {
        if (cancelled) return;
        retryCount.current += 1;
        if (retryCount.current < MAX_RETRIES) {
          // Server may still be starting — retry after delay
          setTimeout(checkHealth, RETRY_DELAY);
        } else {
          setStatus('offline');
        }
      }
    }

    checkHealth();
    return () => { cancelled = true; };
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 600 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>${name}</h1>
      <p style={{ color: '#666' }}>Generated by <strong>PIC-LI</strong> — MERN Stack</p>
      <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
      <p>
        Server:{' '}
        <strong style={{ color: status === 'UP' ? '#16a34a' : status === 'connecting...' ? '#d97706' : '#dc2626' }}>
          {status}
        </strong>
      </p>
      {dbInfo && (
        <p style={{ marginTop: '0.5rem' }}>
          Database: <strong style={{ color: dbInfo === 'connected' ? '#16a34a' : '#dc2626' }}>{dbInfo}</strong>
        </p>
      )}
      {status === 'offline' && (
        <p style={{ marginTop: '1rem', padding: '0.75rem', background: '#fef2f2', borderRadius: 6, color: '#991b1b', fontSize: '0.9rem' }}>
          ⚠ Could not reach the server. Make sure you ran <code>npm run dev</code> from the
          project root (not inside <code>client/</code>).
        </p>
      )}
    </main>
  );
}
`
  );
}

// ─── with-auth ────────────────────────────────────────────────────────────────
//
// src/
// ├── App.jsx
// ├── main.jsx
// ├── components/
// ├── pages/Home.jsx  Login.jsx  Register.jsx
// ├── services/authService.js
// └── hooks/

function buildClientAuth(src, name) {
  w(
    path.join(src, "App.jsx"),
    `import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home     from './pages/Home';
import Login    from './pages/Login';
import Register from './pages/Register';

function PrivateRoute({ children }) {
  return localStorage.getItem('token') ? children : <Navigate to="/login" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"         element={<PrivateRoute><Home /></PrivateRoute>} />
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
`
  );

  w(
    path.join(src, "main.jsx"),
    `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`
  );

  // FIX: same retry logic so a slow server start or no-DB message is handled
  w(
    path.join(src, "pages", "Home.jsx"),
    `import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout } from '../services/authService';

const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

export default function Home() {
  const [status, setStatus] = useState('connecting...');
  const [dbInfo, setDbInfo] = useState('');
  const retryCount = useRef(0);
  const navigate   = useNavigate();

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const res  = await fetch('/api/health', {
          headers: { Authorization: \`Bearer \${localStorage.getItem('token')}\` },
        });
        const data = await res.json();
        if (!cancelled) {
          setStatus(data.status);
          setDbInfo(data.db || '');
        }
      } catch {
        if (cancelled) return;
        retryCount.current += 1;
        if (retryCount.current < MAX_RETRIES) {
          setTimeout(checkHealth, RETRY_DELAY);
        } else {
          setStatus('offline');
        }
      }
    }

    checkHealth();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>${name}</h1>
        <button onClick={handleLogout} style={{ padding: '0.4rem 1rem', cursor: 'pointer' }}>
          Logout
        </button>
      </div>
      <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
      <p>
        Server:{' '}
        <strong style={{ color: status === 'UP' ? '#16a34a' : status === 'connecting...' ? '#d97706' : '#dc2626' }}>
          {status}
        </strong>
      </p>
      {dbInfo && (
        <p style={{ marginTop: '0.5rem' }}>
          Database:{' '}
          <strong style={{ color: dbInfo === 'connected' ? '#16a34a' : '#dc2626' }}>{dbInfo}</strong>
        </p>
      )}
      {dbInfo === 'disconnected' && (
        <p style={{ marginTop: '1rem', padding: '0.75rem', background: '#fffbeb', borderRadius: 6, color: '#92400e', fontSize: '0.9rem' }}>
          ⚠ MongoDB is not running. Auth operations will fail.
          Start MongoDB locally or set <code>MONGO_URI</code> in <code>server/.env</code>.
        </p>
      )}
    </main>
  );
}
`
  );

  w(
    path.join(src, "pages", "Login.jsx"),
    `import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { login } from '../services/authService';

export default function Login() {
  const [form, setForm]       = useState({ email: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 360 }}>
      <h2>Sign In</h2>
      {error && (
        <p style={{ color: '#dc2626', background: '#fef2f2', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {[
          { id: 'email',    label: 'Email',    type: 'email',    name: 'email' },
          { id: 'password', label: 'Password', type: 'password', name: 'password' },
        ].map(({ id, label, type, name }) => (
          <div key={id} style={{ marginBottom: '1rem' }}>
            <label htmlFor={id} style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
              {label}
            </label>
            <input
              id={id} type={type} name={name}
              value={form[name]} onChange={handleChange} required
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <button type="submit" disabled={loading}
          style={{ width: '100%', padding: '0.6rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
          {loading ? 'Signing in…' : 'Login'}
        </button>
      </form>
      <p style={{ marginTop: '1rem', textAlign: 'center' }}>
        No account? <Link to="/register">Register</Link>
      </p>
    </main>
  );
}
`
  );

  w(
    path.join(src, "pages", "Register.jsx"),
    `import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { register } from '../services/authService';

export default function Register() {
  const [form, setForm]       = useState({ name: '', email: '', password: '' });
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form.name, form.email, form.password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 360 }}>
      <h2>Create Account</h2>
      {error && (
        <p style={{ color: '#dc2626', background: '#fef2f2', padding: '0.5rem 0.75rem', borderRadius: 6 }}>
          {error}
        </p>
      )}
      <form onSubmit={handleSubmit}>
        {[
          { id: 'name',     label: 'Name',     type: 'text',     name: 'name' },
          { id: 'email',    label: 'Email',     type: 'email',    name: 'email' },
          { id: 'password', label: 'Password',  type: 'password', name: 'password' },
        ].map(({ id, label, type, name }) => (
          <div key={id} style={{ marginBottom: '1rem' }}>
            <label htmlFor={id} style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
              {label}
            </label>
            <input
              id={id} type={type} name={name}
              value={form[name]} onChange={handleChange} required
              minLength={name === 'password' ? 6 : undefined}
              style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #d1d5db', borderRadius: 6, boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <button type="submit" disabled={loading}
          style={{ width: '100%', padding: '0.6rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
          {loading ? 'Creating account…' : 'Register'}
        </button>
      </form>
      <p style={{ marginTop: '1rem', textAlign: 'center' }}>
        Have an account? <Link to="/login">Login</Link>
      </p>
    </main>
  );
}
`
  );

  w(
    path.join(src, "services", "authService.js"),
    `const BASE = '/api/auth';

async function request(url, body) {
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function login(email, password) {
  const data = await request(\`\${BASE}/login\`, { email, password });
  localStorage.setItem('token', data.token);
  return data;
}

export async function register(name, email, password) {
  const data = await request(\`\${BASE}/register\`, { name, email, password });
  localStorage.setItem('token', data.token);
  return data;
}

export function logout() {
  localStorage.removeItem('token');
}

export function getToken() {
  return localStorage.getItem('token');
}

export function isAuthenticated() {
  return Boolean(getToken());
}
`
  );
}

// ─── with-tailwind ────────────────────────────────────────────────────────────
//
// src/
// ├── App.jsx
// ├── main.jsx
// ├── index.css            ← @tailwind directives
// ├── components/ui/       Button · Input · Card
// ├── pages/Home.jsx
// ├── hooks/
// └── services/

function buildClientTailwind(src, name) {
  fs.ensureDirSync(path.join(src, "components", "ui"));

  w(
    path.join(src, "App.jsx"),
    `import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
`
  );

  w(
    path.join(src, "main.jsx"),
    `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
`
  );

  // FIX: retry logic + DB status display
  w(
    path.join(src, "pages", "Home.jsx"),
    `import { useState, useEffect, useRef } from 'react';
import Button from '../components/ui/Button';
import Card   from '../components/ui/Card';

const MAX_RETRIES = 5;
const RETRY_DELAY = 2000;

export default function Home() {
  const [status, setStatus] = useState('connecting...');
  const [dbInfo, setDbInfo] = useState('');
  const retryCount = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const res  = await fetch('/api/health');
        const data = await res.json();
        if (!cancelled) {
          setStatus(data.status);
          setDbInfo(data.db || '');
        }
      } catch {
        if (cancelled) return;
        retryCount.current += 1;
        if (retryCount.current < MAX_RETRIES) {
          setTimeout(checkHealth, RETRY_DELAY);
        } else {
          setStatus('offline');
        }
      }
    }

    checkHealth();
    return () => { cancelled = true; };
  }, []);

  const statusColor = status === 'UP' ? 'text-green-500' : status === 'connecting...' ? 'text-yellow-500' : 'text-red-400';

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      <Card className="max-w-md w-full text-center space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">${name}</h1>
        <p className="text-gray-500">
          Generated by <span className="font-semibold">PIC-LI</span> — MERN Stack
        </p>
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-gray-600">Server:</span>
          <span className={\`font-semibold \${statusColor}\`}>{status}</span>
        </div>
        {dbInfo && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="text-gray-600">Database:</span>
            <span className={\`font-semibold \${dbInfo === 'connected' ? 'text-green-500' : 'text-red-400'}\`}>
              {dbInfo}
            </span>
          </div>
        )}
        {status === 'offline' && (
          <p className="text-xs text-red-700 bg-red-50 rounded-lg p-3 text-left">
            ⚠ Server unreachable. Run <code>npm run dev</code> from the project root, not inside <code>client/</code>.
          </p>
        )}
        {dbInfo === 'disconnected' && (
          <p className="text-xs text-yellow-800 bg-yellow-50 rounded-lg p-3 text-left">
            ⚠ MongoDB offline. Start MongoDB or set <code>MONGO_URI</code> in <code>server/.env</code>.
          </p>
        )}
        <Button onClick={() => { retryCount.current = 0; setStatus('connecting...'); }}>
          Retry
        </Button>
      </Card>
    </main>
  );
}
`
  );

  w(
    path.join(src, "components", "ui", "Button.jsx"),
    `export default function Button({
  children, onClick, type = 'button',
  variant = 'primary', disabled = false, className = '',
}) {
  const base =
    'inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium ' +
    'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary:   'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500',
    secondary: 'bg-gray-100 text-gray-800 hover:bg-gray-200 focus:ring-gray-400',
    danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
  };

  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={\`\${base} \${variants[variant] ?? variants.primary} \${className}\`}>
      {children}
    </button>
  );
}
`
  );

  w(
    path.join(src, "components", "ui", "Input.jsx"),
    `export default function Input({ label, id, error, className = '', ...props }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">{label}</label>
      )}
      <input id={id}
        className={\`w-full rounded-lg border px-3 py-2 text-sm shadow-sm
          focus:outline-none focus:ring-2 focus:ring-indigo-500
          \${error ? 'border-red-400' : 'border-gray-300'} \${className}\`}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
`
  );

  w(
    path.join(src, "components", "ui", "Card.jsx"),
    `export default function Card({ children, className = '' }) {
  return (
    <div className={\`bg-white rounded-2xl shadow-md p-6 \${className}\`}>
      {children}
    </div>
  );
}
`
  );
}

// =============================================================================
// SERVER BUILDER
// =============================================================================

function buildServer(serverDir, slug, template) {
  const src = path.join(serverDir, "src");

  fs.ensureDirSync(path.join(src, "routes"));
  fs.ensureDirSync(path.join(src, "models"));
  fs.ensureDirSync(path.join(src, "controllers"));
  fs.ensureDirSync(path.join(src, "middleware"));

  w(path.join(src, "middleware", "errorHandler.js"), errorHandlerMiddleware());
  w(path.join(src, "middleware", "requireDb.js"), requireDbMiddleware());
  w(path.join(src, "models", "Item.js"), itemModel());
  w(path.join(src, "routes", "api.js"), apiRoutes());

  const envBase = `PORT=5000\nNODE_ENV=development\n\n# Local MongoDB (default)\nMONGO_URI=mongodb://localhost:27017/${slug}\n\n# MongoDB Atlas example:\n# MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/${slug}?retryWrites=true&w=majority\n`;
  const envAuth = isAuth(template)
    ? `\nJWT_SECRET=change-me-in-production\nJWT_EXPIRES_IN=7d\n`
    : "";
  const env = envBase + envAuth;
  w(path.join(serverDir, ".env"), env);
  w(path.join(serverDir, ".env.example"), env);

  w(
    path.join(serverDir, "package.json"),
    serverPackageJson(slug, isAuth(template))
  );
  w(path.join(src, "index.js"), serverIndex(slug, isAuth(template)));

  if (isAuth(template)) {
    w(path.join(src, "models", "User.js"), userModel());
    w(path.join(src, "routes", "auth.js"), authRoutes());
    w(path.join(src, "controllers", "authController.js"), authController());
    w(path.join(src, "middleware", "auth.js"), authMiddleware());
  }
}

// =============================================================================
// SERVER FILE CONTENT
// =============================================================================

// FIX 1: mongoose.set('bufferCommands', false) — operations fail immediately
//         instead of hanging for 10 seconds when MongoDB is offline.
// FIX 2: /api/health reports db status so the client can show it.
// FIX 3: server starts regardless of DB state; DB-dependent routes return 503
//         via requireDb middleware instead of timing out.
function serverIndex(slug, withAuth) {
  return `require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const mongoose     = require('mongoose');
const apiRoutes    = require('./routes/api');
${
  withAuth ? "const authRoutes   = require('./routes/auth');\n" : ""
}const errorHandler = require('./middleware/errorHandler');

// FIX: disable Mongoose command buffering so DB operations fail fast (not after
// a 10-second timeout) when MongoDB is unreachable.
mongoose.set('bufferCommands', false);

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);
${withAuth ? "app.use('/api/auth', authRoutes);\n" : ""}
// ── Error handler (must be last) ───────────────────────────────────────────
app.use(errorHandler);

// ── Connect to MongoDB then start ──────────────────────────────────────────
const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/${slug}';

// Start the HTTP server immediately — the client can reach /api/health right
// away even if MongoDB takes a moment (or isn't available at all).
app.listen(PORT, () =>
  console.log(\`[PIC-LI] Server → http://localhost:\${PORT}\`)
);

mongoose
  .connect(mongoUri)
  .then(() => console.log('[PIC-LI] MongoDB connected'))
  .catch((err) => {
    console.error('[PIC-LI] MongoDB connection failed:', err.message);
    console.warn(
      '[PIC-LI] Running without a database.\\n' +
      '         • Start MongoDB locally, or\\n' +
      '         • Set MONGO_URI to a MongoDB Atlas connection string in server/.env'
    );
  });
`;
}

function serverPackageJson(slug, withAuth) {
  const deps = {
    cors: "^2.8.5",
    dotenv: "^16.4.5",
    express: "^4.18.3",
    mongoose: "^8.2.2",
    ...(withAuth && {
      bcryptjs: "^2.4.3",
      jsonwebtoken: "^9.0.2",
    }),
  };
  return JSON.stringify(
    {
      name: `${slug}-server`,
      version: "1.0.0",
      main: "src/index.js",
      scripts: { start: "node src/index.js", dev: "nodemon src/index.js" },
      dependencies: deps,
      devDependencies: { nodemon: "^3.1.0" },
    },
    null,
    2
  );
}

// FIX: health route now reports db connection state so the client UI can show it
function apiRoutes() {
  return `const express    = require('express');
const router     = express.Router();
const mongoose   = require('mongoose');
const Item       = require('../models/Item');
const requireDb  = require('../middleware/requireDb');

// Health — always responds; includes db state for the client UI
router.get('/health', (_req, res) => {
  const dbState = mongoose.connection.readyState; // 0=disconnected 1=connected 2=connecting
  res.json({
    status: 'UP',
    db:     dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// All routes below need a live DB — requireDb returns 503 immediately if not
router.use(requireDb);

// GET /api/items
router.get('/items', async (req, res, next) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 });
    res.json({ items, count: items.length });
  } catch (err) { next(err); }
});

// POST /api/items
router.post('/items', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const item = await Item.create({ name });
    res.status(201).json(item);
  } catch (err) { next(err); }
});

// DELETE /api/items/:id
router.delete('/items/:id', async (req, res, next) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
`;
}

// FIX: requireDb middleware — returns a clean 503 instead of letting Mongoose
// buffer the operation and time out after 10 seconds
function requireDbMiddleware() {
  return `const mongoose = require('mongoose');

/**
 * Rejects requests that need the database when MongoDB is not connected.
 * Returns 503 immediately so the client gets a clear error instead of
 * waiting for Mongoose's 10-second buffer timeout.
 */
module.exports = (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error:   'Database unavailable',
      hint:    'Start MongoDB locally or set MONGO_URI in server/.env to a MongoDB Atlas URI.',
    });
  }
  next();
};
`;
}

function authRoutes() {
  return `const express        = require('express');
const router         = express.Router();
const authController = require('../controllers/authController');
const auth           = require('../middleware/auth');
const requireDb      = require('../middleware/requireDb');

// All auth routes need the DB
router.use(requireDb);

router.post('/register', authController.register);
router.post('/login',    authController.login);
router.get('/me',        auth, authController.getMe);

module.exports = router;
`;
}

function authController() {
  return `const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET || 'dev-secret', {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'All fields are required' });

    if (await User.findOne({ email }))
      return res.status(409).json({ error: 'Email already registered' });

    const hash  = await bcrypt.hash(password, 12);
    const user  = await User.create({ name, email, password: hash });
    const token = signToken(user._id);

    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
};

// POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user._id);
    res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
  } catch (err) { next(err); }
};

// GET /api/auth/me
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json({ user });
  } catch (err) { next(err); }
};
`;
}

function authMiddleware() {
  return `const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'dev-secret');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};
`;
}

function errorHandlerMiddleware() {
  return `// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || err.statusCode || 500).json({
    error: err.message || 'Internal server error',
  });
};
`;
}

function itemModel() {
  return `const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    price:       { type: Number, default: null },
    inStock:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Item', ItemSchema);
`;
}

function userModel() {
  return `const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true,  trim: true },
    email:    { type: String, required: true,  unique: true, lowercase: true, trim: true },
    password: { type: String, required: true,  select: false, minlength: 6 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', UserSchema);
`;
}

// =============================================================================
// TAILWIND CONFIG FILES
// =============================================================================

function tailwindConfig() {
  return `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: { extend: { fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] } } },
  plugins: [],
};
`;
}

function postcssConfig() {
  return `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`;
}

function tailwindCss() {
  return `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@layer base {\n  body { @apply bg-gray-50 text-gray-900 antialiased; }\n}\n`;
}

// =============================================================================
// VITE CONFIG
// =============================================================================

function viteConfig() {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target:       'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
`;
}

// =============================================================================
// ROOT PACKAGE.JSON
// FIX: "--delay 3000" gives the server 3 s head-start before the client starts
//      so the first health-check doesn't always get ECONNREFUSED.
// =============================================================================

function rootPackageJson(slug) {
  return JSON.stringify(
    {
      name: slug,
      version: "1.0.0",
      private: true,
      scripts: {
        // --kill-others-on-fail: if server crashes, Vite stops too
        // --delay 3000 on client: give Express 3 s to bind before Vite opens
        dev: 'concurrently --kill-others-on-fail "npm run server" "npm run client:delayed"',
        "client:delayed":
          "node -e \"setTimeout(()=>require('child_process').spawn('npm',['run','client'],{stdio:'inherit',shell:true}),3000)\"",
        client: "cd client && npm run dev",
        server: "cd server && npm run dev",
        build: "cd client && npm run build",
        "install:all":
          "npm install && cd client && npm install && cd ../server && npm install",
      },
      devDependencies: { concurrently: "^8.2.2" },
    },
    null,
    2
  );
}

// =============================================================================
// SHARED HELPERS
// =============================================================================

function gitignore() {
  return (
    [
      "# Dependencies",
      "node_modules/",
      "",
      "# Build",
      "dist/",
      "",
      "# Env",
      ".env",
      "",
      "# OS",
      ".DS_Store",
      "Thumbs.db",
      "",
      "# Logs",
      "*.log",
      "coverage/",
    ].join("\n") + "\n"
  );
}

function readme(name, template) {
  const twLine = isTailwind(template) ? " + Tailwind CSS v3" : "";
  const authLine = isAuth(template)
    ? "- **Auth**: JWT + bcrypt · protected routes on client & server\n"
    : "";

  const mongoSection = `
## MongoDB setup

**Option A — Local MongoDB**
\`\`\`bash
# macOS
brew services start mongodb-community

# Windows
net start MongoDB

# Linux
sudo systemctl start mongod
\`\`\`

**Option B — MongoDB Atlas (free cloud cluster)**
1. Create a free cluster at https://cloud.mongodb.com
2. Get your connection string
3. Paste it into \`server/.env\`:
\`\`\`
MONGO_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/${name
    .toLowerCase()
    .replace(/\s/g, "-")}?retryWrites=true&w=majority
\`\`\`

> The server starts and \`/api/health\` responds even when MongoDB is offline.
> DB-dependent routes (\`/api/items\`, auth) return **503** immediately instead of timing out.
`;

  const authEndpoints = isAuth(template)
    ? `
## Auth endpoints

| Method | Path                  | Auth? | Description       |
|--------|-----------------------|-------|-------------------|
| POST   | \`/api/auth/register\` | —     | Create account    |
| POST   | \`/api/auth/login\`    | —     | Login → JWT token |
| GET    | \`/api/auth/me\`       | ✓     | Current user      |
`
    : "";

  return `# ${name}

Generated by **PIC-LI** — Template: \`${template}\`

## Stack
- **Client**: React${twLine} + Vite
- **Server**: Express.js + MongoDB (Mongoose)
- **Architecture**: Monorepo · Vite proxies \`/api\` → Express
${authLine}
## Quick start

\`\`\`bash
# 1. Install all dependencies
npm run install:all

# 2. Set up MongoDB (see below)

# 3. Start client + server together (run from project root)
npm run dev
\`\`\`

> ⚠ Always run \`npm run dev\` from the **project root**, not from inside \`client/\`.
> The root script starts both the Vite dev server and the Express server together.

| URL                              | Description   |
|----------------------------------|---------------|
| http://localhost:5173            | React client  |
| http://localhost:5000/api/health | Health + DB status |
${mongoSection}${authEndpoints}`;
}

module.exports = { generate };
