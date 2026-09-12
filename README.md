# 🎬 Cheat Clip PRO

> **Turn long YouTube videos into viral TikToks, Shorts, and Reels with animated subtitles, face centering, and music in minutes.**

---

## ⚡ Quick Start (Setup in 3 Steps)

### Step 1: Requirements
1. **[Git](https://git-scm.com/)** — If you don't have Git... how did you even get this project? Download ZIP gang? 📦 No judgment, but grab it so you can get updates (`winget install Git.Git` on Windows, `brew install git` on Mac, or from [git-scm.com](https://git-scm.com/)).
2. **[Node.js](https://nodejs.org/)** (v18 or newer)
3. **Python** (v3.10 or newer) — Install from [python.org](https://www.python.org/downloads/) or directly from the [Microsoft Store (Windows)](https://apps.microsoft.com/detail/9ncvdn91xzqp)
4. **FFmpeg & yt-dlp** (Required to download and render videos)
   * **Windows (PowerShell):**
     ```powershell
     winget install Gyan.FFmpeg
     winget install yt-dlp.yt-dlp
     ```
     *(Close and reopen your terminal after installing so Windows recognizes them)*
   * **Mac (Terminal):**
     ```bash
     brew install ffmpeg yt-dlp
     ```
     *(If you don't have Homebrew installed on Mac, install it first from [brew.sh](https://brew.sh))*

### Step 2: Install
Open your terminal inside this folder and run:
```bash
npm install
python -m pip install -r backend/requirements.txt
```
*(On Mac, use `python3 -m pip install -r backend/requirements.txt`)*

### Step 3: Run the App
```bash
npm run dev
```
Open **`http://localhost:5173`** in your web browser!

---

## 🔑 Free Google Gemini API Key (Takes 1 Minute)

Cheat Clip PRO uses Google's AI to find the best viral moments for free:
1. Go to **[Google AI Studio](https://aistudio.google.com/)** and sign in with any Google account.
2. Click **"Get API key"** (or **"Create API key"**).
3. Copy your key (starts with `AIzaSy...`).
4. Paste it into the **Gemini API Key** field in the app.

> 💡 **Tip:** You can also type `mock` in the API Key box to test out the app with sample data without an API key!

---

## 🎯 How to Use

1. **Paste a YouTube URL** — Enter any podcast, stream, or video link.
2. **Choose Duration** — Pick `~15s` (fast hooks), `~30s` (standard shorts), or `~60s` (story clips).
3. **Click "Analyze Video"** — The AI finds the most exciting moments using YouTube audience retention data.
4. **Customize in Clip Studio** — Adjust your video style:
   * **Frame & Crop**: Fullscreen 9:16 vertical, square, or split-screen facecam.
   * **Face Tracking**: Automatically keeps the speaker in the center of the frame.
   * **Subtitles**: Choose viral animated karaoke caption styles and fonts.
   * **Branding & Audio**: Add your watermark logo, background music, and hook sound effects.
   * **Hardware Acceleration**: Choose your graphics card (NVIDIA, AMD, Intel) or CPU.
5. **Batch Render & Download** — Click **Batch Render**, then download all your finished videos together in one **.ZIP** file!

---

## ❓ Common Problems & Easy Fixes

### 1. "Failed to render video" or `The system cannot find the file specified`
* **Cause:** `ffmpeg` or `yt-dlp` is missing on your computer.
* **Fix:**
  * **Windows (PowerShell):**
    ```powershell
    winget install Gyan.FFmpeg
    winget install yt-dlp.yt-dlp
    ```
    *(Then close and reopen your terminal)*
  * **Mac (Terminal):**
    ```bash
    brew install ffmpeg yt-dlp
    ```
  * Or install directly via Python: `pip install yt-dlp`

### 2. "Sign in to confirm you're not a bot"
* **Cause:** YouTube blocks video downloads if too many requests are sent without logging in.
* **Fix:** Click the 🍪 **Cookies** button in the top navigation bar, export your YouTube cookies using a free browser extension (like *Get cookies.txt locally*), and paste them into the app.

### 3. Does this work on AMD graphics cards and Mac?
* **Yes!** Cheat Clip PRO automatically supports:
  * **NVIDIA** (`h264_nvenc`)
  * **AMD** (`h264_amf` on Radeon GPUs & Ryzen CPUs)
  * **Intel** (`h264_qsv` on Arc & UHD Graphics)
  * **Apple Mac & CPU Software** (`libx264` universal high-speed fallback)
* You can switch your preferred hardware acceleration encoder anytime in the Render Settings or History card.

---

## 📄 License

Distributed under the **MIT License**. Free for personal and commercial use!
