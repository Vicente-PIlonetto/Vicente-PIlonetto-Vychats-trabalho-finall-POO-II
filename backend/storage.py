import json
import os
import sqlite3
import subprocess
import shutil
import sys
import threading
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from mimetypes import guess_type
from pathlib import Path
from uuid import uuid4

try:
    from datetime import UTC
except ImportError:
    UTC = timezone.utc


PROJECT_DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_DATA = {
    "users": [],
    "servers": [],
    "sessions": [],
    "read_state": {},
    "friends": {},
    "friend_requests": [],
    "friend_invites": [],
}
ATTACHMENT_RETENTION_DAYS = 5


def _get_runtime_data_dir() -> Path:
    override = os.getenv("CIPHERLINE_DATA_DIR")
    if override:
        return Path(override).expanduser().resolve()

    if os.getenv("VERCEL"):
        return Path("/tmp") / "cipherline"

    if getattr(sys, "frozen", False):
        appdata = os.getenv("APPDATA")
        base_dir = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base_dir / "Cipherline"

    return PROJECT_DATA_DIR


DATA_DIR = _get_runtime_data_dir()
DATA_FILE = DATA_DIR / "store.json"
DB_FILE = DATA_DIR / "cipherline.db"
CHATS_DIR = DATA_DIR / "chats"
DIRECT_MESSAGES_DIR = DATA_DIR / "direct_messages"
JSON_EXPORTS_DIR = DATA_DIR / "json_exports"
MEDIA_DIR = DATA_DIR / "media"
AVATARS_DIR = MEDIA_DIR / "avatars"
ATTACHMENTS_DIR = MEDIA_DIR / "attachments"


