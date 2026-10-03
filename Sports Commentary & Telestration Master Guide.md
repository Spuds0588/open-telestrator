# Sports Commentary & Telestration Studio: Master Implementation Guide & Task List

This master document serves as the technical blueprint, architecture specification, and step-by-step development roadmap for building a zero-infrastructure, browser-native sports commentary and telestration studio. 

---

## 1. Executive Summary & Architecture Overview

The platform allows a commentator or coach to capture any active browser tab (game stream, YouTube, local video file), layer a responsive touch-friendly canvas for NFL-style telestration, mix custom audio (microphone and game feed), manage a rolling 30-second instant replay buffer with slow-motion capabilities, and distribute the stream and drawing vectors via a PeerJS peer-to-peer tree mesh.

### Core Technology Stack
* **Core Shell / Runtime:** Tauri (Rust + Webview) or modern Chromium-based browser environment.
* **Capture Layer:** `navigator.mediaDevices.getDisplayMedia` with browser tab selection.
* **Canvas Overlay:** HTML5 `<canvas>` with dynamic pointer-event toggling (`pointer-events: none` vs `auto`).
* **Replay Engine:** `MediaRecorder` API with rolling chunk array management / Blob buffers.
* **Audio Mixing:** Web Audio API (`AudioContext`, `MediaStreamAudioSourceNode`, `GainNode`).
* **Signaling & Collaboration:** PeerJS (WebRTC Data Channels for vector syncing, Media Streams for co-host audio/video).

---

## 2. Pre-Implementation Guide & Design Decisions

### 2.1 The Pointer Events Trick for Overlays
When placing a canvas directly over an interactive video feed, user clicks and touch events would normally lock onto the canvas and prevent interaction with the video player controls.
* **Solution:** Implement a hotkey or UI button to toggle state:
  * *Draw Mode (Active):* Canvas has `pointer-events: auto`. Mouse or stylus movements draw strokes.
  * *Control Mode (Inactive):* Canvas has `pointer-events: pass-through` (`pointer-events: none`). Clicks flow through to the underlying video player to pause, scrub, or change volume.

### 2.2 Coordinate Normalization for Multi-Device Sync
Because users will join from different screen sizes, resolutions, and orientations (tablets, touch laptops, phones), raw pixel coordinates will break layout sync.
* **Solution:** All drawing coordinates (`x, y`) must be normalized as percentages relative to the container dimensions ($0.0$ to $1.0$). 
  $$\text{Normalized X} = \frac{X_{\text{absolute}}}{\text{Container Width}}, \quad \text{Normalized Y} = \frac{Y_{\text{absolute}}}{\text{Container Height}}$$
  Received data packets are scaled back up using the local container dimensions upon rendering.

### 2.3 Rolling 30-Second Buffer Strategy
Instead of relying on heavy server-side video buffers, leverage the browser's local memory ring-buffer:
* Instantiate a `MediaRecorder` capturing the active stream at short intervals (e.g., 1-second chunks).
* Maintain a fixed-size array queue (e.g., maximum 30 chunks). When the array length exceeds 30, `shift()` the oldest chunk out.
* When "Instant Replay" is triggered, concatenate the remaining chunks into a single `Blob`, load it into an auxiliary hidden video player, set playback speed to $0.5\times$, and overlay the canvas for breakdown.

---

## 3. Comprehensive Development Task List

### Milestone 1: Environment Setup & Core Capture Engine
- [ ] **Task 1.1:** Initialize project repository (Vite + React/TypeScript or Vanilla JS, paired with Tauri configuration if desktop builds are prioritized).
- [ ] **Task 1.2:** Implement the tab-capture module using `navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, audio: true })`.
- [ ] **Task 1.3:** Bind the resulting `MediaStream` to a primary `<video>` element and confirm zero-latency rendering of the background game tab.
- [ ] **Task 1.4:** Build basic layout shells (Full Game View, Announcer Desk View, Game + PiP View).

