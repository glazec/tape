"""Short lived meeting audio on the single MCP replica's persistent volume."""

import asyncio
import base64
import hashlib
import hmac
import io
import os
from pathlib import Path
import sqlite3
import time
from uuid import UUID
import weakref
import zlib

import soundfile
import httpx
from starlette.websockets import WebSocket, WebSocketDisconnect

RATE = 16_000
BATCH_SAMPLES = RATE * 300
LOCKS = weakref.WeakValueDictionary()


def directory():
    return Path(os.getenv("RAILWAY_VOLUME_MOUNT_PATH", ".")) / "ongoing_audio"


def source_file(kind, identifier):
    return directory() / f"{kind}_{UUID(identifier)}.sqlite"


def connect(path):
    db = sqlite3.connect(path, timeout=10.0)
    db.execute("pragma busy_timeout=10000")
    db.execute("pragma journal_mode=wal")
    db.execute("pragma synchronous=normal")
    return db


def initialize(db):
    db.executescript("""
        create table if not exists frames(
            recording text, sample integer, length integer, audio blob,
            primary key(recording, sample));
        create index if not exists pending_frames on frames(recording,sample) where audio is not null;
        create table if not exists excerpts(
            recording text, start integer, stop integer, text text,
            primary key(recording, start));
    """)


def authorized(query):
    secret = os.getenv("TAPE_AUDIO_SIGNING_SECRET")
    if not secret:
        return False
    scope, nonce = query.get("scope", ""), query.get("nonce", "")
    try:
        UUID(nonce)
        if scope != "bot":
            UUID(scope)
    except ValueError:
        return False
    signature = hmac.new(secret.encode(), f"v1:{scope}:{nonce}".encode(), hashlib.sha256)
    return hmac.compare_digest(signature.hexdigest(), query.get("signature", ""))


async def receive_audio(socket: WebSocket):
    if not authorized(socket.query_params):
        await socket.close(code=1008)
        return
    await socket.accept()
    db = None
    source = None
    try:
        while True:
            event = await socket.receive_json()
            if event.get("event") != "audio_mixed_raw.data":
                continue
            envelope = event["data"]
            recording = str(UUID(envelope["recording"]["id"]))
            scope = socket.query_params["scope"]
            path = (source_file("bot", envelope["bot"]["id"]) if scope == "bot"
                    else source_file("meeting", scope))
            if db is None:
                path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                db = connect(path)
                initialize(db)
                source = path
                OPEN_SOURCES[path] = OPEN_SOURCES.get(path, 0) + 1
            if path != source:
                raise ValueError("Unexpected source change")
            packet = envelope["data"]
            sample = round(float(packet["timestamp"]["relative"]) * RATE)
            pcm = base64.b64decode(packet["buffer"], validate=True)
            if sample < 0 or len(pcm) % 2 or len(pcm) > RATE * 20:
                raise ValueError("Invalid audio frame")
            if pcm:
                with db:
                    db.execute("insert or ignore into frames values(?,?,?,?)",
                        (recording, sample, len(pcm)//2, zlib.compress(pcm, 1)))
    except WebSocketDisconnect:
        pass
    except (KeyError, TypeError, ValueError, OverflowError):
        await socket.close(code=1008)
    finally:
        if db:
            db.close()
            if source:
                OPEN_SOURCES[source] -= 1
                if not OPEN_SOURCES[source]:
                    del OPEN_SOURCES[source]


def encode_flac(pcm):
    stream = io.BytesIO()
    with soundfile.SoundFile(stream, "w", samplerate=RATE, channels=1,
                             format="FLAC", subtype="PCM_16") as file:
        file.buffer_write(pcm, dtype="int16")
    return stream.getvalue()


async def transcribe(pcm):
    compressed = await asyncio.to_thread(encode_flac, pcm)
    async with httpx.AsyncClient(timeout=90) as client:
        result = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": "Bearer " + os.environ["GROQ_API_KEY"]},
            files={"file": ("meeting.flac", compressed, "audio/flac")},
            data={"model": "whisper-large-v3-turbo", "response_format": "json"},
        )
        result.raise_for_status()
        return result.json()["text"].strip()


async def snapshot(path):
    # One replica owns this volume. Concurrent callers share each successful batch.
    lock = LOCKS.setdefault(path, asyncio.Lock())
    async with lock:
        if not path.exists():
            return []
        db = connect(path)
        try:
            cutoff = db.execute("select max(rowid) from frames").fetchone()[0] or 0
            position = ("", -1)
            while True:
                pending = []
                for _ in range(3):
                    first = db.execute("""select recording,sample from frames where
                        audio is not null and rowid<=? and (recording,sample)>(?,?)
                        order by recording,sample limit 1""", (cutoff, *position)).fetchone()
                    if not first:
                        break
                    recording, start = first
                    pcm = bytearray()
                    stop = start
                    for sample, length, audio in db.execute("""select sample,length,audio from frames
                        where recording=? and sample>=? and sample<? and rowid<=?
                        order by sample""", (recording, start, start+BATCH_SAMPLES, cutoff)):
                        if audio is None or sample > stop + RATE//4:
                            break
                        pcm.extend(bytes(max(0, sample-stop)*2))
                        pcm.extend(zlib.decompress(audio)[max(0, stop-sample)*2:])
                        stop = max(stop, sample+length)
                        position = (recording, sample)
                    pending.append((recording, start, stop, position[1], pcm))
                if not pending:
                    break
                results = await asyncio.gather(*(
                    transcribe(pcm) if any(pcm) else asyncio.sleep(0, result="")
                    for _, _, _, _, pcm in pending
                ), return_exceptions=True)
                # Save successful siblings even when another provider request needs retrying.
                with db:
                    for (recording, start, stop, last, _), text in zip(pending, results):
                        if isinstance(text, BaseException):
                            continue
                        db.execute("insert or replace into excerpts values(?,?,?,?)", (recording,start,stop,text))
                        db.execute("""update frames set audio=null where recording=? and
                            sample between ? and ? and rowid<=?""", (recording,start,last,cutoff))
                for result in results:
                    if isinstance(result, BaseException):
                        raise result
            return [{"recording_id": rec, "start_ms": round(start*1000/RATE),
                     "end_ms": round(stop*1000/RATE), "text": text}
                    for rec,start,stop,text in db.execute(
                        "select recording,start,stop,text from excerpts order by recording,start")]
        finally:
            db.close()


def expire_buffers():
    for path in directory().glob("*.sqlite"):
        wal = Path(str(path) + "-wal")
        mtimes = []
        for candidate in (path, wal):
            try:
                mtimes.append(candidate.stat().st_mtime)
            except FileNotFoundError:
                continue
        if not mtimes:
            continue
        newest = max(mtimes)
        if time.time() - newest > 7200 and path not in LOCKS and path not in OPEN_SOURCES:
            for suffix in ("-shm", "-wal", ""):
                Path(str(path) + suffix).unlink(missing_ok=True)


OPEN_SOURCES = {}
