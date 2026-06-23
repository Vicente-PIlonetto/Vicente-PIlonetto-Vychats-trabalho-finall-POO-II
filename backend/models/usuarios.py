from abc import abstractmethod


class Usuario:
    def __init__(
        self,
        id: str,
        username: str,
        avatar_url: str,
        status_mode: str,
        status_text: str,
    ) -> None:
        self.id = id
        self.username = username
        self.avatar_url = avatar_url
        self.status_mode = status_mode
        self.status_text = status_text


class UsuarioPublico(Usuario):
    def __init__(
        self,
        id: str,
        username: str,
        avatar_url: str,
        status_mode: str,
        status_text: str,
        is_online: bool | None,
    ) -> None:
        super().__init__(id, username, avatar_url, status_mode, status_text)
        self.is_online = is_online


class UsuarioPrivado(Usuario):
    def __init__(
        self,
        id: str,
        username: str,
        avatar_url: str,
        status_mode: str,
        status_text: str,
        display_name: str,
        email: str,
        auth_provider: str,
    ) -> None:
        super().__init__(id, username, avatar_url, status_mode, status_text)

        self.display_name = display_name
        self.email = email
        self.auth_provider = auth_provider
