"use strict";

const fs = require("fs-extra");
const path = require("path");
const { spawnSync } = require("child_process");
const { getPython, isWin } = require("../../core/runCommand");

// ─── Safe command runner ──────────────────────────────────────────────────────
// Uses spawnSync with an args array — NO shell interpolation, so paths with
// spaces (e.g. "C:\flutter scr\testing\...") are passed verbatim to the OS.
// This fixes the Windows `'""C:\flutter'` double-quote error entirely.
function run(file, args, { cwd, allowFail = false } = {}) {
  const result = spawnSync(file, args, {
    cwd,
    stdio: "pipe",
    shell: false, // ← critical: no cmd.exe / sh interpolation
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

// ─── Venv helpers (absolute paths — no shell quoting needed) ─────────────────
const venvPython = (d) =>
  isWin
    ? path.join(d, "venv", "Scripts", "python.exe")
    : path.join(d, "venv", "bin", "python3");

const venvPip = (d) =>
  isWin
    ? path.join(d, "venv", "Scripts", "pip.exe")
    : path.join(d, "venv", "bin", "pip3");

const djangoAdminBin = (d) =>
  isWin
    ? path.join(d, "venv", "Scripts", "django-admin.exe")
    : path.join(d, "venv", "bin", "django-admin");

// ─── Template flags ──────────────────────────────────────────────────────────
const isRest = (t) =>
  t.includes("rest") || t.includes("crud") || t.includes("api");
const isPostgres = (t) => t.includes("postgres") || t.includes("pg");

// ─── Entry point ─────────────────────────────────────────────────────────────
async function generate({ name, template, targetDir, onStep }) {
  const python = getPython();
  if (!python)
    throw new Error(
      "Python 3 is not installed or not in PATH.\n       Run: pic setup"
    );

  const slug = name
    .toLowerCase()
    .replace(/[\s-]/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  // ── 1. Virtual environment ──────────────────────────────────────────────────
  onStep("Creating virtual environment");
  fs.ensureDirSync(targetDir);
  run(python, ["-m", "venv", "venv"], { cwd: targetDir });

  // ── 2. Install dependencies ─────────────────────────────────────────────────
  onStep("Writing requirements.txt");
  fs.writeFileSync(
    path.join(targetDir, "requirements.txt"),
    requirements(template)
  );

  onStep("Installing dependencies");
  // --disable-pip-version-check suppresses the "new pip version" notice so it
  // never leaks a non-zero exit code or confusing stderr into the step output.
  run(
    venvPip(targetDir),
    [
      "install",
      "-r",
      "requirements.txt",
      "--quiet",
      "--disable-pip-version-check",
    ],
    { cwd: targetDir }
  );

  // Verify no conflicts (replaces the old "pip upgrade" noise).
  // allowFail = true so a warning never aborts project creation.
  onStep("Checking dependency compatibility");
  run(venvPip(targetDir), ["check", "--disable-pip-version-check"], {
    cwd: targetDir,
    allowFail: true,
  });

  // ── 3. Scaffold Django project as "config" ──────────────────────────────────
  // We always name the Django package "config" so the directory layout is
  // predictable regardless of what the user calls the project.
  onStep("Scaffolding Django project");
  run(djangoAdminBin(targetDir), ["startproject", "config", "."], {
    cwd: targetDir,
  });

  // ── 4. Create app inside apps/ ──────────────────────────────────────────────
  onStep("Creating apps");
  const appName = isRest(template) || isPostgres(template) ? "api" : "core";
  const appsDir = path.join(targetDir, "apps");
  const appDir = path.join(appsDir, appName);
  fs.ensureDirSync(appsDir);
  fs.writeFileSync(path.join(appsDir, "__init__.py"), "");
  // Pass the absolute appDir path so manage.py places the app there directly.
  run(venvPython(targetDir), ["manage.py", "startapp", appName, appDir], {
    cwd: targetDir,
  });
  // Fix apps.py: name must be 'apps.<appName>' so Django resolves the module.
  patchAppConfig(appDir, appName);

  // ── 5. Settings ─────────────────────────────────────────────────────────────
  onStep("Patching settings");
  if (isPostgres(template)) {
    buildSplitSettings(targetDir, slug);
    // Point manage.py / wsgi.py / asgi.py at config.settings.local
    patchEntryPoints(targetDir, "config.settings.local");
  } else {
    patchSettings(targetDir, template);
  }

  // ── 6. App files ────────────────────────────────────────────────────────────
  onStep("Writing app files");
  if (isPostgres(template)) {
    writePostgresApp(appDir);
  } else if (isRest(template)) {
    writeRestApp(appDir);
  } else {
    writeDefaultApp(appDir, name);
  }

  // ── 7. Project URLs ─────────────────────────────────────────────────────────
  onStep("Writing project URLs");
  writeProjectUrls(targetDir, template);

  // ── 8. Extra dirs for postgres ──────────────────────────────────────────────
  if (isPostgres(template)) {
    fs.ensureDirSync(path.join(targetDir, "static"));
    fs.ensureDirSync(path.join(targetDir, "media"));
  }

  // ── 9. .env / .gitignore / README ───────────────────────────────────────────
  onStep("Writing .env");
  const env = envContent(template, slug);
  fs.writeFileSync(path.join(targetDir, ".env"), env);
  fs.writeFileSync(path.join(targetDir, ".env.example"), env);

  onStep("Writing README");
  fs.writeFileSync(path.join(targetDir, "README.md"), readme(name, template));

  onStep("Initializing Git");
  run("git", ["init"], { cwd: targetDir, allowFail: true });
  fs.writeFileSync(path.join(targetDir, ".gitignore"), gitignore());

  // ── 10. Initial migrations (skipped for postgres — needs a live DB) ─────────
  onStep("Running initial migrations");
  if (!isPostgres(template)) {
    run(venvPython(targetDir), ["manage.py", "migrate"], {
      cwd: targetDir,
      allowFail: true,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// APP CONFIG PATCHER
// ═════════════════════════════════════════════════════════════════════════════

function patchAppConfig(appDir, appName) {
  const appsPath = path.join(appDir, "apps.py");
  if (!fs.existsSync(appsPath)) return;
  let c = fs.readFileSync(appsPath, "utf8");
  // Django needs name = 'apps.<appName>' to resolve the module path correctly.
  // label keeps the short name for migrations / admin so nothing else breaks.
  c = c.replace(
    `name = '${appName}'`,
    `name = 'apps.${appName}'\n    label = '${appName}'`
  );
  fs.writeFileSync(appsPath, c);
}

// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS — default & rest  (single config/settings.py)
// ═════════════════════════════════════════════════════════════════════════════

function patchSettings(targetDir, template) {
  const p = path.join(targetDir, "config", "settings.py");
  if (!fs.existsSync(p)) return;
  let c = fs.readFileSync(p, "utf8");

  // Env-driven core knobs
  c = c.replace(
    /SECRET_KEY = ['"]django-insecure-[^'"]*['"]/,
    `SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-insecure-key')`
  );
  c = c.replace(
    "DEBUG = True",
    `DEBUG = os.environ.get('DEBUG', 'True') == 'True'`
  );
  c = c.replace(
    "ALLOWED_HOSTS = []",
    `ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')`
  );
  c = "import os\n\n" + c;

  // INSTALLED_APPS
  const extraApps = isRest(template)
    ? `    'rest_framework',\n    'corsheaders',\n    'apps.api',`
    : `    'corsheaders',\n    'apps.core',`;
  c = c.replace(
    `'django.contrib.staticfiles',`,
    `'django.contrib.staticfiles',\n${extraApps}`
  );

  // CORS middleware before CommonMiddleware
  c = c.replace(
    `'django.middleware.common.CommonMiddleware',`,
    `'corsheaders.middleware.CorsMiddleware',\n    'django.middleware.common.CommonMiddleware',`
  );

  // Default template: template + static dirs
  if (!isRest(template)) {
    c = c.replace(
      `'DIRS': [],`,
      `'DIRS': [BASE_DIR / 'apps' / 'core' / 'templates'],`
    );
    c += `\nSTATICFILES_DIRS = [BASE_DIR / 'apps' / 'core' / 'static']\n`;
  }

  // DRF block for REST
  if (isRest(template)) {
    c += `
CORS_ALLOW_ALL_ORIGINS = True

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES':   ['rest_framework.parsers.JSONParser'],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}
`;
  } else {
    c += `\nCORS_ALLOW_ALL_ORIGINS = True\n`;
  }

  fs.writeFileSync(p, c);
}

// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS — postgres  (split into config/settings/{base,local,production}.py)
// ═════════════════════════════════════════════════════════════════════════════

function buildSplitSettings(targetDir, slug) {
  const configDir = path.join(targetDir, "config");
  const settingsFile = path.join(configDir, "settings.py");
  const settingsDir = path.join(configDir, "settings");

  // Remove the single settings.py that startproject created
  fs.removeSync(settingsFile);
  fs.ensureDirSync(settingsDir);

  fs.writeFileSync(path.join(settingsDir, "__init__.py"), "");
  fs.writeFileSync(path.join(settingsDir, "base.py"), baseSettings());
  fs.writeFileSync(path.join(settingsDir, "local.py"), localSettings(slug));
  fs.writeFileSync(
    path.join(settingsDir, "production.py"),
    productionSettings()
  );
}

function baseSettings() {
  return `"""
Base settings — shared across all environments.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-insecure-key-change-in-production')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'corsheaders',
    # Project apps
    'apps.api',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION  = 'config.asgi.application'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE     = 'UTC'
USE_I18N      = True
USE_TZ        = True

STATIC_URL   = '/static/'
STATIC_ROOT  = BASE_DIR / 'staticfiles'
MEDIA_URL    = '/media/'
MEDIA_ROOT   = BASE_DIR / 'media'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOW_ALL_ORIGINS = True

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES':   ['rest_framework.parsers.JSONParser'],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}
`;
}

function localSettings(slug) {
  return `"""
Local development settings.
"""
import os
from .base import *  # noqa: F401,F403

DEBUG         = True
ALLOWED_HOSTS = ['*']

DATABASES = {
    'default': {
        'ENGINE':   'django.db.backends.postgresql',
        'NAME':     os.environ.get('DB_NAME',     '${slug}_db'),
        'USER':     os.environ.get('DB_USER',     'postgres'),
        'PASSWORD': os.environ.get('DB_PASSWORD', ''),
        'HOST':     os.environ.get('DB_HOST',     'localhost'),
        'PORT':     os.environ.get('DB_PORT',     '5432'),
    }
}
`;
}

function productionSettings() {
  return `"""
Production settings.
"""
import os
from .base import *  # noqa: F401,F403

DEBUG         = False
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '').split(',')

DATABASES = {
    'default': {
        'ENGINE':      'django.db.backends.postgresql',
        'NAME':        os.environ['DB_NAME'],
        'USER':        os.environ['DB_USER'],
        'PASSWORD':    os.environ['DB_PASSWORD'],
        'HOST':        os.environ.get('DB_HOST', 'localhost'),
        'PORT':        os.environ.get('DB_PORT', '5432'),
        'CONN_MAX_AGE': 60,
    }
}

# Security hardening
SECURE_BROWSER_XSS_FILTER    = True
SECURE_CONTENT_TYPE_NOSNIFF  = True
X_FRAME_OPTIONS              = 'DENY'
SESSION_COOKIE_SECURE        = True
CSRF_COOKIE_SECURE           = True
SECURE_SSL_REDIRECT          = os.environ.get('SECURE_SSL_REDIRECT', 'True') == 'True'
SECURE_HSTS_SECONDS          = 31_536_000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY-POINT PATCHER  (manage.py / wsgi.py / asgi.py)
// ═════════════════════════════════════════════════════════════════════════════

function patchEntryPoints(targetDir, settingsModule) {
  const files = [
    path.join(targetDir, "manage.py"),
    path.join(targetDir, "config", "wsgi.py"),
    path.join(targetDir, "config", "asgi.py"),
  ];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    let c = fs.readFileSync(f, "utf8");
    c = c.replace(/'config\.settings'/g, `'${settingsModule}'`);
    fs.writeFileSync(f, c);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROJECT urls.py
// ═════════════════════════════════════════════════════════════════════════════

function writeProjectUrls(targetDir, template) {
  const urlsPath = path.join(targetDir, "config", "urls.py");

  if (isRest(template) || isPostgres(template)) {
    fs.writeFileSync(
      urlsPath,
      `from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/',   admin.site.urls),
    path('api/v1/',  include('apps.api.urls')),
]
`
    );
  } else {
    fs.writeFileSync(
      urlsPath,
      `from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('',       include('apps.core.urls')),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
`
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATE: default — HTML views + Django templates
// ═════════════════════════════════════════════════════════════════════════════
//
// Structure written inside appDir (apps/core/):
//   views.py  urls.py
//   templates/core/base.html  index.html
//   static/core/css/style.css

function writeDefaultApp(appDir, projectName) {
  const w = (rel, content) => {
    const full = path.join(appDir, rel);
    fs.ensureDirSync(path.dirname(full));
    fs.writeFileSync(full, content);
  };

  w(
    "views.py",
    `from django.shortcuts import render
from django.http import JsonResponse


def index(request):
    return render(request, 'core/index.html', {'project': '${projectName}'})


def health(request):
    return JsonResponse({'status': 'UP'})
`
  );

  w(
    "urls.py",
    `from django.urls import path
from . import views

app_name = 'core'

urlpatterns = [
    path('',        views.index,  name='index'),
    path('health/', views.health, name='health'),
]
`
  );

  w(
    "templates/core/base.html",
    `{% load static %}
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{% block title %}${projectName}{% endblock %}</title>
  <link rel="stylesheet" href="{% static 'core/css/style.css' %}" />
</head>
<body>
  <header><h1>${projectName}</h1></header>
  <main>{% block content %}{% endblock %}</main>
  <footer><p>Built with Django</p></footer>
</body>
</html>
`
  );

  w(
    "templates/core/index.html",
    `{% extends 'core/base.html' %}
{% block title %}Home – ${projectName}{% endblock %}
{% block content %}
  <h2>Welcome to ${projectName}</h2>
  <p>Your Django app is running. Edit <code>apps/core/views.py</code> to get started.</p>
{% endblock %}
`
  );

  w(
    "static/core/css/style.css",
    `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body   { font-family: system-ui, sans-serif; padding: 2rem; color: #1a1a1a; }
header { border-bottom: 2px solid #e0e0e0; padding-bottom: 1rem; margin-bottom: 2rem; }
main   { max-width: 960px; }
footer { margin-top: 3rem; color: #666; font-size: 0.85rem; }
`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATE: rest — DRF APIView, in-memory store, permissions stub
// ═════════════════════════════════════════════════════════════════════════════

function writeRestApp(appDir) {
  const w = (rel, content) => {
    const full = path.join(appDir, rel);
    fs.ensureDirSync(path.dirname(full));
    fs.writeFileSync(full, content);
  };

  w(
    "permissions.py",
    `from rest_framework.permissions import BasePermission


class IsOwnerOrReadOnly(BasePermission):
    """Allow safe methods to anyone; write only to the object owner."""

    def has_object_permission(self, request, view, obj):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        return obj.owner == request.user
`
  );

  w(
    "serializers.py",
    `from rest_framework import serializers


class ItemSerializer(serializers.Serializer):
    id          = serializers.IntegerField(read_only=True)
    name        = serializers.CharField(max_length=120)
    description = serializers.CharField(allow_blank=True, required=False, default='')
    price       = serializers.FloatField(required=False, allow_null=True)
`
  );

  w(
    "views.py",
    `from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from .serializers import ItemSerializer

# In-memory store — swap for a real model when you add a database.
_store   = {}
_next_id = [1]


class ItemListView(APIView):
    """
    GET  /api/v1/items/  — list all items
    POST /api/v1/items/  — create an item
    """

    def get(self, request):
        serializer = ItemSerializer(list(_store.values()), many=True)
        return Response({'items': serializer.data, 'count': len(_store)})

    def post(self, request):
        serializer = ItemSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        item_id         = _next_id[0]
        _next_id[0]    += 1
        item            = {'id': item_id, **serializer.validated_data}
        _store[item_id] = item
        return Response(ItemSerializer(item).data, status=status.HTTP_201_CREATED)


class ItemDetailView(APIView):
    """
    GET    /api/v1/items/<id>/  — retrieve
    PUT    /api/v1/items/<id>/  — replace
    PATCH  /api/v1/items/<id>/  — partial update
    DELETE /api/v1/items/<id>/  — remove
    """

    def _get_or_404(self, pk):
        item = _store.get(pk)
        if item is None:
            raise KeyError(pk)
        return item

    def get(self, request, pk):
        try:
            return Response(ItemSerializer(self._get_or_404(pk)).data)
        except KeyError:
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        if pk not in _store:
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ItemSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        _store[pk] = {'id': pk, **serializer.validated_data}
        return Response(ItemSerializer(_store[pk]).data)

    def patch(self, request, pk):
        if pk not in _store:
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
        for k, v in request.data.items():
            if k != 'id' and k in _store[pk]:
                _store[pk][k] = v
        return Response(ItemSerializer(_store[pk]).data)

    def delete(self, request, pk):
        if pk not in _store:
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
        del _store[pk]
        return Response(status=status.HTTP_204_NO_CONTENT)


class HealthView(APIView):
    """GET /api/v1/health/"""

    def get(self, request):
        from django.utils import timezone
        return Response({'status': 'UP', 'timestamp': timezone.now().isoformat()})
`
  );

  w(
    "urls.py",
    `from django.urls import path
from .views import ItemListView, ItemDetailView, HealthView

app_name = 'api'

urlpatterns = [
    path('health/',           HealthView.as_view(),     name='health'),
    path('items/',            ItemListView.as_view(),    name='item-list'),
    path('items/<int:pk>/',   ItemDetailView.as_view(),  name='item-detail'),
]
`
  );

  w(
    "tests.py",
    `from rest_framework import status
from rest_framework.test import APITestCase
from django.urls import reverse


class HealthCheckTest(APITestCase):
    def test_health_returns_200(self):
        url = reverse('api:health')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'UP')


class ItemCRUDTest(APITestCase):
    def test_create_and_list(self):
        url = reverse('api:item-list')
        res = self.client.post(url, {'name': 'Widget', 'price': 9.99}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        res = self.client.get(url)
        self.assertEqual(res.data['count'], 1)
`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TEMPLATE: postgres — DRF ModelViewSet + PostgreSQL model
// ═════════════════════════════════════════════════════════════════════════════

function writePostgresApp(appDir) {
  const w = (rel, content) => {
    const full = path.join(appDir, rel);
    fs.ensureDirSync(path.dirname(full));
    fs.writeFileSync(full, content);
  };

  w(
    "models.py",
    `from django.db import models


class Item(models.Model):
    name        = models.CharField(max_length=120)
    description = models.TextField(blank=True, default='')
    price       = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name
`
  );

  w(
    "serializers.py",
    `from rest_framework import serializers
from .models import Item


class ItemSerializer(serializers.ModelSerializer):
    class Meta:
        model            = Item
        fields           = ['id', 'name', 'description', 'price', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']
`
  );

  w(
    "views.py",
    `from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone
from .models import Item
from .serializers import ItemSerializer


class ItemViewSet(viewsets.ModelViewSet):
    """
    Full CRUD ViewSet for Item backed by PostgreSQL.

    GET    /api/v1/items/          — list (paginated, ?name= filter)
    POST   /api/v1/items/          — create
    GET    /api/v1/items/<id>/     — retrieve
    PUT    /api/v1/items/<id>/     — replace
    PATCH  /api/v1/items/<id>/     — partial update
    DELETE /api/v1/items/<id>/     — destroy
    GET    /api/v1/items/health/   — health check
    """

    queryset         = Item.objects.all()
    serializer_class = ItemSerializer

    def get_queryset(self):
        qs   = super().get_queryset()
        name = self.request.query_params.get('name')
        if name:
            qs = qs.filter(name__icontains=name)
        return qs

    @action(detail=False, methods=['get'], url_path='health')
    def health(self, request):
        return Response({'status': 'UP', 'timestamp': timezone.now().isoformat()})
`
  );

  w(
    "admin.py",
    `from django.contrib import admin
from .models import Item


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display   = ('id', 'name', 'price', 'created_at')
    search_fields  = ('name',)
    list_filter    = ('created_at',)
    readonly_fields = ('created_at', 'updated_at')
`
  );

  w(
    "urls.py",
    `from rest_framework.routers import DefaultRouter
from .views import ItemViewSet

app_name = 'api'

router = DefaultRouter()
router.register(r'items', ItemViewSet, basename='item')

urlpatterns = router.urls
`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function requirements(template) {
  const pkgs = [
    "django>=5.0.0",
    "django-cors-headers>=4.3.0",
    "python-dotenv>=1.0.0",
  ];
  if (isRest(template) || isPostgres(template)) {
    pkgs.push("djangorestframework>=3.15.0");
  }
  if (isPostgres(template)) {
    pkgs.push("psycopg2-binary>=2.9.0");
  }
  return pkgs.join("\n") + "\n";
}

function envContent(template, slug) {
  const base = `SECRET_KEY=change-me-in-production\nDEBUG=True\nALLOWED_HOSTS=*\n`;
  if (isPostgres(template)) {
    return (
      base +
      `\n# PostgreSQL\nDB_NAME=${slug}_db\nDB_USER=postgres\nDB_PASSWORD=\nDB_HOST=localhost\nDB_PORT=5432\n`
    );
  }
  return base;
}

function gitignore() {
  return (
    [
      "# Python",
      "venv/",
      "__pycache__/",
      "*.pyc",
      "*.pyo",
      "*.pyd",
      "*.egg-info/",
      ".pytest_cache/",
      "",
      "# Django",
      ".env",
      "*.sqlite3",
      "staticfiles/",
      "media/",
      "",
      "# OS",
      ".DS_Store",
      "Thumbs.db",
    ].join("\n") + "\n"
  );
}

function readme(name, template) {
  const activate = isWin
    ? "venv\\Scripts\\activate"
    : "source venv/bin/activate";

  const dbSection = isPostgres(template)
    ? `
### Database setup
1. Create the PostgreSQL database: \`createdb ${name
        .toLowerCase()
        .replace(/\s+/g, "_")}_db\`
2. Fill in \`.env\` with your credentials
3. Run migrations:
\`\`\`bash
python manage.py makemigrations
python manage.py migrate
\`\`\``
    : `
### Migrations
\`\`\`bash
python manage.py makemigrations
python manage.py migrate
\`\`\``;

  const envNote = isPostgres(template)
    ? `\n### Environment\nSet \`DJANGO_SETTINGS_MODULE=config.settings.local\` (already the default in manage.py).\nFor production use \`config.settings.production\`.\n`
    : "";

  const apiSection =
    isRest(template) || isPostgres(template)
      ? `
### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET    | \`/api/v1/items/\`        | List items (paginated) |
| POST   | \`/api/v1/items/\`        | Create item |
| GET    | \`/api/v1/items/<id>/\`   | Retrieve item |
| PUT    | \`/api/v1/items/<id>/\`   | Replace item |
| PATCH  | \`/api/v1/items/<id>/\`   | Partial update |
| DELETE | \`/api/v1/items/<id>/\`   | Delete item |
| GET    | \`/api/v1/items/health/\` | Health check |
`
      : "";

  return `# ${name}

Generated by **PIC-LI** · Template: \`${template}\`

## Quick start

\`\`\`bash
${activate}
python manage.py runserver
\`\`\`
${dbSection}
${envNote}
### Admin
\`\`\`bash
python manage.py createsuperuser
\`\`\`

| URL | Description |
|-----|-------------|
| http://localhost:8000 | App |
| http://localhost:8000/admin | Django admin |
${apiSection}
`;
}

module.exports = { generate };
