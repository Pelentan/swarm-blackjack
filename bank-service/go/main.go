package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
)

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Printf("[bank] starting — Go + GnuCOBOL bank service")

	// ── Config ────────────────────────────────────────────────────────────────
	port := getEnv("PORT", "3005")
	cobolDir = getEnv("COBOL_BIN_DIR", "/usr/local/bin/cobol")

	dbHost := getEnv("BANK_DB_HOST", "bank-db")
	dbPort := getEnv("BANK_DB_PORT", "5432")
	dbName := getEnv("BANK_DB_NAME", "bankdb")
	dbUser := getEnv("BANK_DB_USER", "bankuser")
	dbPass := getEnv("BANK_DB_PASSWORD", "bankpass")

	redisHost := getEnv("REDIS_HOST", "redis")
	redisPort := getEnv("REDIS_PORT", "6379")

	documentServiceURL = getEnv("DOCUMENT_SERVICE_URL", "http://document-service:3011")

	// ── Database ──────────────────────────────────────────────────────────────
	db, err := NewDB(dbHost, dbPort, dbName, dbUser, dbPass)
	if err != nil {
		log.Fatalf("[bank] database: %v", err)
	}
	if err := db.Migrate(); err != nil {
		log.Fatalf("[bank] migrate: %v", err)
	}
	if err := db.SeedDemoPlayer(); err != nil {
		log.Fatalf("[bank] seed: %v", err)
	}

	// ── Redis (optional — balance pub/sub) ────────────────────────────────────
	var rdb *redis.Client
	rdb = redis.NewClient(&redis.Options{
		Addr: redisHost + ":" + redisPort,
	})
	log.Printf("[bank] Redis configured at %s:%s", redisHost, redisPort)

	// ── Routes ────────────────────────────────────────────────────────────────
	mux := http.NewServeMux()

	mux.HandleFunc("/health",        healthHandler(db))
	mux.HandleFunc("/account",       accountHandler(db))
	mux.HandleFunc("/balance",       balanceHandler(db))
	mux.HandleFunc("/transactions",  transactionsHandler(db))
	mux.HandleFunc("/bet",           betHandler(db, rdb))
	mux.HandleFunc("/payout",        payoutHandler(db, rdb))
	mux.HandleFunc("/deposit",       depositHandler(db, rdb))
	mux.HandleFunc("/withdraw",      withdrawHandler(db, rdb))
	mux.HandleFunc("/export",        exportHandler(db))
	mux.HandleFunc("/dev/reset",     devResetHandler(db))

	log.Printf("[bank] listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("[bank] server: %v", err)
	}
}
