# Community Activity Reporting Website

A website for a nonprofit where community members report agency activity
(SALUTE-format reports), admins consolidate the data into clean, court-usable
records with a full chain-of-custody trail, and approved reports are visualised
on a heat map (native or Power BI).

## Features (mapped to the user stories)

**User Story 1 — Community submission**
- Mobile-first form with the SALUTE fields: **S**ize, **A**ctivity, **L**ocation,
  **U**nit, **T**ime, **E**quipment.
- Free text, equipment checkboxes + free-text "other".
- Photo/video upload with **resumable chunked upload** (handles 15-min videos on
  flaky mobile connections).
- **All original metadata preserved** — the raw file is stored **write-once
  (read-only)**, EXIF (photos) and ffprobe technical metadata + GPS (video) are
  extracted, and a **SHA-256 integrity hash** is captured at ingest.
- **Forced** terms & conditions (unlocks only after scrolling; server rejects
  submissions without acceptance).

**User Story 2 — Admin consolidation (evidence-handling)**
- Every report stored as **one consolidated row**: text + checkboxes + file +
  metadata + integrity hash together.
- **Individual admin logins** (per reviewer) with roles (reviewer / admin).
- **Immutable audit log**: every view/approve/reject/edit/export records the
  user ID, UTC timestamp, before/after change, and IP. Database trigger blocks
  any UPDATE/DELETE on the log.
- Nothing is hard-deleted; moderation is status-based.
- One-click **CSV export** for Access / Power BI.

**User Story 3 — Heat map**
- Native heat map (Leaflet + OpenStreetMap) built from approved reports — no
  licensing cost, works today.
- **Power BI**: a read-only `powerbi_heatmap` view + embed page (`/powerbi.html`)
  and setup guide — see `POWERBI_SETUP.md`.
- Location priority: media GPS → device GPS → manual entry.

## Stack
Node.js + Express, **PostgreSQL** (Power BI-ready, multi-admin), exifr + ffprobe
(metadata), bcrypt (auth), Leaflet (map). Chosen for Hetzner self-hosting.

## Run
```bash
npm install
cp .env.example .env      # fill in DB + secrets
npm start                 # http://localhost:3000
```
Requires a reachable PostgreSQL. Pages: `/` (submit), `/login.html` → `/admin.html`,
`/heatmap.html` (native), `/powerbi.html` (Power BI embed).

> Deployment on Hetzner + Power BI gateway/refresh: see `POWERBI_SETUP.md`.
> Still to do after sign-off: CSV/Excel bulk import, API/SFTP ingestion,
> real T&C text (currently placeholder).
