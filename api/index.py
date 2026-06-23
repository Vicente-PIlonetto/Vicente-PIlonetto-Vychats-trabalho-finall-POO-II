import os


if os.getenv("VERCEL"):
    os.environ.setdefault("CIPHERLINE_DATA_DIR", "/tmp/cipherline")

from backend.main import app
