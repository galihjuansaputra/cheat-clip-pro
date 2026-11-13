import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from backend.video_engine import FONTS_DIR, get_ffmpeg_safe_font_path


def build_ffmpeg_filtergraph(
    aspect_ratio: str,
    background_style: str,
    face_center_ratio: float = 0.5,
    streamer_preset: str = "none",
    title_text: Optional[str] = None,
    title_position: str = "auto",
    ass_subtitles_path: Optional[str] = None,
    face_box: Optional[Dict[str, Any]] = None,
    title_y_percent: Optional[float] = None,
    crop_x_percent: Optional[float] = None
) -> Tuple[str, str]:
    """
    Constructs the FFmpeg -filter_complex chain with proper aspect ratio center-cropping.
    Canvas is always 1080x1920 (9:16).
    """
    filters = []
    # Guarantee video presentation timestamp strictly begins at 0.000 to eliminate initial subtitle offset / delay
    filters.append("[0:v]setpts=PTS-STARTPTS[v_pts]")

    face_cx = float(face_box.get("cx", face_center_ratio)) if face_box else face_center_ratio
    face_cy = float(face_box.get("cy", 0.78 if streamer_preset in ["split_top_cam", "pip_corner"] else 0.35)) if face_box else 0.35

    # 1. Base Layout & Scaling
    if streamer_preset == "split_top_cam":
        if aspect_ratio == "16:9":
            # 16:9 split: top cam 1080x608 (16:9) tightly cropped around face, bottom feed 1080x608 (16:9)
            cam_h = "min(ih, max(240, ih*0.38))"
            cam_w = f"min(iw, ({cam_h})*16/9)"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
            filters.append(
                f"[v_pts]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=1080:608[cam_box];"
                f"[game_raw]crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))/2':'(ih-min(ih,iw*9/16))/2',scale=1080:608[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[both_split]"
            )
            if background_style == "blurred":
                filters.append(
                    f"[v_pts]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[bg_blurred][both_split]overlay=0:352[layout_base]"
                )
            else:
                filters.append(f"[both_split]pad=1080:1920:0:352:black[layout_base]")

        elif aspect_ratio == "1:1":
            # 1:1 split: top cam 960x960 (1:1) tightly cropped around face, bottom feed 960x960 (1:1)
            cam_h = "min(ih, max(280, ih*0.38))"
            cam_w = f"min(iw, {cam_h})"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
            filters.append(
                f"[v_pts]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=960:960[cam_box];"
                f"[game_raw]crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(ih,iw))/2',scale=960:960[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[both_split]"
            )
            if background_style == "blurred":
                filters.append(
                    f"[v_pts]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[bg_blurred][both_split]overlay=60:0[layout_base]"
                )
            else:
                filters.append(f"[both_split]pad=1080:1920:60:0:black[layout_base]")

        elif aspect_ratio == "4:3":
            # 4:3 split: top cam 1080x810 (4:3) tightly cropped around face, bottom feed 1080x810 (4:3)
            cam_h = "min(ih, max(280, ih*0.38))"
            cam_w = f"min(iw, ({cam_h})*4/3)"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
            filters.append(
                f"[v_pts]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=1080:810[cam_box];"
                f"[game_raw]crop='min(iw,ih*4/3)':'min(ih,iw*3/4)':'(iw-min(iw,ih*4/3))/2':'(ih-min(ih,iw*3/4))/2',scale=1080:810[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[both_split]"
            )
            if background_style == "blurred":
                filters.append(
                    f"[v_pts]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[bg_blurred][both_split]overlay=0:150[layout_base]"
                )
            else:
                filters.append(f"[both_split]pad=1080:1920:0:150:black[layout_base]")

        else:  # 9:16
            # 9:16 Split: full bleed 1080x1920 with crisp facecam on top and centered gameplay on bottom
            cam_h = "min(ih, max(280, ih*0.38))"
            cam_w = f"min(iw, ({cam_h})*4/3)"
            cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
            cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"

            game_w = "min(iw, ih*1080/1110)"
            game_h = "ih"
            game_x = "(iw-ow)/2"
            game_y = "(ih-oh)/2"

            filters.append(
                f"[v_pts]split=2[cam_raw][game_raw];"
                f"[cam_raw]crop='{cam_w}':'{cam_h}':'{cam_x}':'{cam_y}',scale=1080:810[cam_box];"
                f"[game_raw]crop='{game_w}':'{game_h}':'{game_x}':'{game_y}',scale=1080:1110[game_box];"
                f"[cam_box][game_box]vstack=inputs=2[layout_base]"
            )

        current_v = "[layout_base]"

    elif streamer_preset == "pip_corner":
        # PIP Box tightly cropped on face (320x240)
        pip_cam_h = "min(ih, max(220, ih*0.35))"
        pip_cam_w = f"min(iw, ({pip_cam_h})*4/3)"
        pip_cam_x = f"max(0, min(iw-ow, iw*{face_cx:.3f}-ow/2))"
        pip_cam_y = f"max(0, min(ih-oh, ih*{face_cy:.3f}-oh/2))"
        pip_crop = f"[pip_raw]crop='{pip_cam_w}':'{pip_cam_h}':'{pip_cam_x}':'{pip_cam_y}',scale=320:240[pip_box];"

        if aspect_ratio == "1:1":
            crop_main = "crop='min(iw,ih)':'min(iw,ih)':'(iw-min(iw,ih))/2':'(ih-min(ih,iw))/2',scale=1080:1080"
            pip_x, pip_y = 736, 444
            if background_style == "blurred":
                filters.append(
                    f"[v_pts]split=3[bg_raw][main_raw][pip_raw];"
                    f"[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[main_raw]{crop_main}[fg_square];"
                    f"[bg_blurred][fg_square]overlay=0:420[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )
            else:
                filters.append(
                    f"[v_pts]split=2[main_raw][pip_raw];"
                    f"[main_raw]{crop_main},pad=1080:1920:0:420:black[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )

        elif aspect_ratio == "4:3":
            crop_main = "crop='min(iw,ih*4/3)':'min(ih,iw*3/4)':'(iw-min(iw,ih*4/3))/2':'(ih-min(ih,iw*3/4))/2',scale=1080:810"
            pip_x, pip_y = 736, 579
            if background_style == "blurred":
                filters.append(
                    f"[v_pts]split=3[bg_raw][main_raw][pip_raw];"
                    f"[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[main_raw]{crop_main}[fg_43];"
                    f"[bg_blurred][fg_43]overlay=0:555[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )
            else:
                filters.append(
                    f"[v_pts]split=2[main_raw][pip_raw];"
                    f"[main_raw]{crop_main},pad=1080:1920:0:555:black[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )

        elif aspect_ratio == "16:9_landscape":
            crop_main = "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))/2':'(ih-min(ih,iw*9/16))/2',scale=1920:1080"
            pip_x, pip_y = 1550, 780
            filters.append(
                f"[v_pts]split=2[main_raw][pip_raw];"
                f"[main_raw]{crop_main}[main_base];"
                f"{pip_crop}"
                f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
            )

        elif aspect_ratio == "16:9":
            crop_main = "crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'(iw-min(iw,ih*16/9))/2':'(ih-min(ih,iw*9/16))/2',scale=1080:608"
            pip_x, pip_y = 736, 676
            if background_style == "blurred":
                filters.append(
                    f"[v_pts]split=3[bg_raw][main_raw][pip_raw];"
                    f"[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                    f"[main_raw]{crop_main}[fg_169];"
                    f"[bg_blurred][fg_169]overlay=0:656[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )
            else:
                filters.append(
                    f"[v_pts]split=2[main_raw][pip_raw];"
                    f"[main_raw]{crop_main},pad=1080:1920:0:656:black[main_base];"
                    f"{pip_crop}"
                    f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
                )

        else:  # 9:16
            if crop_x_percent is not None:
                crop_ratio_safe = max(0.0, min(1.0, float(crop_x_percent) / 100.0))
            else:
                safe_cx = float(face_cx)
                if 0.46 <= safe_cx <= 0.54:
                    safe_cx = 0.50
                safe_cx = max(0.22, min(0.78, safe_cx))
                crop_ratio_safe = max(0.0, min(1.0, (safe_cx - 0.158) / 0.684))
            pip_x, pip_y = 736, 120
            filters.append(
                f"[v_pts]split=2[main_raw][pip_raw];"
                f"[main_raw]crop=ih*9/16:ih:(iw-ih*9/16)*{crop_ratio_safe:.3f}:0,scale=1080:1920[main_base];"
                f"{pip_crop}"
                f"[main_base][pip_box]overlay=x={pip_x}:y={pip_y}[layout_base]"
            )

        current_v = "[layout_base]"

    elif aspect_ratio == "9:16":
        # Full Bleed 9:16 with Face Tracking / Manual horizontal crop offset
        if crop_x_percent is not None:
            crop_ratio_safe = max(0.0, min(1.0, float(crop_x_percent) / 100.0))
        else:
            safe_cx = float(face_cx)
            if 0.46 <= safe_cx <= 0.54:
                safe_cx = 0.50
            safe_cx = max(0.22, min(0.78, safe_cx))
            crop_ratio_safe = max(0.0, min(1.0, (safe_cx - 0.158) / 0.684))
        filters.append(
            f"[v_pts]crop=ih*9/16:ih:(iw-ih*9/16)*{crop_ratio_safe:.3f}:0,scale=1080:1920[layout_base]"
        )
        current_v = "[layout_base]"

    elif aspect_ratio == "1:1":
        # 1:1 Square (1080x1080) - Smart crop with speaker/object centering then scale to 1080x1080
        safe_cx = float(face_cx)
        if 0.46 <= safe_cx <= 0.54:
            safe_cx = 0.50
        safe_cx = max(0.15, min(0.85, safe_cx))
        crop_11 = f"crop='min(iw,ih)':'min(iw,ih)':'max(0,min(iw-ih,iw*{safe_cx:.3f}-ih/2))':'(ih-min(iw,ih))/2',scale=1080:1080"
        if background_style == "blurred":
            filters.append(
                f"[v_pts]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                f"[fg_raw]{crop_11}[fg_square];"
                f"[bg_blurred][fg_square]overlay=0:420[layout_base]"
            )
        else:
            filters.append(
                f"[v_pts]{crop_11},pad=1080:1920:0:420:black[layout_base]"
            )
        current_v = "[layout_base]"

    elif aspect_ratio == "4:3":
        # 4:3 Standard (1080x810) - Smart crop with speaker/object centering then scale to 1080x810
        safe_cx = float(face_cx)
        if 0.46 <= safe_cx <= 0.54:
            safe_cx = 0.50
        safe_cx = max(0.15, min(0.85, safe_cx))
        crop_43 = f"crop='min(iw,ih*4/3)':'min(ih,iw*3/4)':'max(0,min(iw-ih*4/3,iw*{safe_cx:.3f}-(ih*4/3)/2))':'(ih-min(ih,iw*3/4))/2',scale=1080:810"
        if background_style == "blurred":
            filters.append(
                f"[v_pts]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                f"[fg_raw]{crop_43}[fg_43];"
                f"[bg_blurred][fg_43]overlay=0:555[layout_base]"
            )
        else:
            filters.append(
                f"[v_pts]{crop_43},pad=1080:1920:0:555:black[layout_base]"
            )
        current_v = "[layout_base]"

    elif aspect_ratio == "16:9_landscape":
        # True 16:9 Landscape (1920x1080)
        safe_cx = float(face_cx)
        if 0.46 <= safe_cx <= 0.54:
            safe_cx = 0.50
        safe_cx = max(0.15, min(0.85, safe_cx))
        crop_169_land = f"crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'max(0,min(iw-ih*16/9,iw*{safe_cx:.3f}-(ih*16/9)/2))':'(ih-min(ih,iw*9/16))/2',scale=1920:1080"
        filters.append(
            f"[v_pts]{crop_169_land}[layout_base]"
        )
        current_v = "[layout_base]"

    else:  # 16:9 Letterbox
        # 16:9 Letterbox (1080x608) - Smart crop with speaker/object centering for ultrawide sources
        safe_cx = float(face_cx)
        if 0.46 <= safe_cx <= 0.54:
            safe_cx = 0.50
        safe_cx = max(0.15, min(0.85, safe_cx))
        crop_169 = f"crop='min(iw,ih*16/9)':'min(ih,iw*9/16)':'max(0,min(iw-ih*16/9,iw*{safe_cx:.3f}-(ih*16/9)/2))':'(ih-min(ih,iw*9/16))/2',scale=1080:608"
        if background_style == "blurred":
            filters.append(
                f"[v_pts]split=2[bg_raw][fg_raw];"
                f"[bg_raw]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,boxblur=12:2,scale=1080:1920,eq=saturation=1.2:contrast=1.05[bg_blurred];"
                f"[fg_raw]{crop_169}[fg_169];"
                f"[bg_blurred][fg_169]overlay=0:656[layout_base]"
            )
        else:
            filters.append(
                f"[v_pts]{crop_169},pad=1080:1920:0:656:black[layout_base]"
            )
        current_v = "[layout_base]"

    # 2. Subtitles & Title Burning via libass (.ass)
    # (If ass_subtitles_path is provided, it contains BOTH the title and subtitles rendered with exact matching fonts)
    if ass_subtitles_path and os.path.exists(ass_subtitles_path):
        raw_ass = str(Path(ass_subtitles_path).resolve()).replace("\\", "/")
        escaped_ass = raw_ass.replace(":", "\\:").replace("'", "'\\''")
        if FONTS_DIR.exists() and (any(FONTS_DIR.glob("*.ttf")) or any(FONTS_DIR.glob("*.otf")) or any(FONTS_DIR.glob("*.woff*"))):
            raw_fonts = str(FONTS_DIR.resolve()).replace("\\", "/")
            escaped_fonts = raw_fonts.replace("'", "'\\''").replace(":", "\\:")
            sub_filter = f"{current_v}subtitles=filename='{escaped_ass}':fontsdir='{escaped_fonts}'[v_final]"
        else:
            sub_filter = f"{current_v}subtitles=filename='{escaped_ass}'[v_final]"
        filters.append(sub_filter)
        current_v = "[v_final]"
    elif title_text and title_position != "none":
        # Fallback drawtext if no ASS was generated
        clean_title = title_text.replace("'", "").replace(":", "-").replace('"', "").strip()
        if title_y_percent is not None:
            canvas_h = 1080 if aspect_ratio == "16:9_landscape" else 1920
            y_pos = int(round(canvas_h * (float(title_y_percent) / 100.0)))
        elif streamer_preset == "split_top_cam":
            y_pos = int(round(1920 * 0.045))
        else:
            y_pos = 80 if aspect_ratio == "16:9_landscape" else (345 if aspect_ratio == "1:1" else (480 if aspect_ratio in ["4:3", "9:16"] else 581))
        box_style = "box=0"
        safe_font = get_ffmpeg_safe_font_path()
        font_arg = f":fontfile='{safe_font}'" if safe_font else ""
        title_filter = (
            f"{current_v}drawtext=text='{clean_title}'{font_arg}:fontsize=60:fontcolor=white:"
            f"x=(w-text_w)/2:y={y_pos}:borderw=2.5:bordercolor=black@0.8:{box_style}[v_with_title]"
        )
        filters.append(title_filter)
        current_v = "[v_with_title]"

    full_filter_str = ";".join(filters)
    return full_filter_str, current_v
