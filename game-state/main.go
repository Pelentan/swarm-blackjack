package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"
)

// ── Data Types ────────────────────────────────────────────────────────────────

type Card struct {
	Suit string `json:"suit"`
	Rank string `json:"rank"`
}

type PlayerState struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Chips       int    `json:"chips"`
	CurrentBet  int    `json:"currentBet"`
	Hand        []Card `json:"hand"`
	HandValue   int    `json:"handValue"`
	IsSoftHand  bool   `json:"isSoftHand"`
	Status      string `json:"status"`
	BankTxID    string `json:"-"` // internal only — never sent to frontend
}

type DealerState struct {
	Hand        []Card `json:"hand"`
	HandValue   int    `json:"handValue"`
	IsRevealed  bool   `json:"isRevealed"`
}

type GameState struct {
	TableID        string        `json:"tableId"`
	Phase          string        `json:"phase"`
	Players        []PlayerState `json:"players"`
	Dealer         DealerState   `json:"dealer"`
	ActivePlayerID *string       `json:"activePlayerId"`
	MinBet         int           `json:"minBet"`
	MaxBet         int           `json:"maxBet"`
	HandledBy      string        `json:"handledBy"`
	Timestamp      string        `json:"timestamp"`
}

type SSEEvent struct {
	Type string    `json:"type"`
	Data GameState `json:"data"`
}

type PlayerActionRequest struct {
	PlayerID string `json:"playerId"`
	Action   string `json:"action"`
	Amount   int    `json:"amount,omitempty"`
}

// ── Table ─────────────────────────────────────────────────────────────────────

type Table struct {
	mu        sync.RWMutex
	state     GameState
	clients   map[chan GameState]struct{}
	phase     int // cycling demo phases
}

func NewTable(tableID string) *Table {
	playerID := "player-00000000-0000-0000-0000-000000000001"

	// Seed starting balance — idempotent, bank ignores if player already exists
	startingChips := 1000
	http.Post(bankServiceURL+"/account",
		"application/json",
		bytes.NewReader([]byte(fmt.Sprintf(
			`{"playerId":"%s","startingBalance":"%d.00"}`, playerID, startingChips,
		))),
	)

	// Read authoritative balance from bank
	if balance := callBankBalance(playerID); balance >= 0 {
		startingChips = balance
	}

	return &Table{
		clients: make(map[chan GameState]struct{}),
		state: GameState{
			TableID: tableID,
			Phase:   "waiting",
			Players: []PlayerState{
				{
					ID:     playerID,
					Name:   "Player 1",
					Chips:  startingChips,
					Hand:   []Card{},
					Status: "waiting",
				},
			},
			Dealer: DealerState{
				Hand:       []Card{},
				IsRevealed: false,
			},
			MinBet:    10,
			MaxBet:    500,
			HandledBy: hostname(),
			Timestamp: now(),
		},
	}
}

func (t *Table) Subscribe() chan GameState {
	ch := make(chan GameState, 16)
	t.mu.Lock()
	t.clients[ch] = struct{}{}
	t.mu.Unlock()
	return ch
}

func (t *Table) Unsubscribe(ch chan GameState) {
	t.mu.Lock()
	delete(t.clients, ch)
	t.mu.Unlock()
	close(ch)
}

func (t *Table) Broadcast(state GameState) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	for ch := range t.clients {
		select {
		case ch <- state:
		default:
		}
	}
}

func (t *Table) SetState(state GameState) {
	t.mu.Lock()
	t.state = state
	t.mu.Unlock()
	t.Broadcast(state)
}

func (t *Table) GetState() GameState {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.state
}

// ── Table Registry ─────────────────────────────────────────────────────────────

type Registry struct {
	mu     sync.RWMutex
	tables map[string]*Table
}

func NewRegistry() *Registry {
	return &Registry{tables: make(map[string]*Table)}
}

func (r *Registry) Get(id string) (*Table, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tables[id]
	return t, ok
}

func (r *Registry) GetOrCreate(id string) *Table {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.tables[id]; ok {
		return t
	}
	t := NewTable(id)
	r.tables[id] = t
	return t
}

func (r *Registry) List() []GameState {
	r.mu.RLock()
	defer r.mu.RUnlock()
	states := make([]GameState, 0, len(r.tables))
	for _, t := range r.tables {
		states = append(states, t.GetState())
	}
	return states
}

// ── Demo Game Loop ─────────────────────────────────────────────────────────────
// Cycles the default table through realistic game phases so the UI has
// something to render without real players. Calls stub services so the
// observability dashboard shows real inter-service traffic.

