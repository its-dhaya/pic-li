"use strict";

const fs = require("fs-extra");
const path = require("path");
const { runSilent } = require("../../core/runCommand");

async function generate({ name, template, targetDir, onStep }) {
  const isMongo = template === "mongo";
  const isPostgres = template === "postgres";
  const isCrud = template === "crud" || isMongo || isPostgres;

  // ─── 1. Folder structure (distinct per template) ──────────────────────────
  onStep("Creating project structure");

  if (isMongo) {
    await scaffoldMongo(targetDir);
  } else if (isPostgres) {
    await scaffoldPostgres(targetDir);
  } else if (isCrud) {
    await scaffoldCrud(targetDir);
  } else {
    await scaffoldDefault(targetDir);
  }

  // ─── 2. package.json ──────────────────────────────────────────────────────
  const pkg = buildPackageJson(name, isMongo, isPostgres);
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    JSON.stringify(pkg, null, 2)
  );

  // ─── 3. Source files ──────────────────────────────────────────────────────
  onStep("Writing source files");
  await writeSourceFiles(
    targetDir,
    name,
    template,
    isMongo,
    isPostgres,
    isCrud
  );

  // ─── 4. .env ──────────────────────────────────────────────────────────────
  const env = buildEnv(pkg.name, isMongo, isPostgres);
  await fs.writeFile(path.join(targetDir, ".env"), env);
  await fs.writeFile(path.join(targetDir, ".env.example"), env);

  // ─── 5. Install ───────────────────────────────────────────────────────────
  onStep("Installing dependencies");
  await runSilent("npm install", { cwd: targetDir });

  // ─── 6. Git ───────────────────────────────────────────────────────────────
  onStep("Initializing Git");
  try {
    await runSilent("git init", { cwd: targetDir });
  } catch {}
  await fs.writeFile(
    path.join(targetDir, ".gitignore"),
    "node_modules/\n.env\n.DS_Store\n"
  );

  // ─── 7. README ────────────────────────────────────────────────────────────
  onStep("Writing README");
  await fs.writeFile(
    path.join(targetDir, "README.md"),
    buildReadme(name, template)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAFFOLD
// ─────────────────────────────────────────────────────────────────────────────

async function scaffoldDefault(targetDir) {
  // Minimal — routes + middleware only
  await fs.ensureDir(path.join(targetDir, "src", "routes"));
  await fs.ensureDir(path.join(targetDir, "src", "middleware"));
}

async function scaffoldCrud(targetDir) {
  // In-memory CRUD — routes, controllers, models (empty), middleware
  await fs.ensureDir(path.join(targetDir, "src", "routes"));
  await fs.ensureDir(path.join(targetDir, "src", "controllers"));
  await fs.ensureDir(path.join(targetDir, "src", "models"));
  await fs.ensureDir(path.join(targetDir, "src", "middleware"));
}

async function scaffoldMongo(targetDir) {
  // Full MVC — routes, controllers, models, config
  await fs.ensureDir(path.join(targetDir, "src", "routes"));
  await fs.ensureDir(path.join(targetDir, "src", "controllers"));
  await fs.ensureDir(path.join(targetDir, "src", "models"));
  await fs.ensureDir(path.join(targetDir, "src", "config"));
}

async function scaffoldPostgres(targetDir) {
  // Full MVC — routes, controllers, models, config
  await fs.ensureDir(path.join(targetDir, "src", "routes"));
  await fs.ensureDir(path.join(targetDir, "src", "controllers"));
  await fs.ensureDir(path.join(targetDir, "src", "models"));
  await fs.ensureDir(path.join(targetDir, "src", "config"));
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE FILES
// ─────────────────────────────────────────────────────────────────────────────

async function writeSourceFiles(
  targetDir,
  name,
  template,
  isMongo,
  isPostgres,
  isCrud
) {
  const write = (segments, content) =>
    fs.writeFile(path.join(targetDir, ...segments), content);

  // index.js is shared by all templates; error handler goes to middleware/
  // for default+crud, and directly to src/ for mongo/postgres (no middleware dir)
  await write(
    ["src", "index.js"],
    indexJs(name, template, isMongo, isPostgres)
  );

  if (!isCrud) {
    // ── Default ──────────────────────────────────────────────────────────────
    await write(["src", "middleware", "errorHandler.js"], errorHandlerJs());
    await write(["src", "routes", "index.js"], defaultRoutesJs());
  }

  if (isCrud && !isMongo && !isPostgres) {
    // ── REST CRUD (in-memory) ─────────────────────────────────────────────────
    // Route file is api.js per the required structure
    await write(["src", "middleware", "errorHandler.js"], errorHandlerJs());
    await write(["src", "routes", "api.js"], crudRoutesJs());
    await write(
      ["src", "controllers", "itemController.js"],
      inMemoryControllerJs()
    );
    // models/ dir exists but starts empty — placeholder README keeps it in Git
    await write(["src", "models", ".gitkeep"], "");
  }

  if (isMongo) {
    // ── MongoDB ───────────────────────────────────────────────────────────────
    // errorHandler lives in src/ directly (no middleware dir in this template)
    await write(["src", "errorHandler.js"], errorHandlerJs());
    await write(["src", "config", "db.js"], mongoConfigJs());
    await write(["src", "models", "Item.js"], mongoModelJs());
    await write(["src", "routes", "items.js"], mongoRoutesJs());
    await write(
      ["src", "controllers", "itemController.js"],
      mongoControllerJs()
    );
  }

  if (isPostgres) {
    // ── PostgreSQL ────────────────────────────────────────────────────────────
    // errorHandler lives in src/ directly (no middleware dir in this template)
    await write(["src", "errorHandler.js"], errorHandlerJs());
    await write(["src", "config", "db.js"], postgresConfigJs());
    await write(["src", "models", "Item.js"], postgresModelJs());
    await write(["src", "routes", "items.js"], postgresRoutesJs());
    await write(
      ["src", "controllers", "itemController.js"],
      postgresControllerJs()
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// index.js — wiring differs per template
// ─────────────────────────────────────────────────────────────────────────────

function indexJs(name, template, isMongo, isPostgres) {
  // Error handler path differs: middleware/ for default+crud, src/ for DB templates
  const errorHandlerPath =
    isMongo || isPostgres ? `./errorHandler` : `./middleware/errorHandler`;

  const dbImport = isMongo
    ? `const connectDB = require('./config/db');`
    : isPostgres
    ? `const { sequelize } = require('./config/db');`
    : "";

  const dbConnect = isMongo
    ? `connectDB();`
    : isPostgres
    ? `sequelize.authenticate()
  .then(() => console.log('PostgreSQL connected'))
  .catch(err => { console.error('DB connection failed:', err); process.exit(1); });`
    : "";

  // Route import + mount point per template:
  //   default  → ./routes/index  mounted at /
  //   crud     → ./routes/api    mounted at /api
  //   mongo    → ./routes/items  mounted at /api/items
  //   postgres → ./routes/items  mounted at /api/items
  const routeImport =
    isMongo || isPostgres
      ? `const itemRoutes = require('./routes/items');`
      : template === "crud"
      ? `const apiRoutes = require('./routes/api');`
      : `const routes = require('./routes/index');`;

  const routeMount =
    isMongo || isPostgres
      ? `app.use('/api/items', itemRoutes);`
      : template === "crud"
      ? `app.use('/api', apiRoutes);`
      : `app.use('/', routes);`;

  return `require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const errorHandler = require('${errorHandlerPath}');
${dbImport}
${routeImport}

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());

// ── DB ────────────────────────────────────────────────────────────────────────
${dbConnect}

// ── Routes ────────────────────────────────────────────────────────────────────
${routeMount}

// ── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler);

app.listen(PORT, () =>
  console.log('[PIC-LI] ${name} running on http://localhost:' + PORT)
);

module.exports = app;
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE / ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────

function errorHandlerJs() {
  return `// Central error handler — registered last in index.js
// Trigger with: next(err) from any route or controller
module.exports = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  console.error('[error]', err.message);
  res.status(status).json({ error: err.message || 'Internal server error' });
};
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

function defaultRoutesJs() {
  return `const express = require('express');
const router  = express.Router();

router.get('/', (req, res) => {
  res.json({
    app:    process.env.npm_package_name || 'pic-li-app',
    version: process.env.npm_package_version || '1.0.0',
    status: 'running',
  });
});

router.get('/health', (req, res) => {
  res.json({ status: 'UP', time: new Date().toISOString() });
});

module.exports = router;
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD ROUTES  — file is api.js, mounted at /api in index.js
// ─────────────────────────────────────────────────────────────────────────────

function crudRoutesJs() {
  return `const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/itemController');

// GET /api
router.get('/', (req, res) => {
  res.json({ status: 'running', endpoints: '/api/items' });
});

// GET /api/health
router.get('/health', (req, res) => {
  res.json({ status: 'UP', time: new Date().toISOString() });
});

// Items CRUD — /api/items[/:id]
router.get('/items',     controller.getAll);
router.post('/items',    controller.create);
router.get('/items/:id', controller.getOne);
router.put('/items/:id', controller.update);
router.delete('/items/:id', controller.remove);

module.exports = router;
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGO ROUTES  — file is items.js, mounted at /api/items in index.js
// ─────────────────────────────────────────────────────────────────────────────

function mongoRoutesJs() {
  return `const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/itemController');

router.get('/',    controller.getAll);
router.post('/',   controller.create);
router.get('/:id', controller.getOne);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSTGRES ROUTES  — file is items.js, mounted at /api/items in index.js
// ─────────────────────────────────────────────────────────────────────────────

function postgresRoutesJs() {
  return `const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/itemController');

router.get('/',    controller.getAll);
router.post('/',   controller.create);
router.get('/:id', controller.getOne);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

function inMemoryControllerJs() {
  return `// In-memory store — swap out for a real DB when ready
let items   = [];
let counter = 0;

exports.getAll = (req, res) => {
  res.json({ items, count: items.length });
};

exports.getOne = (req, res, next) => {
  const item = items.find(i => i.id === +req.params.id);
  if (!item) { const e = new Error('Not found'); e.status = 404; return next(e); }
  res.json(item);
};

exports.create = (req, res) => {
  const { name, price } = req.body;
  const item = { id: ++counter, name, price: price || 0 };
  items.push(item);
  res.status(201).json(item);
};

exports.update = (req, res, next) => {
  const idx = items.findIndex(i => i.id === +req.params.id);
  if (idx === -1) { const e = new Error('Not found'); e.status = 404; return next(e); }
  items[idx] = { ...items[idx], ...req.body, id: items[idx].id };
  res.json(items[idx]);
};

exports.remove = (req, res, next) => {
  const idx = items.findIndex(i => i.id === +req.params.id);
  if (idx === -1) { const e = new Error('Not found'); e.status = 404; return next(e); }
  items.splice(idx, 1);
  res.status(204).send();
};
`;
}

function mongoControllerJs() {
  return `const Item = require('../models/Item');

exports.getAll = async (req, res, next) => {
  try {
    const items = await Item.find().lean();
    res.json({ items, count: items.length });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const item = await Item.findById(req.params.id).lean();
    if (!item) { const e = new Error('Not found'); e.status = 404; return next(e); }
    res.json(item);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const item = await Item.create(req.body);
    res.status(201).json(item);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const item = await Item.findByIdAndUpdate(
      req.params.id, req.body,
      { new: true, runValidators: true }
    );
    if (!item) { const e = new Error('Not found'); e.status = 404; return next(e); }
    res.json(item);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) { const e = new Error('Not found'); e.status = 404; return next(e); }
    res.status(204).send();
  } catch (err) { next(err); }
};
`;
}

function postgresControllerJs() {
  return `const { Item } = require('../models/Item');

exports.getAll = async (req, res, next) => {
  try {
    const items = await Item.findAll();
    res.json({ items, count: items.length });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const item = await Item.findByPk(req.params.id);
    if (!item) { const e = new Error('Not found'); e.status = 404; return next(e); }
    res.json(item);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const item = await Item.create(req.body);
    res.status(201).json(item);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const [updated] = await Item.update(req.body, { where: { id: req.params.id } });
    if (!updated) { const e = new Error('Not found'); e.status = 404; return next(e); }
    const item = await Item.findByPk(req.params.id);
    res.json(item);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const deleted = await Item.destroy({ where: { id: req.params.id } });
    if (!deleted) { const e = new Error('Not found'); e.status = 404; return next(e); }
    res.status(204).send();
  } catch (err) { next(err); }
};
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG / MODELS
// ─────────────────────────────────────────────────────────────────────────────

function mongoConfigJs() {
  return `const mongoose = require('mongoose');

async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');
}

module.exports = connectDB;
`;
}

function mongoModelJs() {
  return `const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema(
  {
    name:  { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Item', itemSchema);
`;
}

function postgresConfigJs() {
  return `const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DB_URI, {
  dialect: 'postgres',
  logging: false,
});

module.exports = { sequelize };
`;
}

function postgresModelJs() {
  return `const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Item = sequelize.define('Item', {
  name:  { type: DataTypes.STRING,  allowNull: false },
  price: { type: DataTypes.DECIMAL, defaultValue: 0  },
});

sequelize.sync();

module.exports = { Item };
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildPackageJson(name, isMongo, isPostgres) {
  const pkg = {
    name: name.toLowerCase().replace(/\s+/g, "-"),
    version: "1.0.0",
    main: "src/index.js",
    scripts: {
      start: "node src/index.js",
      dev: "nodemon src/index.js",
    },
    dependencies: {
      express: "^4.18.3",
      cors: "^2.8.5",
      dotenv: "^16.4.5",
      helmet: "^7.1.0",
    },
    devDependencies: {
      nodemon: "^3.1.0",
    },
  };

  if (isMongo) pkg.dependencies.mongoose = "^8.2.2";
  if (isPostgres) pkg.dependencies.pg = "^8.11.3";
  if (isPostgres) pkg.dependencies.sequelize = "^6.37.1";

  return pkg;
}

function buildEnv(slug, isMongo, isPostgres) {
  let env = `PORT=3000\nNODE_ENV=development\n`;
  if (isMongo) env += `MONGO_URI=mongodb://localhost:27017/${slug}\n`;
  if (isPostgres)
    env += `DB_URI=postgres://user:password@localhost:5432/${slug}\n`;
  return env;
}

function buildReadme(name, template) {
  const structures = {
    default: `\`\`\`
src/
  index.js
  routes/
    index.js            ← GET /  GET /health
  middleware/
    errorHandler.js
\`\`\``,

    crud: `\`\`\`
src/
  index.js
  routes/
    api.js              ← GET|POST /api/items  GET|PUT|DELETE /api/items/:id
  controllers/
    itemController.js   ← in-memory store
  models/               ← empty, ready for your schema
  middleware/
    errorHandler.js
\`\`\``,

    mongo: `\`\`\`
src/
  index.js
  routes/
    items.js
  controllers/
    itemController.js   ← async/await, findById etc.
  models/
    Item.js             ← Mongoose schema + timestamps
  config/
    db.js               ← connectDB() via Mongoose
.env                    ← MONGO_URI
\`\`\``,

    postgres: `\`\`\`
src/
  index.js
  routes/
    items.js
  controllers/
    itemController.js   ← findAll / findByPk / create / update / destroy
  models/
    Item.js             ← sequelize.define + sync
  config/
    db.js               ← Sequelize instance
.env                    ← DB_URI
\`\`\``,
  };

  const stacks = {
    default: "Express.js (minimal)",
    crud: "Express.js + in-memory CRUD",
    mongo: "Express.js + MongoDB (Mongoose)",
    postgres: "Express.js + PostgreSQL (Sequelize)",
  };

  return `# ${name}

Generated by **PIC-LI**

## Stack
- ${stacks[template] || "Express.js"}

## Run

\`\`\`bash
npm run dev
\`\`\`

API: http://localhost:3000

## Structure

${structures[template] || structures.default}
`;
}

module.exports = { generate };
