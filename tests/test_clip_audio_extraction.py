import os
import subprocess
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app
from backend.config import TEMP_DIR, EXPORTS_DIR
from backend.routers.media import resolve_media_source_path


class TestClipAudioExtraction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.test_mp4 = TEMP_DIR / "test_audio_sample.mp4"
        # Generate a 2-second test MP4 with AAC stereo audio and video using ffmpeg
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", "sine=frequency=1000:duration=2",
            "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k",
            str(cls.test_mp4)
        ]
        try:
            subprocess.run(cmd, check=True, timeout=10)
        except Exception as e:
            raise unittest.SkipTest(f"FFmpeg not available to generate test media: {e}")

    @classmethod
    def tearDownClass(cls):
        if cls.test_mp4.exists():
            try:
                cls.test_mp4.unlink()
            except Exception:
                pass

    def test_resolve_media_source_path(self):
        # Direct filename
        resolved = resolve_media_source_path("test_audio_sample.mp4")
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.resolve(), self.test_mp4.resolve())

        # Relative /api/download-rendered/ path
        resolved2 = resolve_media_source_path("/api/download-rendered/test_audio_sample.mp4?title=Sample")
        self.assertIsNotNone(resolved2)
        self.assertEqual(resolved2.resolve(), self.test_mp4.resolve())

        # Relative /api/video/ path
        resolved3 = resolve_media_source_path("/api/video/test_audio_sample.mp4")
        self.assertIsNotNone(resolved3)
        self.assertEqual(resolved3.resolve(), self.test_mp4.resolve())

        # Full URL
        resolved4 = resolve_media_source_path("http://localhost:8000/api/download-rendered/test_audio_sample.mp4")
        self.assertIsNotNone(resolved4)
        self.assertEqual(resolved4.resolve(), self.test_mp4.resolve())

    def test_clip_audio_endpoint_success(self):
        # Query with source_url
        res = self.client.get(
            f"/api/clip-audio?source_url=/api/download-rendered/test_audio_sample.mp4&start_time=0&duration=1"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "audio/wav")
        # Standard WAV header starts with "RIFF" and contains "WAVE"
        self.assertTrue(res.content.startswith(b"RIFF"))
        self.assertIn(b"WAVE", res.content[:16])
        self.assertGreater(len(res.content), 1000)

    def test_clip_audio_endpoint_not_found(self):
        res = self.client.get("/api/clip-audio?source_url=non_existent_clip_12345.mp4")
        self.assertEqual(res.status_code, 404)

    def test_clip_audio_endpoint_missing_params(self):
        res = self.client.get("/api/clip-audio")
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main()
