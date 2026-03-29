"""
Loads curriculum documents from the /data folder.

Supported formats: .txt, .md
Drop files into /data — they are picked up automatically, no code changes needed.

Each file is split into chunks of roughly CHUNK_WORDS words so that a random
chunk can be passed as context to Claude when generating a doc-based exercise.
"""

import os
import random

DATA_DIR  = os.path.join(os.path.dirname(__file__), "data")
CHUNK_WORDS = 200  # target words per chunk fed to Claude as context


def _chunk(text: str, size: int) -> list[str]:
    words  = text.split()
    return [" ".join(words[i:i + size]) for i in range(0, len(words), size) if words[i:i + size]]


def load_docs() -> list[dict]:
    """Return a list of {filename, label, chunks} dicts for every doc in /data."""
    docs = []
    if not os.path.isdir(DATA_DIR):
        return docs
    for fname in sorted(os.listdir(DATA_DIR)):
        if not fname.endswith((".txt", ".md")):
            continue
        path = os.path.join(DATA_DIR, fname)
        try:
            text = open(path, encoding="utf-8").read().strip()
        except Exception:
            continue
        if not text:
            continue
        label  = os.path.splitext(fname)[0].replace("_", " ").replace("-", " ")
        chunks = _chunk(text, CHUNK_WORDS)
        if chunks:
            docs.append({"filename": fname, "label": label, "chunks": chunks})
    return docs


def docs_available() -> bool:
    return bool(load_docs())


def random_chunk() -> dict | None:
    """Pick a random chunk from a random doc. Returns {label, chunk} or None."""
    docs = load_docs()
    if not docs:
        return None
    doc   = random.choice(docs)
    chunk = random.choice(doc["chunks"])
    return {"label": doc["label"], "chunk": chunk}
