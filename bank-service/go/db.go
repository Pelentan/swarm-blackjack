package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/lib/pq"
)

// DB wraps the PostgreSQL connection pool.
type DB struct {
	pool *sql.DB
}

const (
	DemoPlayerID    = "player-00000000-0000-0000-0000-000000000001"
	StartingBalance = "1000.00"
)

// NewDB opens a PostgreSQL connection pool and waits for the DB to be ready.
func NewDB(host, port, name, user, password string) (*DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s dbname=%s user=%s password=%s sslmode=disable",
		host, port, name, user, password,
	)
	pool, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("db open: %w", err)
	}
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(5)
	pool.SetConnMaxLifetime(5 * time.Minute)

	db := &DB{pool: pool}
	if err := db.waitReady(); err != nil {
		return nil, err
	}
	return db, nil
}

func (d *DB) waitReady() error {
	for i := 0; i < 30; i++ {
		if err := d.pool.Ping(); err == nil {
			log.Printf("[bank-db] connected")
			return nil
		}
		log.Printf("[bank-db] not ready (%d/30), retrying...", i+1)
		time.Sleep(2 * time.Second)
	}
	return fmt.Errorf("bank-db unavailable after 60s")
}

// Migrate creates tables if they don't exist. Idempotent.
func (d *DB) Migrate() error {
	_, err := d.pool.Exec(`
		CREATE TABLE IF NOT EXISTS accounts (
			player_id   VARCHAR(100) PRIMARY KEY,
			balance     NUMERIC(15,2) NOT NULL DEFAULT 1000.00,
			created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("migrate accounts: %w", err)
	}
	_, err = d.pool.Exec(`
		CREATE TABLE IF NOT EXISTS transactions (
			id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
			player_id      VARCHAR(100)  NOT NULL REFERENCES accounts(player_id),
			type           VARCHAR(30)   NOT NULL,
			amount         NUMERIC(15,2) NOT NULL,
			balance_before NUMERIC(15,2) NOT NULL,
			balance_after  NUMERIC(15,2) NOT NULL,
			ref_id         VARCHAR(100),
			note           VARCHAR(255),
			created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("migrate transactions: %w", err)
	}
	_, err = d.pool.Exec(`
		CREATE TABLE IF NOT EXISTS open_bets (
			transaction_id VARCHAR(100)  PRIMARY KEY,
			player_id      VARCHAR(100)  NOT NULL REFERENCES accounts(player_id),
			amount         NUMERIC(15,2) NOT NULL,
			created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("migrate open_bets: %w", err)
	}
	_, err = d.pool.Exec(`
		CREATE INDEX IF NOT EXISTS idx_transactions_player
			ON transactions(player_id, created_at DESC)
	`)
	if err != nil {
		return fmt.Errorf("migrate index: %w", err)
	}
	log.Printf("[bank-db] schema ready")
	return nil
}

// SeedDemoPlayer inserts the demo player if not present.
func (d *DB) SeedDemoPlayer() error {
	_, err := d.pool.Exec(
		`INSERT INTO accounts(player_id, balance) VALUES($1, $2) ON CONFLICT DO NOTHING`,
		DemoPlayerID, StartingBalance,
	)
	if err != nil {
		return fmt.Errorf("seed demo player: %w", err)
	}
	log.Printf("[bank-db] demo player seeded (or already present)")
	return nil
}

// ── Account operations ────────────────────────────────────────────────────────

// AccountExists returns true if the player has an account.
func (d *DB) AccountExists(playerID string) (bool, error) {
	var exists bool
	err := d.pool.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM accounts WHERE player_id=$1)`, playerID,
	).Scan(&exists)
	return exists, err
}

// CreateAccount creates a new account with the given starting balance.
func (d *DB) CreateAccount(playerID, startingBalance string) error {
	_, err := d.pool.Exec(
		`INSERT INTO accounts(player_id, balance) VALUES($1, $2)`,
		playerID, startingBalance,
	)
	return err
}

// GetBalance returns the current balance string for a player, or "" if not found.
func (d *DB) GetBalance(playerID string) (string, bool, error) {
	var balance string
	err := d.pool.QueryRow(
		`SELECT balance::text FROM accounts WHERE player_id=$1`, playerID,
	).Scan(&balance)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	return balance, true, err
}

// ── Bet operations ────────────────────────────────────────────────────────────

type BetRecord struct {
	PlayerID      string
	BalanceBefore string
	BalanceAfter  string
	Amount        string
	TxID          string
}

// PlaceBet debits a bet from the player's balance in a transaction.
// Returns the new balance string and a transaction ID.
// The caller has already validated funds via COBOL.
func (d *DB) PlaceBet(playerID, balanceBefore, newBalance, amount string) (string, error) {
	tx, err := d.pool.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()

	// Update balance
	_, err = tx.Exec(
		`UPDATE accounts SET balance=$1 WHERE player_id=$2`,
		newBalance, playerID,
	)
	if err != nil {
		return "", fmt.Errorf("place bet update balance: %w", err)
	}

	// Record transaction
	_, err = tx.Exec(
		`INSERT INTO transactions(player_id, type, amount, balance_before, balance_after)
		 VALUES($1, 'bet', $2, $3, $4)`,
		playerID, amount, balanceBefore, newBalance,
	)
	if err != nil {
		return "", fmt.Errorf("place bet record transaction: %w", err)
	}

	// Record open bet with UUID as transaction ID
	var txID string
	err = tx.QueryRow(`SELECT gen_random_uuid()::text`).Scan(&txID)
	if err != nil {
		return "", fmt.Errorf("place bet generate uuid: %w", err)
	}
	_, err = tx.Exec(
		`INSERT INTO open_bets(transaction_id, player_id, amount) VALUES($1, $2, $3)`,
		txID, playerID, amount,
	)
	if err != nil {
		return "", fmt.Errorf("place bet open bet: %w", err)
	}

	return txID, tx.Commit()
}

// ReplenishDemoPlayer resets the demo player's balance to the starting balance.
// Called when the demo player runs out of chips.
func (d *DB) ReplenishDemoPlayer() (string, error) {
	_, err := d.pool.Exec(
		`UPDATE accounts SET balance=$1 WHERE player_id=$2`,
		StartingBalance, DemoPlayerID,
	)
	if err != nil {
		return "", fmt.Errorf("replenish demo player: %w", err)
	}
	log.Printf("[bank] demo player replenished to %s", StartingBalance)
	return StartingBalance, nil
}

// ── Payout operations ─────────────────────────────────────────────────────────

type OpenBet struct {
	PlayerID string
	Amount   string
}

// GetOpenBet retrieves an open bet by transaction ID. Returns nil if not found.
func (d *DB) GetOpenBet(txID string) (*OpenBet, error) {
	var bet OpenBet
	err := d.pool.QueryRow(
		`SELECT player_id, amount::text FROM open_bets WHERE transaction_id=$1`, txID,
	).Scan(&bet.PlayerID, &bet.Amount)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &bet, err
}

type PayoutRecord struct {
	PlayerID      string
	BalanceBefore string
	BalanceAfter  string
	ReturnedAmt   string
	PayoutType    string
	TxID          string
}

// SettlePayout credits the payout to the player's balance in a transaction.
// Also deletes the open bet record and records the transaction.
func (d *DB) SettlePayout(txID, playerID, balanceBefore, newBalance, returned, payoutType string) error {
	tx, err := d.pool.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Update balance
	_, err = tx.Exec(
		`UPDATE accounts SET balance=$1 WHERE player_id=$2`,
		newBalance, playerID,
	)
	if err != nil {
		return fmt.Errorf("settle payout update balance: %w", err)
	}

	// Record transaction
	_, err = tx.Exec(
		`INSERT INTO transactions(player_id, type, amount, balance_before, balance_after, ref_id)
		 VALUES($1, $2, $3, $4, $5, $6)`,
		playerID, payoutType, returned, balanceBefore, newBalance, txID,
	)
	if err != nil {
		return fmt.Errorf("settle payout record transaction: %w", err)
	}

	// Delete open bet
	_, err = tx.Exec(`DELETE FROM open_bets WHERE transaction_id=$1`, txID)
	if err != nil {
		return fmt.Errorf("settle payout delete open bet: %w", err)
	}

	return tx.Commit()
}

// ── Deposit / Withdraw ────────────────────────────────────────────────────────

// ApplyBalanceChange updates the balance and records a transaction.
// Used for deposits, withdrawals, and any direct balance adjustments.
func (d *DB) ApplyBalanceChange(playerID, balanceBefore, newBalance, amount, txType, note string) error {
	tx, err := d.pool.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(
		`UPDATE accounts SET balance=$1 WHERE player_id=$2`,
		newBalance, playerID,
	)
	if err != nil {
		return fmt.Errorf("apply balance change: %w", err)
	}

	var noteVal interface{}
	if note != "" {
		noteVal = note
	}
	_, err = tx.Exec(
		`INSERT INTO transactions(player_id, type, amount, balance_before, balance_after, note)
		 VALUES($1, $2, $3, $4, $5, $6)`,
		playerID, txType, amount, balanceBefore, newBalance, noteVal,
	)
	if err != nil {
		return fmt.Errorf("apply balance change record: %w", err)
	}

	return tx.Commit()
}

// ── Transaction history ───────────────────────────────────────────────────────

type Transaction struct {
	ID            string  `json:"id"`
	Type          string  `json:"type"`
	Amount        string  `json:"amount"`
	BalanceBefore string  `json:"balanceBefore"`
	BalanceAfter  string  `json:"balanceAfter"`
	RefID         *string `json:"refId"`
	Note          *string `json:"note"`
	CreatedAt     string  `json:"createdAt"`
}

// GetTransactions returns the transaction history for a player.
func (d *DB) GetTransactions(playerID string, limit int) ([]Transaction, error) {
	rows, err := d.pool.Query(
		`SELECT id, type, amount::text, balance_before::text, balance_after::text,
		        ref_id, note, created_at
		 FROM transactions
		 WHERE player_id=$1
		 ORDER BY created_at DESC
		 LIMIT $2`,
		playerID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txns []Transaction
	for rows.Next() {
		var t Transaction
		var createdAt time.Time
		err := rows.Scan(
			&t.ID, &t.Type, &t.Amount,
			&t.BalanceBefore, &t.BalanceAfter,
			&t.RefID, &t.Note, &createdAt,
		)
		if err != nil {
			return nil, err
		}
		t.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		txns = append(txns, t)
	}
	if txns == nil {
		txns = []Transaction{} // never return null — always return an array
	}
	return txns, rows.Err()
}

// ── Dev reset ─────────────────────────────────────────────────────────────────

// DevReset wipes all financial data and re-seeds the demo player.
func (d *DB) DevReset() error {
	tx, err := d.pool.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM open_bets`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM transactions`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM accounts`); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return d.SeedDemoPlayer()
}
