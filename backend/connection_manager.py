from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = defaultdict(list)
        self.user_connections: dict[str, set[WebSocket]] = defaultdict(set)
        self.socket_users: dict[WebSocket, str] = {}

    async def connect(self, server_id: str, websocket: WebSocket, user_id: str | None = None):
        await websocket.accept()
        self.active_connections[server_id].append(websocket)
        if user_id:
            self.register_user_socket(user_id, websocket)

    def register_user_socket(self, user_id: str, websocket: WebSocket):
        self.socket_users[websocket] = user_id
        self.user_connections[user_id].add(websocket)

    def unregister_user_socket(self, websocket: WebSocket):
        user_id = self.socket_users.pop(websocket, None)
        if not user_id:
            return
        connections = self.user_connections.get(user_id)
        if connections and websocket in connections:
            connections.remove(websocket)
        if not connections:
            self.user_connections.pop(user_id, None)

    def disconnect(self, server_id: str, websocket: WebSocket):
        if websocket in self.active_connections.get(server_id, []):
            self.active_connections[server_id].remove(websocket)
        if not self.active_connections.get(server_id):
            self.active_connections.pop(server_id, None)
        self.unregister_user_socket(websocket)

    async def broadcast(self, server_id: str, message: str):
        for connection in list(self.active_connections.get(server_id, [])):
            await connection.send_text(message)

    def is_user_online(self, user_id: str) -> bool:
        return bool(self.user_connections.get(user_id))

    def get_online_user_ids(self) -> set[str]:
        return set(self.user_connections.keys())


connection_manager = ConnectionManager()
