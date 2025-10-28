#!/usr/bin/env bash
set -a
source /home/devops/.healthup.env
set +a
exec /usr/bin/node /var/www/healthup/server/app.js
