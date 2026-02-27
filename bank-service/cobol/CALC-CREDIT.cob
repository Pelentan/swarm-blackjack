       IDENTIFICATION DIVISION.
       PROGRAM-ID. CALC-CREDIT.
       AUTHOR. SWARM-BLACKJACK.
      *----------------------------------------------------------------*
      * Computes new balance after crediting an amount.
      * Used for: payout winnings, deposits, replenishment.
      *
      * Input  (environment variables):
      *   BALANCE_CENTS  - current balance in cents (integer)
      *   CREDIT_CENTS   - amount to credit in cents (integer)
      *
      * Output (stdout, key=value lines):
      *   NEW_BALANCE_CENTS - balance after credit
      *
      * Exit code: 0 = success, 1 = error
      *----------------------------------------------------------------*

       ENVIRONMENT DIVISION.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-BALANCE-CENTS      PIC S9(15) VALUE ZERO.
       01 WS-CREDIT-CENTS       PIC S9(15) VALUE ZERO.
       01 WS-NEW-BALANCE-CENTS  PIC S9(15) VALUE ZERO.

       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-BALANCE-CENTS FROM ENVIRONMENT "BALANCE_CENTS"
           ACCEPT WS-CREDIT-CENTS  FROM ENVIRONMENT "CREDIT_CENTS"

           IF WS-CREDIT-CENTS < ZERO
               DISPLAY "ERROR=credit amount must not be negative"
               STOP RUN RETURNING 1
           END-IF

           COMPUTE WS-NEW-BALANCE-CENTS =
               WS-BALANCE-CENTS + WS-CREDIT-CENTS

           DISPLAY "NEW_BALANCE_CENTS=" WS-NEW-BALANCE-CENTS
           STOP RUN.
