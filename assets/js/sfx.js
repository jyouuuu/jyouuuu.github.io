/* ==========================================================================
   jiansketch SFX — tiny synth engine. No audio files, pure WebAudio.
   Every pop is born the moment you hear it.
   ========================================================================== */
(function () {
  "use strict";

  const SFX = {
    ctx: null,
    master: null,
    enabled: localStorage.getItem("jian_sfx") !== "off",
    voices: 0,
    MAX_VOICES: 16,
    unlocked: false,
  };

  // A-minor pentatonic ladder — sweeping the wall plays a melody.
  const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];
  const BASE = 330; // E4-ish starting rung

  function ensureCtx() {
    if (!SFX.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      SFX.ctx = new AC();
      SFX.master = SFX.ctx.createGain();
      SFX.master.gain.value = SFX.enabled ? 0.32 : 0;
      const comp = SFX.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 18;
      comp.ratio.value = 9;
      SFX.master.connect(comp);
      comp.connect(SFX.ctx.destination);
    }
    if (SFX.ctx.state === "suspended") SFX.ctx.resume();
    return SFX.ctx;
  }

  /* The satisfying bit: a bubble "pop" — bright sine that pitch-slides DOWN
     in ~70ms with a snappy gain envelope, plus a breath of noise at the top. */
  function pop(semitones, opts) {
    if (!SFX.enabled) return;
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== "running") return;
    if (SFX.voices >= SFX.MAX_VOICES) return;
    opts = opts || {};

    const t = ctx.currentTime;
    const f0 = BASE * Math.pow(2, semitones / 12) * (1 + (Math.random() - 0.5) * 0.01);
    const f1 = f0 * (opts.drop || 0.38);
    const dur = opts.dur || 0.16;
    const vol = opts.vol || 1;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.55);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85 * vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // noise tick = the "click" of the pop
    const nb = ctx.createBuffer(1, 900, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = f0 * 2.2;
    nf.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.28 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.max(-0.8, Math.min(0.8, opts.pan || 0));

    osc.connect(g);
    noise.connect(nf); nf.connect(ng);
    if (pan) {
      g.connect(pan); ng.connect(pan); pan.connect(SFX.master);
    } else {
      g.connect(SFX.master); ng.connect(SFX.master);
    }

    SFX.voices++;
    osc.start(t); noise.start(t);
    osc.stop(t + dur + 0.05); noise.stop(t + 0.08);
    osc.onended = () => {
      SFX.voices--;
      osc.disconnect(); noise.disconnect(); g.disconnect(); nf.disconnect(); ng.disconnect();
      if (pan) pan.disconnect();
    };
  }

  // sustained rounder tone for chords / party
  function tone(semitones, opts) {
    if (!SFX.enabled) return;
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== "running") return;
    if (SFX.voices >= SFX.MAX_VOICES) return;
    opts = opts || {};
    const t = ctx.currentTime;
    const f = (BASE / 1.5) * Math.pow(2, semitones / 12);
    const dur = opts.dur || 0.5;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * (opts.vol || 1), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(SFX.master);
    SFX.voices++;
    osc.start(t); osc.stop(t + dur + 0.05);
    osc.onended = () => { SFX.voices--; osc.disconnect(); g.disconnect(); };
  }

  const api = {
    // hover pop — tile index climbs the pentatonic ladder, pan -1..1
    plink(i, pan) {
      const step = SCALE[((i % SCALE.length) + SCALE.length) % SCALE.length];
      pop(step, { pan: pan || 0 });
    },
    // UI chrome hover — small high pop
    tick() { pop(26, { vol: 0.35, dur: 0.09 }); },
    // press-down thock
    thock() { pop(-7, { vol: 0.8, dur: 0.11, drop: 0.3 }); },
    // lightbox open: bright two-stage pop
    pop() { pop(12, { vol: 0.9 }); setTimeout(() => pop(19, { vol: 0.5, dur: 0.2 }), 55); },
    unpop() { pop(7, { vol: 0.55, dur: 0.14, drop: 0.25 }); },
    // page turn
    swish(dir) { pop(dir > 0 ? 15 : 12, { vol: 0.45, dur: 0.12 }); },
    // party strum
    party() { [0, 3, 7, 10, 12, 15, 19, 24].forEach((st, k) => setTimeout(() => pop(st, { vol: 0.7 }), k * 42)); },
    chord() { [12, 19, 24, 27].forEach((st) => tone(st, { vol: 0.4, dur: 0.9 })); },
    unlock() {
      const ctx = ensureCtx();
      if (ctx && ctx.state === "running" && !SFX.unlocked) {
        SFX.unlocked = true;
        pop(12, { vol: 0.7 }); // the "you're live" pop
        setTimeout(() => pop(24, { vol: 0.5 }), 70);
        document.dispatchEvent(new CustomEvent("jian:sfx-unlocked"));
      }
    },
    toggle() {
      SFX.enabled = !SFX.enabled;
      localStorage.setItem("jian_sfx", SFX.enabled ? "on" : "off");
      ensureCtx();
      if (SFX.master) {
        SFX.master.gain.cancelScheduledValues(SFX.ctx.currentTime);
        SFX.master.gain.linearRampToValueAtTime(SFX.enabled ? 0.32 : 0, SFX.ctx.currentTime + 0.05);
      }
      if (SFX.enabled) api.pop();
      return SFX.enabled;
    },
    isEnabled() { return SFX.enabled; },
    isUnlocked() { return SFX.unlocked; },
  };

  // browsers require a real gesture before audio — first click/key arms it,
  // pointermove keeps trying in the meantime (harmless when blocked)
  window.addEventListener("pointerdown", () => api.unlock(), { passive: true });
  window.addEventListener("keydown", () => api.unlock());
  window.addEventListener("pointermove", () => { if (!SFX.unlocked) api.unlock(); }, { passive: true });

  window.JIAN_SFX = api;
})();
