FROM eclipse-temurin:21-jdk-jammy AS deps
# Download dependencies at build time — pinned versions, no build tool required
RUN apt-get update -qq && apt-get install -y -qq curl && \
    mkdir -p /app/lib && \
    curl -fsSL -o /app/lib/postgresql.jar \
    "https://jdbc.postgresql.org/download/postgresql-42.7.3.jar" && \
    curl -fsSL -o /app/lib/jedis.jar \
    "https://repo1.maven.org/maven2/redis/clients/jedis/5.1.3/jedis-5.1.3.jar" && \
    curl -fsSL -o /app/lib/slf4j-api.jar \
    "https://repo1.maven.org/maven2/org/slf4j/slf4j-api/2.0.12/slf4j-api-2.0.12.jar" && \
    curl -fsSL -o /app/lib/slf4j-nop.jar \
    "https://repo1.maven.org/maven2/org/slf4j/slf4j-nop/2.0.12/slf4j-nop-2.0.12.jar"

FROM eclipse-temurin:21-jdk-jammy AS builder
WORKDIR /app
COPY --from=deps /app/lib ./lib
RUN mkdir -p com/swarmblackjack/bank
COPY BankService.java com/swarmblackjack/bank/
RUN javac -cp "lib/postgresql.jar:lib/jedis.jar:lib/slf4j-api.jar" com/swarmblackjack/bank/BankService.java

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=builder /app/com ./com
COPY --from=deps /app/lib ./lib
EXPOSE 3005
CMD ["java", "-cp", ".:lib/postgresql.jar:lib/jedis.jar:lib/slf4j-api.jar:lib/slf4j-nop.jar", "com.swarmblackjack.bank.BankService"]
