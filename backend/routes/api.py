from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, File, Header, HTTPException, UploadFile, status

try:
    from backend.auth import (
        create_session_token,
        get_google_client_id,
        hash_password,
        normalize_username,
        verify_google_identity_token,
        verify_password,
    )
    from backend.connection_manager import connection_manager
    from backend.models import (
        CreateServerRequest,
        FriendInviteAccept,
        FriendRequestCreate,
        GoogleAuthRequest,
        JoinServerRequest,
        LoginRequest,
        RegisterRequest,
        SaveJsonRequest,
        UpdateProfileRequest,
    )
    from backend.storage import store, utc_now_iso
except ModuleNotFoundError:
    from auth import (
        create_session_token,
        get_google_client_id,
        hash_password,
        normalize_username,
        verify_google_identity_token,
        verify_password,
    )
    from connection_manager import connection_manager
    from models import (
        CreateServerRequest,
        FriendInviteAccept,
        FriendRequestCreate,
        GoogleAuthRequest,
        JoinServerRequest,
        LoginRequest,
        RegisterRequest,
        SaveJsonRequest,
        UpdateProfileRequest,
    )
    from storage import store, utc_now_iso


router = APIRouter(prefix="/api")
UPLOAD_CHUNK_SIZE = 1024 * 1024


def _public_user(user: dict[str, Any], online_ids: set[str] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": user["id"],
        "username": user["username"],
        "avatar_url": user.get("avatar_url", ""),
        "status_mode": user.get("status_mode", ""),
        "status_text": user.get("status_text", ""),
    }
    if online_ids is not None:
        payload["is_online"] = user["id"] in online_ids
    return payload


def _private_user(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user.get("display_name", "") or user["username"],
        "email": user.get("email", ""),
        "avatar_url": user.get("avatar_url", ""),
        "status_mode": user.get("status_mode", ""),
        "status_text": user.get("status_text", ""),
        "auth_provider": user.get("auth_provider") or ("password" if user.get("password_hash") else ""),
    }


def _dm_conversation_id(user_a_id: str, user_b_id: str) -> str:
    return "__".join(sorted([user_a_id, user_b_id]))


def _sanitize_google_username(value: str) -> str:
    allowed = [char for char in value if char.isalnum() or char in {"_", "-", "."}]
    candidate = "".join(allowed).strip("._-")
    return candidate[:24] if candidate else ""


def _build_google_username(data: dict[str, Any], email: str, full_name: str) -> tuple[str, str]:
    candidates = [
        _sanitize_google_username(full_name.replace(" ", "_")),
        _sanitize_google_username(email.split("@", 1)[0]),
        "google_user",
    ]
    base = next((candidate for candidate in candidates if len(candidate) >= 3), "google_user")
    normalized = normalize_username(base)
    if not any(item["normalized_username"] == normalized for item in data["users"]):
        return base, normalized

    suffix = 2
    while True:
        suffix_text = str(suffix)
        candidate = f"{base[: max(3, 24 - len(suffix_text) - 1)]}_{suffix_text}"
        normalized = normalize_username(candidate)
        if not any(item["normalized_username"] == normalized for item in data["users"]):
            return candidate, normalized
        suffix += 1


def _build_server_summary(server: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": server["id"],
        "name": server["name"],
        "owner_id": server["owner_id"],
        "member_count": len(server["member_ids"]),
        "is_private": bool(server.get("password_hash")),
    }


def _ensure_user_read_state(data: dict[str, Any], user_id: str) -> dict[str, Any]:
    read_state = data.setdefault("read_state", {})
    user_state = read_state.setdefault(user_id, {})
    servers = user_state.get("servers")
    dms = user_state.get("dms")
    user_state["servers"] = servers if isinstance(servers, dict) else {}
    user_state["dms"] = dms if isinstance(dms, dict) else {}
    return user_state


def _ensure_friends_state(data: dict[str, Any]) -> tuple[dict[str, list[str]], list[dict[str, Any]], list[dict[str, Any]]]:
    friends = data.setdefault("friends", {})
    if not isinstance(friends, dict):
        data["friends"] = {}
        friends = data["friends"]
    friend_requests = data.setdefault("friend_requests", [])
    if not isinstance(friend_requests, list):
        data["friend_requests"] = []
        friend_requests = data["friend_requests"]
    friend_invites = data.setdefault("friend_invites", [])
    if not isinstance(friend_invites, list):
        data["friend_invites"] = []
        friend_invites = data["friend_invites"]
    return friends, friend_requests, friend_invites


