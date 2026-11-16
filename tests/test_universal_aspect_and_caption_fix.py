import os
import unittest
from pathlib import Path
from backend.video_engine import wrap_title_smart, generate_ass_file
from backend.video.filtergraph import build_ffmpeg_filtergraph


class TestUniversalAspectAndCaptionFix(unittest.TestCase):
    def test_wrap_title_smart_strict_lines_and_anti_orphan(self):
        # 1. 4 words (when exceeding single line threshold) -> strictly 2 lines with 2 words each
        t4, c4 = wrap_title_smart("AI Bikin Teman Nangis", max_single_len=15)
        self.assertEqual(c4, 2)
        lines4 = t4.split(r"\N")
        self.assertEqual(len(lines4), 2)
        for l in lines4:
            self.assertGreaterEqual(len(l.split()), 2)

        # 2. 5 words -> strictly 2 lines (2 and 3 words, never 1 word orphan)
        t5, c5 = wrap_title_smart("Tutorial Rahasia Sukses Jadi Miliarder", max_single_len=18)
        self.assertEqual(c5, 2)
        lines5 = t5.split(r"\N")
        self.assertEqual(len(lines5), 2)
        for l in lines5:
            self.assertGreaterEqual(len(l.split()), 2)

        # 3. 7 words -> strictly 2 lines with >= 2 words on every line
        t7, c7 = wrap_title_smart("Cara Cepat Belajar Coding Python Sampai Mahir Banget", max_single_len=18)
        self.assertEqual(c7, 2)
        lines7 = t7.split(r"\N")
        self.assertEqual(len(lines7), 2)
        for l in lines7:
            self.assertGreaterEqual(len(l.split()), 2, f"Line has orphan word: {l}")

        # 4. Raditya Dika title (6 words) -> strictly 2 lines with 3 words each
        t_radit, c_radit = wrap_title_smart("SATU-SATUNYA ORANG YANG DIPERCAYA RADITYA DIKA", max_single_len=19)
        self.assertEqual(c_radit, 2)
        lines_radit = t_radit.split(r"\N")
        self.assertEqual(len(lines_radit), 2)
        self.assertEqual(lines_radit[0], "SATU-SATUNYA ORANG YANG")
        self.assertEqual(lines_radit[1], "DIPERCAYA RADITYA DIKA")

        # 5. Long title (14 words) -> strictly 2 lines max (never 3 or 4 lines)
        t14, c14 = wrap_title_smart("Ini Adalah Judul Yang Sangat Panjang Sekali Untuk Menguji Apakah Sistem Bisa Dua Baris", max_single_len=20)
        self.assertEqual(c14, 2)
        lines14 = t14.split(r"\N")
        self.assertEqual(len(lines14), 2)
        for l in lines14:
            self.assertGreaterEqual(len(l.split()), 2)

    def test_generate_ass_file_disabled_caption(self):
        # When style_preset is 'none' or words is empty, ASS should have ZERO subtitle dialogue events
        out_ass = Path("temp_test_no_sub.ass")
        try:
            generate_ass_file(
                words=[],
                style_preset="none",
                font_name="Outfit",
                output_ass_path=str(out_ass),
                title_text="Uji Coba Judul",
                title_position="auto"
            )
            self.assertTrue(out_ass.exists())
            with open(out_ass, "r", encoding="utf-8") as f:
                content = f.read()
            # Title should exist, Subtitle Dialogue events should be empty
            self.assertIn("TitleStyle", content)
            sub_dialogues = [l for l in content.split("\n") if l.startswith("Dialogue:") and "SubStyle" in l]
            self.assertEqual(len(sub_dialogues), 0, "No subtitle dialogue should exist when style is none")
        finally:
            if out_ass.exists():
                out_ass.unlink()

    def test_build_ffmpeg_filtergraph_aspect_ratios(self):
        # 1. 16:9 Letterbox on 1080x1920
        fg_169, out_map = build_ffmpeg_filtergraph("16:9", "black")
        self.assertIn("1080:608", fg_169)
        self.assertIn("pad=1080:1920:0:656:black", fg_169)

        # 2. 1:1 Square on 1080x1920
        fg_11, out_map = build_ffmpeg_filtergraph("1:1", "black")
        self.assertIn("1080:1080", fg_11)
        self.assertIn("pad=1080:1920:0:420:black", fg_11)

        # 3. 4:3 Box on 1080x1920
        fg_43, out_map = build_ffmpeg_filtergraph("4:3", "black")
        self.assertIn("1080:810", fg_43)
        self.assertIn("pad=1080:1920:0:555:black", fg_43)

        # 4. 16:9_landscape on 1920x1080
        fg_land, out_map = build_ffmpeg_filtergraph("16:9_landscape", "black")
        self.assertIn("scale=1920:1080", fg_land)

        # 5. 9:16 Full Bleed Vertical Crop
        fg_916, out_map = build_ffmpeg_filtergraph("9:16", "black")
        self.assertIn("scale=1080:1920", fg_916)


if __name__ == "__main__":
    unittest.main()