class DataStore:
    def __init__(self, db_path: Path = DB_FILE):
        self.db_path = db_path
        self._lock = threading.RLock()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        CHATS_DIR.mkdir(parents=True, exist_ok=True)
        DIRECT_MESSAGES_DIR.mkdir(parents=True, exist_ok=True)
        JSON_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        ATTACHMENTS_DIR.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self.purge_expired_attachments()
        self._start_backup_thread()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self):
        is_new = not self.db_path.exists()
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS app_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    data TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS server_messages (
                    server_id TEXT PRIMARY KEY,
                    messages TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS direct_messages (
                    conversation_id TEXT PRIMARY KEY,
                    messages TEXT NOT NULL
                )
                """
            )
            connection.commit()

            if is_new or not self._state_exists(connection):
                seed = self._load_seed_state()
                self._write_state(connection, seed)
                self._import_message_exports(connection)
                self._export_json_snapshot(connection)
            self._maybe_run_daily_backup(connection)

    def _state_exists(self, connection: sqlite3.Connection) -> bool:
        row = connection.execute("SELECT COUNT(*) AS total FROM app_state").fetchone()
        return bool(row and row["total"] > 0)

    def _load_seed_state(self) -> dict:
        if DATA_FILE.exists():
            with DATA_FILE.open("r", encoding="utf-8") as file:
                data = json.load(file)
            return self._normalize_data_shape(data)

        bundled_store = PROJECT_DATA_DIR / "store.json"
        if bundled_store.exists():
            with bundled_store.open("r", encoding="utf-8") as file:
                data = json.load(file)
            return self._normalize_data_shape(data)

        return deepcopy(DEFAULT_DATA)

    def _import_message_exports(self, connection: sqlite3.Connection):
        for path in CHATS_DIR.glob("*.json"):
            server_id = path.stem
            try:
                with path.open("r", encoding="utf-8") as file:
                    messages = json.load(file)
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(messages, list):
                continue
            self._ensure_message_ids(messages)
            connection.execute(
                "INSERT OR REPLACE INTO server_messages (server_id, messages) VALUES (?, ?)",
                (server_id, json.dumps(messages)),
            )

        for path in DIRECT_MESSAGES_DIR.glob("*.json"):
            conversation_id = path.stem
            try:
                with path.open("r", encoding="utf-8") as file:
                    messages = json.load(file)
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(messages, list):
                continue
            self._ensure_message_ids(messages)
            connection.execute(
                "INSERT OR REPLACE INTO direct_messages (conversation_id, messages) VALUES (?, ?)",
                (conversation_id, json.dumps(messages)),
            )

        connection.commit()

    def _export_json_snapshot(self, connection: sqlite3.Connection):
        JSON_EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
        chat_export_dir = JSON_EXPORTS_DIR / "chats"
        dm_export_dir = JSON_EXPORTS_DIR / "direct_messages"
        chat_export_dir.mkdir(parents=True, exist_ok=True)
        dm_export_dir.mkdir(parents=True, exist_ok=True)

        state = self._read_state(connection)
        with (JSON_EXPORTS_DIR / "store.json").open("w", encoding="utf-8") as file:
            json.dump(state, file, indent=2, ensure_ascii=False)

        rows = connection.execute("SELECT server_id, messages FROM server_messages").fetchall()
        for row in rows:
            target = chat_export_dir / f"{row['server_id']}.json"
            with target.open("w", encoding="utf-8") as file:
                json.dump(json.loads(row["messages"]), file, indent=2, ensure_ascii=False)

        rows = connection.execute("SELECT conversation_id, messages FROM direct_messages").fetchall()
        for row in rows:
            target = dm_export_dir / f"{row['conversation_id']}.json"
            with target.open("w", encoding="utf-8") as file:
                json.dump(json.loads(row["messages"]), file, indent=2, ensure_ascii=False)

    def _maybe_run_daily_backup(self, connection: sqlite3.Connection):
        state = self._read_state(connection)
        backup_state = state.setdefault("backup_state", {})
        last_backup = str(backup_state.get("last_daily_backup", "") or "")
        today = datetime.now(UTC).date().isoformat()
        if last_backup == today:
            return
        self._export_daily_backup(connection, today)
        backup_state["last_daily_backup"] = today
        self._write_state(connection, state)

    def _export_daily_backup(self, connection: sqlite3.Connection, date_tag: str):
        daily_dir = JSON_EXPORTS_DIR / "daily" / date_tag
        chat_export_dir = daily_dir / "chats"
        dm_export_dir = daily_dir / "direct_messages"
        chat_export_dir.mkdir(parents=True, exist_ok=True)
        dm_export_dir.mkdir(parents=True, exist_ok=True)

        state = self._read_state(connection)
        with (daily_dir / "store.json").open("w", encoding="utf-8") as file:
            json.dump(state, file, indent=2, ensure_ascii=False)

        rows = connection.execute("SELECT server_id, messages FROM server_messages").fetchall()
        for row in rows:
            target = chat_export_dir / f"{row['server_id']}.json"
            with target.open("w", encoding="utf-8") as file:
                json.dump(json.loads(row["messages"]), file, indent=2, ensure_ascii=False)

        rows = connection.execute("SELECT conversation_id, messages FROM direct_messages").fetchall()
        for row in rows:
            target = dm_export_dir / f"{row['conversation_id']}.json"
            with target.open("w", encoding="utf-8") as file:
                json.dump(json.loads(row["messages"]), file, indent=2, ensure_ascii=False)

    def _start_backup_thread(self):
        thread = threading.Thread(target=self._daily_backup_loop, name="daily-backup", daemon=True)
        thread.start()

    def _daily_backup_loop(self):
        while True:
            try:
                with self._connect() as connection:
                    self._maybe_run_daily_backup(connection)
            except Exception:
                pass
            time.sleep(3600)

    def _normalize_data_shape(self, data: dict) -> dict:
        data.setdefault("users", [])
        data.setdefault("servers", [])
        data.setdefault("sessions", [])
        data.setdefault("friends", {})
        data.setdefault("friend_requests", [])
        data.setdefault("friend_invites", [])
        read_state = data.setdefault("read_state", {})
        if not isinstance(read_state, dict):
            data["read_state"] = {}
            read_state = data["read_state"]

        for user_id, user_state in list(read_state.items()):
            if not isinstance(user_state, dict):
                read_state[user_id] = {"servers": {}, "dms": {}}
                continue
            servers = user_state.get("servers")
            dms = user_state.get("dms")
            user_state["servers"] = servers if isinstance(servers, dict) else {}
            user_state["dms"] = dms if isinstance(dms, dict) else {}

        friends = data.get("friends")
        if not isinstance(friends, dict):
            data["friends"] = {}
        friend_requests = data.get("friend_requests")
        if not isinstance(friend_requests, list):
            data["friend_requests"] = []
        friend_invites = data.get("friend_invites")
        if not isinstance(friend_invites, list):
            data["friend_invites"] = []
        return data

    def _read_state(self, connection: sqlite3.Connection) -> dict:
        row = connection.execute("SELECT data FROM app_state WHERE id = 1").fetchone()
        if not row:
            return deepcopy(DEFAULT_DATA)
        data = json.loads(row["data"])
        return self._normalize_data_shape(data)

    def _write_state(self, connection: sqlite3.Connection, data: dict):
        connection.execute(
            "INSERT OR REPLACE INTO app_state (id, data) VALUES (1, ?)",
            (json.dumps(data),),
        )
        connection.commit()

    def read_data(self) -> dict:
        with self._lock, self._connect() as connection:
            return deepcopy(self._read_state(connection))

    def update(self, updater):
        with self._lock, self._connect() as connection:
            data = self._read_state(connection)
            result = updater(data)
            self._write_state(connection, data)
            return result

    def _read_messages_row(self, connection: sqlite3.Connection, table: str, key: str, value: str) -> list[dict]:
        row = connection.execute(
            f"SELECT messages FROM {table} WHERE {key} = ?",
            (value,),
        ).fetchone()
        if not row:
            return []
        return json.loads(row["messages"])

    def read_chat_messages(self, server_id: str) -> list[dict]:
        with self._lock, self._connect() as connection:
            messages = self._read_messages_row(connection, "server_messages", "server_id", server_id)
            if self._ensure_message_ids(messages):
                connection.execute(
                    "INSERT OR REPLACE INTO server_messages (server_id, messages) VALUES (?, ?)",
                    (server_id, json.dumps(messages)),
                )
                connection.commit()
            return messages

    def write_chat_messages(self, server_id: str, messages: list[dict]):
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO server_messages (server_id, messages) VALUES (?, ?)",
                (server_id, json.dumps(messages)),
            )
            connection.commit()

    def append_chat_message(self, server_id: str, message: dict, max_messages: int = 100):
        with self._lock, self._connect() as connection:
            messages = self._read_messages_row(connection, "server_messages", "server_id", server_id)
            messages.append(message)
            messages = messages[-max_messages:]
            connection.execute(
                "INSERT OR REPLACE INTO server_messages (server_id, messages) VALUES (?, ?)",
                (server_id, json.dumps(messages)),
            )
            connection.commit()

    def update_chat_message(self, server_id: str, message_id: str, updater) -> dict | None:
        with self._lock, self._connect() as connection:
            messages = self._read_messages_row(connection, "server_messages", "server_id", server_id)
            for index in range(len(messages) - 1, -1, -1):
                message = messages[index]
                if message.get("message_id") != message_id:
                    continue
                if updater(message) is False:
                    return None
                messages[index] = message
                connection.execute(
                    "INSERT OR REPLACE INTO server_messages (server_id, messages) VALUES (?, ?)",
                    (server_id, json.dumps(messages)),
                )
                connection.commit()
                return deepcopy(message)
        return None

    def read_direct_messages(self, conversation_id: str) -> list[dict]:
        with self._lock, self._connect() as connection:
            messages = self._read_messages_row(connection, "direct_messages", "conversation_id", conversation_id)
            if self._ensure_message_ids(messages):
                connection.execute(
                    "INSERT OR REPLACE INTO direct_messages (conversation_id, messages) VALUES (?, ?)",
                    (conversation_id, json.dumps(messages)),
                )
                connection.commit()
            return messages

    def append_direct_message(self, conversation_id: str, message: dict, max_messages: int = 200):
        with self._lock, self._connect() as connection:
            messages = self._read_messages_row(connection, "direct_messages", "conversation_id", conversation_id)
            messages.append(message)
            messages = messages[-max_messages:]
            connection.execute(
                "INSERT OR REPLACE INTO direct_messages (conversation_id, messages) VALUES (?, ?)",
                (conversation_id, json.dumps(messages)),
            )
            connection.commit()

    def update_direct_message(self, conversation_id: str, message_id: str, updater) -> dict | None:
        with self._lock, self._connect() as connection:
            messages = self._read_messages_row(connection, "direct_messages", "conversation_id", conversation_id)
            for index in range(len(messages) - 1, -1, -1):
                message = messages[index]
                if message.get("message_id") != message_id:
                    continue
                if updater(message) is False:
                    return None
                messages[index] = message
                connection.execute(
                    "INSERT OR REPLACE INTO direct_messages (conversation_id, messages) VALUES (?, ?)",
                    (conversation_id, json.dumps(messages)),
                )
                connection.commit()
                return deepcopy(message)
        return None

    def save_json_document(self, filename: str, content: object) -> Path:
        safe_name = "".join(char for char in filename.strip() if char.isalnum() or char in {"-", "_", "."}).strip("._")
        if not safe_name:
            raise ValueError("Filename must contain at least one valid character.")
        if not safe_name.endswith(".json"):
            safe_name = f"{safe_name}.json"

        target = JSON_EXPORTS_DIR / safe_name
        with self._lock:
            with target.open("w", encoding="utf-8") as file:
                json.dump(content, file, indent=2, ensure_ascii=False)
        return target

    def _kind_from_mime(self, mime_type: str) -> str:
        if mime_type.startswith("image/"):
            return "image"
        if mime_type.startswith("audio/"):
            return "audio"
        return "file"

    def _build_media_target(self, filename: str, *, category: str) -> dict:
        safe_name = "".join(char for char in filename.strip() if char.isalnum() or char in {"-", "_", "."}).strip("._")
        if not safe_name:
            safe_name = "upload"
        extension = Path(safe_name).suffix.lower()
        category_dir = AVATARS_DIR if category == "avatars" else ATTACHMENTS_DIR
        stored_name = f"{uuid4()}{extension}"
        target = category_dir / stored_name
        guessed_type = guess_type(target.name)[0] or "application/octet-stream"
        return {
            "name": filename,
            "stored_name": stored_name,
            "path": str(target),
            "url": f"/media/{category}/{stored_name}",
            "content_type": guessed_type,
            "kind": self._kind_from_mime(guessed_type),
        }

    def reserve_media_target(self, filename: str, *, category: str) -> dict:
        return self._build_media_target(filename, category=category)

    def save_media_file(self, filename: str, data: bytes, *, category: str) -> dict:
        meta = self._build_media_target(filename, category=category)
        target = Path(meta["path"])
        with self._lock:
            target.write_bytes(data)
        meta["size"] = len(data)
        return meta

    def convert_audio_to_mp3(self, meta: dict) -> dict:
        if not isinstance(meta, dict):
            return meta
        if meta.get("kind") != "audio":
            return meta
        if meta.get("content_type") == "audio/mpeg":
            return meta
        if shutil.which("ffmpeg") is None:
            return meta

        input_path = Path(meta.get("path", ""))
        if not input_path.exists():
            return meta

        output_name = f"{uuid4()}.mp3"
        output_path = ATTACHMENTS_DIR / output_name
        command = [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "4",
            str(output_path),
        ]
        try:
            subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            output_path.unlink(missing_ok=True)
            return meta

        input_path.unlink(missing_ok=True)
        name = Path(str(meta.get("name") or "audio")).stem + ".mp3"
        return {
            "name": name,
            "stored_name": output_name,
            "path": str(output_path),
            "url": f"/media/attachments/{output_name}",
            "content_type": "audio/mpeg",
            "kind": "audio",
            "size": output_path.stat().st_size,
        }

    def delete_attachment_by_url(self, url: str) -> bool:
        if not isinstance(url, str) or not url.startswith("/media/attachments/"):
            return False
        stored_name = url.split("/media/attachments/", 1)[-1]
        if not stored_name:
            return False
        target = ATTACHMENTS_DIR / stored_name
        if not target.exists():
            return False
        try:
            target.unlink(missing_ok=True)
        except OSError:
            return False
        return True

    def reset_runtime_data(self):
        with self._lock, self._connect() as connection:
            self._write_state(connection, deepcopy(DEFAULT_DATA))
            connection.execute("DELETE FROM server_messages")
            connection.execute("DELETE FROM direct_messages")
            connection.commit()
            for directory in (CHATS_DIR, DIRECT_MESSAGES_DIR, JSON_EXPORTS_DIR, AVATARS_DIR, ATTACHMENTS_DIR):
                for path in directory.iterdir():
                    if path.is_file():
                        path.unlink()

    def purge_expired_attachments(self, *, max_age_days: int = ATTACHMENT_RETENTION_DAYS):
        cutoff = datetime.now(UTC) - timedelta(days=max_age_days)
        with self._lock:
            expired_urls = set()
            for path in ATTACHMENTS_DIR.iterdir():
                if not path.is_file():
                    continue
                modified_at = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
                if modified_at >= cutoff:
                    continue
                expired_urls.add(f"/media/attachments/{path.name}")
                path.unlink(missing_ok=True)

            if not expired_urls:
                return

            with self._connect() as connection:
                for table, key in (("server_messages", "server_id"), ("direct_messages", "conversation_id")):
                    rows = connection.execute(f"SELECT {key}, messages FROM {table}").fetchall()
                    for row in rows:
                        messages = json.loads(row["messages"])
                        changed = False
                        for message in messages:
                            attachments = []
                            attachment = message.get("attachment")
                            if isinstance(attachment, dict):
                                attachments = [attachment]
                            elif isinstance(message.get("attachments"), list):
                                attachments = [item for item in message.get("attachments") if isinstance(item, dict)]

                            if not attachments:
                                continue

                            kept = [item for item in attachments if item.get("url") not in expired_urls]
                            if kept == attachments:
                                continue

                            changed = True
                            if "attachments" in message:
                                message["attachments"] = kept
                                if not kept:
                                    message.pop("attachments", None)
                            if "attachment" in message:
                                if kept:
                                    message["attachment"] = kept[0]
                                else:
                                    message.pop("attachment", None)
                        if changed:
                            connection.execute(
                                f"UPDATE {table} SET messages = ? WHERE {key} = ?",
                                (json.dumps(messages), row[key]),
                            )
                connection.commit()

    def _ensure_message_ids(self, messages: list[dict]) -> bool:
        changed = False
        for message in messages:
            if message.get("type") != "message":
                continue
            if message.get("message_id"):
                continue
            message["message_id"] = str(uuid4())
            changed = True
        return changed


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


store = DataStore()
