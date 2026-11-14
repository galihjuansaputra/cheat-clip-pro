import unittest
import os
import re
import subprocess
from pathlib import Path
from backend.video_engine import (
    detect_hardware_support,
    resolve_encoder,
    _run_ffmpeg_command_with_progress,
    generate_ass_file,
    wrap_title_smart,
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

    def test_generate_ass_file_start_visibility_and_bouncing(self):
        output_ass = Path("temp_test_subtitle.ass")
        words = [
            {"word": "Selamat", "start": 1.5, "end": 2.0},
            {"word": "datang", "start": 2.1, "end": 2.6},
            {"word": "kawan", "start": 2.7, "end": 3.2},
            {"word": "di", "start": 4.5, "end": 4.8},
            {"word": "sini", "start": 4.9, "end": 5.4},
        ]
        try:
            generate_ass_file(
                words=words,
                style_preset="viral_pop",
                font_name="Montserrat",
                output_ass_path=str(output_ass),
                target_aspect_ratio="9:16",
                duration_seconds=8.0,
            )
            self.assertTrue(output_ass.exists())
            content = output_ass.read_text(encoding="utf-8")

            # Check subtitle is immediately visible at 0:00:00.00
            self.assertIn("Dialogue: 0,0:00:00.00,", content)
            self.assertIn("SELAMAT DATANG KAWAN", content)

            # Check bouncing effect animation tags are present on active words
            self.assertIn(r"\fscx100\fscy100\t(0,", content)
            self.assertIn(r"\fscx116\fscy116", content)
            self.assertIn(r"\fscx108\fscy108", content)

            # Check pause bridging / end extension
            self.assertIn("0:00:07.95", content)
        finally:
            if output_ass.exists():
                output_ass.unlink()

    def test_generate_ass_file_font_weight_handling(self):
        output_ass = Path("temp_test_bebas_font.ass")
        try:
            generate_ass_file(
                words=[{"word": "Test", "start": 0.0, "end": 1.0}],
                style_preset="viral_pop",
                font_name="Bebas Neue",
                title_font_name="Bebas Neue",
                title_text="VIRAL TITLE",
                output_ass_path=str(output_ass),
                target_aspect_ratio="9:16",
            )
            self.assertTrue(output_ass.exists())
            content = output_ass.read_text(encoding="utf-8")
            # Bebas Neue is single-weight display font, so bold must be 0 to match TTF without falling back to Arial
            self.assertIn("Style: TitleStyle,Bebas Neue,", content)
            self.assertIn(",0,0,0,100,100", content)
            self.assertIn("Style: SubStyle,Bebas Neue,", content)
        finally:
            if output_ass.exists():
                output_ass.unlink()

    def test_wrap_title_smart_max_3_lines_and_no_orphans(self):
        # 1. User sample: "Awal Mula Raditya Dika Kenal Js Hiren" (7 words)
        title = "Awal Mula Raditya Dika Kenal Js Hiren"
        res, count = wrap_title_smart(title)
        self.assertEqual(count, 3)
        lines = res.split(r"\N")
        self.assertEqual(len(lines), 3)
        for line in lines:
            words = line.split()
            self.assertGreaterEqual(len(words), 2, f"Line '{line}' has fewer than 2 words (orphan word detected)")
        self.assertEqual(lines[0], "Awal Mula")
        self.assertEqual(lines[1], "Raditya Dika")
        self.assertEqual(lines[2], "Kenal Js Hiren")

        # 2. 4 words -> 2 lines, no orphans
        res4, count4 = wrap_title_smart("Kenapa Harus Belajar AI")
        self.assertEqual(count4, 2)
        lines4 = res4.split(r"\N")
        self.assertEqual(len(lines4), 2)
        for line in lines4:
            self.assertGreaterEqual(len(line.split()), 2)

        # 3. 10 words -> strictly 3 lines max (never 4 lines)
        long_title = "Kisah Inspiratif Seorang Tukang Parkir Menjadi Miliarder Muda Sukses Banget"
        res10, count10 = wrap_title_smart(long_title)
        self.assertEqual(count10, 3)
        lines10 = res10.split(r"\N")
        self.assertEqual(len(lines10), 3)
        for line in lines10:
            self.assertGreaterEqual(len(line.split()), 2)

        # 4. Manual 5 lines collapsed to 3 lines max
        manual_title = "Baris1\nBaris2\nBaris3\nBaris4\nBaris5"
        res_m, count_m = wrap_title_smart(manual_title)
        self.assertEqual(count_m, 3)
        self.assertEqual(len(res_m.split(r"\N")), 3)

    def test_generate_ass_file_caption_anti_orphan(self):
        output_ass = Path("temp_test_anti_orphan.ass")
        # 4 words where standard 3-word chunking would leave 1 lonely word
        words = [
            {"word": "Ini", "start": 0.0, "end": 0.3},
            {"word": "adalah", "start": 0.3, "end": 0.6},
            {"word": "contoh", "start": 0.6, "end": 0.9},
            {"word": "orphan", "start": 0.9, "end": 1.2},
        ]
        try:
            generate_ass_file(
                words=words,
                style_preset="viral_pop",
                font_name="Montserrat",
                output_ass_path=str(output_ass),
                target_aspect_ratio="9:16",
                duration_seconds=2.0,
            )
            self.assertTrue(output_ass.exists())
            content = output_ass.read_text(encoding="utf-8")
            # In Dialogue lines, verify that no dialog line contains only 1 word
            dialogue_lines = [l for l in content.splitlines() if l.startswith("Dialogue:")]
            self.assertTrue(len(dialogue_lines) > 0)
            # The 4 words must be balanced into 2 words + 2 words (INI ADALAH and CONTOH ORPHAN)
            self.assertIn("CONTOH ORPHAN", content)
            self.assertIn("ADALAH", content)
            # Ensure every dialogue line has at least 2 words (no single orphan words)
            for line in dialogue_lines:
                # Strip ASS formatting tags {...}
                clean_line = re.sub(r"\{.*?\}", "", line).strip()
                # Text after last comma is the subtitle dialogue
                text_content = clean_line.split(",")[-1].strip()
                if text_content:
                    words_in_line = text_content.split()
                    self.assertGreaterEqual(
                        len(words_in_line),
                        2,
                        f"Dialogue line '{text_content}' left an orphan word"
                    )
        finally:
            if output_ass.exists():
                output_ass.unlink()


if __name__ == "__main__":
    unittest.main()
