defmodule ChatService.Application do
  @moduledoc """
  Chat Service — Elixir / OTP

  Why Elixir? This is literally what it was designed for.
  WhatsApp served 900M users with 50 engineers. OTP supervision trees
  mean a crashed process restarts in isolation — it NEVER takes down the game.
  The actor model makes concurrent messaging trivially correct.

  Security posture:
  - E2E encrypted messages (Signal protocol — TODO: implement)
  - Public table chat + targeted private messages
  - WebSocket connections (bidirectional — genuinely needed for chat)
  - Rate limiting per-player via OTP process state
  """
  use Application

  def start(_type, _args) do
    port = String.to_integer(System.get_env("PORT") || "3007")

    children = [
      {Plug.Cowboy, scheme: :http, plug: ChatService.Router, options: [port: port]},
      ChatService.TableRegistry
    ]

    opts = [strategy: :one_for_one, name: ChatService.Supervisor]

    IO.puts("💬 Chat Service (Elixir/OTP) starting on :#{port}")
    IO.puts("   Actor model: each table is a supervised process.")
    IO.puts("   Crash isolation: a dead table never kills the game.")

    Supervisor.start_link(children, opts)
  end
end
