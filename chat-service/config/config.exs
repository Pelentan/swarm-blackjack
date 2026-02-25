import Config

config :chat_service, ChatService.Router,
  port: String.to_integer(System.get_env("PORT") || "3007")
