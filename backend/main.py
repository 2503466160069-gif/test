from __future__ import annotations

import os
import asyncio
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import httpx
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
JWT_SECRET = os.getenv("JWT_SECRET", "")
CORS_ORIGINS = [x.strip() for x in os.getenv("CORS_ORIGINS", "*").split(",") if x.strip()]

app = FastAPI(title="First Choice Movers API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=CORS_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")

class QuoteCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=5, max_length=40)
    email: EmailStr
    service_type: str = Field(min_length=2, max_length=100)
    pickup_suburb: str = Field(min_length=2, max_length=120)
    dropoff_suburb: str = Field(min_length=2, max_length=120)
    move_date: date | None = None
    message: str = Field(default="", max_length=3000)

class StatusUpdate(BaseModel):
    status: str

class LoginRequest(BaseModel):
    password: str

class ReviewCreate(BaseModel):
    customer_name: str = Field(min_length=2, max_length=120)
    rating: int = Field(ge=1, le=5)
    review_text: str = Field(min_length=5, max_length=1000)

ALLOWED_SERVICES = {
    "House moving", "Office moving", "Furniture delivery", "Piano moving services",
    "Packing and unpacking", "Loading and unloading", "Rubbish or green waste removal",
    "Storage unit move", "Appliance moving", "Mixed freight solution"
}
ALLOWED_STATUSES = {"New", "Contacted", "Quoted", "Booked", "Completed", "Cancelled"}

class ConnectionManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.connections.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.connections.discard(ws)

    async def broadcast(self, event: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.connections):
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

manager = ConnectionManager()


def configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and ADMIN_PASSWORD and JWT_SECRET)


def require_config() -> None:
    if not configured():
        raise HTTPException(status_code=503, detail="Server is not configured. Add the required environment variables.")


def sb_headers() -> dict[str, str]:
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

async def sb_request(method: str, path: str, *, params: dict[str, str] | None = None, json: Any = None) -> Any:
    require_config()
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(method, f"{SUPABASE_URL}/rest/v1/{path}", headers=sb_headers(), params=params, json=json)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Database request failed ({response.status_code}).")
    if not response.content:
        return None
    return response.json()


def issue_token() -> str:
    payload = {"role": "admin", "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str | None) -> bool:
    if not token or not JWT_SECRET:
        return False
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload.get("role") == "admin"
    except jwt.PyJWTError:
        return False


def admin_token_from_header(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    return value if scheme.lower() == "bearer" else None


def ensure_admin(authorization: str | None) -> None:
    require_config()
    if not verify_token(admin_token_from_header(authorization)):
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "database_configured": bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY), "admin_configured": bool(ADMIN_PASSWORD and JWT_SECRET)}

@app.post("/api/auth/login")
async def login(request: LoginRequest) -> dict[str, str]:
    require_config()
    if request.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Incorrect admin password")
    return {"token": issue_token()}

@app.post("/api/quotes", status_code=201)
async def create_quote(quote: QuoteCreate) -> dict[str, Any]:
    if quote.service_type not in ALLOWED_SERVICES:
        raise HTTPException(status_code=400, detail="Please choose a valid service.")
    payload = quote.model_dump(mode="json")
    row = (await sb_request("POST", "quotes", json=payload))[0]
    await manager.broadcast({"type": "quote_created", "quote": row})
    return {"ok": True, "quote": row}

@app.get("/api/quotes")
async def list_quotes(
    authorization: str | None = Header(default=None),
    status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    ensure_admin(authorization)
    params: dict[str, str] = {"select": "*", "order": "created_at.desc", "limit": str(limit)}
    if status and status in ALLOWED_STATUSES:
        params["status"] = f"eq.{status}"
    rows = await sb_request("GET", "quotes", params=params)
    if search:
        s = search.lower().strip()
        rows = [r for r in rows if any(s in str(r.get(k, "")).lower() for k in ("customer_name", "phone", "email", "service_type", "pickup_suburb", "dropoff_suburb"))]
    return {"quotes": rows}

@app.patch("/api/quotes/{quote_id}/status")
async def update_status(quote_id: UUID, update: StatusUpdate, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    ensure_admin(authorization)
    if update.status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    rows = await sb_request("PATCH", "quotes", params={"id": f"eq.{quote_id}"}, json={"status": update.status, "updated_at": datetime.now(timezone.utc).isoformat()})
    if not rows:
        raise HTTPException(status_code=404, detail="Quote not found")
    row = rows[0]
    await manager.broadcast({"type": "quote_updated", "quote": row})
    return {"ok": True, "quote": row}

@app.get("/api/reviews")
async def public_reviews() -> dict[str, Any]:
    rows = await sb_request("GET", "reviews", params={"select": "id,customer_name,rating,review_text,created_at", "approved": "eq.true", "order": "created_at.desc", "limit": "20"})
    return {"reviews": rows}

@app.post("/api/reviews")
async def create_review(review: ReviewCreate) -> dict[str, Any]:
    row = (await sb_request("POST", "reviews", json=review.model_dump()))[0]
    return {"ok": True, "review": row, "message": "Thank you. Your review will appear after approval."}

@app.get("/api/admin/reviews")
async def admin_reviews(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    ensure_admin(authorization)
    rows = await sb_request("GET", "reviews", params={"select": "*", "order": "created_at.desc", "limit": "200"})
    return {"reviews": rows}

@app.patch("/api/admin/reviews/{review_id}")
async def approve_review(review_id: UUID, approved: bool, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    ensure_admin(authorization)
    rows = await sb_request("PATCH", "reviews", params={"id": f"eq.{review_id}"}, json={"approved": approved})
    if not rows:
        raise HTTPException(status_code=404, detail="Review not found")
    return {"ok": True, "review": rows[0]}

@app.websocket("/ws/admin")
async def admin_websocket(ws: WebSocket, token: str = Query(...)) -> None:
    if not configured() or not verify_token(token):
        await ws.close(code=1008)
        return
    await manager.connect(ws)
    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=20)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception:
        manager.disconnect(ws)

@app.get("/")
async def customer_page() -> FileResponse:
    return FileResponse(ROOT / "customer" / "index.html")

@app.get("/admin")
async def admin_page() -> FileResponse:
    return FileResponse(ROOT / "admin" / "index.html")

@app.get("/admin/")
async def admin_page_slash() -> FileResponse:
    return FileResponse(ROOT / "admin" / "index.html")