### Milestone 2: Telestration Canvas & Touch Engine
- [ ] **Task 2.1:** Overlay an HTML5 `<canvas>` element dynamically matched to the active video container dimensions.
- [ ] **Task 2.2:** Implement pointer event listeners (`pointerdown`, `pointermove`, `pointerup`) ensuring full support for mouse, stylus, and multi-touch inputs.
- [ ] **Task 2.3:** Create drawing tools engine:
  * Freehand pen with adjustable stroke width and color.
  * Straight line and directional arrow vectors.
  * Circle/Highlight shapes.
  * Clear screen / Undo last stroke function.
- [ ] **Task 2.4:** Build the "Draw Mode / Control Mode" toggle switch to seamlessly shift pointer events between the canvas and the video background.

### Milestone 3: 30-Second Rolling Replay Buffer & Slow-Mo
- [ ] **Task 3.1:** Setup a background `MediaRecorder` configured to output compressed chunks (e.g., `video/webm;codecs=vp8`).
- [ ] **Task 3.2:** Implement a circular buffer array structure capped at 30 entries (30 seconds of rolling history).
- [ ] **Task 3.3:** Build the Replay Trigger UI button: freezes the live feed, compiles buffer chunks into a playback `Blob`, and switches view to the replay player.
- [ ] **Task 3.4:** Add playback controls for the replay sequence (Play/Pause, Slow-Motion rate adjustment at $0.5\times$, frame stepping).
- [ ] **Task 3.5:** Implement the "Return to Live" action to flush temporary replay memory and snap back to the active stream.

### Milestone 4: Audio Mixing & Routing Engine
- [ ] **Task 4.1:** Initialize a browser `AudioContext` to handle multi-source audio management.
- [ ] **Task 4.2:** Capture microphone input via `navigator.mediaDevices.getUserMedia({ audio: true })`.
- [ ] **Task 4.3:** Extract audio tracks from the captured display stream (`getDisplayMedia`).
- [ ] **Task 4.4:** Route both audio sources through individual `GainNode` volume controllers into a master destination node.
- [ ] **Task 4.5:** Build slider UI components for Announcer Mic Gain and Game Audio Gain.

### Milestone 5: PeerJS Co-Hosting & Tree Distribution
- [ ] **Task 5.1:** Integrate the PeerJS client SDK and establish connection to a signaling server with a unique room/session ID.
- [ ] **Task 5.2:** Implement the **Vector Data Channel**: serialize drawing strokes into JSON payloads and broadcast coordinates instantly to all connected peer clients.
- [ ] **Task 5.3:** Build remote receiver logic: deserialize incoming drawing data and render strokes onto remote canvas overlays in real-time.
- [ ] **Task 5.4:** Implement peer audio/video call handling so a remote co-host can join via a magic link, talk over the stream, and collaborate on drawings.
- [ ] **Task 5.5:** Design the peer tree-relay structure (where relay nodes automatically re-broadcast incoming media streams to subsequent peers if connection limits approach thresholds).

### Milestone 6: Packaging, Polish & Casting Export
- [ ] **Task 6.1:** Build responsive UI skins optimized for touch-screen Windows laptops and tablets (iPad/Android).
- [ ] **Task 6.2:** Test and verify output streaming compatibility with OBS Studio via window/tab capture.
- [ ] **Task 6.3:** Write release bundles for Tauri (macOS `.app`, Windows `.msi`/`.exe`).

---

## 4. Quick-Start Code Snippet: Pointer-Events Toggle Pattern

```javascript
// Example logic for switching between drawing mode and video control mode
const canvas = document.getElementById('telestration-canvas');
const toggleBtn = document.getElementById('mode-toggle');

let isDrawingMode = false;

toggleBtn.addEventListener('click', () => {
    isDrawingMode = !isDrawingMode;
    if (isDrawingMode) {
        canvas.style.pointerEvents = 'auto';
        toggleBtn.textContent = 'Mode: Drawing (ON)';
        toggleBtn.classList.add('bg-red-600');
    } else {
        canvas.style.pointerEvents = 'none';
        toggleBtn.textContent = 'Mode: Video Controls (ON)';
        toggleBtn.classList.remove('bg-red-600');
    }
});