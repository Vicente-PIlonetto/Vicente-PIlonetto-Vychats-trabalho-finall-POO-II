import base64
import math


LEGACY_FAKE_SYMBOLS = {"#", "@", "%", "&", "*", "!"}
DEFAULT_NOISE_SYMBOL = "#"
DEFAULT_NOISE_INTERVAL = 4
def validate_noise_symbol(noise_symbol: str):
    if not noise_symbol or len(noise_symbol) != 1:
        raise ValueError("The noise symbol must be a single character.")
    if noise_symbol == "\0":
        raise ValueError("The noise symbol cannot be the null character.")


def xor_bytes(data: bytes, key: str) -> bytes:
    if not key:
        raise ValueError("The key cannot be empty.")
    key_bytes = key.encode("utf-8")
    result = bytearray()

    for index, byte in enumerate(data):
        result.append(byte ^ key_bytes[index % len(key_bytes)])

    return bytes(result)


def text_to_base64_with_xor(text: str, key: str) -> str:
    data = text.encode("utf-8")
    encrypted = xor_bytes(data, key)
    return base64.b64encode(encrypted).decode("ascii")


def base64_to_text_with_xor(base64_text: str, key: str) -> str:
    try:
        encrypted_data = base64.b64decode(base64_text.encode("ascii"))
    except Exception as exc:
        raise ValueError(f"Invalid Base64 payload: {exc}") from exc

    decrypted = xor_bytes(encrypted_data, key)

    try:
        return decrypted.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(
            "Failed to decode the text. The key may be incorrect or the data may be corrupted."
        ) from exc


def create_3xn_grid(text: str) -> tuple[list[list[str]], int, int]:
    rows = 3
    columns = math.ceil(len(text) / rows) if text else 1
    grid = [["" for _ in range(columns)] for _ in range(rows)]

    index = 0
    for row in range(rows):
        for column in range(columns):
            if index < len(text):
                grid[row][column] = text[index]
                index += 1
            else:
                grid[row][column] = "\0"

    return grid, rows, columns


def read_grid_diagonally(
    grid: list[list[str]],
    rows: int,
    columns: int,
    real_length: int | None = None,
) -> str:
    result = []

    for diagonal_sum in range(rows + columns - 1):
        for row in range(rows):
            column = diagonal_sum - row
            if 0 <= column < columns:
                if real_length is not None and (row * columns + column) >= real_length:
                    continue
                result.append(grid[row][column])

    return "".join(result)


def rebuild_grid_from_diagonal(
    diagonal_text: str,
    rows: int,
    columns: int,
    real_length: int | None = None,
) -> list[list[str]]:
    grid = [["\0" if real_length is not None else "" for _ in range(columns)] for _ in range(rows)]
    index = 0

    for diagonal_sum in range(rows + columns - 1):
        for row in range(rows):
            column = diagonal_sum - row
            if 0 <= column < columns:
                if real_length is not None and (row * columns + column) >= real_length:
                    continue
                if index < len(diagonal_text):
                    grid[row][column] = diagonal_text[index]
                    index += 1

    return grid


def read_grid_by_rows(grid: list[list[str]], rows: int, columns: int) -> str:
    result = []

    for row in range(rows):
        for column in range(columns):
            result.append(grid[row][column])

    return "".join(result)


def insert_noise_symbols(
    text: str,
    interval: int = DEFAULT_NOISE_INTERVAL,
    noise_symbol: str = DEFAULT_NOISE_SYMBOL,
) -> str:
    validate_noise_symbol(noise_symbol)
    if interval <= 0:
        raise ValueError("The interval must be greater than zero.")

    result = []
    counter = 0

    for char in text:
        result.append(char)
        counter += 1
        if counter == interval:
            result.append(noise_symbol)
            counter = 0

    return "".join(result)


def remove_legacy_noise_symbols(text: str) -> str:
    return "".join(char for char in text if char not in LEGACY_FAKE_SYMBOLS)


