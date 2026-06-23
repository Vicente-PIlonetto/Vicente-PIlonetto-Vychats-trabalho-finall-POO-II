import json
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from shutil import which
from pathlib import Path
import re

import uvicorn


from dotenv import load_dotenv

load_dotenv()

DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 8000,
    "browser_host": "127.0.0.1",
    "open_browser": True,
    "data_dir": "",
}

_FUNNEL_PROCESS = None
_FUNNEL_URL_CACHE = ""


def get_runtime_dir() -> Path:
    if getattr(sys, "frozen", False):
        appdata = os.getenv("APPDATA")
        base_dir = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
        return base_dir / "Cipherline"
    return Path(__file__).resolve().parent / "backend" / "data"


CONFIG_DIR = get_runtime_dir()
CONFIG_FILE = CONFIG_DIR / "launcher_config.json"
DEFAULT_STORE = {
    "users": [],
    "servers": [],
    "sessions": [],
    "friends": {},
    "friend_requests": [],
    "friend_invites": [],
}


def load_config() -> dict:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not CONFIG_FILE.exists():
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()

    try:
        with CONFIG_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
    except (json.JSONDecodeError, OSError):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()

    config = DEFAULT_CONFIG.copy()
    config.update({key: value for key, value in data.items() if key in DEFAULT_CONFIG})
    return config


def save_config(config: dict):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with CONFIG_FILE.open("w", encoding="utf-8") as file:
        json.dump(config, file, indent=2)


def get_data_dir(config: dict) -> Path:
    override = config["data_dir"].strip()
    if override:
        return Path(override).expanduser().resolve()
    return get_runtime_dir()


def ensure_runtime_storage(config: dict) -> Path:
    data_dir = get_data_dir(config)
    data_dir.mkdir(parents=True, exist_ok=True)

    for path in (
        data_dir / "chats",
        data_dir / "direct_messages",
        data_dir / "json_exports",
        data_dir / "media",
        data_dir / "media" / "avatars",
        data_dir / "media" / "attachments",
    ):
        path.mkdir(parents=True, exist_ok=True)

    store_file = data_dir / "store.json"
    if not store_file.exists():
        with store_file.open("w", encoding="utf-8") as file:
            json.dump(DEFAULT_STORE, file, indent=2)

    return data_dir


def reset_runtime_storage(config: dict):
    data_dir = get_data_dir(config)
    print("This will delete all local data for VyChat.")
    print(f"Data dir: {data_dir}")
    confirm = input('Type "RESET" to confirm: ').strip()
    if confirm != "RESET":
        print("Reset cancelled.")
        input("Press Enter to return to the menu...")
        return

    for path in (
        data_dir / "chats",
        data_dir / "direct_messages",
        data_dir / "json_exports",
        data_dir / "media",
    ):
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)

    for file_path in (
        data_dir / "store.json",
        data_dir / "cipherline.db",
    ):
        if file_path.exists():
            try:
                file_path.unlink()
            except OSError:
                pass

    ensure_runtime_storage(config)
    print("Data reset complete.")
    input("Press Enter to return to the menu...")


def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


def prompt_text(label: str, current: str) -> str:
    value = input(f"{label} [{current}]: ").strip()
    return value or current


def prompt_port(current: int) -> int:
    while True:
        raw = input(f"Port [{current}]: ").strip()
        if not raw:
            return current
        try:
            port = int(raw)
        except ValueError:
            print("Invalid port. Use an integer.")
            continue
        if 1 <= port <= 65535:
            return port
        print("Port must be between 1 and 65535.")


def prompt_yes_no(label: str, current: bool) -> bool:
    current_label = "Y/n" if current else "y/N"
    raw = input(f"{label} [{current_label}]: ").strip().lower()
    if not raw:
        return current
    return raw in {"y", "yes", "1", "true"}


def build_browser_url(config: dict) -> str:
    host = config["browser_host"].strip() or config["host"].strip()
    return f"http://{host}:{config['port']}/login"


