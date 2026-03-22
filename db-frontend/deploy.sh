#!/bin/bash
set -e

cd /opt/DB_Frontend-main/db-frontend

echo "==> Building frontend"
npm run build

echo "==> Restarting GUI service"
systemctl restart dbfrontend-gui.service

echo "==> Current service status"
systemctl --no-pager --full status dbfrontend-gui.service