def remove_noise_by_interval(text: str, interval: int, noise_symbol: str) -> str:
    if interval <= 0:
        raise ValueError("Invalid interval in header. It must be greater than zero.")
    validate_noise_symbol(noise_symbol)

    result = []
    counter = 0

    for char in text:
        if counter == interval:
            if char != noise_symbol:
                raise ValueError(
                    "Invalid encoded text: noise is not in the expected pattern for the configured symbol."
                )
            counter = 0
            continue

        result.append(char)
        counter += 1

    if counter == interval:
        raise ValueError("Invalid encoded text: missing trailing noise marker.")

    return "".join(result)


def encode_message(
    text: str,
    key: str,
    noise_symbol: str = DEFAULT_NOISE_SYMBOL,
    interval: int = DEFAULT_NOISE_INTERVAL,
) -> str:
    base64_xor = text_to_base64_with_xor(text, key)
    real_length = len(base64_xor)
    grid, rows, columns = create_3xn_grid(base64_xor)
    diagonal = read_grid_diagonally(grid, rows, columns, real_length=real_length)
    with_noise = insert_noise_symbols(diagonal, interval=interval, noise_symbol=noise_symbol)

    return f"{columns}|{interval}|{ord(noise_symbol)}|{real_length}:{with_noise}"


def decode_message(encoded_text: str, key: str) -> str:
    if ":" not in encoded_text:
        raise ValueError(
            "Invalid format. Expected something like 'N:message', 'N|I|S:message' or 'N|I|S|T:message'."
        )

    header, payload = encoded_text.split(":", 1)
    rows = 3
    real_length = None

    if "|" in header:
        parts = header.split("|")
        if len(parts) not in {3, 4}:
            raise ValueError(
                "Invalid header. Use the format 'columns|interval|symbol' or 'columns|interval|symbol|length'."
            )

        try:
            columns = int(parts[0])
            interval = int(parts[1])
            symbol_codepoint = int(parts[2])
            noise_symbol = chr(symbol_codepoint)
            if len(parts) == 4:
                real_length = int(parts[3])
        except ValueError as exc:
            raise ValueError(
                "Invalid header. Columns, interval, symbol and length must be integers."
            ) from exc

        diagonal_without_noise = remove_noise_by_interval(payload, interval, noise_symbol)
    else:
        try:
            columns = int(header)
        except ValueError as exc:
            raise ValueError("Invalid header. The number of columns is not an integer.") from exc

        diagonal_without_noise = remove_legacy_noise_symbols(payload)

    if columns <= 0:
        raise ValueError("Invalid header. The number of columns must be greater than zero.")

    expected = rows * columns
    received_length = len(diagonal_without_noise)

    if real_length is None:
        if received_length == expected:
            grid = rebuild_grid_from_diagonal(diagonal_without_noise, rows, columns)
            text_with_padding = read_grid_by_rows(grid, rows, columns)
            base64_text = text_with_padding.replace("\0", "")
        elif expected - 2 <= received_length < expected:
            real_length = received_length
            grid = rebuild_grid_from_diagonal(
                diagonal_without_noise,
                rows,
                columns,
                real_length=real_length,
            )
            text_with_padding = read_grid_by_rows(grid, rows, columns)
            base64_text = text_with_padding.replace("\0", "")
        else:
            raise ValueError(
                f"Inconsistent length after noise removal. Expected {expected} characters, got {received_length}."
            )
    else:
        if real_length < 0 or real_length > expected:
            raise ValueError("Invalid header. The declared real length does not fit the grid.")
        if received_length != real_length:
            raise ValueError(
                f"Inconsistent length after noise removal. Expected {real_length} real characters, got {received_length}."
            )

        grid = rebuild_grid_from_diagonal(
            diagonal_without_noise,
            rows,
            columns,
            real_length=real_length,
        )
        text_with_padding = read_grid_by_rows(grid, rows, columns)
        base64_text = text_with_padding.replace("\0", "")

    return base64_to_text_with_xor(base64_text, key)


def encrypt_message(
    text: str,
    key: str,
    noise_symbol: str = DEFAULT_NOISE_SYMBOL,
    interval: int = DEFAULT_NOISE_INTERVAL,
) -> str:
    return encode_message(text, key, noise_symbol=noise_symbol, interval=interval)


def decrypt_message(encoded_text: str, key: str) -> str:
    return decode_message(encoded_text, key)
