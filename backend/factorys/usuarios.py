from abc import ABC, abstractmethod
from typing import Any

from backend.models.usuarios import Usuario



class UsuarioFactory(ABC):
    @staticmethod
    @abstractmethod
    def get_usuario(user: dict[str, Any]) -> Usuario:
        raise NotImplementedError()


class UsuarioPublicoFactory(UsuarioFactory):
    @staticmethod
    def get_user(user: dict[str, Any]) -> UsuarioPublico:
        return UsuarioPublico(
            id=user["id"],
            username=user["username"],
            avatar_url=user.get("avatar_url", ""),
            status_mode=user.get("status_mode", ""),
            status_text=user.get("status_text", ""),
            is_online=(user.get("online", False)),
        )


class UsuarioPrivadoFactory(UsuarioFactory):
    @staticmethod
    def get_usuario(user: dict[str, Any]) -> UsuarioPrivado:
        return UsuarioPrivado(
            id=user["id"],
            username=user["username"],
            display_name=user.get("display_name", "") or user["username"],
            email=user.get("email", ""),
            avatar_url=user.get("avatar_url", ""),
            status_mode=user.get("status_mode", ""),
            status_text=user.get("status_text", ""),
            auth_provider=(
                user.get("auth_provider")
                or ("password" if user.get("password_hash") else "")
            ),
        )
