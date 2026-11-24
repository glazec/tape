import asyncio
import base64
import hashlib
import hmac
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from starlette.websockets import WebSocketDisconnect

import ongoing_audio as audio


class AudioTest(unittest.IsolatedAsyncioTestCase):
    async def test_capture_auth_retries_and_incremental_snapshot(self):
        with tempfile.TemporaryDirectory() as root, patch.dict("os.environ", {
            "RAILWAY_VOLUME_MOUNT_PATH": root, "TAPE_AUDIO_SIGNING_SECRET": "secret",
        }):
            scope, nonce, recording = map(str, (uuid4(), uuid4(), uuid4()))
            socket = AsyncMock()
            socket.query_params = {"scope": scope, "nonce": nonce, "signature": "bad"}
            await audio.receive_audio(socket)
            socket.accept.assert_not_awaited()
            socket.query_params["signature"] = hmac.new(
                b"secret", f"v1:{scope}:{nonce}".encode(), hashlib.sha256).hexdigest()

            def packet(t):
                return {"event": "audio_mixed_raw.data", "data": {"recording": {"id": recording},
                        "data": {"timestamp": {"relative": t},
                                 "buffer": base64.b64encode(b"ab"*3200).decode()}}}

            async def send(*timestamps):
                socket.receive_json.side_effect = [*(packet(t) for t in timestamps),
                                                   WebSocketDisconnect()]
                await audio.receive_audio(socket)

            await send(0, 0, .2)
            path = audio.source_file("meeting", scope)
            with patch.object(audio, "transcribe", AsyncMock(side_effect=[
                RuntimeError("busy"), "one", "two"])) as call:
                with self.assertRaises(RuntimeError):
                    await audio.snapshot(path)
                first, repeated = await asyncio.gather(audio.snapshot(path), audio.snapshot(path))
                self.assertEqual(first, repeated)
                self.assertEqual(first[0]["end_ms"], 400)
                await send(.2, .4)
                second = await audio.snapshot(path)
                self.assertEqual([part["text"] for part in second], ["one", "two"])
                self.assertEqual(len(call.await_args.args[0]), 6400)
                self.assertEqual(call.await_count, 3)
            self.assertTrue(path.is_relative_to(Path(root)))

    async def test_expire_buffers_ignores_vanished_wal_files(self):
        with tempfile.TemporaryDirectory() as root, patch.dict("os.environ", {
            "RAILWAY_VOLUME_MOUNT_PATH": root,
        }):
            audio_dir = audio.directory()
            audio_dir.mkdir(parents=True, exist_ok=True)
            db_path = audio_dir / f"meeting_{uuid4()}.sqlite"
            db_path.write_bytes(b"")
            original_stat = Path.stat

            def flaky_stat(self, *args, **kwargs):
                if str(self).endswith("-wal"):
                    raise FileNotFoundError(str(self))
                return original_stat(self, *args, **kwargs)

            with patch.object(Path, "stat", flaky_stat):
                audio.expire_buffers()
            self.assertTrue(db_path.exists())