def _get_friend_ids(friends: dict[str, list[str]], user_id: str) -> list[str]:
    ids = friends.get(user_id)
    if not isinstance(ids, list):
        friends[user_id] = []
        return []
    return ids


def _are_friends(friends: dict[str, list[str]], user_a: str, user_b: str) -> bool:
    return user_b in _get_friend_ids(friends, user_a)


def _add_friendship(friends: dict[str, list[str]], user_a: str, user_b: str):
    if user_a == user_b:
        return
    for left, right in ((user_a, user_b), (user_b, user_a)):
        ids = _get_friend_ids(friends, left)
        if right not in ids:
            ids.append(right)


def _remove_friendship(friends: dict[str, list[str]], user_a: str, user_b: str):
    for left, right in ((user_a, user_b), (user_b, user_a)):
        ids = _get_friend_ids(friends, left)
        if right in ids:
            ids.remove(right)


def _create_invite_code(existing: set[str]) -> str:
    while True:
        code = uuid4().hex[:8].upper()
        if code not in existing:
            return code


def _get_last_read_at(data: dict[str, Any], user_id: str, scope: str, chat_id: str) -> str:
    return str(_ensure_user_read_state(data, user_id)[scope].get(chat_id, "") or "")


def _count_unread_messages(messages: list[dict[str, Any]], current_user_id: str, last_read_at: str) -> int:
    return sum(
        1
        for message in messages
        if message.get("type") == "message"
        and message.get("user_id") != current_user_id
        and (not last_read_at or str(message.get("created_at", "")) > last_read_at)
    )


def _latest_message_timestamp(messages: list[dict[str, Any]]) -> str:
    if not messages:
        return ""
    return max(str(message.get("created_at", "") or "") for message in messages)


def _mark_read(data: dict[str, Any], user_id: str, scope: str, chat_id: str, messages: list[dict[str, Any]]) -> str:
    latest_timestamp = _latest_message_timestamp(messages)
    scoped_state = _ensure_user_read_state(data, user_id)[scope]
    current_timestamp = str(scoped_state.get(chat_id, "") or "")
    if latest_timestamp and latest_timestamp > current_timestamp:
        scoped_state[chat_id] = latest_timestamp
        return latest_timestamp
    if current_timestamp:
        return current_timestamp
    scoped_state.setdefault(chat_id, "")
    return ""


