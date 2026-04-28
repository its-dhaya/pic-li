"use strict";

const fs = require("fs-extra");
const path = require("path");
const {
  runSilent,
  getPython,
  getVenvPip,
  isWin,
  q,
} = require("../../core/runCommand");

// ─── Template flags ───────────────────────────────────────────────────────────
const isRest = (t) => t.includes("rest") || t.includes("crud");
const isSqlOrm = (t) =>
  t.includes("sqlalchemy") || t.includes("sql") || t.includes("orm");
// default = neither

// ─── Entry point ──────────────────────────────────────────────────────────────
async function generate({ name, template, targetDir, onStep }) {
  const python = getPython();
  if (!python)
    throw new Error(
      "Python 3 is not installed or not in PATH.\n       Run: pic setup"
    );

  onStep("Creating project structure");
  createStructure(targetDir, template);

  onStep("Writing application files");
  writeAppFiles(name, template, targetDir);

  onStep("Writing requirements.txt");
  fs.writeFileSync(
    path.join(targetDir, "requirements.txt"),
    requirements(template)
  );

  onStep("Writing .env");
  const env = envContent(template);
  fs.writeFileSync(path.join(targetDir, ".env"), env);
  fs.writeFileSync(path.join(targetDir, ".env.example"), env);

  onStep(`Creating virtual environment  (${python})`);
  runSilent(`${q(python)} -m venv venv`, { cwd: targetDir });

  // pip upgrade is intentionally omitted.
  // We only install what is missing from requirements.txt — that is all that is needed.
  // pip upgrade on Windows causes "project creation failed" even though files are intact.
  onStep("Installing dependencies");
  const pip = getVenvPip(targetDir);
  runSilent(`${pip} install -r requirements.txt --quiet`, { cwd: targetDir });

  onStep("Initializing Git");
  try {
    runSilent("git init", { cwd: targetDir });
  } catch (_) {
    /* git unavailable */
  }
  fs.writeFileSync(path.join(targetDir, ".gitignore"), gitignore(template));

  onStep("Writing README");
  fs.writeFileSync(path.join(targetDir, "README.md"), readme(name, template));
}

// ═════════════════════════════════════════════════════════════════════════════
// DIRECTORY SCAFFOLDING
// ═════════════════════════════════════════════════════════════════════════════

function createStructure(targetDir, template) {
  const dirs = ["app/routes", "tests"];

  if (isSqlOrm(template)) {
    dirs.push("app/models");
  } else if (isRest(template)) {
    dirs.push("app/schemas", "app/middleware");
  } else {
    dirs.push("app/templates", "app/static/css");
  }

  dirs.forEach((d) => fs.ensureDirSync(path.join(targetDir, d)));

  // Python package markers
  const pkgs = ["app", "app/routes", "tests"];
  if (isSqlOrm(template)) pkgs.push("app/models");
  if (isRest(template)) pkgs.push("app/schemas", "app/middleware");
  pkgs.forEach((d) =>
    fs.writeFileSync(path.join(targetDir, d, "__init__.py"), "")
  );
}

