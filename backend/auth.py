import hashlib
import hmac
import os
import secrets
from base64 import b64decode, b64encode
from typing import Any, cast


PBKDF2_ITERATIONS = 120_000
SALT_BYTES = 16


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{PBKDF2_ITERATIONS}${b64encode(salt).decode()}${b64encode(digest).decode()}"


def verify_password(password: str, stored_hash: str) -> bool:
    iterations_str, salt_b64, digest_b64 = stored_hash.split("$", 2)
    iterations = int(iterations_str)
    salt = b64decode(salt_b64.encode())
    expected_digest = b64decode(digest_b64.encode())
    actual_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual_digest, expected_digest)


def create_session_token() -> str:
    return secrets.token_urlsafe(32)


def get_google_client_id() -> str:
    return os.getenv("GOOGLE_CLIENT_ID", "").strip()


def verify_google_identity_token(token: str) -> dict[str, Any]:
    client_id = get_google_client_id()
    if not client_id:
        raise ValueError("Google authentication is not configured.")
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token
    except ModuleNotFoundError as error:
        raise ValueError("google-auth is not installed on the server.") from error
    payload = google_id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
    return cast(dict[str, Any], payload)
