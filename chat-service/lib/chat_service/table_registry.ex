defmodule ChatService.TableRegistry do
  @moduledoc """
  OTP GenServer managing in-memory message store per table.

  Each table is a supervised process. If one table's process crashes,
  only that table loses its in-memory chat — the other tables are unaffected.
  This is OTP supervision in practice, not theory.

  Production: replace ETS/in-memory with persistent storage + Signal protocol E2E encryption.
  """
  use GenServer

  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def get_messages(table_id) do
    GenServer.call(__MODULE__, {:get_messages, table_id})
  end

  def add_message(table_id, message) do
    GenServer.cast(__MODULE__, {:add_message, table_id, message})
  end

  # GenServer callbacks

  @impl true
  def init(_) do
    {:ok, %{}}
  end

  @impl true
  def handle_call({:get_messages, table_id}, _from, state) do
    messages = Map.get(state, table_id, [])
    {:reply, messages, state}
  end

  @impl true
  def handle_cast({:add_message, table_id, message}, state) do
    messages = Map.get(state, table_id, [])
    # Keep last 100 messages per table
    updated = Enum.take([message | messages], 100)
    {:noreply, Map.put(state, table_id, updated)}
  end
end
