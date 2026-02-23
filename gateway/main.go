package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"sync"
	"time"
)

// ObservabilityEvent represents a service-to-service call for the dashboard
type ObservabilityEvent struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Caller     string `json:"caller"`
	Callee     string `json:"callee"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	StatusCode int    `json:"statusCode"`
	LatencyMs  int64  `json:"latencyMs"`
	Protocol   string `json:"protocol"`
}

// ObservabilityBus fans out events to all connected dashboard clients
type ObservabilityBus struct {
	mu      sync.RWMutex
	clients map[chan ObservabilityEvent]struct{}
}

func NewObservabilityBus() *ObservabilityBus {
	return &ObservabilityBus{
		clients: make(map[chan ObservabilityEvent]struct{}),
	}
}

func (b *ObservabilityBus) Subscribe() chan ObservabilityEvent {
	ch := make(chan ObservabilityEvent, 32)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *ObservabilityBus) Unsubscribe(ch chan ObservabilityEvent) {
	b.mu.Lock()
	delete(b.clients, ch)
	b.mu.Unlock()
	close(ch)
}

func (b *ObservabilityBus) Publish(evt ObservabilityEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.clients {
		select {
		case ch <- evt:
		default:
			// slow client — drop rather than block
		}
	}
}

var (
	bus = NewObservabilityBus()

	serviceURLs = map[string]string{
		"game-state":  getEnv("GAME_STATE_URL", "http://game-state:3001"),
		"auth":        getEnv("AUTH_URL", "http://auth-service:3006"),
		"bank":        getEnv("BANK_URL", "http://bank-service:3005"),
		"chat":        getEnv("CHAT_URL", "http://chat-service:3007"),
		"observability": getEnv("OBSERVABILITY_URL", "http://observability:3009"),
	}
)

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("/health", healthHandler)

	// Observability SSE feed (no auth — dashboard is internal)
	mux.HandleFunc("/events", observabilitySSEHandler)

	// Game routes → game-state service
	mux.HandleFunc("/api/game/", instrumentedProxy("game-state", serviceURLs["game-state"]))

	// Auth routes → auth service
	mux.HandleFunc("/api/auth/", instrumentedProxy("auth", serviceURLs["auth"]))

	// Bank routes → bank service (auth required)
	mux.HandleFunc("/api/bank/", requireAuth(instrumentedProxy("bank", serviceURLs["bank"])))

	// Chat WebSocket → chat service
	mux.HandleFunc("/api/chat/", instrumentedProxy("chat", serviceURLs["chat"]))

	port := getEnv("PORT", "8080")
	log.Printf("🚀 API Gateway starting on :%s", port)
	log.Printf("   game-state  → %s", serviceURLs["game-state"])
	log.Printf("   auth        → %s", serviceURLs["auth"])
	log.Printf("   bank        → %s", serviceURLs["bank"])
	log.Printf("   chat        → %s", serviceURLs["chat"])

	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

// instrumentedProxy creates a reverse proxy that publishes observability events
func instrumentedProxy(callee, targetURL string) http.HandlerFunc {
	target, err := url.Parse(targetURL)
	if err != nil {
		log.Fatalf("invalid upstream URL for %s: %v", callee, err)
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy error [%s]: %v", callee, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]string{
			"code":    "upstream_error",
			"message": fmt.Sprintf("%s service unavailable", callee),
		})
	}

	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Detect SSE requests — don't buffer them
		isSSE := r.Header.Get("Accept") == "text/event-stream"

		// Publish request event
		reqEvt := ObservabilityEvent{
			ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
			Caller:    "gateway",
			Callee:    callee,
			Method:    r.Method,
			Path:      r.URL.Path,
			Protocol:  protocolFor(isSSE, r),
		}

		// Track response status
		rw := &statusRecorder{ResponseWriter: w, status: 200}
		proxy.ServeHTTP(rw, r)

		latency := time.Since(start).Milliseconds()
		reqEvt.StatusCode = rw.status
		reqEvt.LatencyMs = latency
		bus.Publish(reqEvt)

		log.Printf("[gateway→%s] %s %s %d (%dms)", callee, r.Method, r.URL.Path, rw.status, latency)
	}
}

func protocolFor(isSSE bool, r *http.Request) string {
	if isSSE {
		return "sse"
	}
	if r.Header.Get("Upgrade") == "websocket" {
		return "websocket"
	}
	return "http"
}

// requireAuth is a stub middleware — real JWT validation comes with Auth service
func requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// TODO: validate JWT from Authorization header
		// For now: pass through with a stub player ID header
		r.Header.Set("X-Player-ID", "stub-player-00000000-0000-0000-0000-000000000001")
		next(w, r)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func observabilitySSEHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	ch := bus.Subscribe()
	defer bus.Unsubscribe(ch)

	// Send connected event
	fmt.Fprintf(w, "event: connected\ndata: {\"service\":\"gateway\"}\n\n")
	flusher.Flush()

	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(w, "event: service_call\ndata: %s\n\n", data)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	upstreams := make(map[string]string)
	for name, svcURL := range serviceURLs {
		status := checkUpstream(svcURL + "/health")
		upstreams[name] = status
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "healthy",
		"service":  "gateway",
		"version":  "0.1.0",
		"upstream": upstreams,
	})
}

func checkUpstream(healthURL string) string {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(healthURL)
	if err != nil {
		return "unreachable"
	}
	defer resp.Body.Close()
	io.ReadAll(resp.Body)
	if resp.StatusCode == 200 {
		return "healthy"
	}
	return fmt.Sprintf("degraded (%d)", resp.StatusCode)
}

// statusRecorder wraps ResponseWriter to capture status code
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