func runDemoLoop(table *Table) {
	phases := []func(*Table){
		phaseBetting,
		phaseDealing,
		phasePlayerTurn,
		phaseDealerTurn,
		phasePayout,
	}
	for {
		for _, phase := range phases {
			phase(table)
		}
	}
}

func phaseBetting(t *Table) {
	log.Println("[demo] phase: betting")
	s := t.GetState()
	s.Phase = "betting"
	s.Dealer = DealerState{Hand: []Card{}, IsRevealed: false}

	betAmount := 50
	for i := range s.Players {
		s.Players[i].Hand = []Card{}
		s.Players[i].HandValue = 0
		s.Players[i].CurrentBet = betAmount
		s.Players[i].Status = "betting"

		txID, newBalance := callBankBet(s.Players[i].ID, betAmount)
		if txID != "" {
			s.Players[i].BankTxID = txID
			s.Players[i].Chips = newBalance
			log.Printf("[bank] bet placed: player=%s amount=%d txId=%s balance=%d",
				s.Players[i].ID, betAmount, txID, newBalance)
		} else {
			log.Printf("[bank] bet failed for player=%s — using local fallback", s.Players[i].ID)
			s.Players[i].Chips -= betAmount
		}
	}

	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	// Show betting state long enough to read
	time.Sleep(1500 * time.Millisecond)
}

func phaseDealing(t *Table) {
	log.Println("[demo] phase: dealing — calling deck-service")

	// Fetch all 4 cards upfront — one service call, deal them out visually one by one
	cards := callDeckService(t.state.TableID, 4)
	if len(cards) < 4 {
		cards = defaultCards()
	}

	s := t.GetState()
	s.Phase = "dealing"
	s.Players[0].Status = "playing"
	s.Players[0].Hand = []Card{}
	s.Dealer = DealerState{Hand: []Card{}, IsRevealed: false}
	t.SetState(s)
	time.Sleep(400 * time.Millisecond)

	// Card 1: player first card
	s = t.GetState()
	s.Players[0].Hand = []Card{cards[0]}
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
	time.Sleep(600 * time.Millisecond)

	// Card 2: dealer face-up card
	s = t.GetState()
	s.Dealer.Hand = []Card{cards[2]}
	s.Dealer.HandValue = cardValue(cards[2])
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
	time.Sleep(600 * time.Millisecond)

	// Card 3: player second card
	s = t.GetState()
	s.Players[0].Hand = []Card{cards[0], cards[1]}
	handResult := callHandEvaluator(s.Players[0].Hand)
	s.Players[0].HandValue = handResult.Value
	s.Players[0].IsSoftHand = handResult.IsSoft
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
	time.Sleep(600 * time.Millisecond)

	// Card 4: dealer hole card (face down)
	s = t.GetState()
	s.Dealer.Hand = []Card{cards[2], {Suit: "hidden", Rank: "hidden"}}
	pid := s.Players[0].ID
	s.ActivePlayerID = &pid
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	// Pause on the dealt hands before player turn
	time.Sleep(1200 * time.Millisecond)
}

func phasePlayerTurn(t *Table) {
	log.Println("[demo] phase: player_turn")
	s := t.GetState()
	s.Phase = "player_turn"
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	// Brief pause — player "thinking"
	time.Sleep(1500 * time.Millisecond)

	// Demo: player hits once
	hitCards := callDeckService(s.TableID, 1)
	s = t.GetState()
	if len(hitCards) > 0 {
		s.Players[0].Hand = append(s.Players[0].Hand, hitCards[0])
	} else {
		s.Players[0].Hand = append(s.Players[0].Hand, Card{Suit: "hearts", Rank: "5"})
	}

	handResult := callHandEvaluator(s.Players[0].Hand)
	s.Players[0].HandValue = handResult.Value
	s.Players[0].IsSoftHand = handResult.IsSoft
	if handResult.IsBust {
		s.Players[0].Status = "bust"
	} else {
		s.Players[0].Status = "standing"
	}

	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	// Pause to show the final player hand
	time.Sleep(1200 * time.Millisecond)
}

