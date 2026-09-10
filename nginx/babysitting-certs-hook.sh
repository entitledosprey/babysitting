#!/bin/sh
# certbot deploy hook: publishes the renewed babysitting certificate into the
# edge proxy's certbot-certs volume and reloads it.
#
# Install to /etc/letsencrypt/renewal-hooks/deploy/babysitting-certs.sh (0755).
# The volume is mounted read-only inside nginx, so the files are written on the
# host side and dereferenced — certbot's live/ entries are symlinks into
# archive/, which does not exist inside that volume.
set -e

DOMAIN=babysitting.entitledosprey.com
DEST=/var/lib/docker/volumes/calorie-app_certbot-certs/_data/live/$DOMAIN
PROXY=calorie-app-nginx-1

# Renewal hooks fire for every lineage; ignore the others.
case "$RENEWED_LINEAGE" in
  */$DOMAIN) ;;
  *) exit 0 ;;
esac

mkdir -p "$DEST"
cp -L "$RENEWED_LINEAGE/fullchain.pem" "$DEST/fullchain.pem"
cp -L "$RENEWED_LINEAGE/privkey.pem"   "$DEST/privkey.pem"
chmod 644 "$DEST/fullchain.pem"
chmod 600 "$DEST/privkey.pem"

docker exec "$PROXY" nginx -s reload
