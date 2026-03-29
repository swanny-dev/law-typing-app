import sqlite3
from datetime import datetime  # fallback for local dev

import os
DB_PATH = os.getenv("DB_PATH", "progress.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            wpm REAL NOT NULL,
            accuracy REAL NOT NULL,
            topic TEXT NOT NULL,
            mistakes INTEGER NOT NULL DEFAULT 0
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS key_errors (
            key TEXT NOT NULL,
            device_id TEXT NOT NULL DEFAULT '',
            count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (key, device_id)
        )
    """)
    # migrate existing databases
    for migration in [
        "ALTER TABLE sessions ADD COLUMN mistakes INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE sessions ADD COLUMN ip TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE sessions ADD COLUMN device_id TEXT NOT NULL DEFAULT ''",
    ]:
        try:
            conn.execute(migration)
        except Exception:
            pass
    conn.commit()
    conn.close()


def save_session(wpm: float, accuracy: float, topic: str, mistakes: int, date: str = "", ip: str = "", device_id: str = ""):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO sessions (date, wpm, accuracy, topic, mistakes, ip, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (date or datetime.now().strftime("%d %b %Y, %H:%M"), round(wpm), round(accuracy), topic, mistakes, ip, device_id),
    )
    conn.commit()
    conn.close()


def save_key_errors(errors: dict, device_id: str = ""):
    conn = sqlite3.connect(DB_PATH)
    for key, count in errors.items():
        conn.execute("INSERT OR IGNORE INTO key_errors (key, device_id, count) VALUES (?, ?, 0)", (key, device_id))
        conn.execute("UPDATE key_errors SET count = count + ? WHERE key = ? AND device_id = ?", (count, key, device_id))
    conn.commit()
    conn.close()


def get_sessions(device_id: str = "") -> list:
    conn = sqlite3.connect(DB_PATH)
    if device_id:
        rows = conn.execute(
            "SELECT id, date, wpm, accuracy, topic, mistakes FROM sessions WHERE device_id = ? ORDER BY id DESC LIMIT 50",
            (device_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, date, wpm, accuracy, topic, mistakes FROM sessions ORDER BY id DESC LIMIT 50"
        ).fetchall()
    conn.close()
    return [{"id": r[0], "date": r[1], "wpm": r[2], "accuracy": r[3], "topic": r[4], "mistakes": r[5]} for r in rows]


def delete_session(session_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()


def get_key_errors(device_id: str = "") -> dict:
    conn = sqlite3.connect(DB_PATH)
    if device_id:
        rows = conn.execute(
            "SELECT key, count FROM key_errors WHERE device_id = ? ORDER BY count DESC", (device_id,)
        ).fetchall()
    else:
        rows = conn.execute("SELECT key, count FROM key_errors ORDER BY count DESC").fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


def get_admin_sessions() -> list:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, date, wpm, accuracy, topic, mistakes, ip FROM sessions ORDER BY id DESC LIMIT 100"
    ).fetchall()
    conn.close()
    return [{"id": r[0], "date": r[1], "wpm": r[2], "accuracy": r[3], "topic": r[4], "mistakes": r[5], "ip": r[6]} for r in rows]


def get_bests(device_id: str = "") -> dict:
    conn = sqlite3.connect(DB_PATH)
    if device_id:
        row = conn.execute("SELECT MAX(wpm), MIN(mistakes) FROM sessions WHERE device_id = ?", (device_id,)).fetchone()
    else:
        row = conn.execute("SELECT MAX(wpm), MIN(mistakes) FROM sessions").fetchone()
    conn.close()
    return {"best_wpm": row[0] or 0, "fewest_mistakes": row[1]}
