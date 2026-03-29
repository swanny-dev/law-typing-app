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
            key TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0
        )
    """)
    # migrate existing databases that lack the mistakes column
    try:
        conn.execute("ALTER TABLE sessions ADD COLUMN mistakes INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass
    conn.commit()
    conn.close()


def save_session(wpm: float, accuracy: float, topic: str, mistakes: int, date: str = ""):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO sessions (date, wpm, accuracy, topic, mistakes) VALUES (?, ?, ?, ?, ?)",
        (date or datetime.now().strftime("%d %b %Y, %H:%M"), round(wpm), round(accuracy), topic, mistakes),
    )
    conn.commit()
    conn.close()


def save_key_errors(errors: dict):
    conn = sqlite3.connect(DB_PATH)
    for key, count in errors.items():
        conn.execute("INSERT OR IGNORE INTO key_errors (key, count) VALUES (?, 0)", (key,))
        conn.execute("UPDATE key_errors SET count = count + ? WHERE key = ?", (count, key))
    conn.commit()
    conn.close()


def get_sessions() -> list:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, date, wpm, accuracy, topic, mistakes FROM sessions ORDER BY id DESC LIMIT 30"
    ).fetchall()
    conn.close()
    return [{"id": r[0], "date": r[1], "wpm": r[2], "accuracy": r[3], "topic": r[4], "mistakes": r[5]} for r in rows]


def delete_session(session_id: int):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()


def get_key_errors() -> dict:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT key, count FROM key_errors ORDER BY count DESC").fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


def get_bests() -> dict:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT MAX(wpm), MIN(mistakes) FROM sessions").fetchone()
    conn.close()
    return {"best_wpm": row[0] or 0, "fewest_mistakes": row[1]}
