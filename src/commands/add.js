'use strict';

const path = require('path');
const fs   = require('fs-extra');
const logger  = require('../utils/cli/logger');
const { runSilent } = require('../core/runCommand');
const { ADD_INTEGRATIONS } = require('../config/stacks');

// ── Integration installers ────────────────────────────────────────────────────

const INSTALLERS = {

  tailwind: async ({ cwd, stackId, onStep }) => {
    onStep('Installing Tailwind CSS v3');
    runSilent('npm install -D tailwindcss@3 postcss autoprefixer', { cwd });

    onStep('Writing tailwind.config.js (no npx init needed)');
    const content = fs.existsSync(path.join(cwd, 'src', 'App.jsx')) || fs.existsSync(path.join(cwd, 'src', 'App.tsx'))
      ? `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n}\n`
      : `/** @type {import('tailwindcss').Config} */\nmodule.exports = {\n  content: ['./src/**/*.{js,jsx,ts,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n}\n`;
    fs.writeFileSync(path.join(cwd, 'tailwind.config.js'), content);
    fs.writeFileSync(path.join(cwd, 'postcss.config.js'),
      `export default { plugins: { tailwindcss: {}, autoprefixer: {} } }\n`
    );

    onStep('Prepending Tailwind directives to CSS entry');
    const cssFiles = ['src/index.css','src/styles/index.css','src/App.css','src/global.css','src/style.css'];
    let patched = false;
    for (const f of cssFiles) {
      const p = path.join(cwd, f);
      if (fs.existsSync(p)) {
        const old = fs.readFileSync(p, 'utf8');
        fs.writeFileSync(p, '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n' + old);
        patched = true;
        break;
      }
    }
    if (!patched) {
      fs.ensureDirSync(path.join(cwd, 'src'));
      fs.writeFileSync(path.join(cwd, 'src', 'index.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
    }
  },

  eslint: async ({ cwd, onStep }) => {
    onStep('Installing ESLint + Prettier');
    runSilent('npm install -D eslint prettier eslint-config-prettier eslint-plugin-prettier', { cwd });
    onStep('Writing .eslintrc.json');
    fs.writeJSONSync(path.join(cwd, '.eslintrc.json'), {
      env: { browser: true, es2021: true, node: true },
      extends: ['eslint:recommended', 'plugin:prettier/recommended'],
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: { 'prettier/prettier': 'warn' },
    }, { spaces: 2 });
    onStep('Writing .prettierrc');
    fs.writeJSONSync(path.join(cwd, '.prettierrc'), {
      semi: true, singleQuote: true, tabWidth: 2, trailingComma: 'es5', printWidth: 100,
    }, { spaces: 2 });
    const pkg = readPkg(cwd);
    pkg.scripts = { ...pkg.scripts, lint: 'eslint src --ext .js,.jsx,.ts,.tsx', format: 'prettier --write src' };
    writePkg(cwd, pkg);
  },

  docker: async ({ cwd, stackId, onStep }) => {
    onStep('Writing Dockerfile');
    fs.writeFileSync(path.join(cwd, 'Dockerfile'), dockerfile(stackId));
    onStep('Writing docker-compose.yml');
    fs.writeFileSync(path.join(cwd, 'docker-compose.yml'), dockerCompose(stackId));
    onStep('Writing .dockerignore');
    fs.writeFileSync(path.join(cwd, '.dockerignore'), 'node_modules/\n.env\n.DS_Store\ndist/\nvenv/\n__pycache__/\n');
  },

  firebase: async ({ cwd, onStep }) => {
    onStep('Installing Firebase SDK');
    runSilent('npm install firebase', { cwd });
    onStep('Writing src/firebase.js');
    fs.ensureDirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'firebase.js'), firebaseConfig());
    const env = path.join(cwd, '.env');
    const vars = `\n# Firebase\nVITE_FB_API_KEY=\nVITE_FB_AUTH_DOMAIN=\nVITE_FB_PROJECT_ID=\nVITE_FB_STORAGE_BUCKET=\nVITE_FB_MSG_SENDER_ID=\nVITE_FB_APP_ID=\n`;
    fs.appendFileSync(env, vars);
  },

  prisma: async ({ cwd, onStep }) => {
    onStep('Installing Prisma');
    runSilent('npm install prisma @prisma/client', { cwd });
    onStep('Initialising Prisma schema');
    runSilent('npx prisma init', { cwd });
    onStep('Adding generate script');
    const pkg = readPkg(cwd);
    pkg.scripts = { ...pkg.scripts, 'db:generate': 'prisma generate', 'db:migrate': 'prisma migrate dev', 'db:studio': 'prisma studio' };
    writePkg(cwd, pkg);
  },

  mongoose: async ({ cwd, onStep }) => {
    onStep('Installing Mongoose');
    runSilent('npm install mongoose', { cwd });
    onStep('Writing src/db.js connection helper');
    fs.ensureDirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'db.js'), mongooseHelper());
  },

  shadcn: async ({ cwd, onStep }) => {
    onStep('Installing shadcn/ui prerequisites');
    runSilent('npm install class-variance-authority clsx tailwind-merge lucide-react @radix-ui/react-slot', { cwd });
    onStep('Writing lib/utils.ts');
    fs.ensureDirSync(path.join(cwd, 'src', 'lib'));
    fs.writeFileSync(path.join(cwd, 'src', 'lib', 'utils.ts'),
      `import { clsx, type ClassValue } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\n\nexport function cn(...inputs: ClassValue[]) {\n  return twMerge(clsx(inputs));\n}\n`);
  },

  husky: async ({ cwd, onStep }) => {
    onStep('Installing Husky + lint-staged');
    runSilent('npm install -D husky lint-staged', { cwd });
    runSilent('npx husky init', { cwd });
    const pkg = readPkg(cwd);
    pkg['lint-staged'] = { 'src/**/*.{js,jsx,ts,tsx}': ['eslint --fix', 'prettier --write'] };
    writePkg(cwd, pkg);
  },

  auth: async ({ cwd, stackId, onStep }) => {
    if (['express', 'nestjs', 'mern'].includes(stackId)) {
      onStep('Installing JWT auth packages');
      runSilent('npm install jsonwebtoken bcryptjs', { cwd });
      onStep('Writing src/middleware/auth.js');
      const dir = path.join(cwd, 'src', 'middleware');
      fs.ensureDirSync(dir);
      fs.writeFileSync(path.join(dir, 'auth.js'),
        `const jwt = require('jsonwebtoken');\nmodule.exports = (req, res, next) => {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.status(401).json({ error: 'Unauthorized' });\n  try { req.user = jwt.verify(token, process.env.JWT_SECRET || 'secret'); next(); }\n  catch { res.status(401).json({ error: 'Invalid token' }); }\n};\n`
      );
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readPkg(cwd) {
  const p = path.join(cwd, 'package.json');
  return fs.existsSync(p) ? fs.readJSONSync(p) : {};
}
function writePkg(cwd, pkg) {
  fs.writeJSONSync(path.join(cwd, 'package.json'), pkg, { spaces: 2 });
}

function dockerfile(stackId) {
  if (['fastapi','flask','django'].includes(stackId)) {
    return `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]\n`;
  }
  if (['spring-boot','spring-gradle'].includes(stackId)) {
    return `FROM eclipse-temurin:21-jdk-alpine AS build\nWORKDIR /app\nCOPY . .\nRUN ./mvnw package -DskipTests\n\nFROM eclipse-temurin:21-jre-alpine\nWORKDIR /app\nCOPY --from=build /app/target/*.jar app.jar\nEXPOSE 8080\nENTRYPOINT ["java","-jar","app.jar"]\n`;
  }
  return `FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json .\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "src/index.js"]\n`;
}

function dockerCompose(stackId) {
  const port = ['spring-boot','spring-gradle'].includes(stackId) ? 8080
    : ['fastapi','flask','django'].includes(stackId) ? 8000 : 3000;
  return `version: '3.8'\nservices:\n  app:\n    build: .\n    ports:\n      - "${port}:${port}"\n    env_file:\n      - .env\n    restart: unless-stopped\n`;
}

function firebaseConfig() {
  return `import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FB_API_KEY,
  authDomain:        import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MSG_SENDER_ID,
  appId:             import.meta.env.VITE_FB_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export default app;
`;
}

function mongooseHelper() {
  return `const mongoose = require('mongoose');\n\nmodule.exports = async () => {\n  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/app';\n  await mongoose.connect(uri);\n  console.log('[PIC-LI] MongoDB connected');\n};\n`;
}

// ── Command entry ─────────────────────────────────────────────────────────────

async function addCommand(integration, opts) {
  logger.brand();

  const cwd = process.cwd();
  const picConfig = path.join(cwd, '.pic', 'config.json');
  let stackId = opts.stack || null;

  // Read pic config if it exists
  if (!stackId && fs.existsSync(picConfig)) {
    try { stackId = fs.readJSONSync(picConfig).stackId; } catch {}
  }

  const intKey = integration.toLowerCase();
  const installer = INSTALLERS[intKey];

  if (!installer) {
    logger.error(`Unknown integration: "${integration}"`);
    logger.blank();
    logger.info('Available integrations:');
    Object.keys(INSTALLERS).forEach(k => logger.detail(k));
    logger.blank();
    process.exit(1);
  }

  if (stackId) {
    const info = ADD_INTEGRATIONS[intKey];
    if (info && info.supports.length && !info.supports.includes(stackId)) {
      logger.warn(`"${integration}" may not be compatible with ${stackId}`);
    }
  }

  logger.section(`Adding ${integration}`);
  logger.blank();

  const steps = [];
  function onStep(label) {
    steps.push(label);
    logger.detail(label);
  }

  try {
    await installer({ cwd, stackId, onStep });
    logger.blank();
    logger.success(`${integration} added successfully`);
    logger.blank();
  } catch (err) {
    logger.error(`Failed to add ${integration}: ${err.message}`);
    if (process.env.PIC_DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

module.exports = { addCommand, INSTALLERS };
