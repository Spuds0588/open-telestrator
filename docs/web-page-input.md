# A web page as an input

> **Status: proposal.** Nothing here is built. This is the write-up to review
> before any code changes, so the shape can be argued about cheaply.
>
> **Correction.** An earlier draft of this file recommended reading the page's own
> `<video>` (element capture over WebRTC) as the *primary* route and justified it
> by claiming the media element was "same-origin with the page, so audio is
> intact and CORS does not apply". That reasoning conflated the element's origin
> with the *resource's* origin, and a local probe in Chromium refuted it outright
> — see *What has been measured*. The recommendation below is rebuilt
> around bytes rather than pixels because of it.
>
> **Second correction, and the one that undid the first.** That rebuild went too
> far the other way: it generalised a single probe of a cross-origin *progressive*
> file into a rule about all cross-origin media, and demoted element capture on
> the strength of it. A live YouTube stream then showed the opposite for the pages
> that actually matter. An MSE page's video is a `blob:` the page owns, so it is
> readable and capturable after all — the cheapest route was right the first time.
> Element capture is primary again and the fragment tee is the WebKit fallback;
> *What has been measured* has both runs.
>
> **Since then the ground moved under the plan.** The desktop and Android shells
> have been removed entirely: there is one web build now, no Tauri, no WebView,
> no APK, and `src-tauri/` no longer exists. So the "internal browser" option
> below — an owned webview as the capture surface — is off the table, and every
> passage that assumes a shell (what a WebView does and does not expose, the
> Android screen-capture route, the Kotlin plugin) is now history rather than a
> plan. What survives is the part that was measured in a browser: element capture
> works on an MSE page and the fragment tee does not work in Safari or WebKitGTK.
> Read the rest as research, not as a roadmap.

## The gap

Today an operator can bring in a camera, a local video file, a direct HLS or
MP4 link, or a shared tab or screen. The first three are fine everywhere. The
last is the only way to put *somebody else's page* — a YouTube live stream, a
Twitch channel, a broadcaster's player — on the program, and it is the one that
does not survive a phone: `getDisplayMedia` is absent from Android's WebView, so
the screen row is not even drawn on the APK, and Android's own tab capture is not
something a WebView app can ask for.

So the most obvious real-world use — *find a stream on a page, draw on it* — is a
desktop-only feature with a fragile step in the middle. The plan is to replace
that step with a browser the app owns.

## What "a browser with no CORS problems" does and does not buy

The intuition is right about one half of the problem and wrong about the other,
and separating them is the whole design:

- **Bringing the page up** is genuinely easy, and CORS genuinely does not apply.
  A real webview loads a remote URL as its own origin: logins, cookies, DRM,
  SPA players, autoplay policy — the page behaves exactly as it does in a
  browser, because it *is* one.
- **Getting the picture into the program** is where it breaks, and the wall is
  not the app, the shell, or a missing Tauri API. It is the browser's origin
  isolation, and it is enforced on the *media resource*, not on the element and
  not on the document that holds the canvas.

There are two separate walls here, and only the second is interesting:

- **DOM access.** Another document's element cannot be reached from ours at all.
  A canvas in the studio drawing the page's `<video>` is not refused, it is
  impossible — that element is not in our document.
- **Origin-clean.** A canvas may not read — and `captureStream()` may not carry —
  media whose *resource* is cross-origin and not CORS-enabled. This is the wall
  the first probe hit.

So the design that follows from injecting our canvas into the page is still
wrong, but for the less interesting reason: it buys DOM access to the video and
then meets the origin-clean wall.

**Except that it does not, on a page that uses MSE.** This is the finding that
reshaped the plan, and it is the reason the first correction was itself wrong. On
YouTube the video's `src` is a `blob:` URL owned by the page, because the page
fetched the CDN's fragments itself and pushed them into a `MediaSource`. To the
origin-clean check the media resource is *the page's own blob*, not
`googlevideo.com` — so it is readable, and capturable, with no CORS involved.
Measured on a live stream: drawing the video into a canvas read real pixels, and
`captureStream()` returned a live, unmuted video track whose frames played back at
full brightness.

The distinction that matters is therefore not "same-origin versus cross-origin"
but **how the page feeds its video**:

