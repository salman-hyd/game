# Subway Dash v2

Endless runner with power-ups, skins, sound effects and offline support. Pure HTML5 + JS, no build step.

## Features
- 🎮 3-lane endless running with jump / slide / lane change
- 🧲 Magnet, 🚀 Jetpack and 🛡️ Shield power-ups
- 🎨 6 skins, unlocked with coins earned while playing
- 🏆 High score + total coins saved to the browser (localStorage)
- 🔊 Web Audio sound effects (no external files)
- 📱 On-screen touch buttons + swipe gestures
- 📲 Installable as a PWA — works offline after first load

## Run locally

**Easiest:**
Just double-click `index.html`. It works straight from the file system.

**With a local server (needed for PWA / service worker):**
```bash
python3 -m http.server 8080
# Open http://localhost:8080