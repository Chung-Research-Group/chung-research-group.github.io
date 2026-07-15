(() => {
  "use strict";

  const heroes = document.querySelectorAll("[data-mof-particles]");
  if (!heroes.length) return;

  for (const hero of heroes) initHero(hero);

  function initHero(hero) {
    const canvas = hero.querySelector(".hero-mof-interactive__particles");
    if (!(canvas instanceof HTMLCanvasElement)) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)");

    const palette = [
      { r: 0, g: 91, b: 170, p: 0.47 },
      { r: 45, g: 167, b: 224, p: 0.26 },
      { r: 0, g: 166, b: 81, p: 0.11 },
      { r: 255, g: 165, b: 0, p: 0.16 }
    ];

    let width = 1;
    let height = 1;
    let dpr = 1;
    let particles = [];
    let animationFrame = 0;
    let lastTime = performance.now();
    let inViewport = true;

    const pointer = {
      x: 0,
      y: 0,
      active: false,
      nx: 0,
      ny: 0,
      smoothNx: 0,
      smoothNy: 0
    };

    function chooseColor() {
      let r = Math.random();
      for (const color of palette) {
        r -= color.p;
        if (r <= 0) return color;
      }
      return palette[0];
    }

    function makeParticle() {
      // Keep the visual density on the molecular side of the hero.
      const rightBiased = Math.random() < 0.82;
      const x = rightBiased
        ? width * (0.38 + 0.62 * Math.pow(Math.random(), 0.68))
        : width * Math.random();

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.055 + Math.random() * 0.14;

      return {
        x,
        y: height * Math.random(),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.15 + Math.random() * 2.25,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.38 + Math.random() * 0.38,
        drift: 0.45 + Math.random() * 0.65,
        hex: Math.random() < 0.18,
        color: chooseColor()
      };
    }

    function targetParticleCount() {
      const byArea = Math.round((width * height) / 10800);
      return Math.max(30, Math.min(width < 760 ? 38 : 64, byArea));
    }

    function resize() {
      const rect = hero.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const desired = targetParticleCount();
      particles.length = Math.min(particles.length, desired);
      while (particles.length < desired) particles.push(makeParticle());
    }

    function updatePointer(event) {
      if (coarsePointer.matches) return;
      const rect = hero.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.nx = Math.max(-1, Math.min(1, pointer.x / width * 2 - 1));
      pointer.ny = Math.max(-1, Math.min(1, pointer.y / height * 2 - 1));
      pointer.active = true;
    }

    function releasePointer() {
      pointer.active = false;
      pointer.nx = 0;
      pointer.ny = 0;
    }

    function updateParticle(p, step, now) {
      const phase = now * 0.00034 + p.phase;
      p.vx += Math.cos(phase) * 0.0022 * p.drift * step;
      p.vy += Math.sin(phase * 1.19) * 0.0018 * p.drift * step;

      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        const repelRadius = Math.max(125, Math.min(185, width * 0.115));

        if (d2 > 0.01 && d2 < repelRadius * repelRadius) {
          const d = Math.sqrt(d2);
          const q = 1 - d / repelRadius;
          const force = q * q * 0.84 * step;
          p.vx += dx / d * force;
          p.vy += dy / d * force;
        }
      }

      const damping = Math.pow(0.982, step);
      p.vx *= damping;
      p.vy *= damping;

      const speed = Math.hypot(p.vx, p.vy);
      const maxSpeed = 2.2;
      if (speed > maxSpeed) {
        p.vx = p.vx / speed * maxSpeed;
        p.vy = p.vy / speed * maxSpeed;
      }

      p.x += p.vx * step;
      p.y += p.vy * step;

      const margin = 20;
      if (p.x < -margin) p.x = width + margin;
      if (p.x > width + margin) p.x = -margin;
      if (p.y < -margin) p.y = height + margin;
      if (p.y > height + margin) p.y = -margin;
    }

    function drawPointerField() {
      if (!pointer.active) return;
      const radius = Math.max(75, Math.min(115, width * 0.075));
      const gradient = ctx.createRadialGradient(
        pointer.x, pointer.y, 0,
        pointer.x, pointer.y, radius
      );
      gradient.addColorStop(0, "rgba(45,167,224,0.075)");
      gradient.addColorStop(0.45, "rgba(0,91,170,0.025)");
      gradient.addColorStop(1, "rgba(0,91,170,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawLinks() {
      const maxDistance = Math.max(92, Math.min(138, width * 0.085));
      const maxDistance2 = maxDistance * maxDistance;
      ctx.lineWidth = 0.8;

      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= maxDistance2) continue;

          const d = Math.sqrt(d2);
          const alpha = (1 - d / maxDistance) * 0.21 * Math.min(a.alpha, b.alpha);
          const orange = a.color.r > 200 || b.color.r > 200;
          ctx.strokeStyle = orange
            ? `rgba(225,138,0,${alpha * 0.78})`
            : `rgba(0,91,170,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    function drawParticle(p) {
      const { r, g, b } = p.color;
      ctx.lineWidth = 0.9;
      ctx.fillStyle = `rgba(${r},${g},${b},${p.alpha})`;
      ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(0.88, p.alpha + 0.22)})`;
      ctx.beginPath();

      if (p.hex) {
        for (let i = 0; i < 6; i += 1) {
          const angle = -Math.PI / 2 + i * Math.PI / 3;
          const x = p.x + Math.cos(angle) * p.radius * 1.5;
          const y = p.y + Math.sin(angle) * p.radius * 1.5;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawFrame(now, step, update = true) {
      ctx.clearRect(0, 0, width, height);
      drawPointerField();
      if (update) {
        for (const p of particles) updateParticle(p, step, now);
      }
      drawLinks();
      for (const p of particles) drawParticle(p);
    }

    function animate(now) {
      animationFrame = 0;
      if (!inViewport || document.hidden || reduceMotion.matches) return;

      const step = Math.max(0.35, Math.min(2, (now - lastTime) / 16.667));
      lastTime = now;

      pointer.smoothNx += (pointer.nx - pointer.smoothNx) * 0.07;
      pointer.smoothNy += (pointer.ny - pointer.smoothNy) * 0.07;

      hero.style.setProperty("--hero-image-x", `${(-pointer.smoothNx * 8).toFixed(2)}px`);
      hero.style.setProperty("--hero-image-y", `${(-pointer.smoothNy * 5).toFixed(2)}px`);
      hero.style.setProperty("--hero-image-rx", `${(-pointer.smoothNy * 0.85).toFixed(3)}deg`);
      hero.style.setProperty("--hero-image-ry", `${(pointer.smoothNx * 1.35).toFixed(3)}deg`);

      drawFrame(now, step, true);
      animationFrame = requestAnimationFrame(animate);
    }

    function start() {
      if (animationFrame || reduceMotion.matches || !inViewport || document.hidden) return;
      lastTime = performance.now();
      animationFrame = requestAnimationFrame(animate);
    }

    function stop() {
      if (!animationFrame) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    function motionPreferenceChanged() {
      if (reduceMotion.matches) {
        stop();
        hero.style.setProperty("--hero-image-x", "0px");
        hero.style.setProperty("--hero-image-y", "0px");
        hero.style.setProperty("--hero-image-rx", "0deg");
        hero.style.setProperty("--hero-image-ry", "0deg");
      } else {
        start();
      }
    }

    hero.addEventListener("pointermove", updatePointer, { passive: true });
    hero.addEventListener("pointerleave", releasePointer, { passive: true });
    hero.addEventListener("pointercancel", releasePointer, { passive: true });

    if ("ResizeObserver" in window) {
      new ResizeObserver(resize).observe(hero);
    } else {
      window.addEventListener("resize", resize, { passive: true });
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        inViewport = entry.isIntersecting;
        if (inViewport) start();
        else stop();
      }, { threshold: 0.02 }).observe(hero);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    if (typeof reduceMotion.addEventListener === "function") {
      reduceMotion.addEventListener("change", motionPreferenceChanged);
    }

    resize();
    drawFrame(performance.now(), 1, false);
    motionPreferenceChanged();
  }
})();
