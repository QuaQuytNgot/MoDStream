"use strict";

(() => {
  const config = JSON.parse(document.getElementById("site-data").textContent);
  const results = JSON.parse(document.getElementById("results-data").textContent);
  const status = document.getElementById("interaction-status");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = Boolean(navigator.connection?.saveData);
  const announce = (message) => { status.textContent = message; };
  const pressed = (selector, key, value) => {
    document.querySelectorAll(selector).forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset[key] === value));
    });
  };

  // Only the hero is eligible for one automatic start. Explicit playback always wins.
  const videos = [...document.querySelectorAll("video")];
  videos.forEach((video) => video.addEventListener("play", () => {
    videos.forEach((other) => { if (other !== video) other.pause(); });
  }));
  let heroAutoplayAttempted = false;
  const attachVideo = (video) => {
    let attached = false;
    video.querySelectorAll("source[data-src]").forEach((source) => {
      source.src = source.dataset.src;
      source.removeAttribute("data-src");
      attached = true;
    });
    if (attached) video.load();
  };
  if ("IntersectionObserver" in window) {
    const mediaObserver = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) { target.pause(); return; }
        attachVideo(target);
        if (target.id === "hero-video" && !heroAutoplayAttempted) {
          heroAutoplayAttempted = true;
          if (!reducedMotion && !saveData && window.matchMedia("(min-width: 701px)").matches) {
            target.play().catch(() => { /* Native controls remain available. */ });
          }
        }
      });
    }, { threshold: 0.08 });
    videos.forEach((video) => mediaObserver.observe(video));
  } else {
    videos.forEach(attachVideo);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) videos.forEach((video) => video.pause());
  });

  const gallery = document.getElementById("gallery-video");
  const galleryCaption = document.getElementById("gallery-caption");
  const chapterContainer = document.querySelector(".chapter-buttons");
  const galleryFailure = document.querySelector(".media-failure");
  let selectedDemo = config.demos[0];
  const chapterButtons = (demo) => {
    chapterContainer.replaceChildren();
    demo.chapters.forEach((chapter, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-button";
      button.dataset.time = chapter.time;
      const number = document.createElement("span");
      number.textContent = String(index + 1).padStart(2, "0");
      button.append(number, chapter.label);
      chapterContainer.append(button);
    });
  };
  const playAt = async (seconds) => {
    attachVideo(gallery);
    if (gallery.readyState < 1) {
      await new Promise((resolve) => {
        gallery.addEventListener("loadedmetadata", resolve, { once: true });
        gallery.addEventListener("error", resolve, { once: true });
      });
    }
    if (Number.isFinite(gallery.duration)) {
      gallery.currentTime = Math.min(seconds, Math.max(0, gallery.duration - 0.05));
      gallery.play().catch(() => announce("Use the video controls to play this recording."));
    }
  };
  chapterContainer.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-time]");
    if (!button) return;
    void playAt(Number(button.dataset.time));
    announce(`Playing ${button.textContent.slice(2)} in the prerecorded visualization.`);
  });
  document.querySelectorAll("[data-demo]").forEach((button) => {
    if (button.tagName !== "BUTTON") return;
    button.addEventListener("click", () => {
      const demo = config.demos.find((item) => item.id === button.dataset.demo);
      if (!demo) return;
      pressed("button[data-demo]", "demo", demo.id);
      if (selectedDemo.id !== demo.id) {
        selectedDemo = demo;
        gallery.pause();
        gallery.poster = demo.poster;
        gallery.dataset.demo = demo.id;
        const source = gallery.querySelector("source");
        source.removeAttribute("data-src");
        source.src = demo.src;
        galleryFailure.hidden = true;
        document.getElementById("gallery-fallback").href = demo.src;
        gallery.load();
        const title = document.createElement("h3"); title.textContent = demo.title;
        const caption = document.createElement("p"); caption.textContent = demo.caption;
        const note = document.createElement("span"); note.className = "caption-note"; note.textContent = demo.note;
        galleryCaption.replaceChildren(title, caption, note);
        chapterButtons(demo);
      }
      void playAt(0);
    });
  });
  gallery.addEventListener("error", () => { galleryFailure.hidden = false; });
  gallery.querySelector("source").addEventListener("error", () => { galleryFailure.hidden = false; });

  // Inspect existing measured maps; no rasterizer or synthetic visibility runs in the page.
  document.querySelectorAll("[data-object]").forEach((button) => {
    button.addEventListener("click", () => {
      const object = config.visibility.objects.find((item) => item.id === button.dataset.object);
      if (!object) return;
      pressed("[data-object]", "object", object.id);
      const joint = document.getElementById("joint-map");
      const solo = document.getElementById("solo-map");
      joint.src = object.joint;
      solo.src = object.solo;
      joint.alt = `${object.name} joint alpha contribution with the other scene objects present.`;
      solo.alt = `${object.name} solo alpha reference without the other scene objects.`;
      document.getElementById("joint-label").textContent = `${object.name} · joint`;
      document.getElementById("solo-label").textContent = `${object.name} · solo`;
      document.getElementById("insight-marker").style.backgroundColor = object.color;
      document.querySelector(".selected-map").style.borderColor = object.color;
      document.getElementById("insight-title").textContent = `${object.name} loses ${(object.occlusion * 100).toFixed(2)}% of its solo contribution.`;
      document.getElementById("insight-text").textContent = `Its single-sample normalized planner weight is ${(object.weight * 100).toFixed(2)}%. ${object.occlusion === 0 ? "In this recorded view, the joint contribution equals the solo reference." : "A projected bounding box alone does not reveal the attenuation from the other objects."}`;
    });
  });

  const comparison = document.getElementById("comparison");
  const referenceImage = document.getElementById("reference-image");
  const candidateImage = document.getElementById("candidate-image");
  const referenceSelect = document.getElementById("reference-select");
  let scene = config.quality.scenes[0];
  let level = config.quality.mapping[0];
  let imageUpdate = 0;
  const preload = (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = reject;
    image.src = url;
  });
  const updateComparison = async () => {
    const update = ++imageUpdate;
    const reference = referenceSelect.value;
    const referenceSrc = reference === "original" ? scene.original : scene.images.Q3;
    const candidateSrc = scene.images[level.id];
    comparison.setAttribute("aria-busy", "true");
    comparison.classList.add("is-loading");
    try {
      await Promise.all([preload(referenceSrc), preload(candidateSrc)]);
      if (update !== imageUpdate) return;
      referenceImage.src = referenceSrc;
      candidateImage.src = candidateSrc;
      referenceImage.alt = `${scene.name}, frame ${scene.frame}, ${reference === "original" ? "Original source point cloud rendered with Open3D" : "Q3 / CRF20 native Gaussian render"}.`;
      candidateImage.alt = `${scene.name}, frame ${scene.frame}, ${level.id} / CRF${level.crf} native Gaussian render.`;
      const label = (id, primary, secondary) => {
        const node = document.getElementById(id);
        const detail = document.createElement("span"); detail.textContent = secondary;
        node.replaceChildren(primary, detail);
      };
      label("reference-label", reference === "original" ? "Original" : "Q3", reference === "original" ? "Source point cloud" : "CRF20 · native Gaussian render");
      label("candidate-label", level.id, `CRF${level.crf} · native Gaussian render`);
      document.getElementById("quality-capture-meta").textContent = `${scene.name} · frame ${scene.frame} · t = ${scene.timestamp.toFixed(1)} s · ${scene.fov}° FOV · ${scene.width} × ${scene.height}`;
      announce(`Showing ${scene.name}, ${reference === "original" ? "Original source point cloud" : "Q3 reference"} and ${level.id}, from the same recorded camera and timestamp.`);
    } catch {
      announce("A comparison image could not load. Please try again.");
    } finally {
      if (update === imageUpdate) {
        comparison.removeAttribute("aria-busy");
        comparison.classList.remove("is-loading");
      }
    }
  };
  document.querySelectorAll("[data-quality-scene]").forEach((button) => button.addEventListener("click", () => {
    scene = config.quality.scenes.find((item) => item.id === button.dataset.qualityScene);
    pressed("[data-quality-scene]", "qualityScene", scene.id);
    void updateComparison();
  }));
  document.querySelectorAll("[data-quality-level]").forEach((button) => button.addEventListener("click", () => {
    level = config.quality.mapping.find((item) => item.id === button.dataset.qualityLevel);
    pressed("[data-quality-level]", "qualityLevel", level.id);
    void updateComparison();
  }));
  referenceSelect.addEventListener("change", () => { void updateComparison(); });
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    const split = button.dataset.view === "split";
    pressed("[data-view]", "view", button.dataset.view);
    comparison.classList.toggle("split-view", split);
    comparison.classList.toggle("side-view", !split);
    document.getElementById("split-control").hidden = !split;
  }));
  const comparisonRange = document.getElementById("comparison-range");
  const setComparisonPosition = (value) => {
    const percent = Math.round(Math.max(0, Math.min(100, value)));
    comparison.style.setProperty("--split-position", `${percent}%`);
    comparisonRange.value = String(percent);
    document.getElementById("comparison-position").textContent = `${percent}%`;
  };
  comparisonRange.addEventListener("input", (event) => {
    setComparisonPosition(Number(event.target.value));
  });
  let dragPointer = null;
  const positionFromPointer = (event) => {
    const bounds = comparison.getBoundingClientRect();
    setComparisonPosition((event.clientX - bounds.left) / bounds.width * 100);
  };
  comparison.addEventListener("pointerdown", (event) => {
    if (!comparison.classList.contains("split-view") || !event.isPrimary || event.button !== 0) return;
    dragPointer = event.pointerId;
    comparison.setPointerCapture(event.pointerId);
    positionFromPointer(event);
    event.preventDefault();
  });
  comparison.addEventListener("pointermove", (event) => {
    if (event.pointerId === dragPointer) positionFromPointer(event);
  });
  const stopDragging = (event) => {
    if (event.pointerId !== dragPointer) return;
    dragPointer = null;
    if (comparison.hasPointerCapture(event.pointerId)) comparison.releasePointerCapture(event.pointerId);
  };
  comparison.addEventListener("pointerup", stopDragging);
  comparison.addEventListener("pointercancel", stopDragging);
  comparison.addEventListener("lostpointercapture", () => { dragPointer = null; });
  comparison.addEventListener("dragstart", (event) => {
    if (comparison.classList.contains("split-view")) event.preventDefault();
  });

  const renderChart = (id, key, layout, max) => {
    const chart = document.getElementById(id);
    const values = results[key].values.filter((row) => row.layout === layout);
    chart.replaceChildren();
    const descriptions = [];
    results.methods.forEach((method) => {
      const value = values.find((row) => row.method === method.id)?.value;
      if (!Number.isFinite(value)) return;
      descriptions.push(`${method.label}: ${value.toFixed(2)} ${results[key].unit}`);
      const row = document.createElement("div"); row.className = "bar-row";
      const name = document.createElement("span"); name.className = "bar-name"; name.textContent = method.label;
      const track = document.createElement("div"); track.className = "bar-track";
      const fill = document.createElement("div"); fill.className = "bar-fill";
      fill.style.setProperty("--bar-width", `${value / max * 100}%`);
      fill.style.setProperty("--bar-color", method.color);
      track.append(fill);
      const number = document.createElement("span"); number.className = "bar-value"; number.textContent = value.toFixed(2);
      row.append(name, track, number); chart.append(row);
    });
    chart.setAttribute("aria-label", descriptions.join("; "));
  };
  document.querySelectorAll("[data-result-layout]").forEach((button) => button.addEventListener("click", () => {
    const layout = button.dataset.resultLayout;
    pressed("[data-result-layout]", "resultLayout", layout);
    renderChart("psnr-chart", "quality", layout, 55);
    renderChart("stalls-chart", "stalls", layout, 15);
    const q = results.quality.values.filter((row) => row.layout === layout);
    const ours = q.find((row) => row.method === "VISIBILITY_MSE").value;
    const vp = q.find((row) => row.method === "VISIBILITY_PSNR").value;
    const name = results.layouts.find((item) => item.id === layout).label;
    document.getElementById("results-observation").textContent = `${name} layout: Ours reaches ${ours.toFixed(2)} dB and V-P reaches ${vp.toFixed(2)} dB in the selected HV session. The stall chart shows a separate LS session.`;
    document.querySelectorAll("#results-table tbody tr").forEach((row) => { row.hidden = row.dataset.layout !== layout; });
  }));

  const copyButton = document.getElementById("copy-citation");
  if (copyButton && config.bibtex) {
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(config.bibtex);
        copyButton.textContent = "Copied";
        announce("Citation copied to clipboard.");
      } catch {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById("bibtex"));
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        announce("Citation selected. Use your browser’s copy command.");
      }
    });
  }
  if ("IntersectionObserver" in window) {
    const navObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll(".nav-links a").forEach((link) => link.classList.toggle("active", link.hash === `#${entry.target.id}`));
    }), { rootMargin: "-15% 0px -65% 0px" });
    document.querySelectorAll("main section[id]").forEach((section) => navObserver.observe(section));
  }
})();