func phaseDealerTurn(t *Table) {
	log.Println("[demo] phase: dealer_turn — calling dealer-ai")
	s := t.GetState()
	s.Phase = "dealer_turn"
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
	time.Sleep(600 * time.Millisecond)

	// Reveal hole card
	s = t.GetState()
	revealCards := callDeckService(s.TableID, 1)
	if len(revealCards) > 0 {
		s.Dealer.Hand[1] = revealCards[0]
	} else {
		s.Dealer.Hand[1] = Card{Suit: "clubs", Rank: "7"}
	}
	s.Dealer.IsRevealed = true

	handResult := callHandEvaluator(s.Dealer.Hand)
	s.Dealer.HandValue = handResult.Value
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
	time.Sleep(800 * time.Millisecond)

	// Ask dealer AI, then hit one card at a time until 17+
	for s.Dealer.HandValue < 17 {
		decision := callDealerAI(s.Dealer.Hand)
		log.Printf("[demo] dealer AI decision: %s (value=%d)", decision, s.Dealer.HandValue)

		hitCards := callDeckService(s.TableID, 1)
		s = t.GetState()
		if len(hitCards) > 0 {
			s.Dealer.Hand = append(s.Dealer.Hand, hitCards[0])
		} else {
			s.Dealer.Hand = append(s.Dealer.Hand, Card{Suit: "diamonds", Rank: "3"})
		}
		handResult = callHandEvaluator(s.Dealer.Hand)
		s.Dealer.HandValue = handResult.Value
		s.HandledBy = hostname()
		s.Timestamp = now()
		t.SetState(s)
		time.Sleep(700 * time.Millisecond)
	}

	s = t.GetState()
	s.ActivePlayerID = nil
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	// Pause to show final dealer hand before payout
	time.Sleep(1000 * time.Millisecond)
}

func phasePayout(t *Table) {
	log.Println("[demo] phase: payout")
	s := t.GetState()
	s.Phase = "payout"

	playerVal := s.Players[0].HandValue
	dealerVal := s.Dealer.HandValue

	var outcome string
	if s.Players[0].Status == "bust" {
		s.Players[0].Status = "lost"
		outcome = "loss"
	} else if dealerVal > 21 || playerVal > dealerVal {
		s.Players[0].Status = "won"
		outcome = "win"
	} else if playerVal == dealerVal {
		s.Players[0].Status = "push"
		outcome = "push"
	} else {
		s.Players[0].Status = "lost"
		outcome = "loss"
	}

	// Settle with bank — bank owns the balance
	txID := s.Players[0].BankTxID
	if txID != "" {
		newBalance := callBankPayout(txID, outcome)
		if newBalance >= 0 {
			s.Players[0].Chips = newBalance
			log.Printf("[bank] payout settled: player=%s txId=%s result=%s balance=%d",
				s.Players[0].ID, txID, outcome, newBalance)
		} else {
			log.Printf("[bank] payout failed for txId=%s — balance may be stale", txID)
		}
		s.Players[0].BankTxID = ""
	} else {
		log.Printf("[bank] no txId for payout — bet may have failed earlier")
	}

	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	// Show the result — long enough to read win/loss and updated chips
	time.Sleep(2500 * time.Millisecond)

	// Reset to waiting — brief pause then next hand begins
	s = t.GetState()
	s.Phase = "waiting"
	s.Players[0].Status = "waiting"
	s.Players[0].CurrentBet = 0
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	time.Sleep(800 * time.Millisecond)
}

// ── Upstream Service Calls ─────────────────────────────────────────────────────

var (
	deckServiceURL     = getEnv("DECK_SERVICE_URL", "http://deck-service:3002")
	handEvaluatorURL   = getEnv("HAND_EVALUATOR_URL", "http://hand-evaluator:3003")
	dealerAIURL        = getEnv("DEALER_AI_URL", "http://dealer-ai:3004")
	observabilityURL   = getEnv("OBSERVABILITY_URL", "http://observability-service:3009")
	bankServiceURL     = getEnv("BANK_SERVICE_URL", "http://bank-service:3005")
)

// reportEvent fires a non-blocking event report to the observability service.
// Fire and forget — never blocks game logic.
func reportEvent(callee, method, path string, status int, latencyMs int64) {
	go func() {
		body, _ := json.Marshal(map[string]interface{}{
			"caller":      "game-state",
			"callee":      callee,
			"method":      method,
			"path":        path,
			"status_code": status,
			"latency_ms":  latencyMs,
			"protocol":    "http",
		})
		resp, err := http.Post(observabilityURL+"/event", "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("[observability] report error: %v", err)
			return
		}
		resp.Body.Close()
	}()
}

type DeckDealResponse struct {
	Cards []Card `json:"cards"`
}

