# PIC-LI — Project Initializer Command

> One command to scaffold any project, in any stack, with everything ready to run.

```
  PIC-LI  Project Initializer Command  v1.0.0
  ──────────────────────────────────────────────────
```

---

## Installation

### From npm (once published)
```bash
npm install -g pic-li
```

### From source
```bash
git clone https://github.com/yourname/pic-li.git
cd pic-li
npm install
npm link        # makes `pic` available globally
```

**Requirements:** Node.js v16 or higher.  
The `pic` CLI itself only needs Node. Stack-specific tools (Java, Python, Flutter, Go) are only required when generating that stack's projects.

---

## Commands

| Command | Description |
|---------|-------------|
| `pic create [name]` | Create a new project (interactive or with flags) |
| `pic init` | Initialize PIC config in an existing project folder |
| `pic add <integration>` | Add an integration to the current project |
| `pic remove <integration>` | Remove an integration from the current project |
| `pic list` | List all stacks and templates |
| `pic check [stack]` | Check if dependencies for a stack are installed |
| `pic doctor` | Full system diagnostic — all tools at once |
| `pic run` | Start the dev server (reads `.pic/config.json`) |
| `pic build` | Build for production |
| `pic open` | Open the project in VS Code, Cursor, etc. |
| `pic setup` | Show install commands for missing tools |

---

## Creating a project

### Interactive (recommended)
```bash
pic create
```
Arrow-key menus guide you through stack → template → name.  
Works on Windows CMD, PowerShell, macOS, Linux (bash/zsh/fish).

### With flags (CI-friendly, no prompts)
```bash
# React + Vite + Tailwind
pic create my-app --stack react-vite --template tailwind

# FastAPI + SQLAlchemy
pic create my-api --stack fastapi --template with-sqlalchemy

# Spring Boot + MySQL  
pic create my-svc --stack spring-boot --template rest-api-mysql

# Flutter + Riverpod
pic create my-mobile --stack flutter --template with-riverpod

# Next.js + Tailwind + TypeScript
pic create my-site --stack nextjs --template tailwind-typescript

# MERN monorepo
pic create my-app --stack mern --template with-tailwind

# Go + Gin
pic create my-api --stack go --template rest-api
```

---

## Supported stacks

### Frontend
| ID | Stack | Templates |
|----|-------|-----------|
| `react-vite` | React + Vite | `default` `tailwind` `tailwind-shadcn` `typescript` |
| `react-cra` | React (Create React App) | `default` `typescript` |
| `nextjs` | Next.js | `default` `tailwind` `typescript` `tailwind-typescript` |
| `vue` | Vue 3 + Vite | `default` `typescript` `tailwind` |
| `angular` | Angular | `default` `material` `tailwind` |

### Backend (Node)
| ID | Stack | Templates |
|----|-------|-----------|
| `express` | Express.js | `default` `rest-api` `rest-api-mongo` `rest-api-postgres` |
| `nestjs` | NestJS | `default` `rest-api` `graphql` `microservice` |

### Backend (Java)
| ID | Stack | Templates |
|----|-------|-----------|
| `spring-boot` | Spring Boot (Maven) | `default` `rest-api` `rest-api-mysql` `rest-api-postgres` `microservice` |
| `spring-gradle` | Spring Boot (Gradle) | `default` `rest-api` `rest-api-mysql` |

### Backend (Python)
| ID | Stack | Templates |
|----|-------|-----------|
| `fastapi` | FastAPI | `default` `with-sqlalchemy` `with-mongodb` `full-stack` |
| `flask` | Flask | `default` `rest-api` `with-sqlalchemy` |
| `django` | Django + DRF | `default` `with-drf` `with-postgres` |

### Mobile
| ID | Stack | Templates |
|----|-------|-----------|
| `flutter` | Flutter | `default` `with-provider` `with-riverpod` `with-bloc` |
| `react-native` | React Native (Expo) | `default` `tabs` `with-typescript` |

### Fullstack
| ID | Stack | Templates |
|----|-------|-----------|
| `mern` | MERN Stack | `default` `with-auth` `with-tailwind` |

### Backend (Go)
| ID | Stack | Templates |
|----|-------|-----------|
| `go` | Go + Gin | `default` `rest-api` `with-gorm` |

---

## Integrations

Add integrations to any existing project:

```bash
pic add tailwind      # Tailwind CSS v3 — writes configs, no npx init
pic add eslint        # ESLint + Prettier
pic add docker        # Dockerfile + docker-compose.yml
pic add firebase      # Firebase SDK + src/firebase.js
pic add prisma        # Prisma ORM + schema
pic add mongoose      # Mongoose + connection helper
pic add shadcn        # shadcn/ui prerequisites
pic add husky         # Husky + lint-staged
pic add auth          # JWT auth middleware (Node stacks)
```

Remove integrations:

```bash
pic remove tailwind
pic remove docker
pic remove eslint
```

---

## `pic init` — existing projects

Run inside any existing project to create `.pic/config.json`.  
PIC auto-detects the stack by scanning `package.json`, `pom.xml`, `go.mod`, `manage.py`, etc.

```bash
cd my-existing-project
pic init
```

After init, you can use `pic run`, `pic build`, and `pic open` in that project.

---

## `pic run` / `pic build` / `pic open`

These commands read `.pic/config.json` and run the right command for your stack.  
If no config exists, they auto-detect from the project files.

```bash
pic run          # npm run dev / uvicorn / mvn spring-boot:run / go run . / etc.
pic build        # npm run build / mvn package / go build / etc.
pic open         # opens in VS Code, Cursor, Sublime, or IDEA (first found)
```

---

## `pic doctor`

Full environment health check — shows every tool, version, and install link:

```bash
pic doctor
```

```
  System health check
  ────────────────────────────────────────────

         Core tools
  [+]  Node.js          v20.11.0
  [+]  npm              v10.2.4
  [+]  Git              v2.44.0

         Java
  [+]  Java JDK         v21.0.2
  [-]  Maven            not installed  https://maven.apache.org/install.html
```

---

## `pic setup`

Interactive guide — shows the exact install command for your OS:

```bash
pic setup
```

Covers Node.js, Git, Java, Maven, Python, Go, Docker.  
Detects Windows (winget), macOS (brew), and Linux (apt).

---

## Environment variables

Set `PIC_DEBUG=1` for full stack traces on errors:

```bash
PIC_DEBUG=1 pic create my-app --stack react-vite
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
