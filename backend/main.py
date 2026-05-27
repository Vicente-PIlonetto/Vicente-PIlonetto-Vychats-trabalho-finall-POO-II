from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

try:
    from backend.routes.api import router as api_router
    from backend.routes.websocket import router as websocket_router
    from backend.storage import MEDIA_DIR
except ModuleNotFoundError:
    from routes.api import router as api_router
    from routes.websocket import router as websocket_router
    from storage import MEDIA_DIR


BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Encrypted Chat Server")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.middleware("http")
async def disable_cache(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith(("/login", "/servers", "/chat", "/dms", "/friends", "/dm-users", "/settings", "/static/")):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.get("/")
def home():
    return RedirectResponse(url="/login")


@app.get("/login")
def login_page():
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/servers")
def servers_page():
    return FileResponse(FRONTEND_DIR / "servers.html")


@app.get("/chat")
def chat_page():
    return FileResponse(FRONTEND_DIR / "chat.html")


@app.get("/dms")
def dms_page():
    return FileResponse(FRONTEND_DIR / "dms.html")


@app.get("/friends")
def friends_page():
    return FileResponse(FRONTEND_DIR / "friends.html")


@app.get("/dm-users")
def dm_users_page():
    return FileResponse(FRONTEND_DIR / "dm-users.html")


@app.get("/settings")
def settings_page():
    return FileResponse(FRONTEND_DIR / "settings.html")


@app.get("/health")
def health_check():
    return {"status": "Chat server running"}


app.include_router(websocket_router)
app.include_router(api_router)
