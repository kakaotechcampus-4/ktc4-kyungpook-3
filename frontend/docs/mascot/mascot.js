/**
 * 2D ring mascot matching the Figma frames:
 * ink outer ellipse + white inner ellipse + ink capsule eyes + timer crown.
 * Crown from Frames 12 / 17–20. Dial stripes from Frame 13.
 */
(function (global) {
  const NS = "http://www.w3.org/2000/svg";
  const R = 84;
  const INK = "#171717";
  const CORAL = "#FF6969";
  const PALETTES = {
    ink: { body: INK, cap: INK, eye: INK },
    coral: { body: CORAL, cap: CORAL, eye: CORAL },
    coralCap: { body: INK, cap: CORAL, eye: INK },
  };

  // Cap: Figma 40×21, rx 6. Positions from Frames 12 / 17 / 18 / 19 / 20
  // absoluteTransform centers, Outer R = 96.5. SVG rotate is clockwise +.
  const CAP_SIZE = { capW: 0.41451, capH: 0.21762, capRx: 0.06218 };
  const STRIPE_W = 0.03109;
  const STRIPE_PITCH = 0.1153;
  const STRIPE_COUNT = 13;
  const STRIPE_ORIGIN = -6;
  const DIAL_HZ = 1.1;

  const CAP_FRONT = Object.assign({ capX: -0.46691, capY: -1.06198, capRot: -22 }, CAP_SIZE);
  const CAP_LEFT = Object.assign({ capX: -0.26128, capY: -1.122, capRot: -13 }, CAP_SIZE);
  const CAP_RIGHT = Object.assign({ capX: -0.38736, capY: -1.08592, capRot: -19 }, CAP_SIZE);
  const CAP_UP_LEFT = Object.assign({ capX: -0.1211, capY: -1.14896, capRot: -6 }, CAP_SIZE);
  const CAP_UP_RIGHT = Object.assign({ capX: -0.68347, capY: -0.94451, capRot: -34 }, CAP_SIZE);

  const FRONT = {
    innerX: 0,
    innerY: -0.0725,
    innerRx: 0.782,
    innerRy: 0.762,
    eyeLX: -0.2485,
    eyeLY: -0.15,
    eyeLW: 0.176,
    eyeLH: 0.456,
    eyeRX: 0.2485,
    eyeRY: -0.15,
    eyeRW: 0.176,
    eyeRH: 0.456,
    eyeLRot: 0,
    eyeRRot: 0,
    open: 1,
    bounce: 0,
    dial: 0,
    ...CAP_FRONT,
  };

  const LEFT = {
    innerX: -0.155,
    innerY: -0.031,
    innerRx: 0.782,
    innerRy: 0.762,
    eyeLX: -0.674,
    eyeLY: -0.088,
    eyeLW: 0.155,
    eyeLH: 0.394,
    eyeRX: -0.29,
    eyeRY: -0.088,
    eyeRW: 0.176,
    eyeRH: 0.456,
    eyeLRot: 0,
    eyeRRot: 0,
    open: 1,
    bounce: 0,
    dial: 0,
    ...CAP_LEFT,
  };

  const RIGHT = {
    innerX: 0.155,
    innerY: -0.031,
    innerRx: 0.782,
    innerRy: 0.762,
    eyeLX: 0.29,
    eyeLY: -0.088,
    eyeLW: 0.176,
    eyeLH: 0.456,
    eyeRX: 0.674,
    eyeRY: -0.088,
    eyeRW: 0.155,
    eyeRH: 0.394,
    eyeLRot: 0,
    eyeRRot: 0,
    open: 1,
    bounce: 0,
    dial: 0,
    ...CAP_RIGHT,
  };

  const UP_LEFT = {
    innerX: -0.1036,
    innerY: -0.1347,
    innerRx: 0.782,
    innerRy: 0.762,
    eyeLX: -0.5832,
    eyeLY: -0.4381,
    eyeLW: 0.1554,
    eyeLH: 0.3678,
    eyeRX: -0.2178,
    eyeRY: -0.3786,
    eyeRW: 0.1762,
    eyeRH: 0.456,
    eyeLRot: 12.918,
    eyeRRot: 8.008,
    open: 1,
    bounce: 0,
    dial: 0,
    ...CAP_UP_LEFT,
  };

  const UP_RIGHT = {
    innerX: 0.1036,
    innerY: -0.1347,
    innerRx: 0.782,
    innerRy: 0.762,
    eyeLX: 0.2178,
    eyeLY: -0.3786,
    eyeLW: 0.1762,
    eyeLH: 0.456,
    eyeRX: 0.5832,
    eyeRY: -0.4381,
    eyeRW: 0.1554,
    eyeRH: 0.3678,
    eyeLRot: -8.008,
    eyeRRot: -12.918,
    open: 1,
    bounce: 0,
    dial: 0,
    ...CAP_UP_RIGHT,
  };

  const SQUINT = {
    innerX: 0,
    innerY: -0.0725,
    innerRx: 0.782,
    innerRy: 0.762,
    eyeLX: -0.3264,
    eyeLY: -0.122,
    eyeLW: 0.456,
    eyeLH: 0.1244,
    eyeRX: 0.3264,
    eyeRY: -0.122,
    eyeRW: 0.456,
    eyeRH: 0.1244,
    eyeLRot: 0,
    eyeRRot: 0,
    open: 1,
    bounce: 0,
    dial: 0,
    ...CAP_FRONT,
  };

  const EXPRESSIONS = {
    idle: Object.assign({}, FRONT),
    left: Object.assign({}, LEFT),
    right: Object.assign({}, RIGHT),
    curious: Object.assign({}, RIGHT),
    thinking: Object.assign({}, LEFT),
    talking: Object.assign({}, FRONT, { bounce: 1 }),
    happy: Object.assign({}, SQUINT),
    squint: Object.assign({}, SQUINT),
    upLeft: Object.assign({}, UP_LEFT),
    upRight: Object.assign({}, UP_RIGHT),
    dial: Object.assign({}, FRONT, { dial: 1 }),
  };

  let uid = 0;
  const instances = [];
  let raf = 0;

  function expApproach(cur, target, dt, lambda) {
    return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
  }

  function blinkEnvelope(t) {
    if (t < 0) return 0;
    if (t < 0.32) {
      const u = t / 0.32;
      return u * u * (3 - 2 * u);
    }
    if (t < 0.48) return 1;
    const u = (t - 0.48) / 0.52;
    return 1 - u * u * (3 - 2 * u);
  }

  function pressEnvelope(t) {
    if (t < 0) return 0;
    if (t < 0.34) {
      const u = t / 0.34;
      return u * u * (3 - 2 * u);
    }
    if (t < 0.52) return 1;
    const u = (t - 0.52) / 0.48;
    return 1 - u * u * (3 - 2 * u);
  }

  function el(name, attrs) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  class PebbleMascot {
    constructor(mount, options) {
      const opts = options || {};
      this.mount = typeof mount === "string" ? document.querySelector(mount) : mount;
      if (!this.mount) throw new Error("PebbleMascot: mount not found");
      this.size = opts.size || 320;
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.active = true;
      this.id = ++uid;

      this.exprName = "idle";
      this.pose = Object.assign({}, FRONT);
      this.poseTarget = Object.assign({}, FRONT);

      this.blinkT = -1;
      this.nextBlink = 1.8 + Math.random() * 1.4;
      this.pendingDouble = false;
      this.pressT = -1;
      this.nextPress = 3.2 + Math.random() * 2.2;

      this.talking = 0;
      this.talkingTarget = 0;
      this.dialPhase = 0;
      this.time = 0;
      this.last = 0;
      this.paletteName = PALETTES[opts.palette] ? opts.palette : "ink";

      this._build();
      this._applyPalette();
      instances.push(this);
      boot();
      this._render();
    }

    _build() {
      const svg = el("svg", {
        viewBox: "0 0 240 240",
        width: this.size,
        height: this.size,
        "aria-hidden": "true",
        focusable: "false",
      });
      svg.style.display = "block";
      svg.style.overflow = "visible";

      const gid = this.id;
      const defs = el("defs", {});
      const clip = el("clipPath", { id: "pb-face-" + gid });
      this.clipEllipse = el("ellipse", { cx: "0", cy: "0", rx: "1", ry: "1" });
      clip.appendChild(this.clipEllipse);
      defs.appendChild(clip);

      const capClip = el("clipPath", { id: "pb-cap-" + gid });
      this.capClipRect = el("rect", {});
      capClip.appendChild(this.capClipRect);
      defs.appendChild(capClip);

      const root = el("g", { transform: "translate(120 120)" });
      this.puppet = el("g", { "data-part": "puppet" });

      this.outer = el("circle", { "data-part": "outer", r: R, fill: INK });
      this.inner = el("ellipse", { "data-part": "inner", fill: "#FFFFFF" });

      this.capG = el("g", { "data-part": "cap-g" });
      this.cap = el("rect", { "data-part": "cap", fill: INK });
      this.stripesG = el("g", {
        "data-part": "dial",
        "clip-path": "url(#pb-cap-" + gid + ")",
        opacity: "0",
      });
      this.stripeShift = el("g", { "data-part": "dial-shift" });
      this.stripes = [];
      for (let i = 0; i < STRIPE_COUNT; i++) {
        const stripe = el("rect", { fill: "#FFFFFF" });
        this.stripeShift.appendChild(stripe);
        this.stripes.push(stripe);
      }
      this.stripesG.appendChild(this.stripeShift);
      this.capG.appendChild(this.cap);
      this.capG.appendChild(this.stripesG);

      this.eyesG = el("g", {
        "data-part": "eyes",
        "clip-path": "url(#pb-face-" + gid + ")",
      });
      this.eyeL = el("rect", { "data-part": "eye-l", fill: INK });
      this.eyeR = el("rect", { "data-part": "eye-r", fill: INK });
      this.eyesG.appendChild(this.eyeL);
      this.eyesG.appendChild(this.eyeR);

      this.puppet.appendChild(this.outer);
      this.puppet.appendChild(this.inner);
      this.puppet.appendChild(this.capG);
      this.puppet.appendChild(this.eyesG);
      root.appendChild(this.puppet);
      svg.appendChild(defs);
      svg.appendChild(root);
      this.mount.appendChild(svg);
      this.svg = svg;
      svg.style.cursor = "pointer";
      svg.addEventListener("click", () => this.pressNow());
    }

    setExpression(name) {
      const next = EXPRESSIONS[name];
      if (!next) return;
      this.exprName = name;
      this.poseTarget = Object.assign({}, next);
    }

    setTalking(on) {
      this.talkingTarget = on ? 1 : 0;
      if (on) this.setExpression("talking");
    }

    setPalette(name) {
      if (!PALETTES[name]) return;
      this.paletteName = name;
      this._applyPalette();
    }

    _applyPalette() {
      const pal = PALETTES[this.paletteName] || PALETTES.ink;
      this.outer.setAttribute("fill", pal.body);
      this.cap.setAttribute("fill", pal.cap);
      this.eyeL.setAttribute("fill", pal.eye);
      this.eyeR.setAttribute("fill", pal.eye);
    }

    pressNow() {
      if (this.reduced) return;
      this.pressT = 0;
    }

    pause() {
      this.active = false;
    }

    resume() {
      this.active = true;
      this.last = 0;
    }

    tick(now) {
      if (!this.active) return;
      if (!this.last) this.last = now;
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      this.time += dt;

      const keys = Object.keys(this.poseTarget);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        this.pose[key] = expApproach(this.pose[key], this.poseTarget[key], dt, 8);
      }
      this.talking = expApproach(this.talking, this.talkingTarget, dt, 6);
      if (!this.reduced && (this.pose.dial > 0.02 || this.poseTarget.dial > 0.02)) {
        this.dialPhase += dt * DIAL_HZ;
      }

      if (this.reduced) {
        this.blinkT = -1;
        this.pressT = -1;
      } else if (this.blinkT < 0) {
        this.nextBlink -= dt;
        if (this.nextBlink <= 0) this.blinkT = 0;
      } else {
        this.blinkT += dt / 0.14;
        if (this.blinkT >= 1) {
          if (this.pendingDouble) {
            this.pendingDouble = false;
            this.blinkT = 0;
          } else {
            this.blinkT = -1;
            this.nextBlink = 2.1 + Math.random() * 2.3;
            if (Math.random() < 0.16) {
              this.pendingDouble = true;
              this.nextBlink = 0.09;
            }
          }
        }
      }

      if (!this.reduced) {
        if (this.pressT < 0) {
          this.nextPress -= dt;
          if (this.nextPress <= 0) this.pressT = 0;
        } else {
          this.pressT += dt / 0.26;
          if (this.pressT >= 1) {
            this.pressT = -1;
            this.nextPress = 4.6 + Math.random() * 3.8;
          }
        }
      }

      this._render();
    }

    _render() {
      const motion = this.reduced ? 0 : 1;
      const p = this.pose;
      const bounce = Math.sin(this.time * 14) * 0.018 * this.talking * motion;
      this.puppet.setAttribute("transform", "scale(1 " + (1 + bounce).toFixed(4) + ")");

      const innerX = p.innerX * R;
      const innerY = p.innerY * R;
      const innerRx = p.innerRx * R;
      const innerRy = p.innerRy * R;
      this.inner.setAttribute("cx", innerX.toFixed(2));
      this.inner.setAttribute("cy", innerY.toFixed(2));
      this.inner.setAttribute("rx", innerRx.toFixed(2));
      this.inner.setAttribute("ry", innerRy.toFixed(2));
      this.clipEllipse.setAttribute("cx", innerX.toFixed(2));
      this.clipEllipse.setAttribute("cy", innerY.toFixed(2));
      this.clipEllipse.setAttribute("rx", innerRx.toFixed(2));
      this.clipEllipse.setAttribute("ry", innerRy.toFixed(2));

      this._cap(p);

      const blink = blinkEnvelope(this.blinkT) * motion;
      const open = Math.max(0.08, p.open * (1 - blink * 0.92));
      this._eye(this.eyeL, p.eyeLX, p.eyeLY, p.eyeLW, p.eyeLH * open, p.eyeLRot);
      this._eye(this.eyeR, p.eyeRX, p.eyeRY, p.eyeRW, p.eyeRH * open, p.eyeRRot);
    }

    _cap(p) {
      const w = p.capW * R;
      const h = p.capH * R;
      const cx = p.capX * R;
      const cy = p.capY * R;
      const rx = (p.capRx || 0) * R;
      const motion = this.reduced ? 0 : 1;
      const press = pressEnvelope(this.pressT) * motion;
      const sy = 1 - press * 0.42;
      const pivot = (h / 2).toFixed(2);
      this.capG.setAttribute(
        "transform",
        "translate(" +
          cx.toFixed(2) +
          " " +
          cy.toFixed(2) +
          ") rotate(" +
          (p.capRot || 0).toFixed(3) +
          ") translate(0 " +
          pivot +
          ") scale(1 " +
          sy.toFixed(4) +
          ") translate(0 " +
          (-h / 2).toFixed(2) +
          ")"
      );

      const x = (-w / 2).toFixed(2);
      const y = (-h / 2).toFixed(2);
      const ws = w.toFixed(2);
      const hs = h.toFixed(2);
      const rxs = rx.toFixed(2);
      this.cap.setAttribute("x", x);
      this.cap.setAttribute("y", y);
      this.cap.setAttribute("width", ws);
      this.cap.setAttribute("height", hs);
      this.cap.setAttribute("rx", rxs);
      this.cap.setAttribute("ry", rxs);
      this.capClipRect.setAttribute("x", x);
      this.capClipRect.setAttribute("y", y);
      this.capClipRect.setAttribute("width", ws);
      this.capClipRect.setAttribute("height", hs);
      this.capClipRect.setAttribute("rx", rxs);
      this.capClipRect.setAttribute("ry", rxs);

      const stripeW = STRIPE_W * R;
      const stripeH = h + 2;
      const pitch = STRIPE_PITCH * R;
      for (let i = 0; i < this.stripes.length; i++) {
        const node = this.stripes[i];
        const local = (STRIPE_ORIGIN + i) * pitch;
        node.setAttribute("x", (local - stripeW / 2).toFixed(2));
        node.setAttribute("y", (-stripeH / 2).toFixed(2));
        node.setAttribute("width", stripeW.toFixed(2));
        node.setAttribute("height", stripeH.toFixed(2));
      }

      const dial = Math.max(0, Math.min(1, p.dial || 0));
      this.stripesG.setAttribute("opacity", dial.toFixed(3));
      const shift = (((this.dialPhase % 1) + 1) % 1) * pitch;
      this.stripeShift.setAttribute("transform", "translate(" + shift.toFixed(2) + " 0)");
    }

    _eye(node, nx, ny, nw, nh, rot) {
      const w = nw * R;
      const h = nh * R;
      const cx = nx * R;
      const cy = ny * R;
      node.setAttribute("x", (cx - w / 2).toFixed(2));
      node.setAttribute("y", (cy - h / 2).toFixed(2));
      node.setAttribute("width", w.toFixed(2));
      node.setAttribute("height", h.toFixed(2));
      node.setAttribute("rx", (Math.min(w, h) / 2).toFixed(2));
      node.setAttribute("transform", "rotate(" + (rot || 0).toFixed(1) + " " + cx.toFixed(2) + " " + cy.toFixed(2) + ")");
    }
  }

  function boot() {
    if (raf) return;
    const step = (now) => {
      for (let i = 0; i < instances.length; i++) instances[i].tick(now);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    document.addEventListener("visibilitychange", () => {
      for (let i = 0; i < instances.length; i++) instances[i].last = 0;
    });
  }

  global.PebbleMascot = PebbleMascot;
})(window);
