#!/usr/bin/env bash
# Turns a walk-through video into the frames the home-page tour flips through on scroll.
# Usage:  tools/make-tour-frames.sh path/to/walkthrough.mp4 [frames-per-second]
# Needs ffmpeg (Mac: brew install ffmpeg). Then set TOUR.frames.count in assets/journey.js
# to the number this script prints.
set -euo pipefail
IN="${1:?give the video file}"; FPS="${2:-15}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/tour/frames"
rm -f "$OUT"/*.webp
# 1600px wide WebP at quality 70 keeps each frame around 60-120 KB.
ffmpeg -loglevel error -i "$IN" -an -vf "fps=$FPS,scale=1600:-2:flags=lanczos" -c:v libwebp -quality 70 "$OUT/%04d.webp"
N=$(ls "$OUT"/*.webp | wc -l | tr -d ' ')
echo "Made $N frames in assets/tour/frames. Set frames.count to $N in assets/journey.js."
