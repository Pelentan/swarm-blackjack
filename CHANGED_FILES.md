# CHANGED_FILES.md

**Date:** 2026-02-26 19:00 UTC  
**Feature:** Fix unhealthy containers — add wget to all services missing it  
**Files Modified:** 8

## Files Modified

- `gateway/Dockerfile` — add busybox static wget at /wget
- `game-state/Dockerfile` — add busybox static wget at /wget
- `deck-service/Dockerfile` — add busybox static wget at /wget
- `auth-ui-service/Dockerfile` — add busybox static wget at /wget
- `hand-evaluator/Dockerfile` — add wget to existing apt-get install
- `dealer-ai/Dockerfile` — add busybox static wget at /usr/local/bin/wget
- `auth-service/Dockerfile` — add busybox static wget at /usr/local/bin/wget (final stage)
- `docker-compose.yml` — scratch container healthchecks updated to /wget full path; auth-ui-service changed from CMD-SHELL to CMD

## Root Cause

Two separate issues:
- **Scratch containers** (gateway, game-state, deck-service, auth-ui-service): no shell, no tools, `wget` doesn't exist. Healthcheck CMD also changed from `wget` to `/wget` since PATH resolution doesn't apply in scratch.
- **Slim containers** (hand-evaluator/debian:bookworm-slim, dealer-ai/python:3.12-slim, auth-service/node:20-slim): minimal base images don't include wget.

## Fix

Uniform approach: copy static busybox wget binary into all affected containers.
- Scratch: `COPY --from=busybox:1.36 /bin/wget /wget` → healthcheck uses `/wget`
- Non-scratch: `COPY --from=busybox:1.36 /bin/wget /usr/local/bin/wget` → on PATH, no compose change
- hand-evaluator: added `wget` to existing apt-get line (already had apt-get, cleaner than copying)