| the page feeds its video by | its resource origin | readable? |
| --- | --- | --- |
| MSE — `MediaSource`/`appendBuffer` (YouTube, Twitch) | the page's own `blob:` | **yes** |
| a `<video src>` on the page's own origin | the page | yes |
| a `<video src>` cross-origin with `crossorigin` and CORS headers | the other origin, approved | yes |
| a `<video src>` cross-origin, plain | the other origin, opaque | **no** — tainted, `SecurityError` |

Of the three layers people naturally collapse into one, only the middle one is
hard:

1. **Compositing** — putting layers over each other. Free, but only within one
   document. The studio already does it: video, corner cameras and strokes into
   one canvas, which is the program.
2. **Reading** — turning rendered content into data we may draw. Licensed
   per-resource-origin — and on an MSE page, already granted to the page.
3. **Getting it on air** — a composited result becoming a `MediaStream`. Only our
   own canvas or a captured surface can.

The way through turned out to be the cheapest one available: **inject a script
into the browser webview and take the page's own video element**, which on the
platforms that matter is already readable.

## The routes

### A — the element, over an in-process peer connection *(recommended primary)*

A script injected into the browser webview calls `captureStream()` on the page's
`<video>` and hands the resulting track to the studio over a loopback
`RTCPeerConnection`. The studio receives a `MediaStream` and treats it as an
ordinary stage source — the same seam `useHostCameras`, `useDisplayCapture` and
`useMediaFeeds` already use, so the compositor, mixer and broadcast need to know
nothing about where the picture came from.

- **Measured on a live YouTube stream**: one video track and one audio track,
  neither muted, 854×480, and the captured frames carried real picture — captured
  mean luma 128 against the source's 129. Content, not a black rectangle.
- **The cheapest route there is.** No re-encode, no copy, no second decode in the
  studio, and no coupling to how the site drives its player: the page hands us a
  track and we never touch its media pipeline.
- **No CORS, no taint, no permission** on MSE pages, and the audio comes with it.
- **Refused on a cross-origin progressive `<video>`**: Chromium throws
  `SecurityError`, measured on a two-port probe. It fails loudly, which is what
  lets the UI name the reason instead of showing black.
- **Refused on DRM**, and this one is a platform guarantee rather than a limit of
  ours: an EME-protected element has `mediaKeys` set, and its frames are protected
  from capture. Detected and refused, never displayed as black.
- **Absent from WebKit.** `HTMLMediaElement.captureStream()` is not implemented in
  Safari or WebKitGTK, so this route is Chromium-only: Windows, and Android. macOS
  and Linux need T.

### T — tee the fragments *(the WebKit fallback)*

A script injected into the browser webview wraps `SourceBuffer.appendBuffer` (and
reads the mime from `addSourceBuffer`), copies each fragment the page is about to
play, and ships it to the studio, which builds its own `MediaSource` with the same
mime and appends the same bytes into a `<video>`.

This was the primary route until A was measured, and on Chromium it is now largely
redundant — MSE pages are capturable directly, and A is simpler, cheaper and less
coupled to somebody else's player. It stays in the plan for the engines where A
does not exist: **macOS and Linux**. Whether it is any use there is unmeasured.

Measured anyway, on the same live stream, the interception works and is cheap to
install: wrapping the prototypes caught four `SourceBuffer`s —
`video/mp4; codecs="av01.0.04M.08"`, `video/webm; codecs="vp09.00.51.08…"`,
`audio/mp4; codecs="mp4a.40.2"` and `audio/webm; codecs="opus"` — and 281 appends
carrying 5.3 MB within a few seconds, so a live stream's bytes can be read this
way.

- **Costs**: every fragment is copied synchronously, the studio decodes a second
  copy of the video (the page decodes one too), and the bridge must be connected
  *before* the player's first append. Miss that and the init segment is gone —
  which is exactly what the probe did by patching after the player had started,
  and why its 24 captured fragments could not be decoded into a picture. The flow
  has to be "connect, then load the page", or press Reload.
- **Blind to progressive pages**, which have no `appendBuffer` to wrap — the same
  case A cannot read either.
- **DRM is refused**, as everywhere: encrypted fragments are useless without the
  CDM.

### P — fetch from the page's own context

The injected script fetches `video.currentSrc` itself. The element plays
cross-origin media without CORS, but a JS `fetch` of the same URL *does* require
CORS, so this works only where the CDN already allows the page's origin — cheap
to probe from inside the page, and a useful complement to T for progressive
files.

