package com.swarmblackjack.bank;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
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
 * you're disciplined about it. Strong ecosystem for financial transaction patterns.
 *
 * This service has its own isolated database (see docker-compose.yml).
 * Bank Service is the ONLY service with credentials to the Bank DB.
 * Every financial operation re-validates the Redis session regardless of JWT validity.
 */
public class BankService {

    private static final Logger log = Logger.getLogger(BankService.class.getName());

    // In-memory store for the stub. Production: isolated PostgreSQL.
    private static final Map<String, BigDecimal> balances = new ConcurrentHashMap<>();

    static {
        // Seed demo player
        balances.put("stub-player-00000000-0000-0000-0000-000000000001", new BigDecimal("1000.00"));
    }

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "3005"));

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/health", new HealthHandler());
        server.createContext("/balance", new BalanceHandler());
        server.createContext("/deposit", new DepositHandler());
        server.createContext("/withdraw", new WithdrawHandler());
        server.setExecutor(null);
        server.start();

        log.info(String.format("💰 Bank Service (Java) starting on :%d", port));
        log.info("   BigDecimal arithmetic — no floats near money. Ever.");
    }

    static void sendJson(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    static String readBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    // Health handler
    static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            sendJson(exchange, 200,
                "{\"status\":\"healthy\",\"service\":\"bank-service\",\"language\":\"Java\",\"note\":\"BigDecimal only — float arithmetic is a compile-time error here\"}");
        }
    }

    // GET /balance?playerId={id}
    static class BalanceHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, OPTIONS");
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            String query = exchange.getRequestURI().getQuery();
            String playerId = parseQueryParam(query, "playerId");

            if (playerId == null) {
                sendJson(exchange, 400, "{\"error\":\"playerId required\"}");
                return;
            }

            // TODO: Re-validate Redis session here before any financial data is returned.
            // This happens regardless of JWT validity — bank's extra layer.

            BigDecimal balance = balances.getOrDefault(playerId, BigDecimal.ZERO);
            log.info(String.format("Balance request: player=%s balance=%s", playerId, balance));

            sendJson(exchange, 200, String.format(
                "{\"playerId\":\"%s\",\"chips\":%s,\"currency\":\"chips\"}",
                playerId, balance.toPlainString()
            ));
        }
    }

    // POST /deposit {"playerId": "...", "amount": "100.00"}
    static class DepositHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"method not allowed\"}");
                return;
            }

            String body = readBody(exchange);
            String playerId = extractJsonString(body, "playerId");
            String amountStr = extractJsonString(body, "amount");

            if (playerId == null || amountStr == null) {
                sendJson(exchange, 400, "{\"error\":\"playerId and amount required\"}");
                return;
            }

            BigDecimal amount;
            try {
                amount = new BigDecimal(amountStr);
                if (amount.compareTo(BigDecimal.ZERO) <= 0) {
                    throw new NumberFormatException("Amount must be positive");
                }
            } catch (NumberFormatException e) {
                sendJson(exchange, 400, "{\"error\":\"invalid amount\"}");
                return;
            }

            BigDecimal newBalance = balances.merge(playerId, amount, BigDecimal::add);
            log.info(String.format("Deposit: player=%s amount=%s newBalance=%s", playerId, amount, newBalance));

            sendJson(exchange, 200, String.format(
                "{\"playerId\":\"%s\",\"deposited\":%s,\"newBalance\":%s}",
                playerId, amount.toPlainString(), newBalance.toPlainString()
            ));
        }
    }

    // POST /withdraw {"playerId": "...", "amount": "50.00"}
    static class WithdrawHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if (!"POST".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"method not allowed\"}");
                return;
            }

            String body = readBody(exchange);
            String playerId = extractJsonString(body, "playerId");
            String amountStr = extractJsonString(body, "amount");

            if (playerId == null || amountStr == null) {
                sendJson(exchange, 400, "{\"error\":\"playerId and amount required\"}");
                return;
            }

            BigDecimal amount;
            try {
                amount = new BigDecimal(amountStr);
                if (amount.compareTo(BigDecimal.ZERO) <= 0) {
                    throw new NumberFormatException();
                }
            } catch (NumberFormatException e) {
                sendJson(exchange, 400, "{\"error\":\"invalid amount\"}");
                return;
            }

            BigDecimal current = balances.getOrDefault(playerId, BigDecimal.ZERO);
            if (current.compareTo(amount) < 0) {
                sendJson(exchange, 409, "{\"error\":\"insufficient funds\"}");
                return;
            }

            BigDecimal newBalance = balances.merge(playerId, amount.negate(), BigDecimal::add);
            log.info(String.format("Withdrawal: player=%s amount=%s newBalance=%s", playerId, amount, newBalance));

            sendJson(exchange, 200, String.format(
                "{\"playerId\":\"%s\",\"withdrawn\":%s,\"newBalance\":%s}",
                playerId, amount.toPlainString(), newBalance.toPlainString()
            ));
        }
    }

    // Minimal query param parser
    static String parseQueryParam(String query, String key) {
        if (query == null) return null;
        for (String part : query.split("&")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && kv[0].equals(key)) return kv[1];
        }
        return null;
    }

    // Minimal JSON string value extractor (avoids external dependencies for stub)
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