func callDeckService(tableID string, count int) []Card {
	body, _ := json.Marshal(map[string]int{"count": count})
	start := time.Now()
	path := fmt.Sprintf("/shoe/%s/deal", tableID)
	resp, err := http.Post(
		fmt.Sprintf("%s%s", deckServiceURL, path),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[deck-service] error: %v", err)
		reportEvent("deck-service", "POST", path, 503, time.Since(start).Milliseconds())
		return nil
	}
	defer resp.Body.Close()
	reportEvent("deck-service", "POST", path, resp.StatusCode, time.Since(start).Milliseconds())
	var result DeckDealResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Cards
}

type HandResult struct {
	Value      int  `json:"value"`
	IsSoft     bool `json:"isSoft"`
	IsBlackjack bool `json:"isBlackjack"`
	IsBust     bool `json:"isBust"`
}

func callHandEvaluator(hand []Card) HandResult {
	body, _ := json.Marshal(map[string]interface{}{"cards": hand})
	start := time.Now()
	resp, err := http.Post(
		fmt.Sprintf("%s/evaluate", handEvaluatorURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[hand-evaluator] error: %v", err)
		reportEvent("hand-evaluator", "POST", "/evaluate", 503, time.Since(start).Milliseconds())
		return HandResult{Value: estimateValue(hand)}
	}
	defer resp.Body.Close()
	reportEvent("hand-evaluator", "POST", "/evaluate", resp.StatusCode, time.Since(start).Milliseconds())
	var result HandResult
	json.NewDecoder(resp.Body).Decode(&result)
	return result
}

func callDealerAI(hand []Card) string {
	body, _ := json.Marshal(map[string]interface{}{"hand": hand})
	start := time.Now()
	resp, err := http.Post(
		fmt.Sprintf("%s/decide", dealerAIURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[dealer-ai] error: %v", err)
		reportEvent("dealer-ai", "POST", "/decide", 503, time.Since(start).Milliseconds())
		return "stand"
	}
	defer resp.Body.Close()
	reportEvent("dealer-ai", "POST", "/decide", resp.StatusCode, time.Since(start).Milliseconds())
	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	return result["action"]
}

// ── Bank Service Calls ────────────────────────────────────────────────────────

type BetResponse struct {
	TransactionID string  `json:"transactionId"`
	NewBalance    float64 `json:"newBalance"`
}

type PayoutResponse struct {
	NewBalance float64 `json:"newBalance"`
}

// callBankBet deducts the bet from the player's bank balance.
// Returns transaction_id to be held until payout, and new balance.
func callBankBet(playerID string, amount int) (string, int) {
	start := time.Now()
	body, _ := json.Marshal(map[string]string{
		"playerId": playerID,
		"amount":   fmt.Sprintf("%d.00", amount),
	})
	resp, err := http.Post(bankServiceURL+"/bet", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("[bank-service] bet error: %v", err)
		reportEvent("bank-service", "POST", "/bet", 503, time.Since(start).Milliseconds())
		return "", -1
	}
	defer resp.Body.Close()
	reportEvent("bank-service", "POST", "/bet", resp.StatusCode, time.Since(start).Milliseconds())

	if resp.StatusCode != 200 {
		log.Printf("[bank-service] bet rejected: status=%d", resp.StatusCode)
		return "", -1
	}

	var result BetResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return result.TransactionID, int(result.NewBalance)
}

// callBankPayout settles a bet transaction.
// result must be "win", "loss", or "push".
// Returns new balance after settlement.
func callBankPayout(txID string, result string) int {
	start := time.Now()
	body, _ := json.Marshal(map[string]string{
		"transactionId": txID,
		"result":        result,
	})
	resp, err := http.Post(bankServiceURL+"/payout", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("[bank-service] payout error: %v", err)
		reportEvent("bank-service", "POST", "/payout", 503, time.Since(start).Milliseconds())
		return -1
	}
	defer resp.Body.Close()
	reportEvent("bank-service", "POST", "/payout", resp.StatusCode, time.Since(start).Milliseconds())

	if resp.StatusCode != 200 {
		log.Printf("[bank-service] payout rejected: status=%d", resp.StatusCode)
		return -1
	}

	var pr PayoutResponse
	json.NewDecoder(resp.Body).Decode(&pr)
	return int(pr.NewBalance)
}

// callBankBalance fetches current balance for display on startup/reconnect.
func callBankBalance(playerID string) int {
	start := time.Now()
	resp, err := http.Get(fmt.Sprintf("%s/balance?playerId=%s", bankServiceURL, playerID))
	if err != nil {
		reportEvent("bank-service", "GET", "/balance", 503, time.Since(start).Milliseconds())
		return -1
	}
	defer resp.Body.Close()
	reportEvent("bank-service", "GET", "/balance", resp.StatusCode, time.Since(start).Milliseconds())

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	if b, ok := result["balance"].(float64); ok {
		return int(b)
	}
	return -1
}

// ── HTTP Handlers ─────────────────────────────────────────────────────────────

func main() {
	registry := NewRegistry()

	// Create and start demo table
	demoTableID := "demo-table-00000000-0000-0000-0000-000000000001"
	demoTable := registry.GetOrCreate(demoTableID)
	go runDemoLoop(demoTable)

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "healthy",
			"service": "game-state",
		})
	})

	mux.HandleFunc("/tables", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(registry.List())
	})

	// GET /tables/{id} - state snapshot
	// GET /tables/{id}/stream - SSE
	// POST /tables/{id}/action - player action
	mux.HandleFunc("/tables/", func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// /tables/{id}/stream
		if len(path) > 8 && path[len(path)-7:] == "/stream" {
			tableID := path[8 : len(path)-7]
			sseHandler(w, r, registry, tableID)
			return
		}

		// /tables/{id}/action
		if len(path) > 8 && path[len(path)-7:] == "/action" {
			tableID := path[8 : len(path)-7]
			actionHandler(w, r, registry, tableID)
			return
		}

		// /tables/{id}/join
		if len(path) > 8 && path[len(path)-5:] == "/join" {
			tableID := path[8 : len(path)-5]
			table := registry.GetOrCreate(tableID)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(table.GetState())
			return
		}

		// /tables/{id}
		tableID := path[8:]
		if tableID == "" {
			http.NotFound(w, r)
			return
		}
		table, ok := registry.Get(tableID)
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(table.GetState())
	})

	port := getEnv("PORT", "3001")
	log.Printf("🃏 Game State service starting on :%s", port)
	log.Printf("   Demo table: %s", demoTableID)

	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

