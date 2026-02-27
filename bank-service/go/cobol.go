package main

import (
	"fmt"
	"math"
	"os/exec"
	"strconv"
	"strings"
)

// cobolDir is set at startup from the COBOL_BIN_DIR environment variable.
// Defaults to /usr/local/bin/cobol — where Dockerfile places compiled binaries.
var cobolDir = "/usr/local/bin/cobol"

// RunCOBOL executes a compiled COBOL program with the given environment variables.
// The program communicates via environment variables (input) and stdout key=value lines (output).
// Returns a map of output key=value pairs, or an error if the program fails.
func RunCOBOL(program string, env map[string]string) (map[string]string, error) {
	path := cobolDir + "/" + program
	cmd := exec.Command(path)

	// Pass input as environment variables
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	out, err := cmd.Output()
	if err != nil {
		// Include stderr in error message if available
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("COBOL %s failed (exit %d): %s",
				program, exitErr.ExitCode(), string(exitErr.Stderr))
		}
		return nil, fmt.Errorf("COBOL %s exec error: %w", program, err)
	}

	result := make(map[string]string)
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// Check for error line first
		if strings.HasPrefix(line, "ERROR=") {
			return nil, fmt.Errorf("COBOL %s: %s", program, strings.TrimPrefix(line, "ERROR="))
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			result[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	return result, nil
}

// ── Decimal ↔ Cents conversion ───────────────────────────────────────────────
// All amounts stored in DB as NUMERIC(15,2) strings e.g. "1000.00"
// COBOL programs work in integer cents to avoid floating-point arithmetic.

// DollarsToCents converts a decimal string ("1000.00") to integer cents (100000).
// Parses without floating point to avoid precision loss.
func DollarsToCents(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, fmt.Errorf("empty amount string")
	}
	parts := strings.SplitN(s, ".", 2)
	whole, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("invalid amount %q: %w", s, err)
	}
	cents := whole * 100
	if len(parts) == 2 {
		frac := parts[1]
		switch len(frac) {
		case 0:
			// "1000." — no fractional part
		case 1:
			frac += "0" // "1000.5" → 50 cents
		default:
			frac = frac[:2] // truncate beyond 2 decimal places
		}
		f, err := strconv.ParseInt(frac, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid fractional amount %q: %w", s, err)
		}
		cents += f
	}
	return cents, nil
}

// CentsToDollars converts integer cents (100000) to a decimal string ("1000.00").
func CentsToDollars(cents int64) string {
	abs := cents
	neg := ""
	if cents < 0 {
		abs = -cents
		neg = "-"
	}
	return fmt.Sprintf("%s%d.%02d", neg, abs/100, abs%100)
}

// CentsToString formats cents as a zero-padded string for COBOL env vars.
// COBOL PIC S9(15) can hold up to 999,999,999,999,999 cents.
func CentsToString(cents int64) string {
	return strconv.FormatInt(cents, 10)
}

// ParseCentsResult reads a cents value from a COBOL output map.
func ParseCentsResult(result map[string]string, key string) (int64, error) {
	val, ok := result[key]
	if !ok {
		return 0, fmt.Errorf("COBOL output missing key %q", key)
	}
	val = strings.TrimSpace(val)
	// Strip leading zeros but handle "0" correctly
	n, err := strconv.ParseInt(val, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("COBOL output %q=%q is not an integer: %w", key, val, err)
	}
	return n, nil
}

// ── High-level COBOL operations ───────────────────────────────────────────────

type DebitResult struct {
	Status          string // "OK" or "INSUFFICIENT"
	NewBalanceCents int64
}

// ValidateDebit calls VALIDATE-DEBIT: checks funds and computes new balance.
func ValidateDebit(balanceCents, debitCents int64) (DebitResult, error) {
	result, err := RunCOBOL("VALIDATE-DEBIT", map[string]string{
		"BALANCE_CENTS": CentsToString(balanceCents),
		"DEBIT_CENTS":   CentsToString(debitCents),
	})
	if err != nil {
		return DebitResult{}, err
	}
	status, ok := result["STATUS"]
	if !ok {
		return DebitResult{}, fmt.Errorf("VALIDATE-DEBIT: missing STATUS in output")
	}
	status = strings.TrimSpace(status)
	newBal, err := ParseCentsResult(result, "NEW_BALANCE_CENTS")
	if err != nil {
		return DebitResult{}, fmt.Errorf("VALIDATE-DEBIT: %w", err)
	}
	return DebitResult{Status: status, NewBalanceCents: newBal}, nil
}

type PayoutResult struct {
	ReturnedCents int64
	PayoutType    string // "payout_win", "payout_loss", "payout_push"
}

// CalcPayout calls CALC-PAYOUT: computes amount to return given bet and result.
func CalcPayout(betCents int64, result string) (PayoutResult, error) {
	out, err := RunCOBOL("CALC-PAYOUT", map[string]string{
		"BET_CENTS": CentsToString(betCents),
		"RESULT":    strings.ToUpper(strings.TrimSpace(result)),
	})
	if err != nil {
		return PayoutResult{}, err
	}
	returned, err := ParseCentsResult(out, "RETURNED_CENTS")
	if err != nil {
		return PayoutResult{}, fmt.Errorf("CALC-PAYOUT: %w", err)
	}
	payoutType, ok := out["PAYOUT_TYPE"]
	if !ok {
		return PayoutResult{}, fmt.Errorf("CALC-PAYOUT: missing PAYOUT_TYPE in output")
	}
	return PayoutResult{
		ReturnedCents: returned,
		PayoutType:    strings.TrimSpace(payoutType),
	}, nil
}

// CalcCredit calls CALC-CREDIT: adds a credit to balance.
func CalcCredit(balanceCents, creditCents int64) (int64, error) {
	// Optimization: zero credit is a no-op (payout_loss case)
	if creditCents == 0 {
		return balanceCents, nil
	}
	out, err := RunCOBOL("CALC-CREDIT", map[string]string{
		"BALANCE_CENTS": CentsToString(balanceCents),
		"CREDIT_CENTS":  CentsToString(creditCents),
	})
	if err != nil {
		return 0, err
	}
	return ParseCentsResult(out, "NEW_BALANCE_CENTS")
}

// roundToTwoDecimals is a safety helper — should never be needed given
// integer cents arithmetic, but guards against any conversion edge cases.
func roundToTwoDecimals(f float64) float64 {
	return math.Round(f*100) / 100
}
