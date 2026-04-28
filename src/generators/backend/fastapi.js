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
// Stacks sends: "default" | "with-sqlalchemy" | "with-mongodb" | "full-stack"
// Using includes() guards against any future alias variations.
const isMongo = (t) => t.includes("mongodb") || t.includes("mongo");
const isSql = (t) =>
  t.includes("sqlalchemy") || (t.includes("sql") && !isMongo(t));
const isFullStack = (t) => t.includes("full-stack") || t.includes("fullstack");
// default = none of the above

// ─── Entry point ──────────────────────────────────────────────────────────────
async function generate({ name, template, targetDir, onStep }) {
  const python = getPython();
  if (!python)
    throw new Error(
      "Python 3 is not installed or not in PATH.\n" +
        "       Run: pic setup  to see how to install it for your OS."
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
  fs.writeFileSync(
    path.join(targetDir, "requirements-dev.txt"),
    requirementsDev()
  );

  onStep("Writing .env");
  const env = envFile(name, template);
  fs.writeFileSync(path.join(targetDir, ".env"), env);
  fs.writeFileSync(path.join(targetDir, ".env.example"), env);

  onStep(`Creating virtual environment  (${python})`);
  await runSilent(`${q(python)} -m venv venv`, { cwd: targetDir });

  // pip upgrade is intentionally omitted.
  // We only install what is missing from requirements.txt — that is all that is needed.
  // pip upgrade on Windows causes "project creation failed" even though files are intact.
  onStep("Installing dependencies");
  const pip = getVenvPip(targetDir);
  await runSilent(`${pip} install -r requirements.txt --quiet`, {
    cwd: targetDir,
  });

  onStep("Initializing Git");
  try {
    await runSilent("git init", { cwd: targetDir });
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
  const dirs = ["app/routers", "tests"];

  if (isFullStack(template)) {
    dirs.push("app/models", "app/schemas", "app/utils");
  } else if (isSql(template) || isMongo(template)) {
    dirs.push("app/models", "app/schemas");
  }
  // default: only app/routers + tests

  dirs.forEach((d) => fs.ensureDirSync(path.join(targetDir, d)));

  // Python package markers
  const pkgs = ["app", "app/routers", "tests"];
  if (isSql(template) || isMongo(template) || isFullStack(template)) {
    pkgs.push("app/models", "app/schemas");
  }
  if (isFullStack(template)) pkgs.push("app/utils");
  pkgs.forEach((d) =>
    fs.writeFileSync(path.join(targetDir, d, "__init__.py"), "")
  );
}

// ─── File dispatcher ──────────────────────────────────────────────────────────
function writeAppFiles(name, template, targetDir) {
  const w = (rel, content) =>
    fs.writeFileSync(path.join(targetDir, rel), content);

  // Shared across all templates
  w("app/main.py", mainPy(name, template));
  w("app/config.py", configPy(template));
  w("app/routers/health.py", healthRouter(name));
  w("app/routers/items.py", itemsRouter(template));

  if (isSql(template)) {
    w("app/database.py", sqlDatabasePy());
    w("app/models/__init__.py", "");
    w("app/models/item.py", sqlItemModel());
    w("app/schemas/__init__.py", "");
    w("app/schemas/item.py", sqlItemSchema());
    w("tests/test_main.py", testsSql());
  } else if (isMongo(template)) {
    w("app/database.py", mongoDatabasePy());
    w("app/models/__init__.py", "");
    w("app/models/item.py", mongoItemModel());
    w("app/schemas/__init__.py", "");
    w("app/schemas/item.py", mongoItemSchema());
    w("tests/test_main.py", testsDefault()); // mongo not testable with sync TestClient
  } else if (isFullStack(template)) {
    w("app/database.py", sqlDatabasePy());
    w("app/deps.py", depsPy());
    w("app/routers/auth.py", authRouter());
    w("app/routers/users.py", usersRouter());
    w("app/models/__init__.py", "");
    w("app/models/item.py", fsItemModel());
    w("app/models/user.py", userModel());
    w("app/schemas/__init__.py", "");
    w("app/schemas/item.py", sqlItemSchema());
    w("app/schemas/user.py", userSchema());
    w("app/utils/__init__.py", "");
    w("app/utils/security.py", securityUtils());
    w("tests/test_main.py", testsFullStack());
  } else {
    // default
    w("tests/test_main.py", testsDefault());
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// main.py  (per template)
// ═════════════════════════════════════════════════════════════════════════════

function mainPy(name, template) {
  if (isMongo(template)) {
    return `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.routers import health, items
from app.database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="Generated by PIC-LI — FastAPI + MongoDB (Motor + Beanie)",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(items.router,  prefix="/api/items", tags=["items"])


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "docs": "/docs"}
`;
  }

  if (isFullStack(template)) {
    return `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import health, items, auth, users
from app.database import engine, Base

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    description="Generated by PIC-LI — FastAPI full-stack (SQLAlchemy + JWT)",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(auth.router,   prefix="/api/auth",  tags=["auth"])
app.include_router(users.router,  prefix="/api/users", tags=["users"])
app.include_router(items.router,  prefix="/api/items", tags=["items"])


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "docs": "/docs"}
`;
  }

  if (isSql(template)) {
    return `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import health, items
from app.database import engine, Base

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    description="Generated by PIC-LI — FastAPI + SQLAlchemy",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(items.router,  prefix="/api/items", tags=["items"])


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "docs": "/docs"}
`;
  }

  // default
  return `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import health, items

app = FastAPI(
    title=settings.APP_NAME,
    description="Generated by PIC-LI — FastAPI minimal",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(items.router,  prefix="/api/items", tags=["items"])


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "docs": "/docs"}
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// config.py  (per template)
// ═════════════════════════════════════════════════════════════════════════════

function configPy(template) {
  const baseFields = `    APP_NAME: str  = "My API"
    APP_ENV:  str  = "development"
    DEBUG:    bool = True`;

  if (isMongo(template)) {
    return `from pydantic_settings import BaseSettings


class Settings(BaseSettings):
${baseFields}
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB:  str = "appdb"

    model_config = {"env_file": ".env"}


settings = Settings()
`;
  }

  if (isFullStack(template)) {
    return `from pydantic_settings import BaseSettings


class Settings(BaseSettings):
${baseFields}
    DATABASE_URL:                str = "sqlite:///./app.db"
    SECRET_KEY:                  str = "change-me-in-production"
    ALGORITHM:                   str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

    model_config = {"env_file": ".env"}


settings = Settings()
`;
  }

  if (isSql(template)) {
    return `from pydantic_settings import BaseSettings


class Settings(BaseSettings):
${baseFields}
    DATABASE_URL: str = "sqlite:///./app.db"

    model_config = {"env_file": ".env"}


settings = Settings()
`;
  }

  // default
  return `from pydantic_settings import BaseSettings


class Settings(BaseSettings):
${baseFields}

    model_config = {"env_file": ".env"}


settings = Settings()
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTERS
// ═════════════════════════════════════════════════════════════════════════════

function healthRouter(name) {
  return `from fastapi import APIRouter
from datetime import datetime, timezone

router = APIRouter()


@router.get("/health")
async def health():
    return {
        "status":    "UP",
        "service":   "${name}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
`;
}

function itemsRouter(template) {
  if (isSql(template)) {
    return `from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.item import Item
from app.schemas.item import ItemCreate, ItemOut

router = APIRouter()


@router.get("/", response_model=List[ItemOut])
def list_items(db: Session = Depends(get_db)):
    return db.query(Item).all()


@router.post("/", response_model=ItemOut, status_code=201)
def create_item(body: ItemCreate, db: Session = Depends(get_db)):
    item = Item(**body.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/{item_id}", response_model=ItemOut)
def update_item(item_id: int, body: ItemCreate, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for k, v in body.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ItemOut)
def patch_item(item_id: int, body: ItemCreate, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
`;
  }

  if (isMongo(template)) {
    return `from fastapi import APIRouter, HTTPException
from typing import List
from beanie import PydanticObjectId
from app.models.item import Item
from app.schemas.item import ItemCreate, ItemOut

router = APIRouter()


@router.get("/", response_model=List[ItemOut])
async def list_items():
    return await Item.find_all().to_list()


@router.post("/", response_model=ItemOut, status_code=201)
async def create_item(body: ItemCreate):
    item = Item(**body.model_dump())
    await item.insert()
    return item


@router.get("/{item_id}", response_model=ItemOut)
async def get_item(item_id: PydanticObjectId):
    item = await Item.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/{item_id}", response_model=ItemOut)
async def update_item(item_id: PydanticObjectId, body: ItemCreate):
    item = await Item.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await item.set(body.model_dump())
    return item


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: PydanticObjectId):
    item = await Item.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    await item.delete()
`;
  }

  if (isFullStack(template)) {
    return `from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.item import Item
from app.schemas.item import ItemCreate, ItemOut
from app.deps import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/", response_model=List[ItemOut])
def list_items(
    db: Session = Depends(get_db),
    _:  User    = Depends(get_current_user),
):
    return db.query(Item).all()


@router.post("/", response_model=ItemOut, status_code=201)
def create_item(
    body:         ItemCreate,
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    item = Item(**body.model_dump(), owner_id=current_user.id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/{item_id}", response_model=ItemOut)
def get_item(
    item_id: int,
    db: Session = Depends(get_db),
    _:  User    = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/{item_id}", response_model=ItemOut)
def update_item(
    item_id: int,
    body:    ItemCreate,
    db:      Session = Depends(get_db),
    _:       User    = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    for k, v in body.model_dump().items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    _:  User    = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
`;
  }

  // default — in-memory store, no DB dependency
  return `from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()


class ItemCreate(BaseModel):
    name:        str
    description: Optional[str] = None
    price:       float
    in_stock:    bool = True


class Item(ItemCreate):
    id: int


_store:   List[Item] = []
_counter: int        = 0


@router.get("/", response_model=List[Item])
async def list_items():
    return _store


@router.post("/", response_model=Item, status_code=201)
async def create_item(body: ItemCreate):
    global _counter
    _counter += 1
    item = Item(id=_counter, **body.model_dump())
    _store.append(item)
    return item


@router.get("/{item_id}", response_model=Item)
async def get_item(item_id: int):
    item = next((i for i in _store if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.put("/{item_id}", response_model=Item)
async def update_item(item_id: int, body: ItemCreate):
    for idx, item in enumerate(_store):
        if item.id == item_id:
            _store[idx] = Item(id=item_id, **body.model_dump())
            return _store[idx]
    raise HTTPException(status_code=404, detail="Item not found")


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: int):
    global _store
    before = len(_store)
    _store = [i for i in _store if i.id != item_id]
    if len(_store) == before:
        raise HTTPException(status_code=404, detail="Item not found")
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// database.py
// ═════════════════════════════════════════════════════════════════════════════

function sqlDatabasePy() {
  return `from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import settings

_connect_args = {"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
engine        = create_engine(settings.DATABASE_URL, connect_args=_connect_args)
SessionLocal  = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
`;
}

function mongoDatabasePy() {
  return `from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from app.config import settings
from app.models.item import Item


async def init_db():
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db     = client[settings.MONGODB_DB]
    await init_beanie(database=db, document_models=[Item])
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// MODELS
// ═════════════════════════════════════════════════════════════════════════════

function sqlItemModel() {
  return `from sqlalchemy import Column, Integer, String, Float, Boolean
from app.database import Base


class Item(Base):
    __tablename__ = "items"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String,  index=True,       nullable=False)
    description = Column(String,  nullable=True)
    price       = Column(Float,   nullable=False)
    in_stock    = Column(Boolean, default=True)
`;
}

function fsItemModel() {
  return `from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Item(Base):
    __tablename__ = "items"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String,  index=True,       nullable=False)
    description = Column(String,  nullable=True)
    price       = Column(Float,   nullable=False)
    in_stock    = Column(Boolean, default=True)
    owner_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    owner       = relationship("User", back_populates="items")
`;
}

function mongoItemModel() {
  return `from beanie import Document
from typing import Optional


class Item(Document):
    name:        str
    description: Optional[str] = None
    price:       float
    in_stock:    bool = True

    class Settings:
        name = "items"
`;
}

function userModel() {
  return `from sqlalchemy import Column, Integer, String, Boolean
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    email           = Column(String,  unique=True, index=True, nullable=False)
    username        = Column(String,  unique=True, index=True, nullable=False)
    hashed_password = Column(String,  nullable=False)
    is_active       = Column(Boolean, default=True)
    is_admin        = Column(Boolean, default=False)
    items           = relationship("Item", back_populates="owner")
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// SCHEMAS
// ═════════════════════════════════════════════════════════════════════════════

function sqlItemSchema() {
  return `from pydantic import BaseModel
from typing import Optional


class ItemBase(BaseModel):
    name:        str
    description: Optional[str] = None
    price:       float
    in_stock:    bool = True


class ItemCreate(ItemBase):
    pass


class ItemOut(ItemBase):
    id: int
    model_config = {"from_attributes": True}
`;
}

function mongoItemSchema() {
  return `from pydantic import BaseModel
from typing import Optional


class ItemCreate(BaseModel):
    name:        str
    description: Optional[str] = None
    price:       float
    in_stock:    bool = True


class ItemOut(ItemCreate):
    id: Optional[str] = None
    model_config = {"from_attributes": True}
`;
}

function userSchema() {
  return `from pydantic import BaseModel, EmailStr
from typing import Optional


class UserCreate(BaseModel):
    email:    EmailStr
    username: str
    password: str


class UserOut(BaseModel):
    id:        int
    email:     str
    username:  str
    is_active: bool
    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type:   str


class TokenData(BaseModel):
    username: Optional[str] = None
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// FULL-STACK EXTRAS
// ═════════════════════════════════════════════════════════════════════════════

function securityUtils() {
  return `from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload["exp"] = expire
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None
`;
}

function depsPy() {
  return `from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.utils.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str     = Depends(oauth2_scheme),
    db:    Session = Depends(get_db),
) -> User:
    username = decode_token(token)
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return user
`;
}

function authRouter() {
  return `from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserOut, Token
from app.utils.security import hash_password, verify_password, create_access_token

router = APIRouter()


@router.post("/register", response_model=UserOut, status_code=201)
def register(body: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = User(
        email           = body.email,
        username        = body.username,
        hashed_password = hash_password(body.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    return {
        "access_token": create_access_token({"sub": user.username}),
        "token_type":   "bearer",
    }
`;
}

function usersRouter() {
  return `from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserOut
from app.deps import get_current_user

router = APIRouter()


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/", response_model=List[UserOut])
def list_users(
    db:           Session = Depends(get_db),
    current_user: User    = Depends(get_current_user),
):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    return db.query(User).all()
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

function testsDefault() {
  return `from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_root():
    r = client.get("/")
    assert r.status_code == 200


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "UP"


def test_list_items_empty():
    r = client.get("/api/items/")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_create_and_get_item():
    r = client.post("/api/items/", json={"name": "Widget", "price": 9.99})
    assert r.status_code == 201
    item_id = r.json()["id"]
    r = client.get(f"/api/items/{item_id}")
    assert r.status_code == 200
    assert r.json()["name"] == "Widget"


def test_delete_item():
    r = client.post("/api/items/", json={"name": "Temp", "price": 1.0})
    item_id = r.json()["id"]
    assert client.delete(f"/api/items/{item_id}").status_code == 204
`;
}

function testsSql() {
  return `import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

TEST_DB_URL = "sqlite:///./test.db"
engine      = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    def override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_root(client):
    assert client.get("/").status_code == 200


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "UP"


def test_create_and_get_item(client):
    r = client.post("/api/items/", json={"name": "Widget", "price": 9.99})
    assert r.status_code == 201
    item_id = r.json()["id"]
    r = client.get(f"/api/items/{item_id}")
    assert r.status_code == 200
    assert r.json()["name"] == "Widget"


def test_delete_item(client):
    r = client.post("/api/items/", json={"name": "Temp", "price": 1.0})
    item_id = r.json()["id"]
    assert client.delete(f"/api/items/{item_id}").status_code == 204
`;
}

function testsFullStack() {
  return `import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

TEST_DB_URL = "sqlite:///./test_fs.db"
engine      = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client():
    def override_db():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_root(client):
    assert client.get("/").status_code == 200


def test_health(client):
    assert client.get("/health").json()["status"] == "UP"


def test_register_and_login(client):
    r = client.post("/api/auth/register", json={
        "email": "user@example.com", "username": "testuser", "password": "secret123",
    })
    assert r.status_code == 201

    r = client.post("/api/auth/login",
                    data={"username": "testuser", "password": "secret123"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_protected_route_requires_auth(client):
    r = client.get("/api/items/")
    assert r.status_code == 401
`;
}

// ═════════════════════════════════════════════════════════════════════════════
// SHARED HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function requirements(template) {
  const base = [
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "python-dotenv>=1.0.0",
  ];

  if (isMongo(template))
    return [...base, "motor>=3.6.0", "beanie>=1.26.0,<2.0.0"].join("\n") + "\n";

  if (isFullStack(template))
    return (
      [
        ...base,
        "sqlalchemy>=2.0.0",
        "alembic>=1.13.0",
        "python-jose[cryptography]>=3.3.0",
        "passlib[bcrypt]>=1.7.4",
        "python-multipart>=0.0.9",
        "email-validator>=2.0.0",
      ].join("\n") + "\n"
    );

  if (isSql(template))
    return [...base, "sqlalchemy>=2.0.0", "alembic>=1.13.0"].join("\n") + "\n";

  return base.join("\n") + "\n";
}

function requirementsDev() {
  return "pytest>=7.0.0\npytest-asyncio>=0.23.0\nhttpx>=0.27.0\n";
}

function envFile(name, template) {
  const base = `APP_NAME=${name}\nAPP_ENV=development\nDEBUG=True\n`;
  if (isMongo(template))
    return `${base}MONGODB_URL=mongodb://localhost:27017\nMONGODB_DB=appdb\n`;
  if (isFullStack(template))
    return `${base}DATABASE_URL=sqlite:///./app.db\nSECRET_KEY=change-me-in-production\nALGORITHM=HS256\nACCESS_TOKEN_EXPIRE_MINUTES=30\n`;
  if (isSql(template)) return `${base}DATABASE_URL=sqlite:///./app.db\n`;
  return base;
}

function gitignore(template) {
  const base = [
    "venv/",
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    ".env",
    ".DS_Store",
    ".pytest_cache/",
    "*.egg-info/",
  ];
  if (isSql(template) || isFullStack(template))
    base.push("*.db", "alembic/versions/");
  return base.join("\n") + "\n";
}

function readme(name, template) {
  const activate = isWin
    ? "venv\\Scripts\\activate"
    : "source venv/bin/activate";

  const dbSection =
    isSql(template) || isFullStack(template)
      ? `\n### Database\nSQLite is used by default. To switch to PostgreSQL update \`DATABASE_URL\` in \`.env\`.\n\`\`\`bash\nalembic init alembic\nalembic revision --autogenerate -m "init"\nalembic upgrade head\n\`\`\``
      : isMongo(template)
      ? `\n### Database\nStart MongoDB locally or set \`MONGODB_URL\` in \`.env\` to your Atlas URI.`
      : "";

  const authSection = isFullStack(template)
    ? `\n### Auth flow\n| Endpoint | Method | Body |\n|---|---|---|\n| \`/api/auth/register\` | POST | \`{email, username, password}\` |\n| \`/api/auth/login\` | POST | form-data \`username\` + \`password\` |\n\nUse the returned \`access_token\` as \`Authorization: Bearer <token>\` on protected routes.`
    : "";

  const apiSection = `\n### API docs\n- Swagger UI → http://localhost:8000/docs\n- ReDoc → http://localhost:8000/redoc`;

  return `# ${name}

Generated by **PIC-LI** · Template: \`${template}\`

## Quick start

\`\`\`bash
${activate}
uvicorn app.main:app --reload
\`\`\`

App → http://localhost:8000
${dbSection}
${authSection}
${apiSection}
`;
}

module.exports = { generate };
