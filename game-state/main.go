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
	return &Table{
		clients: make(map[chan GameState]struct{}),
		state: GameState{
			TableID: tableID,
			Phase:   "waiting",
			Players: []PlayerState{
				{
					ID:     playerID,
					Name:   "Player 1",
					Chips:  1000,
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
			time.Sleep(3 * time.Second)
		}
	}
}

func phaseBetting(t *Table) {
	log.Println("[demo] phase: betting")
	s := t.GetState()
	s.Phase = "betting"
	s.Dealer = DealerState{Hand: []Card{}, IsRevealed: false}
	for i := range s.Players {
		s.Players[i].Hand = []Card{}
		s.Players[i].HandValue = 0
		s.Players[i].CurrentBet = 50
		s.Players[i].Status = "betting"
	}
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
}

func phaseDealing(t *Table) {
	log.Println("[demo] phase: dealing — calling deck-service")

	// Call deck service stub — this shows up in observability
	cards := callDeckService(t.state.TableID, 4)
	if len(cards) < 4 {
		cards = defaultCards()
	}

	s := t.GetState()
	s.Phase = "dealing"
	s.Players[0].Hand = []Card{cards[0], cards[1]}
	s.Players[0].Status = "playing"

	dealerHand := []Card{cards[2], {Suit: "hidden", Rank: "hidden"}}
	s.Dealer = DealerState{
		Hand:       dealerHand,
		HandValue:  cardValue(cards[2]),
		IsRevealed: false,
	}

	// Call hand evaluator for player hand
	handResult := callHandEvaluator(s.Players[0].Hand)
	s.Players[0].HandValue = handResult.Value
	s.Players[0].IsSoftHand = handResult.IsSoft

	pid := s.Players[0].ID
	s.ActivePlayerID = &pid
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
}

func phasePlayerTurn(t *Table) {
	log.Println("[demo] phase: player_turn")
	s := t.GetState()
	s.Phase = "player_turn"

	// Demo: player hits once then stands
	time.Sleep(2 * time.Second)
	hitCards := callDeckService(s.TableID, 1)
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
}

func phaseDealerTurn(t *Table) {
	log.Println("[demo] phase: dealer_turn — calling dealer-ai")
	s := t.GetState()
	s.Phase = "dealer_turn"

	// Reveal hole card
	revealCards := callDeckService(s.TableID, 1)
	if len(revealCards) > 0 {
		s.Dealer.Hand[1] = revealCards[0]
	} else {
		s.Dealer.Hand[1] = Card{Suit: "clubs", Rank: "7"}
	}
	s.Dealer.IsRevealed = true

	handResult := callHandEvaluator(s.Dealer.Hand)
	s.Dealer.HandValue = handResult.Value

	// Call dealer AI for strategy decision
	decision := callDealerAI(s.Dealer.Hand)
	log.Printf("[demo] dealer AI decision: %s", decision)

	// Dealer hits until 17+
	for s.Dealer.HandValue < 17 {
		hitCards := callDeckService(s.TableID, 1)
		if len(hitCards) > 0 {
			s.Dealer.Hand = append(s.Dealer.Hand, hitCards[0])
		} else {
			s.Dealer.Hand = append(s.Dealer.Hand, Card{Suit: "diamonds", Rank: "3"})
		}
		handResult = callHandEvaluator(s.Dealer.Hand)
		s.Dealer.HandValue = handResult.Value
	}

	s.ActivePlayerID = nil
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
}

func phasePayout(t *Table) {
	log.Println("[demo] phase: payout")
	s := t.GetState()
	s.Phase = "payout"

	playerVal := s.Players[0].HandValue
	dealerVal := s.Dealer.HandValue

	if s.Players[0].Status == "bust" {
		s.Players[0].Status = "lost"
		s.Players[0].Chips -= s.Players[0].CurrentBet
	} else if dealerVal > 21 || playerVal > dealerVal {
		s.Players[0].Status = "won"
		s.Players[0].Chips += s.Players[0].CurrentBet
	} else if playerVal == dealerVal {
		s.Players[0].Status = "push"
	} else {
		s.Players[0].Status = "lost"
		s.Players[0].Chips -= s.Players[0].CurrentBet
	}

	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)

	time.Sleep(3 * time.Second)

	// Reset to waiting
	s.Phase = "waiting"
	s.Players[0].Status = "waiting"
	s.Players[0].CurrentBet = 0
	s.HandledBy = hostname()
	s.Timestamp = now()
	t.SetState(s)
}

// ── Upstream Service Calls ─────────────────────────────────────────────────────

var (
	deckServiceURL     = getEnv("DECK_SERVICE_URL", "http://deck-service:3002")
	handEvaluatorURL   = getEnv("HAND_EVALUATOR_URL", "http://hand-evaluator:3003")
	dealerAIURL        = getEnv("DEALER_AI_URL", "http://dealer-ai:3004")
)

type DeckDealResponse struct {
	Cards []Card `json:"cards"`
}

func callDeckService(tableID string, count int) []Card {
	body, _ := json.Marshal(map[string]int{"count": count})
	resp, err := http.Post(
		fmt.Sprintf("%s/shoe/%s/deal", deckServiceURL, tableID),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[deck-service] error: %v", err)
		return nil
	}
	defer resp.Body.Close()
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
	resp, err := http.Post(
		fmt.Sprintf("%s/evaluate", handEvaluatorURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[hand-evaluator] error: %v", err)
		return HandResult{Value: estimateValue(hand)}
	}
	defer resp.Body.Close()
	var result HandResult
	json.NewDecoder(resp.Body).Decode(&result)
	return result
}

func callDealerAI(hand []Card) string {
	body, _ := json.Marshal(map[string]interface{}{"hand": hand})
	resp, err := http.Post(
		fmt.Sprintf("%s/decide", dealerAIURL),
		"application/json",
		bytes.NewReader(body),
	)
	if err != nil {
		log.Printf("[dealer-ai] error: %v", err)
		return "stand"
	}
	defer resp.Body.Close()
	var result map[string]string
	json.NewDecoder(resp.Body).Decode(&result)
	return result["action"]
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
