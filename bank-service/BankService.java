package com.swarmblackjack.bank;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

/**
 * Bank Service
 * Language: Java
 *
 * Why Java? Financial arithmetic. BigDecimal everywhere — no floats near money.
 * Java's type system makes accidental float arithmetic a compile error when
 * you're disciplined about it.
 *
 * Owns the only source of truth for player chip balances.
 * Game-state delegates ALL financial operations here.
 *
 * Endpoints:
 *   POST /account              — register player with starting balance
 *   GET  /balance?playerId=    — current balance
 *   POST /bet                  — deduct bet, return transaction_id
 *   POST /payout               — settle transaction (win/loss/push)
 *   POST /deposit              — add chips
 *   POST /withdraw             — remove chips
 *   GET  /health
 */
public class BankService {

    private static final Logger log = Logger.getLogger(BankService.class.getName());

    // Player balances — production: isolated PostgreSQL
    private static final Map<String, BigDecimal> balances = new ConcurrentHashMap<>();

    // Open bet transactions: transaction_id → BetRecord
    private static final Map<String, BetRecord> openBets = new ConcurrentHashMap<>();

    static {
        // Seed demo player — matches game-state player ID
        balances.put("player-00000000-0000-0000-0000-000000000001", new BigDecimal("1000.00"));
    }

    static class BetRecord {
        final String playerId;
        final BigDecimal amount;
        final String createdAt;

        BetRecord(String playerId, BigDecimal amount) {
            this.playerId = playerId;
            this.amount = amount;
            this.createdAt = Instant.now().toString();
        }
    }

    // ── Server Setup ──────────────────────────────────────────────────────────

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3005"));

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health",   new HealthHandler());
        server.createContext("/account",  new AccountHandler());
        server.createContext("/balance",  new BalanceHandler());
        server.createContext("/bet",      new BetHandler());
        server.createContext("/payout",   new PayoutHandler());
        server.createContext("/deposit",  new DepositHandler());
        server.createContext("/withdraw", new WithdrawHandler());
        server.setExecutor(null);
        server.start();

