/* ==========================================================================
   justinyou.art — portfolio engine
   work grid, zoom lightbox, spray mode, scroll reveals, hamburger nav
   ========================================================================== */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  /* -------------------------------------------------- lightbox (zoom) --- */
  const lb = {
    el: null, img: null, cap: null, list: [], idx: 0,
    scale: 1, tx: 0, ty: 0, panning: false, px: 0, py: 0,
    build() {
      if (this.el) return;
      const el = document.createElement("div");
      el.className = "lightbox";
      el.innerHTML = `
        <div class="lightbox__stage"><img class="lightbox__img" alt=""></div>
        <div class="lightbox__cap"></div>
        <div class="lb-zoomhint">scroll / pinch to zoom · drag to pan · double-click to reset</div>
        <button class="lb-btn lb-btn--prev" aria-label="Previous">&lt;</button>
        <button class="lb-btn lb-btn--next" aria-label="Next">&gt;</button>
        <button class="lb-btn lb-btn--close" aria-label="Close">X</button>`;
      document.body.appendChild(el);
      this.el = el;
      this.img = el.querySelector(".lightbox__img");
      this.cap = el.querySelector(".lightbox__cap");
      el.addEventListener("click", (e) => { if (e.target === el) this.close(); });
      el.querySelector(".lb-btn--close").addEventListener("click", () => this.close());
      el.querySelector(".lb-btn--prev").addEventListener("click", () => this.step(-1));
      el.querySelector(".lb-btn--next").addEventListener("click", () => this.step(1));
      window.addEventListener("keydown", (e) => {
        if (!el.classList.contains("is-open")) return;
        if (e.key === "Escape") this.close();
        if (e.key === "ArrowLeft") this.step(-1);
        if (e.key === "ArrowRight") this.step(1);
      });
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }, { passive: false });
      this.img.addEventListener("dblclick", () => {
        if (this.scale > 1.2) this.resetZoom(); else { this.scale = 2.5; this.apply(); }
      });
      this.img.addEventListener("pointerdown", (e) => {
        if (this.scale <= 1) return;
        this.panning = true; this.px = e.clientX; this.py = e.clientY;
        this.img.setPointerCapture(e.pointerId);
        this.img.style.cursor = "grabbing";
      });
      this.img.addEventListener("pointermove", (e) => {
        if (!this.panning) return;
        this.tx += e.clientX - this.px; this.ty += e.clientY - this.py;
        this.px = e.clientX; this.py = e.clientY;
        this.apply();
      });
      const stop = () => { this.panning = false; this.img.style.cursor = "grab"; };
      this.img.addEventListener("pointerup", stop);
      this.img.addEventListener("pointercancel", stop);
    },
    zoom(f) {
      this.scale = Math.min(6, Math.max(1, this.scale * f));
      if (this.scale === 1) { this.tx = 0; this.ty = 0; }
      this.apply();
    },
    apply() {
      this.img.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    },
    resetZoom() { this.scale = 1; this.tx = 0; this.ty = 0; this.apply(); },
    open(list, idx) {
      this.build();
      this.list = list;
      this.idx = idx;
      this.resetZoom();
      this.show();
      this.el.classList.add("is-open");
      document.body.style.overflow = "hidden";
    },
    show() {
      const p = this.list[this.idx];
      this.img.src = p.f;
      this.img.alt = p.cap;
      this.cap.innerHTML = `${p.cap} &nbsp;·&nbsp; <b>${p.credit}</b> &nbsp;·&nbsp; ${this.idx + 1}/${this.list.length}`;
      this.resetZoom();
      [1, -1].forEach((d) => {
        const q = this.list[(this.idx + d + this.list.length) % this.list.length];
        if (q) new Image().src = q.f;
      });
    },
    step(d) {
      this.idx = (this.idx + d + this.list.length) % this.list.length;
      this.show();
    },
    close() {
      this.el.classList.remove("is-open");
      document.body.style.overflow = "";
    },
  };
  window.JY_LB = lb;

  /* -------------------------------------------------- work feed --------- */
  function buildGrids() {
    const data = window.JY_WORK || [];
    document.querySelectorAll("[data-sec]").forEach((host) => {
      const sec = host.dataset.sec;
      const items = data.filter((p) => p.sec === sec);
      // comics/hypeforce pages read better compact — grid instead of giant feed
      const compact = sec === "comics";
      const feed = document.createElement("div");
      feed.className = compact ? "feed-grid" : "feed";
      items.forEach((p, i) => {
        const fig = document.createElement("figure");
        fig.className = compact ? "feed-post feed-post--grid reveal" : "feed-post reveal";
        const img = document.createElement("img");
        img.src = compact ? p.t : p.f;
        img.alt = p.cap;
        img.loading = "lazy";
        img.decoding = "async";
        const cap = document.createElement("figcaption");
        const b = document.createElement("b");
        b.textContent = p.cap;
        const span = document.createElement("span");
        span.textContent = p.credit;
        cap.appendChild(b);
        cap.appendChild(span);
        fig.appendChild(img);
        fig.appendChild(cap);
        fig.addEventListener("click", () => lb.open(items, i));
        feed.appendChild(fig);
      });
      host.appendChild(feed);
      const count = document.querySelector(`[data-count="${sec}"]`);
      if (count) count.textContent = `${items.length} pieces`;
    });
  }

  /* -------------------------------------------------- draw mode (chisel marker) */
  function initSpray() {
    const btn = document.getElementById("sprayBtn");
    const cv = document.getElementById("sprayCanvas");
    if (!btn || !cv) return;
    const ctx = cv.getContext("2d");
    const COLORS = ["#ff2ea6", "#4ecfe0", "#ffe45b", "#a8e10c", "#7b5cff", "#ff2e63"];
    let on = false, ci = 0, lx = 0, ly = 0;
    function size() { cv.width = innerWidth; cv.height = innerHeight; }
    size();
    window.addEventListener("resize", size);

    function stroke(x, y) {
      ctx.strokeStyle = COLORS[ci % COLORS.length];
      ctx.lineWidth = 12;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      lx = x; ly = y;
    }

    let down = false;
    cv.addEventListener("pointerdown", (e) => {
      if (e.button === 2) return;
      if (e.shiftKey) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
      down = true; ci++;
      lx = e.clientX; ly = e.clientY;
      stroke(e.clientX + 0.01, e.clientY + 0.01); // dot for single taps
      const SFX = window.JIAN_SFX;
      if (SFX) SFX.thock();
    });
    cv.addEventListener("pointermove", (e) => { if (down) stroke(e.clientX, e.clientY); });
    const up = () => { down = false; };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);

    btn.addEventListener("click", () => {
      on = !on;
      btn.classList.toggle("is-on", on);
      btn.textContent = on ? "DONE ★" : "DRAW ★";
      cv.classList.toggle("is-live", on);
    });
  }

  /* -------------------------------------------------- reveals + nav ----- */
  ready(function () {
    buildGrids();
    initSpray();

    // sound — hover ticks + press thocks + toggle (engine in sfx.js)
    const SFX = window.JIAN_SFX;
    if (SFX) {
      document.querySelectorAll(".nav-btn:not(.nav-btn--sound):not(.nav-btn--menu), .btn, .client-chip, .feed-post, .feature__shot img, .contact__mail").forEach((el) => {
        el.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") SFX.tick(); });
        el.addEventListener("pointerdown", () => SFX.thock());
      });
      document.querySelectorAll(".nav-btn--sound").forEach((btn) => {
        btn.setAttribute("aria-pressed", SFX.isEnabled() ? "true" : "false");
        btn.textContent = SFX.isEnabled() ? "SOUND: ON" : "SOUND: OFF";
        btn.addEventListener("click", () => {
          const onNow = SFX.toggle();
          btn.setAttribute("aria-pressed", onNow ? "true" : "false");
          btn.textContent = onNow ? "SOUND: ON" : "SOUND: OFF";
        });
      });
    }

    // standalone images that open the lightbox solo
    document.querySelectorAll("[data-lb-single]").forEach((img) => {
      img.addEventListener("click", () => {
        lb.open([{ f: img.src, cap: img.alt, credit: "GRUNGE · original game" }], 0);
      });
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.08 });
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

    const menuBtn = document.querySelector(".nav-btn--menu");
    const navbar = document.querySelector(".navbar");
    if (menuBtn && navbar) {
      menuBtn.addEventListener("click", () => {
        const open = navbar.classList.toggle("is-open");
        menuBtn.textContent = open ? "CLOSE ✕" : "MENU ☰";
      });
      navbar.querySelectorAll("a.nav-btn").forEach((a) => {
        a.addEventListener("click", () => { navbar.classList.remove("is-open"); menuBtn.textContent = "MENU ☰"; });
      });
    }
  });
})();
