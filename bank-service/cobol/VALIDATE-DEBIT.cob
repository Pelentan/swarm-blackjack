       IDENTIFICATION DIVISION.
       PROGRAM-ID. VALIDATE-DEBIT.
       AUTHOR. SWARM-BLACKJACK.
      *----------------------------------------------------------------*
      * Validates a debit (bet or withdrawal) against current balance.
      *
      * Input  (environment variables):
      *   BALANCE_CENTS   - current balance in cents (integer)
      *   DEBIT_CENTS     - amount to debit in cents (integer)
      *
      * Output (stdout, key=value lines):
      *   STATUS          - OK or INSUFFICIENT
      *   NEW_BALANCE_CENTS - balance after debit (only valid if OK)
      *
      * Exit code: 0 = success, 1 = error
      *----------------------------------------------------------------*

       ENVIRONMENT DIVISION.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-BALANCE-CENTS      PIC S9(15) VALUE ZERO.
       01 WS-DEBIT-CENTS        PIC S9(15) VALUE ZERO.
       01 WS-NEW-BALANCE-CENTS  PIC S9(15) VALUE ZERO.
       01 WS-STATUS             PIC X(12)  VALUE SPACES.

       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-BALANCE-CENTS FROM ENVIRONMENT "BALANCE_CENTS"
           ACCEPT WS-DEBIT-CENTS   FROM ENVIRONMENT "DEBIT_CENTS"

           IF WS-DEBIT-CENTS <= ZERO
               DISPLAY "ERROR=debit amount must be positive"
               STOP RUN RETURNING 1
           END-IF

           IF WS-BALANCE-CENTS < WS-DEBIT-CENTS
               MOVE "INSUFFICIENT" TO WS-STATUS
               MOVE ZERO TO WS-NEW-BALANCE-CENTS
           ELSE
               MOVE "OK" TO WS-STATUS
               COMPUTE WS-NEW-BALANCE-CENTS =
                   WS-BALANCE-CENTS - WS-DEBIT-CENTS
           END-IF

           DISPLAY "STATUS=" WS-STATUS
           DISPLAY "NEW_BALANCE_CENTS=" WS-NEW-BALANCE-CENTS
           STOP RUN.