### B — the screen, captured natively and re-encoded

Windows.Graphics.Capture, ScreenCaptureKit, X11/PipeWire, Android MediaProjection
— encoded and pushed across the IPC boundary the publisher already uses
(`src-tauri/src/stream.rs` reads exactly this shape), decoded in the studio via
MSE.

- **Universal.** DRM, cross-origin iframes, canvas-heavy players: it captures what
  is rendered and inherits none of the element route's blind spots. Protected
  surfaces are the exception — platforms that blank them in OS capture blank them
  here too.
- **Expensive and platform-heavy**: four capture implementations, a permission
  flow each, and capture→encode→IPC→decode per feed. On a phone, MediaProjection
  captures the whole screen or one chosen app, and the app must be *on* screen to
  be captured — which puts the studio and the video in the same rectangle being
  drawn over.

### S — share a tab or screen *(today's route, keep it)*

On the desktop this is already implemented, it is immune to everything above
(capturing a composited surface is not reading a cross-origin resource), and it
is the one route that needs no cooperation from the page at all. It stays. Its
limit is unchanged: no phone.

### S+ — our own browser window, captured by the existing pipeline

The cheapest coherent version of S: instead of asking the operator to go and find
some other browser and share a tab from it, the app owns a chromeless browser
window, and that window — one we can name — is what gets captured. Its frames
arrive as a `MediaStream` through `useDisplayCapture`, which is code that already
exists and already works, so the compositor, mixer and broadcast stay untouched.

This is not a footnote, it is the strongest practical argument for the S family:
capture reads the *composited surface*, so every wall the byte routes keep hitting
— the resource's origin, canvas taint, cross-origin iframes, `captureStream()`
throwing — simply does not exist here. It is S+ where S is available, since it is
the same API: **wherever the table above says S works, S+ is S with the source
chosen for you**, so the table needs no new column.

Two things it cannot do, and both matter:

- **The picker cannot be skipped.** `getDisplayMedia` requires the operator to
  choose a source; no API preselects another window. `preferCurrentTab` is
  Chrome-only and means the *studio*, which is the recursion case — capturing the
  window that is displaying the capture. So S+ is one click and one dialog, not
  zero. Removing the dialog means capturing our own window *natively*, which is
  route B narrowed to one window: reliable and picker-less, but it is exactly the
  capture→encode→IPC→decode chain this route exists to avoid.
- **Hiding it is the one thing that breaks it.** Capturing a minimised or hidden
  window is not reliable on any platform, and Tauri cannot opt out of background
  throttling on Windows or Linux, so "reveal and hide by rail selection" risks a
  frozen program rather than a paused one. The shape that survives is
  **raise, not hide**: the tile brings the browser window forward for interaction
  while the page keeps rendering behind the studio. Whether occluded-but-visible
  really keeps producing frames is the measurement that decides the rail's
  behaviour, and it is worth taking before the UI is designed around either
  answer.

And the honest limit of the whole S family, S+ included: **there is no
`getDisplayMedia` on Android**, so none of this reaches the platform that started
the discussion. S+ is a desktop improvement — a good one, and nearly free — while
the phone still needs one of the byte routes.

The two are not rivals. The same owned browser window can offer **Use this page**
(the element route: no dialog, no permission, no second decode, and the only
option on a phone) where the engine supports it, and fall back to **Capture this
window** (the picker: universal on the desktop, immune to everything above) where
it does not. Same window, two bridges, chosen by capability — and both end in the
same `MediaStream` seam.

## Recommended shape

