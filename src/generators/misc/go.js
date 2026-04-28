"use strict";

const fs = require("fs-extra");
const path = require("path");
const { runSilent, runSafe } = require("../../core/runCommand");

async function generate({ name, template, targetDir, onStep }) {
  // ── Guard: Go must be available ───────────────────────────────────────────
  if (!runSafe("go version 2>&1").ok) {
    throw new Error(
      "Go is not installed or not in PATH.\n" +
        "       Run: pic setup  to see how to install it for your OS."
    );
  }

  const slug = name
    .toLowerCase()
    .replace(/[\s_]/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const module = `github.com/yourname/${slug}`;

  onStep("Creating Go project structure");

  if (template === "with-gorm") {
    scaffoldGorm(targetDir);
  } else if (template === "rest-crud") {
    scaffoldRestCrud(targetDir);
  } else {
    scaffoldDefault(targetDir);
  }

  onStep("Initializing Go module");
  runSilent(`go mod init ${module}`, { cwd: targetDir });

  onStep("Writing Go source files");
  writeSourceFiles(targetDir, module, template);

  onStep(
    template === "with-gorm"
      ? "Fetching Gin + GORM (go get)"
      : "Fetching Gin framework (go get)"
  );
  try {
    runSilent("go get github.com/gin-gonic/gin", { cwd: targetDir });
    if (template === "with-gorm") {
      runSilent("go get gorm.io/gorm", { cwd: targetDir });
      // FIX 1: glebarez/sqlite is pure-Go — no CGO / GCC required on Windows
      runSilent("go get github.com/glebarez/sqlite", { cwd: targetDir });
    }
    runSilent("go mod tidy", { cwd: targetDir });
  } catch {
    fs.writeFileSync(path.join(targetDir, "OFFLINE.md"), offlineNote(template));
  }

  onStep("Writing Makefile and .env");
  fs.writeFileSync(path.join(targetDir, "Makefile"), makefile());
  fs.writeFileSync(path.join(targetDir, ".env"), envFile(template));

  onStep("Initializing Git");
  try {
    runSilent("git init", { cwd: targetDir });
  } catch {}
  fs.writeFileSync(path.join(targetDir, ".gitignore"), gitignore());

  onStep("Writing README");
  fs.writeFileSync(
    path.join(targetDir, "README.md"),
    readme(name, template, module)
  );
}

// ── Folder scaffolders ────────────────────────────────────────────────────────

function scaffoldDefault(targetDir) {
  const dir = (...p) => fs.ensureDirSync(path.join(targetDir, ...p));

  dir("cmd", "server");
  dir("internal", "handlers");
  dir("internal", "middleware");
  dir("internal", "config");
  dir("pkg", "utils");
}

function scaffoldRestCrud(targetDir) {
  const dir = (...p) => fs.ensureDirSync(path.join(targetDir, ...p));

  dir("cmd", "server");
  dir("internal", "handlers");
  dir("internal", "models");
  dir("internal", "middleware");
}

function scaffoldGorm(targetDir) {
  const dir = (...p) => fs.ensureDirSync(path.join(targetDir, ...p));

  dir("cmd", "server");
  dir("internal", "handlers");
  dir("internal", "models");
  dir("internal", "database");
}

// ── Source file dispatcher ────────────────────────────────────────────────────

function writeSourceFiles(targetDir, module, template) {
  const write = (segments, content) =>
    fs.writeFileSync(path.join(targetDir, ...segments), content);

  // Files common to every template
  write(["cmd", "server", "main.go"], mainGo(module, template));
  write(["internal", "handlers", "health.go"], healthHandler());

  if (template === "default") {
    write(["internal", "middleware", "logger.go"], loggerMiddleware());
    write(["internal", "config", "config.go"], configGo());
    write(["pkg", "utils", "response.go"], responseUtils());
  }

  if (template === "rest-crud") {
    write(["internal", "handlers", "items.go"], itemsHandlerInMemory());
    write(["internal", "models", "item.go"], itemModelPlain());
    write(["internal", "middleware", "logger.go"], loggerMiddleware());
  }

  if (template === "with-gorm") {
    write(["internal", "database", "db.go"], databaseGo());
    write(["internal", "models", "item.go"], itemModelGorm());
    write(["internal", "handlers", "items.go"], itemsHandlerGorm(module));
  }
}

// ── main.go (per-template routing) ────────────────────────────────────────────

function mainGo(module, template) {
  // FIX 2: Every template now registers GET / so hitting localhost:8080
  //         in a browser returns JSON instead of Gin's 404.

  if (template === "default") {
    return `package main

import (
\t"fmt"
\t"log"
\t"net/http"

\t"${module}/internal/config"
\t"${module}/internal/handlers"
\t"${module}/internal/middleware"
\t"github.com/gin-gonic/gin"
)

func main() {
\tcfg := config.Load()
\tr := gin.New()
\tr.Use(gin.Recovery())
\tr.Use(middleware.Logger())

\t// Root — so GET / doesn't 404 in the browser
\tr.GET("/", func(c *gin.Context) {
\t\tc.JSON(http.StatusOK, gin.H{
\t\t\t"service": "pic-li",
\t\t\t"routes": gin.H{
\t\t\t\t"health": "GET /health",
\t\t\t},
\t\t})
\t})
\tr.GET("/health", handlers.Health)

\taddr := fmt.Sprintf(":%s", cfg.Port)
\tlog.Printf("[PIC-LI] Server running at http://localhost%s", addr)
\tif err := r.Run(addr); err != nil {
\t\tlog.Fatal(err)
\t}
}
`;
  }

  if (template === "rest-crud") {
    return `package main

import (
\t"fmt"
\t"log"
\t"net/http"
\t"os"

\t"${module}/internal/handlers"
\t"${module}/internal/middleware"
\t"github.com/gin-gonic/gin"
)

func main() {
\tr := gin.New()
\tr.Use(gin.Recovery())
\tr.Use(middleware.Logger())

\t// Root — so GET / doesn't 404 in the browser
\tr.GET("/", func(c *gin.Context) {
\t\tc.JSON(http.StatusOK, gin.H{
\t\t\t"service": "pic-li",
\t\t\t"routes": gin.H{
\t\t\t\t"health":      "GET  /health",
\t\t\t\t"list items":  "GET  /api/items",
\t\t\t\t"create item": "POST /api/items",
\t\t\t\t"get item":    "GET  /api/items/:id",
\t\t\t\t"delete item": "DEL  /api/items/:id",
\t\t\t},
\t\t})
\t})
\tr.GET("/health", handlers.Health)

\tapi := r.Group("/api")
\t{
\t\titems := api.Group("/items")
\t\t{
\t\t\titems.GET("",        handlers.ListItems)
\t\t\titems.POST("",       handlers.CreateItem)
\t\t\titems.GET("/:id",    handlers.GetItem)
\t\t\titems.DELETE("/:id", handlers.DeleteItem)
\t\t}
\t}

\tport := os.Getenv("PORT")
\tif port == "" { port = "8080" }
\taddr := fmt.Sprintf(":%s", port)
\tlog.Printf("[PIC-LI] Server running at http://localhost%s", addr)
\tif err := r.Run(addr); err != nil {
\t\tlog.Fatal(err)
\t}
}
`;
  }

  // with-gorm
  return `package main

import (
\t"fmt"
\t"log"
\t"net/http"
\t"os"

\t"${module}/internal/database"
\t"${module}/internal/handlers"
\t"${module}/internal/models"
\t"github.com/gin-gonic/gin"
)

func main() {
\tdb, err := database.Connect()
\tif err != nil {
\t\tlog.Fatalf("database connection failed: %v", err)
\t}
\tif err := db.AutoMigrate(&models.Item{}); err != nil {
\t\tlog.Fatalf("automigrate failed: %v", err)
\t}

\tr := gin.New()
\tr.Use(gin.Recovery())
\tr.Use(gin.Logger())

\t// Root — so GET / doesn't 404 in the browser
\tr.GET("/", func(c *gin.Context) {
\t\tc.JSON(http.StatusOK, gin.H{
\t\t\t"service": "pic-li",
\t\t\t"routes": gin.H{
\t\t\t\t"health":      "GET  /health",
\t\t\t\t"list items":  "GET  /api/items",
\t\t\t\t"create item": "POST /api/items",
\t\t\t\t"get item":    "GET  /api/items/:id",
\t\t\t\t"delete item": "DEL  /api/items/:id",
\t\t\t},
\t\t})
\t})
\tr.GET("/health", handlers.Health)

\tapi := r.Group("/api")
\t{
\t\titems := api.Group("/items")
\t\t{
\t\t\titems.GET("",        handlers.ListItems(db))
\t\t\titems.POST("",       handlers.CreateItem(db))
\t\t\titems.GET("/:id",    handlers.GetItem(db))
\t\t\titems.DELETE("/:id", handlers.DeleteItem(db))
\t\t}
\t}

\tport := os.Getenv("PORT")
\tif port == "" { port = "8080" }
\taddr := fmt.Sprintf(":%s", port)
\tlog.Printf("[PIC-LI] Server running at http://localhost%s", addr)
\tif err := r.Run(addr); err != nil {
\t\tlog.Fatal(err)
\t}
}
`;
}

// ── Shared: health handler ────────────────────────────────────────────────────

function healthHandler() {
  return `package handlers

import (
\t"net/http"
\t"time"
\t"github.com/gin-gonic/gin"
)

func Health(c *gin.Context) {
\tc.JSON(http.StatusOK, gin.H{
\t\t"status":    "UP",
\t\t"timestamp": time.Now().Format(time.RFC3339),
\t})
}
`;
}

// ── Shared: logger middleware ─────────────────────────────────────────────────

function loggerMiddleware() {
  return `package middleware

import (
\t"log"
\t"time"
\t"github.com/gin-gonic/gin"
)

func Logger() gin.HandlerFunc {
\treturn func(c *gin.Context) {
\t\tstart := time.Now()
\t\tc.Next()
\t\tlog.Printf("%s %s  →  %d  (%s)",
\t\t\tc.Request.Method,
\t\t\tc.Request.URL.Path,
\t\t\tc.Writer.Status(),
\t\t\ttime.Since(start),
\t\t)
\t}
}
`;
}

// ── Default: config + utils ───────────────────────────────────────────────────

function configGo() {
  return `package config

import "os"

type Config struct {
\tPort    string
\tGinMode string
}

func Load() *Config {
\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "8080"
\t}
\treturn &Config{
\t\tPort:    port,
\t\tGinMode: os.Getenv("GIN_MODE"),
\t}
}
`;
}

function responseUtils() {
  return `package utils

import (
\t"net/http"
\t"github.com/gin-gonic/gin"
)

func OK(c *gin.Context, data any) {
\tc.JSON(http.StatusOK, gin.H{"data": data})
}

func Fail(c *gin.Context, status int, msg string) {
\tc.JSON(status, gin.H{"error": msg})
}
`;
}

// ── REST-CRUD: in-memory handlers + plain model ───────────────────────────────

function itemModelPlain() {
  return `package models

type Item struct {
\tID    int     \`json:"id"\`
\tName  string  \`json:"name"\`
\tPrice float64 \`json:"price,omitempty"\`
}
`;
}

function itemsHandlerInMemory() {
  return `package handlers

import (
\t"net/http"
\t"strconv"
\t"sync"

\t"github.com/gin-gonic/gin"
)

type Item struct {
\tID    int     \`json:"id"\`
\tName  string  \`json:"name"  binding:"required"\`
\tPrice float64 \`json:"price,omitempty"\`
}

var (
\tmu      sync.Mutex
\titems   []Item
\tcounter int
)

func ListItems(c *gin.Context) {
\tmu.Lock(); defer mu.Unlock()
\tif items == nil {
\t\titems = []Item{}
\t}
\tc.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
}

func CreateItem(c *gin.Context) {
\tvar body Item
\tif err := c.ShouldBindJSON(&body); err != nil {
\t\tc.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
\t\treturn
\t}
\tmu.Lock()
\tcounter++
\tbody.ID = counter
\titems = append(items, body)
\tmu.Unlock()
\tc.JSON(http.StatusCreated, body)
}

func GetItem(c *gin.Context) {
\tid, _ := strconv.Atoi(c.Param("id"))
\tmu.Lock(); defer mu.Unlock()
\tfor _, item := range items {
\t\tif item.ID == id {
\t\t\tc.JSON(http.StatusOK, item)
\t\t\treturn
\t\t}
\t}
\tc.JSON(http.StatusNotFound, gin.H{"error": "item not found"})
}

func DeleteItem(c *gin.Context) {
\tid, _ := strconv.Atoi(c.Param("id"))
\tmu.Lock(); defer mu.Unlock()
\tfor i, item := range items {
\t\tif item.ID == id {
\t\t\titems = append(items[:i], items[i+1:]...)
\t\t\tc.Status(http.StatusNoContent)
\t\t\treturn
\t\t}
\t}
\tc.JSON(http.StatusNotFound, gin.H{"error": "item not found"})
}
`;
}

// ── GORM: database, model, handlers ──────────────────────────────────────────

function databaseGo() {
  // FIX 1: github.com/glebarez/sqlite is a pure-Go SQLite driver.
  // It does NOT need CGO or a C compiler (no GCC/MinGW required on Windows).
  // Drop-in replacement for gorm.io/driver/sqlite.
  return `package database

import (
\t"os"

\t"github.com/glebarez/sqlite"
\t"gorm.io/gorm"
\t"gorm.io/gorm/logger"
)

func Connect() (*gorm.DB, error) {
\tdsn := os.Getenv("DB_DSN")
\tif dsn == "" {
\t\tdsn = "app.db"
\t}
\treturn gorm.Open(sqlite.Open(dsn), &gorm.Config{
\t\tLogger: logger.Default.LogMode(logger.Info),
\t})
}
`;
}

function itemModelGorm() {
  return `package models

import "gorm.io/gorm"

type Item struct {
\tgorm.Model
\tName  string  \`json:"name"  gorm:"not null"\`
\tPrice float64 \`json:"price"\`
}
`;
}

function itemsHandlerGorm(module) {
  return `package handlers

import (
\t"net/http"
\t"strconv"

\t"${module}/internal/models"
\t"github.com/gin-gonic/gin"
\t"gorm.io/gorm"
)

type createItemInput struct {
\tName  string  \`json:"name"  binding:"required"\`
\tPrice float64 \`json:"price"\`
}

func ListItems(db *gorm.DB) gin.HandlerFunc {
\treturn func(c *gin.Context) {
\t\tvar items []models.Item
\t\tif err := db.Find(&items).Error; err != nil {
\t\t\tc.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
\t\t\treturn
\t\t}
\t\tc.JSON(http.StatusOK, gin.H{"items": items, "count": len(items)})
\t}
}

func CreateItem(db *gorm.DB) gin.HandlerFunc {
\treturn func(c *gin.Context) {
\t\tvar input createItemInput
\t\tif err := c.ShouldBindJSON(&input); err != nil {
\t\t\tc.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
\t\t\treturn
\t\t}
\t\titem := models.Item{Name: input.Name, Price: input.Price}
\t\tif err := db.Create(&item).Error; err != nil {
\t\t\tc.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
\t\t\treturn
\t\t}
\t\tc.JSON(http.StatusCreated, item)
\t}
}

func GetItem(db *gorm.DB) gin.HandlerFunc {
\treturn func(c *gin.Context) {
\t\tid, _ := strconv.Atoi(c.Param("id"))
\t\tvar item models.Item
\t\tif err := db.First(&item, id).Error; err != nil {
\t\t\tc.JSON(http.StatusNotFound, gin.H{"error": "item not found"})
\t\t\treturn
\t\t}
\t\tc.JSON(http.StatusOK, item)
\t}
}

func DeleteItem(db *gorm.DB) gin.HandlerFunc {
\treturn func(c *gin.Context) {
\t\tid, _ := strconv.Atoi(c.Param("id"))
\t\tvar item models.Item
\t\tif err := db.First(&item, id).Error; err != nil {
\t\t\tc.JSON(http.StatusNotFound, gin.H{"error": "item not found"})
\t\t\treturn
\t\t}
\t\tdb.Delete(&item)
\t\tc.Status(http.StatusNoContent)
\t}
}
`;
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function makefile() {
  return `.PHONY: run build test

run:
\tgo run ./cmd/server

build:
\tgo build -o bin/server ./cmd/server

test:
\tgo test ./...
`;
}

function envFile(template) {
  const base = `PORT=8080\nGIN_MODE=debug\n`;
  return template === "with-gorm" ? base + `DB_DSN=app.db\n` : base;
}

function gitignore() {
  return `bin/\n*.exe\n*.db\n.env\n.DS_Store\nvendor/\n`;
}

function offlineNote(template) {
  const extra =
    template === "with-gorm"
      ? `go get gorm.io/gorm\ngo get github.com/glebarez/sqlite\n`
      : "";
  return `# Offline note\n\nRun these when you have internet:\n\n\`\`\`bash\ngo get github.com/gin-gonic/gin\n${extra}go mod tidy\n\`\`\`\n`;
}

function readme(name, template, module) {
  const stacks = {
    default: "Go + Gin (minimal server)",
    "rest-crud": "Go + Gin + in-memory CRUD",
    "with-gorm": "Go + Gin + GORM (SQLite, pure-Go)",
  };

  const structures = {
    default: `\`\`\`
cmd/server/
  main.go
internal/
  handlers/   health.go
  middleware/  logger.go
  config/      config.go
pkg/utils/
  response.go
\`\`\``,
    "rest-crud": `\`\`\`
cmd/server/
  main.go
internal/
  handlers/   health.go  items.go
  models/     item.go
  middleware/  logger.go
\`\`\``,
    "with-gorm": `\`\`\`
cmd/server/
  main.go           ← gorm.Open + AutoMigrate
internal/
  database/  db.go   ← Connect() returns *gorm.DB
  models/    item.go ← gorm.Model embedded
  handlers/  items.go health.go
\`\`\``,
  };

  const apiDocs = {
    default: `| Method | Path      | Description   |
|--------|-----------|---------------|
| GET    | /         | API index     |
| GET    | /health   | Health check  |`,
    "rest-crud": `| Method | Path           | Description   |
|--------|----------------|---------------|
| GET    | /              | API index     |
| GET    | /health        | Health check  |
| GET    | /api/items     | List items    |
| POST   | /api/items     | Create item   |
| GET    | /api/items/:id | Get item      |
| DELETE | /api/items/:id | Delete item   |`,
    "with-gorm": `| Method | Path           | Description   |
|--------|----------------|---------------|
| GET    | /              | API index     |
| GET    | /health        | Health check  |
| GET    | /api/items     | List items    |
| POST   | /api/items     | Create item   |
| GET    | /api/items/:id | Get item      |
| DELETE | /api/items/:id | Delete item   |`,
  };

  return `# ${name}

Generated by **PIC-LI** — Project Initializer Command

## Stack
${stacks[template] || stacks.default}

## Getting started

\`\`\`bash
go run ./cmd/server
\`\`\`

API at http://localhost:8080

## Endpoints

${apiDocs[template] || apiDocs.default}

## Project structure

${structures[template] || structures.default}

## Module path
Update \`${module}\` in \`go.mod\` to your actual GitHub path.
`;
}

module.exports = { generate };
