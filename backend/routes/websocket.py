import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

try:
    from datetime import UTC
except ImportError:
    UTC = timezone.utc

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect, WebSocketException, status

try:
    from backend.connection_manager import connection_manager
    from backend.storage import db
except ModuleNotFoundError:
    from connection_manager import connection_manager
    from storage import db


router = APIRouter()
manager = connection_manager
MAX_SERVER_MESSAGES = 100


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _resolve_socket_access(token: str, server_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    data = db.read_data()
    session = next((item for item in data["sessions"] if item["token"] == token), None)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")

    user = next((item for item in data["users"] if item["id"] == session["user_id"]), None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session user not found.")

    server = next((item for item in data["servers"] if item["id"] == server_id), None)
    if server is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found.")
    if user["id"] not in server["member_ids"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this server.")

    return user, server


def _resolve_user_from_token(token: str) -> dict[str, Any]:
    data = db.read_data()
    session = next((item for item in data["sessions"] if item["token"] == token), None)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")

    user = next((item for item in data["users"] if item["id"] == session["user_id"]), None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session user not found.")
    return user


def _append_server_message(server_id: str, message: dict[str, Any]):
    db.append_chat_message(server_id, message, max_messages=MAX_SERVER_MESSAGES)


def _dm_conversation_id(user_a_id: str, user_b_id: str) -> str:
    return "__".join(sorted([user_a_id, user_b_id]))


def _resolve_direct_socket_access(token: str, other_user_id: str) -> tuple[dict[str, Any], dict[str, Any], str]:
    data = db.read_data()
    session = next((item for item in data["sessions"] if item["token"] == token), None)
    if session is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.")

    user = next((item for item in data["users"] if item["id"] == session["user_id"]), None)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session user not found.")

    other_user = next((item for item in data["users"] if item["id"] == other_user_id), None)
    if other_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if other_user["id"] == user["id"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot open a direct message with yourself.")

    return user, other_user, _dm_conversation_id(user["id"], other_user["id"])


def _append_direct_message(conversation_id: str, message: dict[str, Any]):
    db.append_direct_message(conversation_id, message, max_messages=200)


def _build_message_record(
    user: dict[str, Any],
    content: str,
    client_message_id: str | None,
    attachment: dict[str, Any] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    reply_to: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message_record = {
        "type": "message",
        "message_id": str(uuid4()),
        "user_id": user["id"],
        "username": user["username"],
        "user_avatar_url": user.get("avatar_url", ""),
        "content": content,
        "created_at": _utc_now_iso(),
    }
    if client_message_id:
        message_record["client_message_id"] = client_message_id
    if attachment:
        message_record["attachment"] = attachment
    if attachments:
        message_record["attachments"] = attachments
    if reply_to:
        message_record["reply_to"] = reply_to
    return message_record


def _resolve_reply_summary(messages: list[dict[str, Any]], reply_to_id: str) -> dict[str, Any] | None:
    if not reply_to_id:
        return None
    for message in reversed(messages):
        if message.get("message_id") != reply_to_id:
            continue
        attachment = message.get("attachment")
        attachments = message.get("attachments") if isinstance(message.get("attachments"), list) else None
        return {
            "message_id": message.get("message_id", ""),
            "user_id": message.get("user_id", ""),
            "username": message.get("username", ""),
            "content": message.get("content", ""),
            "created_at": message.get("created_at", ""),
            "deleted": bool(message.get("deleted")),
            "attachment": attachment if isinstance(attachment, dict) else None,
            "attachments": [item for item in attachments if isinstance(item, dict)] if attachments else None,
        }
    return None


def _apply_message_edit(message: dict[str, Any], user_id: str, content: str) -> bool:
    if message.get("type") != "message" or message.get("user_id") != user_id:
        return False
    message["content"] = content
    message["edited_at"] = _utc_now_iso()
    message.pop("deleted", None)
    return True


def _apply_message_delete(message: dict[str, Any], user_id: str) -> bool:
    if message.get("type") != "message" or message.get("user_id") != user_id:
        return False
    message["content"] = ""
    message["edited_at"] = _utc_now_iso()
    message["deleted"] = True
    message.pop("attachment", None)
    message.pop("attachments", None)
    return True


def _remove_message_attachments(message: dict[str, Any], user_id: str) -> list[dict[str, Any]] | None:
    if message.get("type") != "message" or message.get("user_id") != user_id:
        return None
    attachments = []
    if isinstance(message.get("attachments"), list):
        attachments = [item for item in message.get("attachments") if isinstance(item, dict)]
    elif isinstance(message.get("attachment"), dict):
        attachments = [message.get("attachment")]
    message.pop("attachments", None)
    message.pop("attachment", None)
    message["edited_at"] = _utc_now_iso()
    return attachments


@router.websocket("/ws/dm/{other_user_id}")
async def direct_message_websocket_endpoint(websocket: WebSocket, other_user_id: str, token: str = Query(...)):
    try:
        user, other_user, conversation_id = _resolve_direct_socket_access(token, other_user_id)
    except HTTPException as exc:
        raise WebSocketException(code=1008, reason=exc.detail) from exc

    await manager.connect(f"dm:{conversation_id}", websocket, user["id"])

    try:
        while True:
            raw_payload = await websocket.receive_text()
            client_message_id = None
            content = raw_payload
            reply_to_id = ""
            parsed_payload = None
            attachments = None

            try:
                parsed_payload = json.loads(raw_payload)
                if isinstance(parsed_payload, dict):
                    action = str(parsed_payload.get("action") or "message").lower()
                    if action == "edit":
                        message_id = str(parsed_payload.get("message_id", "")).strip()
                        next_content = str(parsed_payload.get("content", "")).strip()
                        if not message_id or not next_content:
                            continue
                        updated = db.update_direct_message(
                            conversation_id,
                            message_id,
                            lambda message: _apply_message_edit(message, user["id"], next_content),
                        )
                        if not updated:
                            continue
                        await manager.broadcast(
                            f"dm:{conversation_id}",
                            json.dumps(
                                {
                                    "type": "message_edit",
                                    "message_id": message_id,
                                    "content": updated.get("content", ""),
                                    "edited_at": updated.get("edited_at", ""),
                                }
                            ),
                        )
                        continue
                    if action == "delete":
                        message_id = str(parsed_payload.get("message_id", "")).strip()
                        if not message_id:
                            continue
                        updated = db.update_direct_message(
                            conversation_id,
                            message_id,
                            lambda message: _apply_message_delete(message, user["id"]),
                        )
                        if not updated:
                            continue
                        await manager.broadcast(
                            f"dm:{conversation_id}",
                            json.dumps(
                                {
                                    "type": "message_delete",
                                    "message_id": message_id,
                                    "edited_at": updated.get("edited_at", ""),
                                }
                            ),
                        )
                        continue
                    if action == "remove_attachments":
                        message_id = str(parsed_payload.get("message_id", "")).strip()
                        if not message_id:
                            continue
                        removed: list[list[dict[str, Any]] | None] = []
                        updated = db.update_direct_message(
                            conversation_id,
                            message_id,
                            lambda message: removed.append(_remove_message_attachments(message, user["id"])) or (removed[-1] is not None),
                        )
                        if not updated:
                            continue
                        for batch in removed:
                            if not batch:
                                continue
                            for item in batch:
                                db.delete_attachment_by_url(item.get("url", ""))
                        await manager.broadcast(
                            f"dm:{conversation_id}",
                            json.dumps(
                                {
                                    "type": "message_remove_attachments",
                                    "message_id": message_id,
                                    "edited_at": updated.get("edited_at", ""),
                                }
                            ),
                        )
                        continue

                    content = str(parsed_payload.get("content", ""))
                    client_message_id = parsed_payload.get("client_message_id")
                    attachment = parsed_payload.get("attachment")
                    attachments = parsed_payload.get("attachments")
                    reply_to_id = str(parsed_payload.get("reply_to", "") or parsed_payload.get("reply_to_id", "")).strip()
                else:
                    attachment = None
            except json.JSONDecodeError:
                attachment = None

            reply_to = None
            if isinstance(parsed_payload, dict):
                messages = db.read_direct_messages(conversation_id)
                reply_to = _resolve_reply_summary(messages, reply_to_id)

            normalized_attachments = None
            if isinstance(parsed_payload, dict) and isinstance(attachments, list):
                normalized_attachments = [item for item in attachments if isinstance(item, dict)]

            message_record = _build_message_record(
                user,
                content,
                client_message_id,
                attachment if isinstance(attachment, dict) else None,
                normalized_attachments,
                reply_to,
            )
            _append_direct_message(conversation_id, message_record)
            await manager.broadcast(f"dm:{conversation_id}", json.dumps(message_record))
            notification_event = {
                "type": "dm_notification",
                "conversation_id": conversation_id,
                "other_user_id": user["id"],
                "username": user["username"],
                "avatar_url": user.get("avatar_url", ""),
                "message": message_record,
            }
            await manager.broadcast(f"user:{other_user['id']}", json.dumps(notification_event))

    except WebSocketDisconnect:
        manager.disconnect(f"dm:{conversation_id}", websocket)


@router.websocket("/ws/notifications")
async def notification_websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    try:
        user = _resolve_user_from_token(token)
    except HTTPException as exc:
        raise WebSocketException(code=1008, reason=exc.detail) from exc

    room_id = f"user:{user['id']}"
    await manager.connect(room_id, websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(room_id, websocket)


@router.websocket("/ws/{server_id}")
async def websocket_endpoint(websocket: WebSocket, server_id: str, token: str = Query(...)):
    try:
        user, server = _resolve_socket_access(token, server_id)
    except HTTPException as exc:
        raise WebSocketException(code=1008, reason=exc.detail) from exc

    await manager.connect(server_id, websocket, user["id"])

    join_message = {
        "type": "system",
        "user_id": user["id"],
        "username": user["username"],
        "content": f"{user['username']} joined {server['name']}",
        "created_at": _utc_now_iso(),
    }
    _append_server_message(server_id, join_message)
    await manager.broadcast(server_id, json.dumps(join_message))

    try:
        while True:
            raw_payload = await websocket.receive_text()
            client_message_id = None
            content = raw_payload
            reply_to_id = ""
            parsed_payload = None
            attachments = None

            try:
                parsed_payload = json.loads(raw_payload)
                if isinstance(parsed_payload, dict):
                    action = str(parsed_payload.get("action") or "message").lower()
                    if action == "edit":
                        message_id = str(parsed_payload.get("message_id", "")).strip()
                        next_content = str(parsed_payload.get("content", "")).strip()
                        if not message_id or not next_content:
                            continue
                        updated = db.update_chat_message(
                            server_id,
                            message_id,
                            lambda message: _apply_message_edit(message, user["id"], next_content),
                        )
                        if not updated:
                            continue
                        await manager.broadcast(
                            server_id,
                            json.dumps(
                                {
                                    "type": "message_edit",
                                    "message_id": message_id,
                                    "content": updated.get("content", ""),
                                    "edited_at": updated.get("edited_at", ""),
                                }
                            ),
                        )
                        continue
                    if action == "delete":
                        message_id = str(parsed_payload.get("message_id", "")).strip()
                        if not message_id:
                            continue
                        updated = db.update_chat_message(
                            server_id,
                            message_id,
                            lambda message: _apply_message_delete(message, user["id"]),
                        )
                        if not updated:
                            continue
                        await manager.broadcast(
                            server_id,
                            json.dumps(
                                {
                                    "type": "message_delete",
                                    "message_id": message_id,
                                    "edited_at": updated.get("edited_at", ""),
                                }
                            ),
                        )
                        continue
                    if action == "remove_attachments":
                        message_id = str(parsed_payload.get("message_id", "")).strip()
                        if not message_id:
                            continue
                        removed: list[list[dict[str, Any]] | None] = []
                        updated = db.update_chat_message(
                            server_id,
                            message_id,
                            lambda message: removed.append(_remove_message_attachments(message, user["id"])) or (removed[-1] is not None),
                        )
                        if not updated:
                            continue
                        for batch in removed:
                            if not batch:
                                continue
                            for item in batch:
                                db.delete_attachment_by_url(item.get("url", ""))
                        await manager.broadcast(
                            server_id,
                            json.dumps(
                                {
                                    "type": "message_remove_attachments",
                                    "message_id": message_id,
                                    "edited_at": updated.get("edited_at", ""),
                                }
                            ),
                        )
                        continue

                    content = str(parsed_payload.get("content", ""))
                    client_message_id = parsed_payload.get("client_message_id")
                    attachment = parsed_payload.get("attachment")
                    attachments = parsed_payload.get("attachments")
                    reply_to_id = str(parsed_payload.get("reply_to", "") or parsed_payload.get("reply_to_id", "")).strip()
                else:
                    attachment = None
            except json.JSONDecodeError:
                attachment = None

            reply_to = None
            if isinstance(parsed_payload, dict):
                messages = db.read_chat_messages(server_id)
                reply_to = _resolve_reply_summary(messages, reply_to_id)

            normalized_attachments = None
            if isinstance(parsed_payload, dict) and isinstance(attachments, list):
                normalized_attachments = [item for item in attachments if isinstance(item, dict)]

            message_record = _build_message_record(
                user,
                content,
                client_message_id,
                attachment if isinstance(attachment, dict) else None,
                normalized_attachments,
                reply_to,
            )
            _append_server_message(server_id, message_record)
            await manager.broadcast(server_id, json.dumps(message_record))

    except WebSocketDisconnect:
        manager.disconnect(server_id, websocket)
        leave_message = {
            "type": "system",
            "user_id": user["id"],
            "username": user["username"],
            "content": f"{user['username']} left {server['name']}",
            "created_at": _utc_now_iso(),
        }
        _append_server_message(server_id, leave_message)
        await manager.broadcast(server_id, json.dumps(leave_message))
