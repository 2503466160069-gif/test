# First Choice Movers — Real-Time Quote + Admin System

A simple customer website and protected admin dashboard using **FastAPI + Supabase PostgreSQL + WebSockets**. No Canva Datasheet and no Google Sheet is required.

## What works

- Customer quote form
- Multiple customers can submit independently
- Piano moving services
- Piano-specific details in the additional details field
- Quotes stored in Supabase PostgreSQL
- Protected admin login
- Admin search and status filters
- Status workflow: New → Contacted → Quoted → Booked → Completed / Cancelled
- Real-time quote events over WebSocket
- If an admin reconnects after being offline, the dashboard reloads the current database state
- Customer reviews with admin approval
- Responsive mobile layout
- Your supplied First Choice Movers logo and moving image are included

## Folder structure

```text
first-choice-movers-realtime/
├── admin/
│   └── index.html
├── assets/
│   ├── admin.css
│   ├── admin.js
│   ├── customer.js
│   ├── hero.jpg
│   ├── logo.jpg
│   └── site.css
├── backend/
│   ├── main.py
│   └── requirements.txt
├── customer/
│   └── index.html
├── database/
│   └── schema.sql
├── .env.example
├── .gitignore
└── README.md
```

## 1. Create Supabase database

Create a Supabase project. Open **SQL Editor** and run all of `database/schema.sql`.

Do not put the Supabase service-role key in browser JavaScript.

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
ADMIN_PASSWORD=YOUR_STRONG_ADMIN_PASSWORD
JWT_SECRET=YOUR_LONG_RANDOM_SECRET
CORS_ORIGINS=*
```

The service-role key stays on the FastAPI server only.

## 3. Run locally

From the project root:

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

Open:

- Customer: `http://127.0.0.1:8000/`
- Admin: `http://127.0.0.1:8000/admin`
- Health: `http://127.0.0.1:8000/api/health`

## 4. Deploy on Render

Create a **Web Service** from the project repository.

- Runtime: Python
- Build command: `pip install -r backend/requirements.txt`
- Start command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`

Add the four environment variables from `.env` in Render's Environment settings.

After deployment:

- `https://YOUR-RENDER-DOMAIN/` = customer website
- `https://YOUR-RENDER-DOMAIN/admin` = admin dashboard

## Real-time behavior

When a customer submits a quote, FastAPI writes it to Supabase and immediately broadcasts a `quote_created` event to connected admin dashboards over WebSocket. Status changes broadcast `quote_updated` events.

The dashboard also reloads from the database when it reconnects, so quotes are not lost if the admin was temporarily offline.

This implementation is designed for a single Render Web Service instance. If you later run multiple backend instances, use a shared pub/sub layer (for example Redis) so WebSocket events are broadcast across every instance.

## Security notes

- Never commit `.env`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend files.
- Use a strong `ADMIN_PASSWORD` and `JWT_SECRET`.
- Change the admin password before production.
