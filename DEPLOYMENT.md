# Deployment guide (Hetzner / Ubuntu)

Step-by-step to run the app on a fresh Ubuntu 22.04/24.04 server. Commands assume
a sudo user. Replace `reports.example.org` with your domain.

## 1. System packages
```bash
sudo apt update && sudo apt upgrade -y
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs postgresql ffmpeg nginx git
# HTTPS
sudo apt install -y certbot python3-certbot-nginx
```
`ffmpeg` provides `ffprobe`, used to read video metadata/GPS.

## 2. PostgreSQL database + user
```bash
sudo -u postgres psql <<'SQL'
CREATE USER appuser WITH PASSWORD 'CHANGE_ME_STRONG';
CREATE DATABASE agency_reports OWNER appuser;
\c agency_reports
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
```
The app creates its own tables/views on first start.

## 3. App
```bash
sudo mkdir -p /opt/agency && sudo chown $USER /opt/agency
cd /opt/agency
git clone https://github.com/anirudhatalmale6-alt/agency-activity-reporting.git .
npm install --omit=dev
cp .env.example .env
```
Edit `.env`:
```
PORT=3000
PGHOST=localhost
PGPORT=5432
PGUSER=appuser
PGPASSWORD=CHANGE_ME_STRONG
PGDATABASE=agency_reports
SESSION_SECRET=<run: openssl rand -hex 32>
ADMIN_USER=admin
ADMIN_PASSWORD=<a strong first-login password>
```

## 4. Run as a service (systemd)
```bash
sudo tee /etc/systemd/system/agency.service >/dev/null <<'UNIT'
[Unit]
Description=Agency Activity Reporting
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/agency
EnvironmentFile=/opt/agency/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
UNIT
sudo chown -R www-data:www-data /opt/agency
sudo systemctl daemon-reload
sudo systemctl enable --now agency
sudo systemctl status agency --no-pager
```

## 5. Nginx reverse proxy (with large-upload support)
```bash
sudo tee /etc/nginx/sites-available/agency >/dev/null <<'NGINX'
server {
  listen 80;
  server_name reports.example.org;

  # Allow 15-min videos through the proxy.
  client_max_body_size 3g;
  proxy_read_timeout 600s;
  proxy_send_timeout 600s;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
NGINX
sudo ln -s /etc/nginx/sites-available/agency /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 6. HTTPS
```bash
sudo certbot --nginx -d reports.example.org
```
Certbot adds the SSL block and auto-renews. Because the app sets `trust proxy`,
submitter IPs are recorded correctly behind Nginx.

## 7. First login
1. Visit `https://reports.example.org/login.html`.
2. Log in with `ADMIN_USER` / `ADMIN_PASSWORD` from `.env`.
3. Go to **Reviewers** and add an account for each reviewer (3–4 people).
4. Everyone logs in with their own account so the audit log ties actions to a person.

## 8. Power BI
See `POWERBI_SETUP.md`. Since the map is public, use **Publish to web** and
paste the iframe into `public/powerbi.html`. Point Power BI at the
`powerbi_heatmap` view and set a scheduled refresh via the free data gateway.

## 9. Backups (important for evidence data)
```bash
# Database (run daily via cron)
pg_dump -U appuser agency_reports | gzip > /backups/agency_$(date +\%F).sql.gz
# Uploaded originals (write-once files)
rsync -a /opt/agency/uploads/ /backups/uploads/
```

## Updating later
```bash
cd /opt/agency && git pull && npm install --omit=dev && sudo systemctl restart agency
```
