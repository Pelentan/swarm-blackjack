FROM elixir:1.16 AS builder
WORKDIR /app
RUN mix local.hex --force && \
    mix local.rebar --force
COPY mix.exs ./
RUN mix deps.get && \
    mix deps.compile
COPY config ./config
COPY lib ./lib
RUN MIX_ENV=prod mix compile

FROM elixir:1.16
WORKDIR /app
RUN mix local.hex --force && \
    mix local.rebar --force
COPY --from=builder /app ./
EXPOSE 3007
ENV MIX_ENV=prod
CMD ["mix", "run", "--no-halt"]
