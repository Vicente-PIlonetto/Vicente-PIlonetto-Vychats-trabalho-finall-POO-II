from typing import Any

from pydantic import BaseModel, Field, field_validator


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Username must have at least 3 non-space characters.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value.strip()) < 6:
            raise ValueError("Password must have at least 6 non-space characters.")
        return value


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=24)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Username must have at least 3 non-space characters.")
        return value

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value.strip()) < 6:
            raise ValueError("Password must have at least 6 non-space characters.")
        return value


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=32, max_length=4096)


class CreateServerRequest(BaseModel):
    name: str = Field(min_length=2, max_length=48)
    password: str = Field(default="", max_length=128)

    @field_validator("password")
    @classmethod
    def validate_server_password(cls, value: str) -> str:
        value = value.strip()
        if value and len(value) < 4:
            raise ValueError("Server password must have at least 4 characters.")
        return value


class JoinServerRequest(BaseModel):
    password: str = Field(default="", max_length=128)


class SaveJsonRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=120)
    content: Any

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Filename cannot be empty.")
        return value


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(default=None, max_length=48)
    username: str | None = Field(default=None, min_length=3, max_length=24)
    email: str | None = Field(default=None, max_length=128)
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str | None = Field(default=None, max_length=128)
    status_mode: str | None = Field(default=None, max_length=16)
    status_text: str | None = Field(default=None, max_length=48)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()[:48] or None

    @field_validator("username")
    @classmethod
    def validate_username_update(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Username must have at least 3 non-space characters.")
        return value

    @field_validator("email")
    @classmethod
    def validate_email_update(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip().lower() or None

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if len(value.strip()) < 6:
            raise ValueError("Password must have at least 6 non-space characters.")
        return value

    @field_validator("status_mode")
    @classmethod
    def validate_status_mode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        allowed = {"online", "offline", "dnd", "meeting"}
        if value not in allowed:
            raise ValueError("Invalid status mode.")
        return value

    @field_validator("status_text")
    @classmethod
    def validate_status_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()[:48] or None


class FriendRequestCreate(BaseModel):
    username: str = Field(min_length=3, max_length=24)

    @field_validator("username")
    @classmethod
    def validate_friend_username(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Username must have at least 3 non-space characters.")
        return value


class FriendInviteAccept(BaseModel):
    code: str = Field(min_length=4, max_length=24)

    @field_validator("code")
    @classmethod
    def validate_invite_code(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Invite code cannot be empty.")
        return value


class SessionResponse(BaseModel):
    token: str
    user: dict


class MessageRecord(BaseModel):
    user_id: str
    username: str
    content: str
    created_at: str


class ServerSummary(BaseModel):
    id: str
    name: str
    owner_id: str
    member_count: int
    is_private: bool


class ServerDetail(ServerSummary):
    members: list[dict]
    messages: list[MessageRecord]