def get_tailscale_funnel_url() -> str:
    try:
        result = subprocess.run(
            ["tailscale", "funnel", "status", "--json"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return ""

    if result.returncode != 0 or not result.stdout.strip():
        return ""

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return ""

    if isinstance(payload, dict):
        for key in ("URL", "url"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        for key in ("Funnel", "funnel", "Services", "services"):
            items = payload.get(key)
            url = _extract_funnel_url(items)
            if url:
                return url

    return ""


def _extract_funnel_url(value) -> str:
    if isinstance(value, str):
        return value.strip() if value.startswith("https://") else ""
    if isinstance(value, dict):
        for key in ("URL", "url", "HTTPS", "https"):
            nested = value.get(key)
            url = _extract_funnel_url(nested)
            if url:
                return url
        for nested in value.values():
            url = _extract_funnel_url(nested)
            if url:
                return url
    if isinstance(value, list):
        for item in value:
            url = _extract_funnel_url(item)
            if url:
                return url
    return ""


def get_tailscale_ipv4() -> str:
    try:
        result = subprocess.run(
            ["tailscale", "ip", "-4"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return ""

    if result.returncode != 0 or not result.stdout.strip():
        return ""

    for line in result.stdout.splitlines():
        value = line.strip()
        if value:
            return value

    return ""


def start_tailscale_funnel(port: int):
    if not which("tailscale"):
        print("Tailscale CLI not found in PATH.")
        print('Install Tailscale and make sure "tailscale" is available in the terminal.')
        input("Press Enter to return to the menu...")
        return

    try:
        global _FUNNEL_PROCESS, _FUNNEL_URL_CACHE
        if _FUNNEL_PROCESS and _FUNNEL_PROCESS.poll() is None:
            print("Tailscale Funnel is already running.")
        else:
            _FUNNEL_PROCESS = subprocess.Popen(
                ["tailscale", "funnel", f"127.0.0.1:{port}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            threading.Thread(target=_read_funnel_output, args=(_FUNNEL_PROCESS,), daemon=True).start()
            print("Tailscale Funnel started.")

        for _ in range(8):
            url = get_tailscale_funnel_url()
            if url:
                _FUNNEL_URL_CACHE = url
                print(f"Tailscale Funnel: {url}")
                break
            time.sleep(0.5)
    except OSError as error:
        print(f"Failed to start Tailscale Funnel: {error}")
    input("Press Enter to return to the menu...")


def _read_funnel_output(process: subprocess.Popen):
    global _FUNNEL_URL_CACHE
    if not process.stdout:
        return
    for line in process.stdout:
        line = line.strip()
        if line:
            print(line)
        match = re.search(r"https://\\S+", line)
        if match:
            _FUNNEL_URL_CACHE = match.group(0)


def open_browser(url: str):
    webbrowser.open(url)


def start_server(config: dict):
    try:
        from backend.main import app as asgi_app
    except ModuleNotFoundError as error:
        raise RuntimeError("Could not import backend.main. Run the launcher from the project root.") from error

    data_dir = ensure_runtime_storage(config)
    funnel_url = get_tailscale_funnel_url()

    if config["data_dir"].strip():
        os.environ["CIPHERLINE_DATA_DIR"] = config["data_dir"].strip()
    else:
        os.environ.pop("CIPHERLINE_DATA_DIR", None)

    if config["open_browser"]:
        threading.Timer(1.5, open_browser, args=(build_browser_url(config),)).start()

    clear_screen()
    print("Starting Cipherline server")
    print(f"Host: {config['host']}")
    print(f"Port: {config['port']}")
    print(f"Browser URL: {build_browser_url(config)}")
    print(f"Data dir: {data_dir}")
    if funnel_url:
        print(f"Tailscale Funnel: {funnel_url}")
    tailscale_ip = get_tailscale_ipv4()
    if tailscale_ip and config["host"].strip() in {"127.0.0.1", "localhost"}:
        print("Warning: Host is set to loopback. Tailscale devices will not reach the server.")
        print(f"Use Host/IP = 0.0.0.0 or {tailscale_ip} for tailnet access.")
    print()
    print("Press Ctrl+R to reload the server.")
    print("Press Ctrl+C to stop the server.")
    print()

    reload_event = threading.Event()
    stop_event = threading.Event()
    _start_funnel_monitor(stop_event)
    listener = threading.Thread(
        target=_listen_for_reload,
        args=(reload_event, stop_event),
        daemon=True,
    )
    listener.start()

    config_obj = uvicorn.Config(
        asgi_app,
        host=config["host"],
        port=config["port"],
        reload=False,
        ws="websockets",
    )

    try:
        while True:
            reload_requested = False
            server = uvicorn.Server(config_obj)
            server_thread = threading.Thread(target=server.run, daemon=True)
            server_thread.start()

            while server_thread.is_alive():
                if reload_event.is_set():
                    reload_event.clear()
                    reload_requested = True
                    print("\nReloading server...")
                    server.should_exit = True
                    break
                time.sleep(0.1)

            server_thread.join()

            if not reload_requested:
                break
    finally:
        stop_event.set()


def _start_funnel_monitor(stop_event: threading.Event):
    def monitor():
        last_url = ""
        for _ in range(120):
            if stop_event.is_set():
                return
            url = get_tailscale_funnel_url()
            if url and url != last_url:
                last_url = url
                print(f"Tailscale Funnel: {url}")
                return
            time.sleep(2)

    threading.Thread(target=monitor, daemon=True).start()


def _listen_for_reload(reload_event: threading.Event, stop_event: threading.Event):
    if os.name == "nt":
        import msvcrt

        while not stop_event.is_set():
            if msvcrt.kbhit():
                key = msvcrt.getwch()
                if key == "\x12":
                    reload_event.set()
            time.sleep(0.1)
        return

    import select
    import sys
    import termios
    import tty

    fd = sys.stdin.fileno()
    original = termios.tcgetattr(fd)
    try:
        tty.setcbreak(fd)
        while not stop_event.is_set():
            ready, _, _ = select.select([sys.stdin], [], [], 0.1)
            if ready:
                key = sys.stdin.read(1)
                if key == "\x12":
                    reload_event.set()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, original)


def render_menu(config: dict):
    clear_screen()
    funnel_url = _FUNNEL_URL_CACHE or get_tailscale_funnel_url()
    tailscale_ip = get_tailscale_ipv4()
    print("Cipherline Server Control")
    print("=" * 28)
    print(f"1. Start server")
    print(f"2. Host/IP ............ {config['host']}")
    print(f"3. Port ............... {config['port']}")
    print(f"4. Browser host ....... {config['browser_host']}")
    print(f"5. Open browser ....... {'Yes' if config['open_browser'] else 'No'}")
    print(f"6. Data dir override .. {config['data_dir'] or '(default)'}")
    print("7. Reset defaults")
    print("8. Start Tailscale Funnel")
    print("9. Reset data (delete all chats/users/media)")
    print("0. Exit")
    print()
    print(f"Config file: {CONFIG_FILE}")
    print(f"Tailscale IP ...... {tailscale_ip or '(not detected)'}")
    print(f"Tailscale Funnel .. {funnel_url or '(not active)'}")
    print()


def main():
    config = load_config()
    ensure_runtime_storage(config)

    while True:
        render_menu(config)
        try:
            # choice = input("Choose an option: ").strip()
            choice = "1"
        except (KeyboardInterrupt, EOFError):
            print("\nExiting Cipherline.")
            break

        if choice == "1":
            save_config(config)
            try:
                start_server(config)
            except KeyboardInterrupt:
                print("\nServer stopped.")
                input("Press Enter to return to the menu...")
            continue

        if choice == "2":
            config["host"] = prompt_text("Host/IP", config["host"])
            save_config(config)
            continue

        if choice == "3":
            config["port"] = prompt_port(config["port"])
            save_config(config)
            continue

        if choice == "4":
            config["browser_host"] = prompt_text("Browser host", config["browser_host"])
            save_config(config)
            continue

        if choice == "5":
            config["open_browser"] = prompt_yes_no("Open browser automatically", config["open_browser"])
            save_config(config)
            continue

        if choice == "6":
            value = input(f"Data dir override [{config['data_dir'] or '(default)'}]: ").strip()
            config["data_dir"] = value
            save_config(config)
            continue

        if choice == "7":
            config = DEFAULT_CONFIG.copy()
            save_config(config)
            continue

        if choice == "8":
            start_tailscale_funnel(config["port"])
            continue

        if choice == "9":
            reset_runtime_storage(config)
            continue

        if choice == "0":
            break


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nExiting Cipherline.")