def _build_enriched_server_summary(server: dict[str, Any], current_user: dict[str, Any], data: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
    last_read_at = _get_last_read_at(data, current_user["id"], "servers", server["id"])
    return {
        **_build_server_summary(server),
        "last_message": messages[-1] if messages else None,
        "unread_count": _count_unread_messages(messages, current_user["id"], last_read_at),
    }


def _build_direct_summary(
    current_user: dict[str, Any],
    other_user: dict[str, Any],
    messages: list[dict[str, Any]],
    data: dict[str, Any],
    online_ids: set[str] | None = None,
) -> dict[str, Any]:
    last_message = messages[-1] if messages else None
    last_read_at = _get_last_read_at(data, current_user["id"], "dms", other_user["id"])
    unread_count = _count_unread_messages(messages, current_user["id"], last_read_at)
    return {
        "id": other_user["id"],
        "username": other_user["username"],
        "avatar_url": other_user.get("avatar_url", ""),
        "is_online": other_user["id"] in online_ids if online_ids is not None else False,
        "last_message": last_message,
        "message_count": len(messages),
        "unread_count": unread_count,
    }


def _resolve_session(authorization: str | None) -> tuple[dict[str, Any], dict[str, Any]]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token.")

    token = authorization.removeprefix("Bearer ").strip()
    data = store.read_data()
    session = next((item for item in data["sessions"] if item["token"] == token), None)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")

    user = next((item for item in data["users"] if item["id"] == session["user_id"]), None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session user not found.")

    return user, session


async def _save_upload_stream(file: UploadFile, *, category: str, max_size: int) -> dict:
    meta = store.reserve_media_target(file.filename or "upload", category=category)
    target_path = Path(meta["path"])
    size = 0
    try:
        with target_path.open("wb") as output:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_size:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment file is too large.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment file is empty.")
    except Exception:
        target_path.unlink(missing_ok=True)
        raise
    finally:
        try:
            await file.close()
        except Exception:
            pass
    meta["size"] = size
    return meta


@router.get("/auth/google/config")
def google_auth_config():
    client_id = get_google_client_id()
    return {"enabled": bool(client_id), "client_id": client_id}


@router.post("/auth/register")
def register(payload: RegisterRequest):
    username = payload.username.strip()
    normalized_username = normalize_username(username)

    def updater(data: dict):
        if any(item["normalized_username"] == normalized_username for item in data["users"]):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists.")

        user = {
            "id": str(uuid4()),
            "username": username,
            "normalized_username": normalized_username,
            "password_hash": hash_password(payload.password),
            "display_name": username,
            "status_mode": "online",
            "status_text": "",
            "created_at": utc_now_iso(),
        }
        token = create_session_token()
        session = {
            "token": token,
            "user_id": user["id"],
            "created_at": utc_now_iso(),
        }
        data["users"].append(user)
        data["sessions"].append(session)
        return {"token": token, "user": _public_user(user)}

    return store.update(updater)


@router.post("/auth/login")
def login(payload: LoginRequest):
    normalized_username = normalize_username(payload.username)

    def updater(data: dict):
        user = next((item for item in data["users"] if item["normalized_username"] == normalized_username), None)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
        if not user.get("password_hash"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account uses Google sign-in.")
        if not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

        token = create_session_token()
        data["sessions"].append({
            "token": token,
            "user_id": user["id"],
            "created_at": utc_now_iso(),
        })
        return {"token": token, "user": _public_user(user)}

    return store.update(updater)


@router.post("/auth/google")
def login_with_google(payload: GoogleAuthRequest):
    try:
        google_profile = verify_google_identity_token(payload.credential)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google credential.") from error

    google_sub = str(google_profile.get("sub", "")).strip()
    email = str(google_profile.get("email", "")).strip().lower()
    email_verified = bool(google_profile.get("email_verified"))
    display_name = str(google_profile.get("name") or google_profile.get("given_name") or email.split("@", 1)[0]).strip()

    if not google_sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google account identifier is missing.")
    if not email or not email_verified:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is missing or not verified.")

    def updater(data: dict):
        user = next((item for item in data["users"] if item.get("google_sub") == google_sub), None)
        if user is None:
            user = next((item for item in data["users"] if item.get("email", "").lower() == email), None)

        if user is None:
            username, normalized_username = _build_google_username(data, email, display_name)
            user = {
                "id": str(uuid4()),
                "username": username,
                "normalized_username": normalized_username,
                "password_hash": "",
                "email": email,
                "google_sub": google_sub,
                "display_name": display_name or username,
                "auth_provider": "google",
                "status_mode": "online",
                "status_text": "",
                "created_at": utc_now_iso(),
            }
            data["users"].append(user)
        else:
            user["email"] = email
            user["google_sub"] = google_sub
            user["auth_provider"] = "google"
            if display_name:
                user["display_name"] = display_name

        token = create_session_token()
        data["sessions"].append({
            "token": token,
            "user_id": user["id"],
            "created_at": utc_now_iso(),
        })
        return {"token": token, "user": _public_user(user)}

    return store.update(updater)


@router.get("/session")
def get_session(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    return {"user": _public_user(user)}


@router.get("/users/me")
def get_current_user_profile(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    return {"user": _private_user(user)}


@router.patch("/users/me")
def update_current_user_profile(payload: UpdateProfileRequest, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        target = next((item for item in data["users"] if item["id"] == user["id"]), None)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

        auth_provider = target.get("auth_provider") or ("password" if target.get("password_hash") else "")
        wants_sensitive = bool(payload.username or payload.email or payload.new_password)
        if wants_sensitive:
            if auth_provider == "google" or not target.get("password_hash"):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This account uses Google sign-in.")
            if not payload.current_password or not verify_password(payload.current_password, target["password_hash"]):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

        if payload.username:
            normalized_username = normalize_username(payload.username)
            if normalized_username != target.get("normalized_username"):
                if any(item["normalized_username"] == normalized_username for item in data["users"]):
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists.")
            target["username"] = payload.username
            target["normalized_username"] = normalized_username

        if payload.display_name is not None:
            target["display_name"] = payload.display_name or target.get("username", "")

        if payload.email is not None:
            target["email"] = payload.email

        if payload.new_password:
            target["password_hash"] = hash_password(payload.new_password)

        if payload.status_mode is not None:
            target["status_mode"] = payload.status_mode

        if payload.status_text is not None:
            target["status_text"] = payload.status_text or ""

        return {"user": _private_user(target)}

    return store.update(updater)


@router.post("/users/avatar")
async def upload_user_avatar(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    saved = await _save_upload_stream(file, category="avatars", max_size=5 * 1024 * 1024)

    def updater(data: dict):
        target_user = next((item for item in data["users"] if item["id"] == user["id"]), None)
        if target_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        target_user["avatar_url"] = saved["url"]
        return {"user": _private_user(target_user)}

    return store.update(updater)


@router.post("/uploads")
async def upload_chat_attachment(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    _resolve_session(authorization)
    saved = await _save_upload_stream(file, category="attachments", max_size=256 * 1024 * 1024)
    if file.content_type and file.content_type.startswith("audio/"):
        saved["kind"] = "audio"
        saved["content_type"] = file.content_type
        saved = store.convert_audio_to_mp3(saved)
    return {"attachment": saved}


@router.post("/storage/json")
def save_json_file(payload: SaveJsonRequest, authorization: str | None = Header(default=None)):
    _resolve_session(authorization)
    try:
        saved_path = store.save_json_document(payload.filename, payload.content)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    return {
        "file": {
            "name": saved_path.name,
            "path": str(saved_path),
        }
    }


@router.get("/users")
def list_users(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    data = store.read_data()
    online_ids = connection_manager.get_online_user_ids()
    users = [
        _public_user(item, online_ids)
        for item in data["users"]
        if item["id"] != user["id"]
    ]
    users.sort(key=lambda item: item["username"].lower())
    return {"users": users}


@router.get("/friends")
def list_friends(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    data = store.read_data()
    online_ids = connection_manager.get_online_user_ids()
    friends, friend_requests, friend_invites = _ensure_friends_state(data)
    friend_ids = set(_get_friend_ids(friends, user["id"]))

    friend_users = [
        _public_user(item, online_ids)
        for item in data["users"]
        if item["id"] in friend_ids
    ]
    friend_users.sort(key=lambda item: item["username"].lower())

    incoming = []
    outgoing = []
    for request in friend_requests:
        if request.get("status") != "pending":
            continue
        if request.get("to_user_id") == user["id"]:
            sender = next((item for item in data["users"] if item["id"] == request.get("from_user_id")), None)
            if sender:
                incoming.append({
                    "id": request.get("id"),
                    "created_at": request.get("created_at", ""),
                    "user": _public_user(sender, online_ids),
                })
        if request.get("from_user_id") == user["id"]:
            receiver = next((item for item in data["users"] if item["id"] == request.get("to_user_id")), None)
            if receiver:
                outgoing.append({
                    "id": request.get("id"),
                    "created_at": request.get("created_at", ""),
                    "user": _public_user(receiver, online_ids),
                })

    invites = [
        {
            "code": invite.get("code", ""),
            "created_at": invite.get("created_at", ""),
            "status": invite.get("status", "pending"),
        }
        for invite in friend_invites
        if invite.get("status") == "pending" and invite.get("from_user_id") == user["id"]
    ]

    return {
        "friends": friend_users,
        "incoming_requests": incoming,
        "outgoing_requests": outgoing,
        "invites": invites,
    }


@router.post("/friends/requests")
def create_friend_request(payload: FriendRequestCreate, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    normalized_username = normalize_username(payload.username)

    def updater(data: dict):
        friends, friend_requests, _ = _ensure_friends_state(data)
        other_user = next((item for item in data["users"] if item["normalized_username"] == normalized_username), None)
        if other_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        if other_user["id"] == user["id"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add yourself.")
        if _are_friends(friends, user["id"], other_user["id"]):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already friends.")

        for request in friend_requests:
            if request.get("status") != "pending":
                continue
            if {request.get("from_user_id"), request.get("to_user_id")} == {user["id"], other_user["id"]}:
                request["status"] = "accepted"
                request["responded_at"] = utc_now_iso()

        _add_friendship(friends, user["id"], other_user["id"])
        return {"status": "accepted", "friend": _public_user(other_user)}

    return store.update(updater)


@router.post("/friends/requests/{request_id}/accept")
def accept_friend_request(request_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        friends, friend_requests, _ = _ensure_friends_state(data)
        request = next((item for item in friend_requests if item.get("id") == request_id), None)
        if request is None or request.get("status") != "pending":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")
        if request.get("to_user_id") != user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        request["status"] = "accepted"
        request["responded_at"] = utc_now_iso()
        other_user_id = request.get("from_user_id")
        _add_friendship(friends, user["id"], other_user_id)
        other_user = next((item for item in data["users"] if item["id"] == other_user_id), None)
        return {"status": "accepted", "friend": _public_user(other_user) if other_user else None}

    return store.update(updater)


@router.post("/friends/requests/{request_id}/decline")
def decline_friend_request(request_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        _, friend_requests, _ = _ensure_friends_state(data)
        request = next((item for item in friend_requests if item.get("id") == request_id), None)
        if request is None or request.get("status") != "pending":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found.")
        if user["id"] not in {request.get("to_user_id"), request.get("from_user_id")}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed.")
        request["status"] = "declined"
        request["responded_at"] = utc_now_iso()
        return {"status": "declined"}

    return store.update(updater)


@router.post("/friends/invites")
def create_friend_invite(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        _, _, friend_invites = _ensure_friends_state(data)
        existing_codes = {invite.get("code", "") for invite in friend_invites}
        code = _create_invite_code(existing_codes)
        friend_invites.append({
            "code": code,
            "from_user_id": user["id"],
            "status": "pending",
            "created_at": utc_now_iso(),
        })
        return {"code": code}

    return store.update(updater)


@router.post("/friends/invites/accept")
def accept_friend_invite(payload: FriendInviteAccept, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        friends, _, friend_invites = _ensure_friends_state(data)
        invite = next((item for item in friend_invites if item.get("code") == payload.code and item.get("status") == "pending"), None)
        if invite is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found.")
        if invite.get("from_user_id") == user["id"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot accept your own invite.")
        invite["status"] = "accepted"
        invite["claimed_by"] = user["id"]
        invite["claimed_at"] = utc_now_iso()
        _add_friendship(friends, user["id"], invite.get("from_user_id"))
        return {"status": "accepted"}

    return store.update(updater)


@router.delete("/friends/{friend_id}")
def remove_friend(friend_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        friends, _, _ = _ensure_friends_state(data)
        if not _are_friends(friends, user["id"], friend_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Friend not found.")
        _remove_friendship(friends, user["id"], friend_id)
        return {"status": "removed"}

    return store.update(updater)


@router.get("/dms")
def list_direct_messages(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    data = store.read_data()
    online_ids = connection_manager.get_online_user_ids()
    friends, _, _ = _ensure_friends_state(data)
    friend_ids = set(_get_friend_ids(friends, user["id"]))
    summaries = []
    for other_user in data["users"]:
        if other_user["id"] == user["id"]:
            continue
        if other_user["id"] not in friend_ids:
            continue
        conversation_id = _dm_conversation_id(user["id"], other_user["id"])
        messages = store.read_direct_messages(conversation_id)
        summaries.append(_build_direct_summary(user, other_user, messages, data, online_ids))
    summaries.sort(
        key=lambda item: item["last_message"]["created_at"] if item["last_message"] else "",
        reverse=True,
    )
    return {"conversations": summaries}


@router.get("/dms/{other_user_id}")
def get_direct_message_thread(other_user_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    online_ids = connection_manager.get_online_user_ids()

    def updater(data: dict):
        friends, _, _ = _ensure_friends_state(data)
        other_user = next((item for item in data["users"] if item["id"] == other_user_id), None)
        if other_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        if other_user["id"] == user["id"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot open a direct message with yourself.")

        conversation_id = _dm_conversation_id(user["id"], other_user["id"])
        messages = store.read_direct_messages(conversation_id)
        if not _are_friends(friends, user["id"], other_user_id) and not messages:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only message friends.")
        _mark_read(data, user["id"], "dms", other_user_id, messages)
        return {
            "conversation": {
                "id": conversation_id,
                "user": _public_user(other_user, online_ids),
                "messages": messages,
                "unread_count": 0,
            }
        }

    return store.update(updater)


@router.post("/dms/{other_user_id}/read")
def mark_direct_message_thread_read(other_user_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        other_user = next((item for item in data["users"] if item["id"] == other_user_id), None)
        if other_user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
        if other_user["id"] == user["id"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot open a direct message with yourself.")

        conversation_id = _dm_conversation_id(user["id"], other_user["id"])
        messages = store.read_direct_messages(conversation_id)
        last_read_at = _mark_read(data, user["id"], "dms", other_user_id, messages)
        return {"status": "ok", "last_read_at": last_read_at, "unread_count": 0}

    return store.update(updater)


@router.get("/servers")
def list_servers(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    data = store.read_data()
    servers = [
        _build_enriched_server_summary(server, user, data, store.read_chat_messages(server["id"]))
        for server in data["servers"]
        if user["id"] in server["member_ids"]
    ]
    return {"servers": servers}


@router.post("/servers")
def create_server(payload: CreateServerRequest, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    name = payload.name.strip()
    password = payload.password.strip()

    def updater(data: dict):
        server = {
            "id": str(uuid4()),
            "name": name,
            "owner_id": user["id"],
            "member_ids": [user["id"]],
            "messages": [],
            "password_hash": hash_password(password) if password else "",
            "created_at": utc_now_iso(),
        }
        data["servers"].append(server)
        return {"server": _build_server_summary(server)}

    return store.update(updater)


@router.get("/servers/discover")
def discover_servers(authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    data = store.read_data()
    servers = []
    for server in data["servers"]:
        joined = user["id"] in server["member_ids"]
        messages = store.read_chat_messages(server["id"]) if joined else []
        servers.append({
            **_build_enriched_server_summary(server, user, data, messages),
            "joined": joined,
        })
    return {"servers": servers}


@router.post("/servers/{server_id}/join")
def join_server(server_id: str, payload: JoinServerRequest, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        server = next((item for item in data["servers"] if item["id"] == server_id), None)
        if server is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found.")
        if user["id"] not in server["member_ids"] and server.get("password_hash"):
            if not verify_password(payload.password, server["password_hash"]):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid server password.")
        if user["id"] not in server["member_ids"]:
            server["member_ids"].append(user["id"])
        return {"server": _build_server_summary(server)}

    return store.update(updater)


@router.get("/servers/{server_id}")
def get_server(server_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)
    online_ids = connection_manager.get_online_user_ids()

    def updater(data: dict):
        server = next((item for item in data["servers"] if item["id"] == server_id), None)
        if server is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found.")
        if user["id"] not in server["member_ids"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this server.")

        users_by_id = {item["id"]: item for item in data["users"]}
        members = [
            _public_user(users_by_id[user_id], online_ids)
            for user_id in server["member_ids"]
            if user_id in users_by_id
        ]
        messages = store.read_chat_messages(server_id)
        _mark_read(data, user["id"], "servers", server_id, messages)
        return {
            "server": {
                **_build_enriched_server_summary(server, user, data, messages),
                "members": members,
                "messages": messages,
                "unread_count": 0,
            }
        }

    return store.update(updater)


@router.post("/servers/{server_id}/read")
def mark_server_read(server_id: str, authorization: str | None = Header(default=None)):
    user, _ = _resolve_session(authorization)

    def updater(data: dict):
        server = next((item for item in data["servers"] if item["id"] == server_id), None)
        if server is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found.")
        if user["id"] not in server["member_ids"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this server.")

        messages = store.read_chat_messages(server_id)
        last_read_at = _mark_read(data, user["id"], "servers", server_id, messages)
        return {"status": "ok", "last_read_at": last_read_at, "unread_count": 0}

    return store.update(updater)
