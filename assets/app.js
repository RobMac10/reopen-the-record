/* Reopen the Record book reader. No personal names. */
(function () {
  "use strict";

  if (!window.BOOK) {
    document.body.insertAdjacentHTML("afterbegin", "<p role='alert'>The book data failed to load.</p>");
    return;
  }

  const BOOK = window.BOOK;
  const TOTAL = BOOK.pageCount;
  const YEAR_ORDER = [4, 5, 6, 7, 8, 9, 10];

  const $ = (id) => document.getElementById(id);
  const views = {
    cover: $("view-cover"),
    contents: $("view-contents"),
    reader: $("view-reader"),
  };

  let page = 1;
  let view = "cover";
  let textMode = false;
  let spread = false;
  let pageTexts = null;
  let touchStartX = null;
  let touchStartY = null;
  let turning = false;

  function pad(n) {
    return String(n).padStart(3, "0");
  }
  function src(n) {
    return "assets/pages/p" + pad(n) + ".webp";
  }
  function alt(n) {
    return (BOOK.pageAlts && BOOK.pageAlts[n]) || ("Page " + n + " of " + BOOK.bookTitle);
  }
  function caseOn(n) {
    const raw = BOOK.pageCases && BOOK.pageCases[String(n)];
    return raw == null ? null : raw;
  }
  function caseByNum(num) {
    return BOOK.cases.find((c) => c.num === num);
  }
  function clamp(n) {
    n = Number(n) || 1;
    return Math.max(1, Math.min(TOTAL, Math.round(n)));
  }
  function hasConsult(c) {
    return (c.tags || []).some((t) => /First Nations|consultation/i.test(t));
  }

  function parseHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    if (!raw || raw === "cover" || raw === "/" || raw === "top") return { view: "cover" };
    if (raw === "contents" || raw === "toc") return { view: "contents" };
    let m = raw.match(/^(?:p|page)=(\d+)/i);
    if (m) return { view: "reader", page: clamp(m[1]) };
    m = raw.match(/^case=(\d+)/i);
    if (m) {
      const c = caseByNum(Number(m[1]));
      if (c && c.written) return { view: "reader", page: c.start };
    }
    return { view: "cover" };
  }

  function hashFor(next) {
    if (next.view === "cover") return "#cover";
    if (next.view === "contents") return "#contents";
    return "#p=" + next.page;
  }

  function go(next, opts) {
    const push = opts && opts.push;
    const was = { view: view, page: page };
    view = next.view;
    if (next.page) page = clamp(next.page);
    const hash = hashFor({ view, page });
    const url = location.pathname + location.search + hash;
    if (location.hash !== hash) {
      if (push) history.pushState({ view, page }, "", url);
      else history.replaceState({ view, page }, "", url);
    }
    render();
    if (was.view !== view) {
      $("main").focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  function setTitle() {
    const base = BOOK.bookTitle;
    if (view === "cover") document.title = base;
    else if (view === "contents") document.title = "Contents · " + base;
    else document.title = "Page " + page + " · " + base;
  }

  function navCurrent() {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const is = a.getAttribute("data-nav") === view;
      if (is) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function renderWrittenStrip() {
    const host = $("written-strip");
    if (!host || host.dataset.ready) return;
    const start = BOOK.startHere;
    const bits = [];
    bits.push(
      '<a class="start-card" href="#p=' + start.page + '">' +
        '<img src="assets/thumbs/p079.webp" width="420" alt="Start here: In Case of Emergency.">' +
        "<div><strong>" + escapeHtml(start.title) + "</strong>" +
        "<p>" + escapeHtml(start.blurb) + " Then open Case 42.</p></div></a>"
    );
    const written = BOOK.cases.filter((c) => c.written);
    // Show in year then case order
    written.sort((a, b) => a.year - b.year || a.num - b.num);
    written.forEach((c) => {
      const thumbPage = c.num === 42 ? 80 : c.envelope || c.start;
      const thumb = "assets/thumbs/p" + pad(thumbPage) + ".webp";
      const href = c.num === 42 ? "#p=80" : "#p=" + c.start;
      bits.push(
        '<a href="' + href + '"><img src="' + thumb + '" alt="">' +
        "<span>Case " + c.num + " · Year " + c.year + "<br>" + escapeHtml(c.title) + "</span></a>"
      );
    });
    host.innerHTML = bits.join("");
    host.dataset.ready = "1";
  }

  function statusBadge(c) {
    if (c.written) return '<span class="badge written">Written</span>';
    const label = {
      Outlined: "Coming soon · outlined",
      Proposed: "Coming soon · proposed",
      "From Queenslander": "Coming soon",
      "From Frontier Friction": "Coming soon",
    }[c.status] || "Coming soon";
    return '<span class="badge soon">' + label + "</span>";
  }

  function renderContents() {
    const host = $("contents-list");
    if (!host || host.dataset.ready) return;
    const chunks = [];
    YEAR_ORDER.forEach((year) => {
      const list = BOOK.cases.filter((c) => c.year === year);
      const writtenN = list.filter((c) => c.written).length;
      chunks.push(
        '<section class="year-block y' + year + '" aria-labelledby="year-' + year + '">' +
        '<h2 class="year-label" id="year-' + year + '"><b>Year ' + year + "</b>" +
        "<span>" + list.length + " cases · " + writtenN + " written</span></h2>" +
        '<ul class="case-list">'
      );
      list.forEach((c) => {
        if (c.num === 42) {
          const s = BOOK.startHere;
          chunks.push(
            '<li><a class="start-row" href="#p=' + s.page + '">' +
            '<img src="assets/thumbs/p079.webp" width="72" alt="">' +
            "<div><h3>" + escapeHtml(s.title) + "</h3>" +
            "<p>" + escapeHtml(s.blurb) + "</p>" +
            '<p class="meta"><span class="badge app">Escape room</span></p></div>' +
            '<div class="side"><span class="open">Open page ' + s.page + " →</span></div></a></li>"
          );
        }
        const consult = hasConsult(c)
          ? '<span class="badge consult">Draft, pending consultation</span>'
          : "";
        const apps = (c.apps || [])
          .map((a) => '<span class="badge app">' + escapeHtml(a.label) + "</span>")
          .join("");
        const inner =
          '<span class="case-num">' + c.num + "</span>" +
          "<div><h3>" + escapeHtml(c.title) + "</h3>" +
          '<p class="q">' + escapeHtml(c.question) + "</p>" +
          '<p class="meta">' + statusBadge(c) + consult + apps +
          (c.codes ? '<span class="codes">' + escapeHtml(c.codes) + "</span>" : "") +
          "</p></div>";
        if (c.written) {
          const href = c.num === 42 ? "#p=80" : "#p=" + c.start;
          const range = c.num === 42 ? ("the case file, p. 80–" + c.end) : ("pages " + c.start + "–" + c.end);
          chunks.push(
            '<li><a class="case-row y' + year + '" href="' + href + '">' + inner +
            '<div class="side"><span class="open">Open ' + range + " →</span></div></a></li>"
          );
        } else {
          chunks.push(
            '<li><div class="case-row soon y' + year + '" aria-disabled="true">' + inner +
            '<div class="side"><span class="badge soon">Coming soon</span></div></div></li>'
          );
        }
      });
      chunks.push("</ul></section>");
    });
    host.innerHTML = chunks.join("");
    host.dataset.ready = "1";
  }

  function fillJump() {
    const sel = $("jump");
    if (!sel || sel.dataset.ready) return;
    const opts = [];
    opts.push('<option value="cover">Cover</option>');
    opts.push('<option value="contents">Contents</option>');
    opts.push('<option value="p-1">Cover page (p. 1)</option>');
    opts.push('<option value="p-2">Title page (p. 2)</option>');
    opts.push('<option value="p-3">How a case file works (p. 3)</option>');
    opts.push('<option value="p-4">Printed contents (p. 4)</option>');
    YEAR_ORDER.forEach((year) => {
      const list = BOOK.cases.filter((c) => c.written && c.year === year);
      if (!list.length) return;
      opts.push('<optgroup label="Year ' + year + '">');
      list.forEach((c) => {
        if (c.num === 42) {
          opts.push(
            '<option value="p-79">Start here: In Case of Emergency (p. 79)</option>'
          );
          opts.push(
            '<option value="p-80">Case 42 · ' + escapeHtml(c.title) + " (p. 80)</option>"
          );
        } else {
          opts.push(
            '<option value="p-' + c.start + '">Case ' + c.num + " · " +
              escapeHtml(c.title) + " (p. " + c.start + ")</option>"
          );
        }
      });
      opts.push("</optgroup>");
    });
    sel.innerHTML = opts.join("");
    sel.dataset.ready = "1";
  }

  function syncJump() {
    const sel = $("jump");
    if (!sel) return;
    const want = "p-" + page;
    const exact = Array.from(sel.options).some((o) => o.value === want);
    if (exact) sel.value = want;
    else {
      // choose the written case that contains this page, else nearest front-matter
      const cnum = caseOn(page);
      if (cnum) {
        const c = caseByNum(cnum);
        const start = cnum === 42 && page === 79 ? 79 : (c && c.num === 42 ? 80 : c.start);
        sel.value = "p-" + start;
      } else if (page <= 1) sel.value = "p-1";
      else if (page === 2) sel.value = "p-2";
      else if (page === 3) sel.value = "p-3";
      else if (page >= 4 && page <= 8) sel.value = "p-4";
      else sel.value = "contents";
    }
  }

  function preload(n) {
    if (n < 1 || n > TOTAL) return;
    const img = new Image();
    img.src = src(n);
  }

  function setLeaf(elImg, n, show) {
    const leaf = elImg.parentElement;
    if (!show || !n) {
      leaf.hidden = true;
      elImg.removeAttribute("src");
      elImg.alt = "";
      return;
    }
    leaf.hidden = false;
    if (elImg.getAttribute("data-page") !== String(n)) {
      elImg.src = src(n);
      elImg.setAttribute("data-page", String(n));
    }
    elImg.alt = alt(n);
  }

  function spreadPair(n) {
    // Odd pages are recto (right). Page 1 stands alone with a blank left.
    if (n % 2 === 1) return { left: n === 1 ? null : n - 1, right: n };
    return { left: n, right: n + 1 <= TOTAL ? n + 1 : null };
  }

  function renderReader() {
    const useSpread = spread && window.matchMedia("(min-width:841px)").matches && !textMode;
    $("stage").hidden = textMode;
    $("text-view").hidden = !textMode;
    $("stage").classList.toggle("spread-on", useSpread);
    $("book").classList.toggle("spread", useSpread);
    $("btn-text").setAttribute("aria-pressed", textMode ? "true" : "false");
    $("btn-spread").setAttribute("aria-pressed", spread ? "true" : "false");
    $("page-num").value = String(page);
    $("page-total").textContent = String(TOTAL);

    const atStart = page <= 1;
    const atEnd = useSpread ? (page >= TOTAL - (TOTAL % 2 === 0 ? 0 : 0) && (page === TOTAL || (page % 2 === 0 && page + 1 >= TOTAL))) : page >= TOTAL;
    // simpler: can't go prev at 1; can't go next at TOTAL (or if spread and both shown pages exhausted)
    let canPrev = page > 1;
    let canNext = page < TOTAL;
    if (useSpread) {
      const pair = spreadPair(page);
      const leftN = pair.left || 0;
      const rightN = pair.right || 0;
      canPrev = (leftN || rightN) > 1;
      canNext = Math.max(leftN, rightN) < TOTAL;
    }
    $("btn-prev").disabled = $("edge-prev").disabled = !canPrev;
    $("btn-next").disabled = $("edge-next").disabled = !canNext;

    if (textMode) {
      renderText();
    } else if (useSpread) {
      const pair = spreadPair(page);
      setLeaf($("img-left"), pair.left, true);
      setLeaf($("img-right"), pair.right, true);
      if (!pair.left) {
        $("leaf-left").hidden = false;
        $("leaf-left").classList.add("blank");
        $("img-left").hidden = true;
        $("img-left").alt = "";
      } else {
        $("leaf-left").classList.remove("blank");
        $("img-left").hidden = false;
      }
      preload((pair.left || 1) - 1);
      preload((pair.right || page) + 1);
    } else {
      $("leaf-left").hidden = true;
      $("leaf-left").classList.remove("blank");
      setLeaf($("img-right"), page, true);
      preload(page - 1);
      preload(page + 1);
    }
    syncJump();
    renderDock();
  }

  function renderDock() {
    const dock = $("dock");
    const cnum = caseOn(page);
    const bits = [];
    if (page === BOOK.startHere.page) {
      bits.push('<p class="hint">Do the escape room first, then open the case file.</p>');
      bits.push(
        '<a href="' + BOOK.startHere.app.url + '" target="_blank" rel="noopener">' +
        "Open the escape room →</a>"
      );
      bits.push(
        '<a class="secondary" href="#p=80">Then open Case 42 →</a>'
      );
    } else if (cnum) {
      const c = caseByNum(cnum);
      bits.push('<span class="case-chip">Case ' + c.num + " · Year " + c.year + " · " + escapeHtml(c.title) + "</span>");
      (c.apps || []).forEach((app) => {
        const onPage = !app.pages || app.pages.indexOf(page) !== -1;
        const cls = onPage ? "" : ' class="secondary"';
        bits.push(
          '<a' + cls + ' href="' + app.url + '" target="_blank" rel="noopener">' +
          escapeHtml(app.label) + " →</a>"
        );
      });
    } else if (page >= 4 && page <= 8) {
      bits.push('<a class="secondary" href="#contents">Open the interactive contents →</a>');
    }
    dock.innerHTML = bits.join("");
  }

  function ensureTexts(cb) {
    if (pageTexts) return cb();
    fetch("assets/pages.json")
      .then((r) => r.json())
      .then((data) => {
        pageTexts = {};
        (data.pages || []).forEach((p) => {
          pageTexts[p.n] = p;
        });
        cb();
      })
      .catch(() => {
        pageTexts = {};
        cb();
      });
  }

  function renderText() {
    ensureTexts(() => {
      const rec = pageTexts[page] || {};
      const raw = (rec.text || "").trim();
      const heading = "Page " + page + (rec.case ? " · Case " + rec.case : "");
      $("text-article").textContent = heading + "\n\n" + (raw || alt(page) + "\n\nNo printable text was extracted from this page. It may be a cover or envelope illustration.");
    });
  }

  function render() {
    views.cover.hidden = view !== "cover";
    views.contents.hidden = view !== "contents";
    views.reader.hidden = view !== "reader";
    navCurrent();
    document.body.classList.toggle("is-reader", view === "reader");
    setTitle();
    if (view === "cover") renderWrittenStrip();
    if (view === "contents") renderContents();
    if (view === "reader") renderReader();
  }

  function turn(delta, push) {
    if (turning) return;
    const useSpread = spread && window.matchMedia("(min-width:841px)").matches && !textMode;
    let next = page + (useSpread ? (delta > 0 ? 2 : -2) : delta);
    // Align to the left page of a spread when moving backward onto an even/odd pair
    if (useSpread) {
      if (delta > 0) {
        const pair = spreadPair(page);
        const maxNow = Math.max(pair.left || 0, pair.right || 0);
        next = maxNow + 1;
      } else {
        const pair = spreadPair(page);
        const minNow = Math.min(pair.left || page, pair.right || page);
        next = Math.max(1, minNow - 1);
      }
    }
    next = clamp(next);
    if (next === page) return;
    if (!textMode && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      turning = true;
      const book = $("book");
      book.classList.add("turning", delta > 0 ? "turn-next" : "turn-prev");
      setTimeout(() => {
        book.classList.remove("turning", "turn-next", "turn-prev");
        turning = false;
        go({ view: "reader", page: next }, { push: false });
      }, 180);
    } else {
      go({ view: "reader", page: next }, { push: false });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Events
  $("btn-prev").addEventListener("click", () => turn(-1));
  $("btn-next").addEventListener("click", () => turn(1));
  $("edge-prev").addEventListener("click", () => turn(-1));
  $("edge-next").addEventListener("click", () => turn(1));
  $("text-prev").addEventListener("click", () => turn(-1));
  $("text-next").addEventListener("click", () => turn(1));

  $("page-form").addEventListener("submit", (e) => {
    e.preventDefault();
    go({ view: "reader", page: clamp($("page-num").value) }, { push: true });
  });
  $("page-num").addEventListener("change", () => {
    go({ view: "reader", page: clamp($("page-num").value) }, { push: true });
  });

  $("jump").addEventListener("change", () => {
    const v = $("jump").value;
    if (v === "cover") go({ view: "cover" }, { push: true });
    else if (v === "contents") go({ view: "contents" }, { push: true });
    else if (v.indexOf("p-") === 0) go({ view: "reader", page: Number(v.slice(2)) }, { push: true });
  });

  $("btn-text").addEventListener("click", () => {
    textMode = !textMode;
    renderReader();
  });
  $("btn-spread").addEventListener("click", () => {
    spread = !spread;
    renderReader();
  });

  document.addEventListener("keydown", (e) => {
    if (view !== "reader") return;
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "j") {
      e.preventDefault();
      turn(1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "k") {
      e.preventDefault();
      turn(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go({ view: "reader", page: 1 }, { push: true });
    } else if (e.key === "End") {
      e.preventDefault();
      go({ view: "reader", page: TOTAL }, { push: true });
    } else if (e.key === "t" || e.key === "T") {
      textMode = !textMode;
      renderReader();
    }
  });

  const stage = $("stage");
  stage.addEventListener("touchstart", (e) => {
    if (e.changedTouches[0]) {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    }
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (touchStartX == null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    touchStartX = touchStartY = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) turn(1);
    else turn(-1);
  }, { passive: true });

  // Click left/right thirds of the page image to turn, when not in text mode.
  $("book").addEventListener("click", (e) => {
    if (textMode) return;
    const img = e.target.closest("img");
    if (!img) return;
    const r = img.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < r.width * 0.22) turn(-1);
    else if (x > r.width * 0.78) turn(1);
  });

  window.addEventListener("popstate", () => {
    const next = parseHash();
    view = next.view;
    if (next.page) page = next.page;
    render();
  });
  window.addEventListener("hashchange", () => {
    const next = parseHash();
    if (next.view !== view || (next.page && next.page !== page)) {
      view = next.view;
      if (next.page) page = next.page;
      render();
    }
  });
  window.addEventListener("resize", () => {
    if (view === "reader") renderReader();
  });

  // Measure header for sticky toolbar offset
  function syncHeaderVar() {
    const h = document.querySelector(".site-header");
    if (h) document.documentElement.style.setProperty("--header-h", h.offsetHeight + "px");
  }
  window.addEventListener("resize", syncHeaderVar);
  syncHeaderVar();

  $("page-num").setAttribute("max", String(TOTAL));

  // First paint
  fillJump();
  const first = parseHash();
  view = first.view;
  if (first.page) page = first.page;
  render();
  // Warm nearby images if we landed in the reader
  if (view === "reader") {
    preload(page - 1);
    preload(page + 1);
  }
})();
