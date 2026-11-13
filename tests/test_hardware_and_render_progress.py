import unittest
import os
import subprocess
from pathlib import Path
from backend.video_engine import (
    detect_hardware_support,
    resolve_encoder,
    _run_ffmpeg_command_with_progress,
)


class TestHardwareAndRenderProgress(unittest.TestCase):
    def test_detect_hardware_support(self):
        support = detect_hardware_support()
        self.assertIn("nvenc", support)
        self.assertIn("amf", support)
        self.assertIn("qsv", support)
        self.assertIn("cpu", support)
        self.assertIn("recommended", support)
        self.assertIn("gpu_name", support)
        # On this machine, host has NVIDIA RTX 3060 Ti
        self.assertTrue(support["nvenc"])
        self.assertEqual(support["recommended"], "nvenc")
        self.assertIn("3060", support["gpu_name"])

    def test_resolve_encoder_auto(self):
        codec, args = resolve_encoder("auto")
        self.assertEqual(codec, "h264_nvenc")
        self.assertIn("h264_nvenc", args)

    def test_resolve_encoder_never_defaults_to_cpu_when_gpu_available(self):
        # Auto, None, client_gpu must all route to NVENC, never falling back to server CPU
        for sel in ["auto", None, "client_gpu", "browser_wasm", "nvenc"]:
            codec, args = resolve_encoder(sel)
            self.assertEqual(codec, "h264_nvenc", f"Expected NVENC for selection '{sel}', got '{codec}'")

        # Only explicit 'cpu' should use libx264
        cpu_codec, cpu_args = resolve_encoder("cpu")
        self.assertEqual(cpu_codec, "libx264")

    def test_ffmpeg_progress_reporting(self):
        # Generate a test 1-second synthetic video in null format with progress
        progress_updates = []

        def callback(frac: float):
            progress_updates.append(frac)

        cmd = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=160x120:rate=15",
            "-f", "null", "-"
        ]
        returncode, err = _run_ffmpeg_command_with_progress(
            cmd,
            total_duration=1.0,
            timeout=10.0,
            progress_callback=callback
        )
        self.assertEqual(returncode, 0)
        self.assertTrue(len(progress_updates) > 0)
        self.assertAlmostEqual(progress_updates[-1], 1.0, delta=0.01)


if __name__ == "__main__":
    unittest.main()
