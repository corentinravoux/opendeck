// Video blocks in the deck runtime. The markup (ours):
//   <div class="sl-block" data-block-type="video" …><div class="sl-block-content" …>
//     <video src="media/….webm" poster="media/….png" data-print="media/….png" muted playsinline preload="auto"></video>
//   </div></div>
// Optional on the <video>: `loop`, data-autoplay="false" (default: play when the slide is entered),
// <source> children as fallbacks. Without `loop` a clip stops on its last frame, so a chain of
// clips (last frame of one = first frame of the next) reads as one animation.

const SELECTOR = '.sl-block[data-block-type="video"] video';

export function videosIn(root: ParentNode): HTMLVideoElement[] {
  return [...root.querySelectorAll<HTMLVideoElement>(SELECTOR)];
}

export const autoplays = (v: HTMLVideoElement) => v.dataset.autoplay !== "false";

/** A slide became current: its autoplay videos start from the beginning. */
export function enterSlide(section: HTMLElement): void {
  for (const v of videosIn(section)) {
    if (!autoplays(v)) continue;
    if (v.hasAttribute("muted")) v.muted = true; // muted playback needs no user gesture
    v.currentTime = 0;
    v.play()?.catch(() => undefined);
  }
}

/** A slide was left: its videos stop; autoplay ones rewind so a return shows frame 0 at once. */
export function leaveSlide(section: HTMLElement): void {
  for (const v of videosIn(section)) {
    v.pause();
    if (autoplays(v)) v.currentTime = 0;
  }
}

/** Click on a video (viewer only) plays or pauses it. */
export function togglePlay(v: HTMLVideoElement): void {
  if (v.paused || v.ended) v.play()?.catch(() => undefined);
  else v.pause();
}

/**
 * Viewer only: a video is its own play / pause button, for the mouse and for the keyboard. It
 * takes the focus (Tab), says what activating it does, and Enter or Space plays or pauses it
 * without also moving to the next slide.
 */
export function makeControllable(v: HTMLVideoElement): void {
  const label = () => v.setAttribute("aria-label", v.paused || v.ended ? "Play video" : "Pause video");
  v.tabIndex = 0;
  v.setAttribute("role", "button");
  label();
  for (const ev of ["play", "pause", "ended"]) v.addEventListener(ev, label);
  v.addEventListener("click", () => togglePlay(v));
  v.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) togglePlay(v);
  });
}

/**
 * Print mode: each video is replaced by its still (data-print, else poster), so a PDF page never
 * shows an empty box. A video with neither keeps its element, seeked to its last frame; the
 * returned promise settles when those frames are there (or after `timeoutMs`).
 */
export function printStills(section: HTMLElement, timeoutMs = 5000): Promise<void> {
  const waits: Promise<void>[] = [];
  for (const v of videosIn(section)) {
    const still = v.getAttribute("data-print") || v.getAttribute("poster");
    if (still) {
      const img = document.createElement("img");
      img.className = "od-video-still";
      img.src = still;
      img.alt = "";
      v.replaceWith(img);
    } else {
      waits.push(lastFrame(v, timeoutMs));
    }
  }
  return Promise.all(waits).then(() => undefined);
}

function lastFrame(v: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    const seek = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return done();
      v.addEventListener("seeked", done, { once: true });
      v.currentTime = Math.max(0, v.duration - 0.001);
    };
    v.addEventListener("error", done, { once: true });
    v.preload = "auto";
    if (v.readyState >= 1) seek();
    else v.addEventListener("loadedmetadata", seek, { once: true });
  });
}
