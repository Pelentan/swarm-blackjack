FROM eclipse-temurin:21-jdk-alpine AS builder
WORKDIR /app
COPY BankService.java .
RUN javac BankService.java

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=builder /app/*.class .
EXPOSE 3005
CMD ["java", "com.swarmblackjack.bank.BankService"]
