#!/bin/bash
set -e

MAIL_HOSTNAME="${MAIL_HOSTNAME:-swarm-blackjack.local}"
MAIL_FROM_DOMAIN="${MAIL_FROM_DOMAIN:-swarm-blackjack.local}"
SMTP_RELAY_HOST="${SMTP_RELAY_HOST:-}"
SMTP_RELAY_PORT="${SMTP_RELAY_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASSWORD="${SMTP_PASSWORD:-}"

echo "[postfix] Configuring send-only MTA"
echo "[postfix] Hostname: ${MAIL_HOSTNAME}"
echo "[postfix] Relay: ${SMTP_RELAY_HOST}:${SMTP_RELAY_PORT}"

# SASL credentials file
if [ -n "$SMTP_USER" ] && [ -n "$SMTP_PASSWORD" ]; then
    echo "[${SMTP_RELAY_HOST}]:${SMTP_RELAY_PORT} ${SMTP_USER}:${SMTP_PASSWORD}" \
        > /etc/postfix/sasl_passwd
    postmap /etc/postfix/sasl_passwd
    chmod 600 /etc/postfix/sasl_passwd /etc/postfix/sasl_passwd.db
    echo "[postfix] SASL credentials configured for ${SMTP_USER}"
fi

cat > /etc/postfix/main.cf << CONF
compatibility_level = 3.6

# Identity
myhostname = ${MAIL_HOSTNAME}
myorigin = ${MAIL_FROM_DOMAIN}

# Send-only — accept from Docker internal network only
inet_interfaces = all
inet_protocols = ipv4
mydestination =
mynetworks = 127.0.0.0/8, 172.16.0.0/12, 10.0.0.0/8

# Relay through configured SMTP server
relayhost = [${SMTP_RELAY_HOST}]:${SMTP_RELAY_PORT}
smtp_use_tls = yes
smtp_tls_security_level = encrypt
smtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt

# SASL auth
smtp_sasl_auth_enable = yes
smtp_sasl_password_maps = hash:/etc/postfix/sasl_passwd
smtp_sasl_security_options = noanonymous
smtp_sasl_tls_security_options = noanonymous

# No local mailboxes
local_transport = error: local mail delivery disabled
alias_maps =
alias_database =

# Logging to stdout
maillog_file = /dev/stdout

# Queue tuning
maximal_queue_lifetime = 1h
bounce_queue_lifetime = 1h
queue_run_delay = 30s
minimal_backoff_time = 60s
maximal_backoff_time = 5m
CONF

# Copy resolv.conf into chroot for MX lookups
mkdir -p /var/spool/postfix/etc
cp /etc/resolv.conf /var/spool/postfix/etc/resolv.conf

postfix check 2>&1 || true
newaliases 2>/dev/null || true

echo "[postfix] Starting"
exec /usr/sbin/postfix -c /etc/postfix start-fg
