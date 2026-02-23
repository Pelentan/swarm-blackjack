defmodule ChatService.Router do
  use Plug.Router

  plug(:match)
  plug(Plug.Parsers, parsers: [:json], json_decoder: Jason)
  plug(:dispatch)

  get "/health" do
    send_json(conn, 200, %{
      status: "healthy",
      service: "chat-service",
      language: "Elixir",
      note: "OTP supervision trees — crash isolation by design. WebSocket support: TODO."
    })
  end

  # List messages for a table
  get "/tables/:table_id/messages" do
    messages = ChatService.TableRegistry.get_messages(table_id)

    send_json(conn, 200, %{
      tableId: table_id,
      messages: messages
    })
  end

  # Post a message to a table
  post "/tables/:table_id/messages" do
    %{"playerId" => player_id, "content" => content, "type" => msg_type} = conn.body_params

    message = %{
      id: :crypto.strong_rand_bytes(8) |> Base.encode16(case: :lower),
      tableId: table_id,
      playerId: player_id,
      content: content,
      type: msg_type,  # "public" or "private"
      targetPlayerId: Map.get(conn.body_params, "targetPlayerId"),
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    ChatService.TableRegistry.add_message(table_id, message)

    send_json(conn, 201, message)
  end

  match _ do
    send_json(conn, 404, %{error: "not found"})
  end

  defp send_json(conn, status, body) do
    conn
    |> Plug.Conn.put_resp_header("content-type", "application/json")
    |> Plug.Conn.put_resp_header("access-control-allow-origin", "*")
    |> Plug.Conn.send_resp(status, Jason.encode!(body))
  end
end
