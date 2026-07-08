# Community Activity Reporting Website

A website for a nonprofit where community members can report agency activity
(SALUTE-format reports), admins consolidate the data into clean records, and
approved reports are visualised on a heat map.

## What it does (mapped to the user stories)

**User Story 1 — Community submission**
- Mobile-first submission form with the SALUTE fields: **S**ize, **A**ctivity,
  **L**ocation, **U**nit, **T**ime, **E**quipment.
- Free text, checkboxes (equipment) + free-text "other".
- Photo/video upload with **all original metadata preserved** (the raw file is
  stored untouched; EXIF incl. GPS & timestamp is also extracted for use).
- **Forced** terms & conditions: the accept box only unlocks after the user
  scrolls through the terms, and the server rejects any report without acceptance.
- Works on mobile and desktop.

**User Story 2 — Admin consolidation**
- Every report is stored as **one consolidated row**: text + checkbox selections
  + file reference + extracted media metadata all on the same record.
- Admin dashboard to review, approve/reject reports.
- One-click **CSV export** that opens directly in **Access or Power BI**.

**User Story 3 — Heat map**
- Native heat map (Leaflet + OpenStreetMap) built directly from approved report
  coordinates — no Power BI licensing required, fast to load.
- Location comes from photo GPS → device GPS → manual entry (in that priority).
- Data also remains exportable to Power BI if you prefer to drive it from there.

## Run locally

```bash
npm install
npm start          # http://localhost:3000  (set PORT to change)
```

- Submission form:  `/`
- Admin dashboard:   `/admin.html`
- Heat map:          `/heatmap.html`

## Tech
Node.js + Express, SQLite (better-sqlite3), Multer (uploads), exifr (metadata),
Leaflet (map). Chosen to keep hosting simple and low-cost for a nonprofit.

> This is a v1 demo. Auth for the admin area, video-GPS parsing, CSV/Excel bulk
> import and API/SFTP ingestion are planned next — see the project notes.
