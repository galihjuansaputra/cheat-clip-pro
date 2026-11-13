import os
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure root dir is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.video_engine import (
    format_ass_timestamp,
    generate_ass_file,
    build_ffmpeg_filtergraph,
)
from backend.routers.analyze import parse_lenient_json_analysis
from backend.services.render_service import (
    RENDER_BATCHES,
    save_render_batches,
    load_render_batches,
)


class TestVideoPipeline(unittest.TestCase):
    def test_format_ass_timestamp(self):
        self.assertEqual(format_ass_timestamp(0.0), "0:00:00.00")
        self.assertEqual(format_ass_timestamp(1.25), "0:00:01.25")
        self.assertEqual(format_ass_timestamp(65.45), "0:01:05.45")
        self.assertEqual(format_ass_timestamp(3605.10), "1:00:05.10")

    def test_generate_ass_file_anchors_first_word(self):
        words = [
            {"word": "Halo", "start": 1.2, "end": 1.6},
            {"word": "semuanya", "start": 1.6, "end": 2.2},
            {"word": "selamat", "start": 2.3, "end": 2.7},
            {"word": "datang", "start": 2.8, "end": 3.2},
        ]
        with tempfile.NamedTemporaryFile(suffix=".ass", delete=False) as tf:
            temp_ass_path = tf.name

        try:
            generate_ass_file(
                words=words,
                style_preset="yellow_pop",
                font_name="Arial",
                output_ass_path=temp_ass_path,
                target_aspect_ratio="9:16",
            )
            with open(temp_ass_path, "r", encoding="utf-8") as f:
                content = f.read()

            dialogue_lines = [l for l in content.splitlines() if l.startswith("Dialogue:")]
            self.assertTrue(len(dialogue_lines) > 0, "ASS file must contain dialogue events")
            first_line = dialogue_lines[0]
            # Ensure the first dialogue begins strictly at 0:00:00.00
            self.assertIn("Dialogue: 0,0:00:00.00,", first_line)
            # Ensure active word highlight formatting is present
            self.assertIn(r"\pos(540,1880)", first_line)
        finally:
            if os.path.exists(temp_ass_path):
                os.unlink(temp_ass_path)

    def test_build_ffmpeg_filtergraph_all_ratios(self):
        ratios = ["9:16", "1:1", "4:3", "16:9_landscape", "16:9"]
        bg_styles = ["blurred", "black"]

        for ar in ratios:
            for bg in bg_styles:
                fg, ov = build_ffmpeg_filtergraph(aspect_ratio=ar, background_style=bg)
                self.assertIn("setpts=PTS-STARTPTS", fg, f"setpts missing in {ar} {bg}")
                self.assertIn("[v_pts]", fg, f"[v_pts] missing in {ar} {bg}")
                leftover = fg.replace("[0:v]setpts=PTS-STARTPTS[v_pts]", "")
                self.assertNotIn("[0:v]", leftover, f"Unreset [0:v] found in {ar} {bg}")

    def test_build_ffmpeg_filtergraph_streamer_presets(self):
        for streamer in ["split_top_cam", "pip_corner"]:
            fg, ov = build_ffmpeg_filtergraph(
                aspect_ratio="9:16",
                background_style="blurred",
                streamer_preset=streamer
            )
            self.assertIn("setpts=PTS-STARTPTS", fg)
            leftover = fg.replace("[0:v]setpts=PTS-STARTPTS[v_pts]", "")
            self.assertNotIn("[0:v]", leftover, f"Unreset [0:v] in {streamer}")

    def test_parse_lenient_json_analysis(self):
        # Truncated JSON with trailing comma
        messy_json = '''
        ```json
        {
            "summary": "Analisis gameplay seru",
            "clips": [
                {
                    "title": "Momen clutch epic",
                    "start_time": 10.0,
                    "end_time": 40.0,
                    "hook_time": 12.0,
                    "virality_score": 92,
                    "title_suggestion": "Saya berhasil clutch",
                    "caption_suggestion": "Tonton sampai habis!",
                    "hashtag_suggestion": "#gaming #clutch",
                },
            ]
        }
        ```
        '''
        res = parse_lenient_json_analysis(messy_json, channel="Galih", lang_code="id")
        self.assertIsNotNone(res)
        self.assertEqual(res["summary"], "Analisis gameplay seru")
        self.assertEqual(len(res["clips"]), 1)
        clip = res["clips"][0]
        self.assertEqual(clip["virality_score"], 92)
        self.assertEqual(clip["start_time"], 10.0)

    def test_render_batches_persistence(self):
        test_id = "test_batch_persistence_123"
        RENDER_BATCHES[test_id] = {
            "batch_id": test_id,
            "total_clips": 1,
            "current_clip_index": 0,
            "overall_status": "completed",
            "clips": [{"clip_index": 0, "status": "completed", "download_url": "/api/download/test.mp4"}],
            "zip_url": None,
            "is_merged": False
        }
        save_render_batches()

        # Temporarily clear in-memory dict
        del RENDER_BATCHES[test_id]
        self.assertNotIn(test_id, RENDER_BATCHES)

        # Reload from disk
        load_render_batches()
        self.assertIn(test_id, RENDER_BATCHES)
        self.assertEqual(RENDER_BATCHES[test_id]["overall_status"], "completed")

        # Cleanup
        del RENDER_BATCHES[test_id]
        save_render_batches()

    def test_ytdlp_version_info(self):
        from backend.services.system_service import get_ytdlp_version_info
        info = get_ytdlp_version_info()
        self.assertIn("version", info)
        self.assertNotEqual(info["version"], "unknown")


if __name__ == "__main__":
    unittest.main()
