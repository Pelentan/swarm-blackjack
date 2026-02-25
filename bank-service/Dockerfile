FROM eclipse-temurin:21-jdk-jammy AS builder
WORKDIR /app
RUN mkdir -p com/swarmblackjack/bank
COPY BankService.java com/swarmblackjack/bank/
RUN javac com/swarmblackjack/bank/BankService.java

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=builder /app/com ./com
EXPOSE 3005
CMD ["java", "com.swarmblackjack.bank.BankService"]