**A first**, because it is the cheapest route and it is now measured on six
platforms rather than one. Injected into a browser webview we own, it turns a live
stream into a stage source with no permission, no capture dialog, no new platform
code and no second decode — and it reaches **the phone**, since Android's WebView
is Chromium. The sweep found no platform where the player worked and route A did
not: Twitch, Kick, Rumble, Facebook and Bilibili all behaved exactly as YouTube
did, because all six ship the same MSE `blob:`. What it *did* find is that the
bridge must choose which element to take, and that the platforms most people name
first gate a logged-out session — see [the measurements](#what-has-been-measured).

**T** follows only where A cannot run: macOS and Linux, whose WebKit has no
`captureStream()`. It is no longer first in line, and it is worth building only
once somebody has measured whether a page's player works in those webviews at all.

**S** and its **S+** refinement stay the desktop universal, because they need no
cooperation from the page, and S+ is nearly free — a window and a picker on top of
capture code that already ships. **B** stays the escape hatch for DRM and exotic
players, and for a phone if A turns out not to hold in Android's WebView.

Reasons, in order of weight: A needs no permission, no platform code and no second
decode, and it moves a `MediaStream` — the shape the compositor, mixer and
publisher already understand. Its failure modes (a cross-origin progressive file,
DRM) are cases where an honest refusal is the correct answer rather than a
shortcoming.

### The browser surface

A separate window that loads any URL: an address bar, back/forward/reload, and a
**Use this page** action. Stable Tauri on the desktop (`WebviewWindowBuilder` +
`WebviewUrl::External`). On Android, multi-window is Activity Embedding and is a
*large-screen* feature: side by side on a tablet or foldable (Android 12L / API
32+), while on a handset the second window is just another activity on the back
stack. That is not a defect to route around — on a phone the browser is full
screen, and the payoff is that the video becomes a feed that plays *in the
studio*, which is where it is being drawn on.

### How the two webviews talk

They are different origins, so there is no shared JavaScript context and no
`postMessage`. Two channels, both initiated from Rust, neither of which gives the
third-party page access to our app:

- **Inbound:** `Webview::eval` from Rust. Rust runs it, not the page, so it works
  regardless of the page's origin.
- **Outbound:** the injected script sets `document.title`, read by
  `on_document_title_changed`. Tauri does not hand IPC to a remote origin unless
  a capability lists that origin, and we will not list one — a page must never be
  able to call our commands. Chunked, because an SDP answer is bigger than a
  title comfortably holds. A deliberate, documented hack: a one-shot handshake,
  not a data path — media and fragments flow over the peer connection itself.

Whether a page's own title writes collide with our chunks, and what a page that
fights us over the title does, is a Phase 0 question.

## What has been measured

### A cross-origin progressive file is refused

Two ports on loopback serving the same WebM, so the page differed from the video
only in origin — the shape of a page serving its own media. One Chromium tab:

| | same origin | different origin |
| --- | --- | --- |
| draw the page's video into a canvas, then `getImageData` | works, mean luma 123 | **`SecurityError`** — tainted |
| `video.captureStream()` | 1 live video track, frames carrying real content (mean luma 124) | **throws `SecurityError`** |
| feed the captured track to a second `<video>` | plays, 320×180 | — |

Caveats, so this is not over-read: Chromium only. WebView2 and Android's WebView
are Chromium, so this is the right engine for two of the three platforms;
WKWebView (macOS) and WebKitGTK (Linux) are unmeasured and may fail differently.
The frame counter in that probe read low for reasons that were its own
(current-time sampling on a four-second clip) — the load-bearing results are the
`SecurityError` and the pixel content, not the count.

### A live YouTube stream is readable, and capturable

A real live stream in the same Chromium, with the page's own MSE prototypes
wrapped and then a second video selected in-page to force the player to rebuild:

| | observed |
| --- | --- |
| the video's `src` | a `blob:` URL on `www.youtube.com`, not a `googlevideo.com` address |
| drawing the video into a canvas, then `getImageData` | works, mean luma 129 |
| `video.captureStream()` | 1 video track + 1 audio track, neither muted |
| that track fed to a second `<video>` | plays at 854×480, mean luma 128 |
| `MediaSource` prototypes wrapped | 4 `SourceBuffer`s, mimes read; 281 appends, 5.3 MB |
| decoding the fragments we copied | **not possible** — the init segment was appended before the wrapper went in |

Read together, the two runs say the deciding question is not which origin the
*bytes* come from but how the page feeds its video: an MSE page hands its own
`blob:` to the element, and everything downstream of that is ordinary same-origin
media. The fragment route works mechanically but needs the bridge in place before
the player starts, which is a scheduling constraint the element route simply does
not have.

Both probes are deleted, along with their servers. What they answered was the
design question that mattered; the numbers above are the whole record.

### The same question asked of eight more platforms

One question, asked of every platform an operator is likely to open: does route A
work the same way on all of them? YouTube is the row above; every other row was
measured the same way — navigate to a live stream, let the player start, read the
element's own state, draw one frame into a 64×36 canvas and take its mean luma,
then call `captureStream()`, play the returned track into a second `<video>`, and
take *that* mean luma. Real live streams over the real network, one Chromium tab,
no injected polyfill of any kind.

| platform | logged-out session | `<video>` | its `src` | canvas | `captureStream()` | captured frame |
| --- | --- | --- | --- | --- | --- | --- |
| **YouTube** *(baseline)* | plays | main frame | `blob:` | readable, luma 129 | 1 video + 1 audio, unmuted | 854×480, luma 128 |
| **Twitch** | plays | main frame | `blob:` | readable, luma 36 | 1 video + 1 audio, unmuted | 1280×720, luma 35 |
| **Kick** | plays | main frame | `blob:` | readable, luma 70 | 1 video + 1 audio, unmuted | 1280×720, luma 75 |
| **Rumble** | plays | main frame | `blob:` | readable, luma 189 | 1 video + 1 audio, unmuted | 1920×1080, luma 189 |
| **Facebook Live** | login prompt over the page, the player loads anyway | main frame | `blob:` | readable, luma 93 | 1 video + 1 audio, unmuted | 1920×1080, luma 77 |
| **Bilibili Live** | plays | main frame | `blob:` | readable, luma 79 | 1 video + 1 audio, unmuted | 1280×720, luma 66 |
| **TikTok Live** | the room renders, chat and all — **no `<video>` is ever attached** | — | — | — | — | — |
| **Instagram** (reels, live) | login-gated; the posts never load | — | — | — | — | — |
| **X** | hard login wall before anything | — | — | — | — | — |

Six of the nine worked, and they worked *identically*: one unmuted video track,
one unmuted audio track, and a captured frame whose luma matched the source's
within a couple of points. The captured picture was the real picture, not black.
That uniformity is the finding. It is not six coincidences — it is one player
technology, and the platform names are only a list of who happens to use it.

#### Every player that worked is MSE, and that is *why* it worked

Each of the six served its live video through `MediaSource`, so the element's
`src` was a `blob:` URL the page had built itself. The bytes are still on a CDN in
another company's rack — Twitch's, Rumble's, Bilibili's — but the *resource* the
element plays is the page's own `blob:`, and origin-clean is a property of the
resource, not of where the bytes were fetched from. Route A does not need the
platform's permission, its CORS headers, or its cooperation. It needs MSE, and
MSE is what every large platform uses because it is how you do adaptive bitrate.

Which means the answer generalises further than the six. The question to ask of a
platform is not "is it big?" but "does it ship a `blob:` to a `<video>`?", and any
platform doing HLS or DASH in the browser does.

#### The ads are the exception, and they prove the rule

Kick and Rumble each put a **second `<video>` on the same page** as the live
stream — an ad fed a **cross-origin progressive MP4** (`static.kick.com`,
`hugh.cdn.rumble.cloud`). On those, measured on the same pages as the passing rows
above:

| | the live stream | the ad element |
| --- | --- | --- |
| draw it into a canvas, then `getImageData` | works | **`SecurityError`** — tainted |
| `captureStream()` | 1 video + 1 audio | **throws** `SecurityError: Cannot capture from element with cross-origin data` |

This is the two-port probe from the first measurement, found in the wild, on the
same page as a working capture. It sets a requirement the design did not have
before: **the bridge cannot simply take the first `<video>` it finds.** It has to
choose, and the choice is not guesswork — the live stream is the element with a
`blob:` source and a current frame; the ad is a plain `https:` on someone else's
host. `pickPageVideo` below is that choice, with these two pages as its test
cases.

Rumble's page also carried a third, **empty** `<video>` — no source, no frame,
`captureStream()` returning **zero tracks without throwing**. So "no tracks" and
"refused" are different answers and must not be collapsed into one notice.

#### Two of the three refusals are the platform's, not the browser's

TikTok, Instagram and X did not fail the way a black stage would suggest. They
failed *earlier*: the page never gave us a video to judge.

- **TikTok Live** rendered the entire room — title, viewer count, scrolling chat,
suggested creators — and never attached a `<video>`. Not a muted element, not a
`srcObject`, none at all. The stream is withheld from a logged-out session.
- **Instagram** treated `/reel/` as a profile handle and would not load a single
post; live viewing is behind the same wall.
- **X** put a login wall in front of `/i/live` itself and redirected to it.

No capture design can do anything about this, and the conclusion is not that the
feature fails there — it is that **cookie-carrying browsing is a requirement, not
a nicety.** An operator who is signed in to these sites is the ordinary case, and
a capture path that cannot reach a signed-in page is worth little. So the browser
webview this plan calls for must keep a **persistent profile** — the same
storage the user's logins live in, surviving restarts — rather than starting each
session clean. Facebook is the milder version of the same fact: its player loaded
and captured perfectly at 1080p *behind* the login prompt, so the capture was
never the problem; being able to browse the site was.

#### A player inside someone else's page is out of reach entirely

The one limitation that no engine choice fixes. A third-party page with a
`<video>` of its own is fine — that is the ordinary case. But a third-party page
that **embeds** the player (YouTube's `/embed/`, Twitch's player, Dailymotion's)
puts the video inside a cross-origin iframe, and measured directly:

| | observed |
| --- | --- |
| `iframe.contentDocument` from the page around it | **`null`** |
| `<video>` elements visible to the page around it | **0** — the player's element is inside the frame |

So on a news site that embeds a stream, the injector finds nothing, and the
honest advice is not "start the video" — there is no video it can see. The
operator has to open the stream **on the platform's own page**, in its own tab of
our browser, where it is the top-level document. Where they cannot or will not,
the existing tab/screen share is the answer, which is why that path stays in the
build even once route A ships.

#### What this changes in the plan

Route A survives the sweep — nothing here made it fail where it was expected to
work, and the refusals all have a named fallback. It does pick up three
obligations it did not have when the plan was written:

1. **Choose among the page's videos.** `pickPageVideo` in `src/lib/webPageInput.ts`,
   pinned by the Kick and Rumble ad elements.
2. **Keep a persistent, sign-in-able profile.** The login walls on Facebook,
   TikTok, Instagram and X are the whole ballgame for those platforms.
3. **Say "embedded, so unreachable" rather than "no video".** The two are
   different situations with different fixes and must not share a notice.

Still unmeasured, and still load-bearing: the same question asked inside Android's
own WebView rather than Chrome, and Chromium is the only engine any of this has
been measured in. The table above is Chromium's answer; macOS and Linux are the
WebKit fallback's problem, which is why route T is Phase 3 rather than dead.

## Which engines this needs

The shell runs each platform's own webview — that is Tauri's design rather than a
setting — so "do we need Chromium?" is really four separate questions:

| | shell webview | route A (the element) | route T (the fragments) | route S (share) |
| --- | --- | --- | --- | --- |
| **Windows** | WebView2 — Chromium | yes | yes | yes |
| **Android** | Android WebView — Chromium | expected; verify in the WebView, not just Chrome | expected; MSE is in the modern WebView | no API at all |
| **macOS** | WKWebView — WebKit | **no** — WebKit does not implement `HTMLMediaElement.captureStream()` | plausible: Safari has MSE and no Widevine, so it turns on whether the *page* plays in a bare webview | yes, after the Screen Recording grant |
| **Linux** | WebKitGTK — WebKit | **no**, same reason | doubtful — MSE is the weak link here, and this is the engine where the docs already call screen capture unreliable | yes, unreliably |

Two things follow. First, **the platform that motivated all of this is already
Chromium**: a phone needs no pivot, and neither does Windows. Second, the engine
gap is exactly the pair where our own docs already list gaps, and **it costs
route A on macOS and Linux outright** — so Phase 1 cannot promise element capture
on the desktop, only on Windows.

With A measured, the route T column above is a fallback rather than a peer: it
exists for the engines where A does not exist, not to compete with it.

### So does this need a pivot?

Not to make the feature work on the phones, which is the part that matters. And
"pivot to Chromium" is worth pricing honestly before choosing it: Tauri has no
Chromium backend to switch on, so it is not a flag — it is Electron, or an
embedded CEF, and it would take the app's identity with it. The docs and the
landing page sell *one standalone executable, about 6 MB, and a 7 MB APK*; a
bundled Chromium multiplies that by roughly thirty and adds an update-and-security
treadmill of its own. That is a product decision, not an implementation detail.

There is a third way that is neither: on macOS and Linux, **drive a Chromium the
user already has** rather than shipping one. Launched into its own profile, a
Chrome-family browser in app mode with a remote-debugging port gives us exactly
what the feature needs — `Runtime.evaluate` *is* the injection, no extension
required, and `Page.startScreencast` exists as a last-resort frame source — with
no bundle cost and no change to the app's size story. Two caveats, both
measured rather than assumed: it requires a Chrome-family browser to be present
(falling back to route S when it is not), and since Chrome 136 the debugging port
is ignored on the default profile, so the browser must be launched with its own
`--user-data-dir` — which is what we want anyway, since it keeps the operator's
real profile out of it.

So the shape is tiers, not a pivot: Chromium engines get routes A and T; macOS and
Linux get a CDP-driven browser if one is installed and route S if not;and every control the platform cannot honour is simply not drawn, which is the rule
`src/lib/capture.ts` already follows.

### What skipping the internal browser costs on Android

Android *does* let an app capture other apps' screens, so this is not the platform
refusing. `android.media.projection` has done it since Android 5 (API 21), and
Android 14 (API 34) added **app screen sharing** — the user shares one chosen app
window, with the status bar, notifications and every other app left out,
"regardless of windowing mode". Apps using the projection APIs get that choice for
free from `createScreenCaptureIntent()`, and `onCapturedContentVisibilityChanged()`
exists for exactly our case: the host app showing the captured app's content on the
same screen the user is looking at.

The catch is not the platform, it is the surface: **Android's WebView has no
`getDisplayMedia`**, which is why the screen row is already missing from the APK.
So a capture route here is not a call from our own code — it is a new Kotlin
plugin, and the price is in the details:

- **Consent cannot be remembered.** On Android 14+ the projection token is
  single-use and `createVirtualDisplay()` may be called once per token, so *every*
  session asks again. There is no "share this app" that sticks.
- **A foreground service is mandatory** when targeting Android 14+:
  `FOREGROUND_SERVICE_MEDIA_PROJECTION`, a service declared with
  `foregroundServiceType="mediaProjection"`, started with `startForeground()` —
  and with it a visible, persistent notification.
- **The user can stop it, and the system will.** From Android 15 QPR1 a status bar
  chip announces the projection and ends it on a tap, and projection stops by
  itself when the device is locked. For a phone on a sideline that is not a
  hypothetical.
- **Single-app sharing needs Android 14+.** Below that it is the whole display or
  nothing — and on a handheld the whole display is the studio showing the capture:
  the recursion case, with no way out.
- **The frames still have to reach the compositor.** A `VirtualDisplay` writes to a
  `Surface`; getting that into the JS canvas means an encode and a native path into
  the studio — the same encoded-frames shape route B needs, now written in Kotlin.

And the consequence that matters most: **a browser we do not own cannot be teed**,
so skipping the internal browser kills route T on *every* platform, not just
Android. The desktop absorbs that, because S and S+ already work there. Android is
left with neither capture (it never had it) nor a tee (no browser of ours to
instrument) — only cameras, local files and a bare link, which is precisely the
web-video case in question.

The ranking inverts, which is the part worth weighing: **with the tee, Android is
the best-served platform in this plan** — no permission, no foreground service, no
status chip, no lock fragility, and it works on any phone since API 24 — while
macOS and Linux are the doubtful ones, since WebKit has no `captureStream()` at
all. Skipping the internal browser sends Android from best-served to worst-served.
The native plugin is *more* work than the browser and the tee, for a strictly worse
experience, so skipping it is a false economy rather than a saving.

If it must be skipped anyway, the one honest fallback on a tablet is Android 14
app screen sharing in split screen — share Chrome, draw in the studio — which is
the trade the desktop already makes, minus everything that makes it pleasant.

## Phases

Each phase is shippable and each keeps the repo's checks green on its own.

### Phase 1 — desktop: the browser window and route A

This is now the phase that delivers the use case, not a warm-up: a **Web page** row
in Add input beside the existing stream-URL row (a bare `.m3u8` or `.mp4` link is
still better served by the direct path), the browser window with its address bar,
and **Use this page** calling `captureStream()` on the page's video and handing the
track to the studio. The `SecurityError` case becomes a notice that names the
reason, not a mystery.

On macOS and Linux the row appears only once a browser surface exists there, so
this phase is Windows plus whatever the CDP path proves to be; the row is absent
rather than present-and-broken everywhere else.

- Pure logic in `src/lib/webPageInput.ts` with a sibling test file, in the
  established style: URL normalisation, the handshake state machine, and the
  failure classification (cross-origin media / DRM / no video found / connection
  failed).
- Notices through the existing `media.notice`/`side-note` pattern.
- The feed joins the existing `MAX_MEDIA_FEEDS` budget rather than getting one of
  its own.
- `src/lib/desktop.ts` gains the shell calls; nothing else may ask about the
  shell, and the row is not drawn in the web build — `canShareScreen`'s
  capability rule, applied again.

### Phase 2 — Android, which is where A pays off

The same browser window as a second activity on 12L+, and the honest fallback
below that. The things to establish first, because everything else leans on them:
whether `captureStream()` exists in Android's WebView at all (it is Chromium, but
WebView gates features Chrome has), and whether a page's media keeps flowing once
the browser activity is not the one on screen — if it suspends, the phone story is
"open the page, start it, come back", and the docs say so.

Only if A fails here does the tee matter for a phone, and only if both fail does
the Kotlin plugin in *What skipping the internal browser costs on Android* become
the answer.

### Phase 3 — route T, for macOS and Linux

The fragment tee, for the two engines where element capture does not exist. It is
worth building only after somebody has established that a page's player works in
those webviews at all — if the page will not play, there is nothing to tee.

### Phase 4 — route B, only if DRM pages are worth it

## Risks worth naming before we start

- **DRM is not fixable by T or A.** Broadcast sports with Widevine, YouTube's
  licensed content, streaming services: refused, with a notice that says why.
- **The tee is invasive.** It wraps a hot API and copies every media byte of the
  page. It costs CPU and memory, and it is coupled to how a site drives MSE — a
  site that changes its player can break it without anything of ours changing.
- **No platform here is a stable interface.** Everything in T is an
  implementation detail of someone else's player, and it must be written to fail
  honestly rather than quietly.
- **The engine coverage is a measurement, not a claim.** Route T on macOS is
  plausible from the engine's capabilities and unproven; on Linux it is doubtful.
  Neither should be written into the README or the landing page's table until it
  has been run on the platform.
- **Two webviews, one process.** A 1080p60 page *plus* a second decode and an
  encode is real work on a phone. Measure before claiming it is fine.
- **Somebody else's window list.** S+ assumes our browser window appears in the
  OS picker and stays listed while the studio is in front, and that capture keeps
  flowing when it is occluded. Both are platform behaviour, not ours to choose,
  and both are cheap to measure per platform.
- **The largest platforms gate a logged-out session.** Measured: TikTok never
  attaches a `<video>`, Instagram will not load a post, X puts a login wall in
  front of its own live page, and Facebook's player is behind a prompt. A browser
  that cannot carry a login is not a browser for those sites — which means a
  **persistent profile**, and therefore that this app ends up holding the
  operator's cookies for them. That is a privacy decision as much as a technical
  one, and it is the one real cost of the whole approach.
- **The claims in the README, the landing page's feature table and the two docs
  all move**: "capture a tab or screen" stops being the whole story of outside
  pages, and the phone table stops saying the phone can only read a bare link.

## Invariants to add to `AGENTS.md` when this lands

- A third-party page runs in exactly one place — the browser webview — and is
  never given IPC, a capability, or a way to call a command.
- The bridge carries encoded bytes or a `MediaStream`, never pixels, and never a
  page's DOM.
- Cross-origin media is *refused* — `captureStream()` throwing `SecurityError` is
  the expected outcome, not a bug to work around.
- A page whose video cannot be read (DRM, no video, refused) is refused with a
  reason, never displayed as black.
- The video is **chosen**, not assumed: a page can carry a live stream and a
  cross-origin ad element, and the first `<video>` is as likely to be the ad.
- An embedded player and an empty one give different notices. "Start the video"
  is wrong advice about a frame we cannot look inside.
- The browser keeps a **persistent profile**, because the platforms that matter
  (Facebook, TikTok, Instagram, X) will not show a logged-out session a stream at
  all.
- The browser surface is opened by `src/lib/desktop.ts` and nowhere else.
