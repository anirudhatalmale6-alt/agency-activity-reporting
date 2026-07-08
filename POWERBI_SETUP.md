# Power BI integration

The app stores every report in PostgreSQL and exposes a read-only view,
`powerbi_heatmap`, containing approved, geolocated reports. Power BI connects to
that view, and you display the result on your site.

## 1. Connect Power BI Desktop to the database
1. **Home → Get data → PostgreSQL database.**
2. Server: your Hetzner host (or `localhost` if running on the same box), Database: `agency_reports`.
3. Select the **`powerbi_heatmap`** view (not the raw `reports` table — the view
   already filters to approved + geolocated rows).
4. Load.

## 2. Build the heat map visual
- Use **Azure Maps** or **ArcGIS Maps for Power BI** (both free, built in).
- Location = `latitude` / `longitude`. Turn on the **heat map** layer.
- Optional tooltips: `activity`, `unit`, `observed_at`.

## 3. Keep the data fresh
- Publish the report to the Power BI service (**My Workspace**).
- Install the free **On-premises data gateway** on a machine that can reach the
  PostgreSQL server, then set a **scheduled refresh** on the dataset.

## 4. Show it on the website
- In the service: **File → Embed report → Publish to web (public)**.
- Copy the `<iframe>` it generates and paste it into `public/powerbi.html`
  (replace the placeholder block). Done — the map shows on `/powerbi.html`.

### Licensing summary
- **Publish to web** embed: free for viewers; publishing usually needs one
  **Power BI Pro** seat (~$14/mo) for whoever maintains the report — not all reviewers.
- Only use Publish to web for **public** data (the heat map is public awareness).
- If the map must be access-restricted, that needs **Power BI Embedded** (paid Azure capacity).

> A fully-working native heat map (`/heatmap.html`, Leaflet + OpenStreetMap) is
> included as a no-cost alternative, reading the same data.
