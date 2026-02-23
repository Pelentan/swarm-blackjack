# CHANGED_FILES.md

**Date:** 2026-02-23 17:00 UTC  
**Feature:** Initial skeleton — full swarm, all services running, SSE to UI  
**Files Added:** 47  
**Files Modified:** 0

## What This Delivers

`docker compose up --build` → cards dealt across 6 languages, visible in browser, observability panel shows live inter-service calls.

## Directory Structure Created

```
swarm-blackjack/
├── README.md
├── contracts/openapi/
│   ├── gateway.yaml          ← Full OpenAPI spec, all routes
│   ├── game-state.yaml       ← Full OpenAPI spec, SSE + actions
│   └── deck-service.yaml     ← Full OpenAPI spec, shoe management
├── gateway/                  ← Go — real, routes + observability SSE
│   ├── main.go
│   ├── go.mod
│   └── Dockerfile
├── game-state/               ← Go — real, SSE + demo loop calling stubs
│   ├── main.go
│   ├── go.mod
│   └── Dockerfile
├── deck-service/             ← Go — real shuffle/deal logic
│   ├── main.go
│   ├── go.mod
│   └── Dockerfile
├── hand-evaluator/           ← Haskell — pure function, real eval logic
│   ├── Main.hs
│   ├── hand-evaluator.cabal
│   └── Dockerfile
├── dealer-ai/                ← Python — real rule-based strategy
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── bank-service/             ← Java — stub, real BigDecimal arithmetic
│   ├── BankService.java
│   └── Dockerfile
├── auth-service/             ← TypeScript — stub, passkey flow documented
│   ├── index.ts
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── chat-service/             ← Elixir — HTTP stub, OTP structure in place
│   ├── mix.exs
│   ├── Dockerfile
│   └── lib/chat_service/
│       ├── application.ex
│       ├── router.ex
│       └── table_registry.ex
├── email-service/            ← Python — stub, logs to console
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── ui/                       ← React/TypeScript — live SSE, game table, observability
│   ├── package.json
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── public/index.html
│   └── src/
│       ├── App.tsx
│       ├── index.tsx
│       ├── types/index.ts
│       ├── hooks/useGameState.ts
│       └── components/
│           ├── Card.tsx
│           ├── GameTable.tsx
│           └── ObservabilityPanel.tsx
└── infra/
    ├── docker-compose.yml
    └── scripts/gen-certs.sh

```

## Next Steps (not in this delivery)
- Move docker-compose.yml to project root for convenience
- Wire mTLS enforcement into each service using generated certs
- OPA policy engine integration in auth-service
- WebSocket chat in Elixir chat-service
- Real passkey ceremony (simplewebauthn)
- Multi-table UI
- Game history PostgreSQL schema + migrations