func sseHandler(w http.ResponseWriter, r *http.Request, registry *Registry, tableID string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	table := registry.GetOrCreate(tableID)
	ch := table.Subscribe()
	defer table.Unsubscribe(ch)

	// Send current state immediately on connect
	sendSSEEvent(w, flusher, "game_state", table.GetState())

	for {
		select {
		case state, ok := <-ch:
			if !ok {
				return
			}
			sendSSEEvent(w, flusher, "game_state", state)
		case <-r.Context().Done():
			return
		}
	}
}

func sendSSEEvent(w http.ResponseWriter, flusher http.Flusher, eventType string, state GameState) {
	evt := SSEEvent{Type: eventType, Data: state}
	data, _ := json.Marshal(evt)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, data)
	flusher.Flush()
}

func actionHandler(w http.ResponseWriter, r *http.Request, registry *Registry, tableID string) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var action PlayerActionRequest
	if err := json.NewDecoder(r.Body).Decode(&action); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	_, ok := registry.Get(tableID)
	if !ok {
		http.NotFound(w, r)
		return
	}

	// TODO: validate action against game phase and player state
	// For now: accept all actions
	log.Printf("[game-state] action: player=%s action=%s", action.PlayerID, action.Action)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"accepted": true,
		"message":  fmt.Sprintf("action '%s' accepted", action.Action),
	})
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "game-state"
	}
	return h
}

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func defaultCards() []Card {
	suits := []string{"hearts", "diamonds", "clubs", "spades"}
	ranks := []string{"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"}
	cards := make([]Card, 4)
	for i := range cards {
		cards[i] = Card{
			Suit: suits[rand.Intn(len(suits))],
			Rank: ranks[rand.Intn(len(ranks))],
		}
	}
	return cards
}

func cardValue(c Card) int {
	switch c.Rank {
	case "A":
		return 11
	case "J", "Q", "K", "10":
		return 10
	default:
		v := 0
		fmt.Sscanf(c.Rank, "%d", &v)
		return v
	}
}

func estimateValue(hand []Card) int {
	total := 0
	aces := 0
	for _, c := range hand {
		switch c.Rank {
		case "A":
			aces++
			total += 11
		case "J", "Q", "K", "10":
			total += 10
		default:
			v := 0
			fmt.Sscanf(c.Rank, "%d", &v)
			total += v
		}
	}
	for aces > 0 && total > 21 {
		total -= 10
		aces--
	}
	return total
}
