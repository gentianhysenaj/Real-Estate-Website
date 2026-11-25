#!/usr/bin/env bash
# Turns a walk-through video into the frames the home-page tour flips through on scroll.
# Usage:  tools/make-tour-frames.sh path/to/walkthrough.mp4 [frames-per-second]
# Needs ffmpeg (Mac: brew install ffmpeg). Then set TOUR.frames.count in assets/journey.js
# to the number this script prints.
#   assets/tour/frames/     whole frames, 1600 px wide (laptops, desktops, tablets on their side)
#   assets/tour/frames-hd/  the middle half of each frame at the video's full height, for portrait
#                           screens, which only ever show the middle of a 16:9 frame
set -euo pipefail
IN="${1:?give the video file}"; FPS="${2:-15}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)/assets/tour"
mkdir -p "$ROOT/frames" "$ROOT/frames-hd"
rm -f "$ROOT/frames"/*.webp "$ROOT/frames-hd"/*.webp
# 1600px wide WebP at quality 70 keeps each frame around 60-90 KB.
ffmpeg -loglevel error -i "$IN" -an -vf "fps=$FPS,scale=1600:-2:flags=lanczos" -c:v libwebp -quality 70 "$ROOT/frames/%04d.webp"
ffmpeg -loglevel error -i "$IN" -an -vf "fps=$FPS,crop=iw/2:ih:iw/4:0" -c:v libwebp -quality 72 "$ROOT/frames-hd/%04d.webp"
N=$(ls "$ROOT/frames"/*.webp | wc -l | tr -d ' ')
echo "Made $N frames in assets/tour/frames and frames-hd. Set frames.count to $N in assets/journey.js."