// ─── File dispatcher ──────────────────────────────────────────────────────────
function writeAppFiles(name, template, targetDir) {
  const w = (rel, content) =>
    fs.writeFileSync(path.join(targetDir, rel), content);

  w("run.py", runPy());
  w("app/config.py", flaskConfig(template));

  if (isSqlOrm(template)) {
    w("app/__init__.py", appFactorySqlOrm());
    w("app/extensions.py", extensions());
    w("app/routes/__init__.py", "");
    w("app/routes/items.py", sqlOrmItemRoutes());
    w("app/models/__init__.py", "");
    w("app/models/item.py", itemModel());
    w("tests/test_items.py", testsSqlOrm());
  } else if (isRest(template)) {
    w("app/__init__.py", appFactoryRest());
    w("app/routes/__init__.py", "");
    w("app/routes/items.py", restCrudRoutes());
    w("app/schemas/__init__.py", "");
    w("app/schemas/item.py", itemSchema());
    w("app/middleware/__init__.py", "");
    w("app/middleware/errors.py", errorHandlers());
    w("tests/test_items.py", testsRest());
  } else {
    w("app/__init__.py", appFactoryDefault());
    w("app/routes/__init__.py", "");
    w("app/routes/main.py", defaultMainRoutes());
    w("app/templates/base.html", baseTemplate(name));
    w("app/templates/index.html", indexTemplate(name));
    w("app/static/css/style.css", baseCSS());
    w("tests/test_app.py", testsDefault());
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// APP FACTORIES
// ═════════════════════════════════════════════════════════════════════════════

function appFactoryDefault() {
  return `from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def create_app():
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config.from_object("app.config.Config")
    CORS(app)

    from app.routes.main import main
    app.register_blueprint(main)

    return app
`;
}

function appFactoryRest() {
  return `from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def create_app():
    app = Flask(__name__)
    app.config.from_object("app.config.Config")
    CORS(app)

    from app.routes.items import items_bp
    from app.middleware.errors import register_error_handlers

    app.register_blueprint(items_bp, url_prefix="/api/v1/items")
    register_error_handlers(app)

    return app
`;
}

function appFactorySqlOrm() {
  return `from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def create_app():
    app = Flask(__name__)
    app.config.from_object("app.config.Config")
    CORS(app)

    from app.extensions import db, migrate
    db.init_app(app)
    migrate.init_app(app, db)

    with app.app_context():
        from app.models import item  # noqa: F401 — registers models
        db.create_all()

    from app.routes.items import items_bp
    app.register_blueprint(items_bp, url_prefix="/api/v1/items")

    return app
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════════════════════

function flaskConfig(template) {
  const dbLines = isSqlOrm(template)
    ? `\n    SQLALCHEMY_DATABASE_URI      = os.getenv("DATABASE_URL", "sqlite:///app.db")\n    SQLALCHEMY_TRACK_MODIFICATIONS = False`
    : "";

  return `import os


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    DEBUG       = os.getenv("FLASK_ENV") == "development"${dbLines}
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXTENSIONS  (SQL ORM only)
// ═════════════════════════════════════════════════════════════════════════════

function extensions() {
  return `from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

db      = SQLAlchemy()
migrate = Migrate()
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

function defaultMainRoutes() {
  return `from flask import Blueprint, render_template, jsonify

main = Blueprint("main", __name__)


@main.route("/")
def index():
    return render_template("index.html")


@main.route("/health")
def health():
    return jsonify({"status": "UP"})
`;
}

function restCrudRoutes() {
  return `from flask import Blueprint, jsonify, request
from app.schemas.item import validate_item

items_bp = Blueprint("items", __name__)
_store   = {}
_next_id = [1]


@items_bp.route("/", methods=["GET"])
def list_items():
    return jsonify(list(_store.values())), 200


@items_bp.route("/<int:item_id>", methods=["GET"])
def get_item(item_id):
    item = _store.get(item_id)
    if not item:
        return jsonify({"error": "Item not found"}), 404
    return jsonify(item), 200


@items_bp.route("/", methods=["POST"])
def create_item():
    data, err = validate_item(request.get_json())
    if err:
        return jsonify({"error": err}), 400
    item_id         = _next_id[0]
    _next_id[0]    += 1
    item            = {"id": item_id, **data}
    _store[item_id] = item
    return jsonify(item), 201


@items_bp.route("/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    if item_id not in _store:
        return jsonify({"error": "Item not found"}), 404
    data, err = validate_item(request.get_json())
    if err:
        return jsonify({"error": err}), 400
    _store[item_id] = {"id": item_id, **data}
    return jsonify(_store[item_id]), 200


@items_bp.route("/<int:item_id>", methods=["PATCH"])
def patch_item(item_id):
    if item_id not in _store:
        return jsonify({"error": "Item not found"}), 404
    body = request.get_json() or {}
    _store[item_id].update({k: v for k, v in body.items() if k != "id"})
    return jsonify(_store[item_id]), 200


@items_bp.route("/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    if item_id not in _store:
        return jsonify({"error": "Item not found"}), 404
    del _store[item_id]
    return "", 204
`;
}

function sqlOrmItemRoutes() {
  return `from flask import Blueprint, jsonify, request
from app.extensions import db
from app.models.item import Item

items_bp = Blueprint("items", __name__)


@items_bp.route("/", methods=["GET"])
def list_items():
    page     = request.args.get("page",  1,  type=int)
    per_page = request.args.get("limit", 20, type=int)
    pag      = Item.query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        "items":  [i.to_dict() for i in pag.items],
        "total":  pag.total,
        "page":   pag.page,
        "pages":  pag.pages,
    }), 200


@items_bp.route("/<int:item_id>", methods=["GET"])
def get_item(item_id):
    item = db.get_or_404(Item, item_id)
    return jsonify(item.to_dict()), 200


@items_bp.route("/", methods=["POST"])
def create_item():
    data = request.get_json() or {}
    if not data.get("name"):
        return jsonify({"error": "'name' is required"}), 400
    item = Item(name=data["name"], description=data.get("description"), price=data.get("price"))
    db.session.add(item)
    db.session.commit()
    return jsonify(item.to_dict()), 201


@items_bp.route("/<int:item_id>", methods=["PUT"])
def update_item(item_id):
    item = db.get_or_404(Item, item_id)
    data = request.get_json() or {}
    if not data.get("name"):
        return jsonify({"error": "'name' is required"}), 400
    item.name        = data["name"]
    item.description = data.get("description")
    item.price       = data.get("price")
    db.session.commit()
    return jsonify(item.to_dict()), 200


@items_bp.route("/<int:item_id>", methods=["PATCH"])
def patch_item(item_id):
    item = db.get_or_404(Item, item_id)
    data = request.get_json() or {}
    for field in ("name", "description", "price"):
        if field in data:
            setattr(item, field, data[field])
    db.session.commit()
    return jsonify(item.to_dict()), 200


@items_bp.route("/<int:item_id>", methods=["DELETE"])
def delete_item(item_id):
    item = db.get_or_404(Item, item_id)
    db.session.delete(item)
    db.session.commit()
    return "", 204
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHEMA  (REST only)
// ═════════════════════════════════════════════════════════════════════════════

function itemSchema() {
  return `ALLOWED_FIELDS = {"name", "description", "price"}


def validate_item(data):
    """Returns (clean_data, error_string | None)."""
    if not data or not isinstance(data, dict):
        return None, "Request body must be JSON"
    if not data.get("name"):
        return None, "'name' is required"
    clean = {k: v for k, v in data.items() if k in ALLOWED_FIELDS}
    if "price" in clean:
        try:
            clean["price"] = float(clean["price"])
        except (TypeError, ValueError):
            return None, "'price' must be a number"
    return clean, None
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE  (REST only)
// ═════════════════════════════════════════════════════════════════════════════

function errorHandlers() {
  return `from flask import jsonify


def register_error_handlers(app):

    @app.errorhandler(400)
    def bad_request(e):
        return jsonify({"error": "Bad request", "detail": str(e)}), 400

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Not found", "detail": str(e)}), 404

    @app.errorhandler(405)
    def method_not_allowed(e):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(500)
    def internal_error(e):
        return jsonify({"error": "Internal server error"}), 500
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// MODEL  (SQL ORM only)
// ═════════════════════════════════════════════════════════════════════════════

function itemModel() {
  return `from app.extensions import db
from datetime import datetime, timezone


def _now():
    return datetime.now(timezone.utc)


class Item(db.Model):
    __tablename__ = "items"

    id          = db.Column(db.Integer,     primary_key=True)
    name        = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text,        nullable=True)
    price       = db.Column(db.Float,       nullable=True)
    created_at  = db.Column(db.DateTime,    default=_now, nullable=False)
    updated_at  = db.Column(db.DateTime,    default=_now, onupdate=_now, nullable=False)

    def to_dict(self):
        return {
            "id":          self.id,
            "name":        self.name,
            "description": self.description,
            "price":       self.price,
            "created_at":  self.created_at.isoformat() if self.created_at else None,
            "updated_at":  self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<Item {self.id} {self.name!r}>"
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATES  (Default only)
// ═════════════════════════════════════════════════════════════════════════════

function baseTemplate(name) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{% block title %}${name}{% endblock %}</title>
  <link rel="stylesheet" href="{{ url_for('static', filename='css/style.css') }}" />
</head>
<body>
  <header><h1>${name}</h1></header>
  <main>{% block content %}{% endblock %}</main>
  <footer><p>Built with Flask</p></footer>
</body>
</html>
`;
}

function indexTemplate(name) {
  return `{% extends "base.html" %}
{% block title %}Home – ${name}{% endblock %}
{% block content %}
  <h2>Welcome to ${name}</h2>
  <p>Your Flask app is running. Edit <code>app/routes/main.py</code> to get started.</p>
{% endblock %}
`;
}

function baseCSS() {
  return `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body   { font-family: system-ui, sans-serif; padding: 2rem; color: #1a1a1a; }
header { border-bottom: 2px solid #e0e0e0; padding-bottom: 1rem; margin-bottom: 2rem; }
footer { margin-top: 3rem; color: #666; font-size: 0.85rem; }
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

function testsDefault() {
  return `import pytest
from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_index(client):
    r = client.get("/")
    assert r.status_code == 200


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.get_json()["status"] == "UP"
`;
}

function testsRest() {
  return `import pytest
from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_list_empty(client):
    r = client.get("/api/v1/items/")
    assert r.status_code == 200
    assert r.get_json() == []


def test_create_item(client):
    r = client.post("/api/v1/items/", json={"name": "Widget", "price": 9.99})
    assert r.status_code == 201
    data = r.get_json()
    assert data["name"] == "Widget"
    assert "id" in data


def test_get_item(client):
    create = client.post("/api/v1/items/", json={"name": "Gadget", "price": 4.99})
    item_id = create.get_json()["id"]
    r = client.get(f"/api/v1/items/{item_id}")
    assert r.status_code == 200
    assert r.get_json()["name"] == "Gadget"


def test_delete_item(client):
    create = client.post("/api/v1/items/", json={"name": "Temp", "price": 1.0})
    item_id = create.get_json()["id"]
    r = client.delete(f"/api/v1/items/{item_id}")
    assert r.status_code == 204


def test_create_missing_name(client):
    r = client.post("/api/v1/items/", json={"price": 5.0})
    assert r.status_code == 400
`;
}

function testsSqlOrm() {
  return `import pytest
from app import create_app
from app.extensions import db as _db


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"]                  = True
    app.config["SQLALCHEMY_DATABASE_URI"]  = "sqlite:///:memory:"
    with app.app_context():
        _db.create_all()
        with app.test_client() as c:
            yield c
        _db.drop_all()


def test_list_items(client):
    r = client.get("/api/v1/items/")
    assert r.status_code == 200
    assert r.get_json()["items"] == []


def test_create_item(client):
    r = client.post("/api/v1/items/", json={"name": "Widget", "price": 9.99})
    assert r.status_code == 201
    assert r.get_json()["name"] == "Widget"


def test_get_item(client):
    create = client.post("/api/v1/items/", json={"name": "Gadget"})
    item_id = create.get_json()["id"]
    r = client.get(f"/api/v1/items/{item_id}")
    assert r.status_code == 200


def test_delete_item(client):
    create = client.post("/api/v1/items/", json={"name": "Temp"})
    item_id = create.get_json()["id"]
    assert client.delete(f"/api/v1/items/{item_id}").status_code == 204
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED
// ═════════════════════════════════════════════════════════════════════════════

function runPy() {
  return `from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
`;
}

function requirements(template) {
  const pkgs = ["flask>=3.0.0", "flask-cors>=4.0.0", "python-dotenv>=1.0.0"];
  if (isSqlOrm(template)) {
    pkgs.push("flask-sqlalchemy>=3.1.0", "flask-migrate>=4.0.0");
  }
  return pkgs.join("\n") + "\n";
}

function envContent(template) {
  const base =
    "FLASK_APP=run.py\nFLASK_ENV=development\nSECRET_KEY=change-me\n";
  return isSqlOrm(template) ? base + "DATABASE_URL=sqlite:///app.db\n" : base;
}

function gitignore(template) {
  const base = [
    "venv/",
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    ".env",
    "*.db",
    "*.sqlite3",
    ".DS_Store",
    "instance/",
    ".pytest_cache/",
  ];
  if (isSqlOrm(template)) base.push("migrations/versions/*.pyc");
  return base.join("\n") + "\n";
}

function readme(name, template) {
  const activate = isWin
    ? "venv\\Scripts\\activate"
    : "source venv/bin/activate";

  const dbSection = isSqlOrm(template)
    ? `\n### Database migrations\n\`\`\`bash\nflask db init\nflask db migrate -m "initial"\nflask db upgrade\n\`\`\``
    : "";

  const apiSection =
    isRest(template) || isSqlOrm(template)
      ? `\n### API endpoints\n| Method | Path | Description |\n|--------|------|-------------|\n| GET | \`/api/v1/items/\` | List items |\n| POST | \`/api/v1/items/\` | Create item |\n| GET | \`/api/v1/items/<id>\` | Get item |\n| PUT | \`/api/v1/items/<id>\` | Replace item |\n| PATCH | \`/api/v1/items/<id>\` | Partial update |\n| DELETE | \`/api/v1/items/<id>\` | Delete item |`
      : "";

  return `# ${name}

Generated by **PIC-LI** · Template: \`${template}\`

## Quick start

\`\`\`bash
${activate}
flask run
\`\`\`
${dbSection}
App → http://localhost:5000
${apiSection}
`;
}

module.exports = { generate };