        log.info(String.format("Bank Service (Java) starting on :%d", port));
        log.info("   BigDecimal arithmetic — no floats near money. Ever.");
        log.info("   Demo player seeded: player-00000000-0000-0000-0000-000000000001 = 1000.00");
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            sendJson(ex, 200, String.format(
                "{\"status\":\"healthy\",\"service\":\"bank-service\",\"language\":\"Java\"," +
                "\"open_bets\":%d,\"players\":%d," +
                "\"note\":\"BigDecimal only — float arithmetic is a compile-time error here\"}",
                openBets.size(), balances.size()
            ));
        }
    }

    /**
     * POST /account
     * Register a player. Idempotent — existing players are not modified.
     * Body: {"playerId": "...", "startingBalance": "1000.00"}
     */
    static class AccountHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"method not allowed\"}"); return;
            }

            String body = readBody(ex);
            String playerId = extractJsonString(body, "playerId");
            String startingStr = extractJsonString(body, "startingBalance");

            if (playerId == null) {
                sendJson(ex, 400, "{\"error\":\"playerId required\"}"); return;
            }

            BigDecimal starting = new BigDecimal(startingStr != null ? startingStr : "1000.00");

            // Idempotent — don't overwrite existing balance
            balances.putIfAbsent(playerId, starting);
            BigDecimal balance = balances.get(playerId);

            log.info(String.format("Account: player=%s balance=%s (existing=%b)",
                playerId, balance, !balance.equals(starting)));

            sendJson(ex, 200, String.format(
                "{\"playerId\":\"%s\",\"balance\":%s,\"currency\":\"chips\"}",
                playerId, balance.toPlainString()
            ));
        }
    }

    /**
     * GET /balance?playerId=
     */
    static class BalanceHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;

            String playerId = parseQueryParam(ex.getRequestURI().getQuery(), "playerId");
            if (playerId == null) {
                sendJson(ex, 400, "{\"error\":\"playerId required\"}"); return;
            }

            if (!balances.containsKey(playerId)) {
                sendJson(ex, 404, "{\"error\":\"player not found\"}"); return;
            }

            BigDecimal balance = balances.get(playerId);
            log.info(String.format("Balance: player=%s balance=%s", playerId, balance));

            sendJson(ex, 200, String.format(
                "{\"playerId\":\"%s\",\"balance\":%s,\"currency\":\"chips\"}",
                playerId, balance.toPlainString()
            ));
        }
    }

    /**
     * POST /bet
     * Deduct bet from balance. Returns transaction_id for later settlement.
     * Body: {"playerId": "...", "amount": "50.00"}
     * Response: {"transactionId": "...", "amount": "50.00", "newBalance": "950.00"}
     */
    static class BetHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"method not allowed\"}"); return;
            }

            String body = readBody(ex);
            String playerId = extractJsonString(body, "playerId");
            String amountStr = extractJsonString(body, "amount");

            if (playerId == null || amountStr == null) {
                sendJson(ex, 400, "{\"error\":\"playerId and amount required\"}"); return;
            }

            if (!balances.containsKey(playerId)) {
                sendJson(ex, 404, "{\"error\":\"player not found\"}"); return;
            }

            BigDecimal amount;
            try {
                amount = new BigDecimal(amountStr);
                if (amount.compareTo(BigDecimal.ZERO) <= 0) throw new NumberFormatException();
            } catch (NumberFormatException e) {
                sendJson(ex, 400, "{\"error\":\"invalid amount\"}"); return;
            }

            BigDecimal current = balances.get(playerId);
            if (current.compareTo(amount) < 0) {
                sendJson(ex, 409, String.format(
                    "{\"error\":\"insufficient funds\",\"balance\":%s,\"requested\":%s}",
                    current.toPlainString(), amount.toPlainString()
                ));
                return;
            }

            // Deduct bet and record open transaction
            BigDecimal newBalance = balances.merge(playerId, amount.negate(), BigDecimal::add);
            String txId = UUID.randomUUID().toString();
            openBets.put(txId, new BetRecord(playerId, amount));

            log.info(String.format("Bet placed: player=%s amount=%s txId=%s newBalance=%s",
                playerId, amount, txId, newBalance));

            sendJson(ex, 200, String.format(
                "{\"transactionId\":\"%s\",\"playerId\":\"%s\",\"amount\":%s,\"newBalance\":%s}",
                txId, playerId, amount.toPlainString(), newBalance.toPlainString()
            ));
        }
    }

    /**
     * POST /payout
     * Settle a bet transaction.
     * Body: {"transactionId": "...", "result": "win|loss|push"}
     *   win  → return 2x bet (original bet + winnings)
     *   push → return 1x bet (original bet back)
     *   loss → nothing returned (already deducted at bet time)
     * Response: {"transactionId": "...", "result": "...", "returned": "100.00", "newBalance": "..."}
     */
    static class PayoutHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"method not allowed\"}"); return;
            }

            String body = readBody(ex);
            String txId = extractJsonString(body, "transactionId");
            String result = extractJsonString(body, "result");

            if (txId == null || result == null) {
                sendJson(ex, 400, "{\"error\":\"transactionId and result required\"}"); return;
            }

            BetRecord bet = openBets.remove(txId);
            if (bet == null) {
                sendJson(ex, 404, "{\"error\":\"transaction not found or already settled\"}"); return;
            }

            BigDecimal returned;
            switch (result.toLowerCase()) {
                case "win":
                    returned = bet.amount.multiply(new BigDecimal("2")); // bet + winnings
                    break;
                case "push":
                    returned = bet.amount; // bet returned, no winnings
                    break;
                case "loss":
                    returned = BigDecimal.ZERO; // already deducted at bet time
                    break;
                default:
                    // Re-open the bet — invalid result, don't lose the money
                    openBets.put(txId, bet);
                    sendJson(ex, 400, "{\"error\":\"result must be win, loss, or push\"}");
                    return;
            }

            BigDecimal newBalance = balances.merge(bet.playerId, returned, BigDecimal::add);

            log.info(String.format("Payout: player=%s txId=%s result=%s returned=%s newBalance=%s",
                bet.playerId, txId, result, returned, newBalance));

            sendJson(ex, 200, String.format(
                "{\"transactionId\":\"%s\",\"playerId\":\"%s\",\"result\":\"%s\"," +
                "\"betAmount\":%s,\"returned\":%s,\"newBalance\":%s}",
                txId, bet.playerId, result,
                bet.amount.toPlainString(), returned.toPlainString(), newBalance.toPlainString()
            ));
        }
    }

    /**
     * POST /deposit — add chips (admin / top-up)
     */
    static class DepositHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"method not allowed\"}"); return;
            }

            String body = readBody(ex);
            String playerId = extractJsonString(body, "playerId");
            String amountStr = extractJsonString(body, "amount");

            if (playerId == null || amountStr == null) {
                sendJson(ex, 400, "{\"error\":\"playerId and amount required\"}"); return;
            }

            BigDecimal amount;
            try {
                amount = new BigDecimal(amountStr);
                if (amount.compareTo(BigDecimal.ZERO) <= 0) throw new NumberFormatException();
            } catch (NumberFormatException e) {
                sendJson(ex, 400, "{\"error\":\"invalid amount\"}"); return;
            }

            BigDecimal newBalance = balances.merge(playerId, amount, BigDecimal::add);
            log.info(String.format("Deposit: player=%s amount=%s newBalance=%s", playerId, amount, newBalance));

            sendJson(ex, 200, String.format(
                "{\"playerId\":\"%s\",\"deposited\":%s,\"newBalance\":%s}",
                playerId, amount.toPlainString(), newBalance.toPlainString()
            ));
        }
    }

    /**
     * POST /withdraw — remove chips (admin / cashout)
     */
    static class WithdrawHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange ex) throws IOException {
            if (handleOptions(ex)) return;
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"method not allowed\"}"); return;
            }

            String body = readBody(ex);
            String playerId = extractJsonString(body, "playerId");
            String amountStr = extractJsonString(body, "amount");

            if (playerId == null || amountStr == null) {
                sendJson(ex, 400, "{\"error\":\"playerId and amount required\"}"); return;
            }

            BigDecimal amount;
            try {
                amount = new BigDecimal(amountStr);
                if (amount.compareTo(BigDecimal.ZERO) <= 0) throw new NumberFormatException();
            } catch (NumberFormatException e) {
                sendJson(ex, 400, "{\"error\":\"invalid amount\"}"); return;
            }

            BigDecimal current = balances.getOrDefault(playerId, BigDecimal.ZERO);
            if (current.compareTo(amount) < 0) {
                sendJson(ex, 409, "{\"error\":\"insufficient funds\"}"); return;
            }

            BigDecimal newBalance = balances.merge(playerId, amount.negate(), BigDecimal::add);
            log.info(String.format("Withdrawal: player=%s amount=%s newBalance=%s", playerId, amount, newBalance));

            sendJson(ex, 200, String.format(
                "{\"playerId\":\"%s\",\"withdrawn\":%s,\"newBalance\":%s}",
                playerId, amount.toPlainString(), newBalance.toPlainString()
            ));
        }
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    static boolean handleOptions(HttpExchange ex) throws IOException {
        if ("OPTIONS".equals(ex.getRequestMethod())) {
            ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
            ex.sendResponseHeaders(204, -1);
            return true;
        }
        return false;
    }

    static void sendJson(HttpExchange ex, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    static String readBody(HttpExchange ex) throws IOException {
        try (InputStream is = ex.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static String parseQueryParam(String query, String key) {
        if (query == null) return null;
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && kv[0].equals(key)) return kv[1];
        }
        return null;
    }

    static String extractJsonString(String json, String key) {
        String search = "\"" + key + "\":\"";
        int start = json.indexOf(search);
        if (start < 0) return null;
        start += search.length();
        int end = json.indexOf("\"", start);
        if (end < 0) return null;
        return json.substring(start, end);
    }
}
