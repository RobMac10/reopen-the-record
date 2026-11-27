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
  // Casebook PDF pages 66-69 are the Blue Mountains cover story. They stay in the PDF only.
  const OMITTED = { 66: 1, 67: 1, 68: 1, 69: 1 };
  const AFTER_OMIT = 70;
  const BEFORE_OMIT = 65;
  function isOmitted(n) { return !!OMITTED[n]; }
  function livePage(n, from) {
    n = clamp(n);
    if (!isOmitted(n)) return n;
    if (from != null && from > n) return BEFORE_OMIT;
    return AFTER_OMIT;
  }

  const $ = (id) => document.getElementById(id);
  const views = {
    cover: $("view-cover"),
    contents: $("view-contents"),
    reader: $("view-reader"),
    story: $("view-story"),
  };

  let page = 1;
  let view = "cover";
  let storyId = null;
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
    return (BOOK.alts && BOOK.alts[String(n)]) || (BOOK.pageAlts && BOOK.pageAlts[n]) || ("Page " + n + " of " + BOOK.bookTitle);
  }
  function caseOn(n) {
    const raw = BOOK.pageCases && BOOK.pageCases[String(n)];
    return raw == null ? null : raw;
  }
  function caseByNum(num) {
    return BOOK.cases.find((c) => c.num === num);
  }

  function caseYears(c) {
    return (c.years && c.years.length) ? c.years : [c.year];
  }
  function yearLabel(c) {
    return c.yearLabel || ("Year " + c.year);
  }
  function isStartCase(c) {
    return !!(c && BOOK.startHere && c.num === BOOK.startHere.case);
  }
  function coverStoryOf(c) {
    return c && c.coverStory ? c.coverStory : null;
  }
  function caseByCoverStory(id) {
    return BOOK.cases.find((c) => c.coverStory && c.coverStory.id === id);
  }
  function resolveCaseNum(n) {
    n = Number(n);
    if (caseByNum(n)) return n;
    const leg = BOOK.legacyCases && BOOK.legacyCases[String(n)];
    return leg ? Number(leg) : n;
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
    if (m) return { view: "reader", page: livePage(m[1]) };
    m = raw.match(/^story=([a-z0-9-]+)/i);
    if (m) {
      const c = caseByCoverStory(m[1].toLowerCase());
      if (c) return { view: "story", story: c.coverStory.id, page: c.start };
    }
    m = raw.match(/^case=(\d+)/i);
    if (m) {
      const c = caseByNum(resolveCaseNum(m[1]));
      if (c && c.written && coverStoryOf(c)) return { view: "story", story: c.coverStory.id, page: c.start };
      if (c && c.written) return { view: "reader", page: c.start };
      if (c) return { view: "contents" };
    }
    return { view: "cover" };
  }

  function hashFor(next) {
    if (next.view === "cover") return "#cover";
    if (next.view === "contents") return "#contents";
    if (next.view === "story") return "#story=" + (next.story || storyId || "blue-mountains");
    return "#p=" + next.page;
  }

  function go(next, opts) {
    const push = opts && opts.push;
    const was = { view: view, page: page };
    view = next.view;
    if (next.page) page = livePage(next.page, page);
    if (next.story) storyId = next.story;
    const hash = hashFor({ view, page, story: storyId });
    const url = location.pathname + location.search + hash;
    if (location.hash !== hash) {
      if (push) history.pushState({ view, page, story: storyId }, "", url);
      else history.replaceState({ view, page, story: storyId }, "", url);
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
    else if (view === "story") {
      const c = caseByCoverStory(storyId);
      document.title = ((c && c.coverStory && c.coverStory.title) || "Cover story") + " · " + base;
    } else document.title = "Page " + page + " · " + base;
  }

  function navCurrent() {
    document.querySelectorAll("[data-nav]").forEach((a) => {
      const is = a.getAttribute("data-nav") === view;
      if (is) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function statusBadge(c) {
    if (c.written) return '<span class="badge written">Written</span>';
    const label = {
      Outlined: "Coming soon · outlined",
      Proposed: "Coming soon · proposed",
      "Coming soon": "Coming soon",
      "From Queenslander": "Coming soon",
      "From Frontier Friction": "Coming soon",
    }[c.status] || "Coming soon";
    return '<span class="badge soon">' + label + "</span>";
  }

  function caseSortKey(c) {
    // Book order is chronological within each year level.
    return typeof c.sort === "number" ? c.sort : c.num;
  }

  function renderContents() {
    const host = $("contents-list");
    if (!host || host.dataset.ready) return;
    const chunks = [];
    const stories = BOOK.storyApps || [];
    // Three coloured tabs: the Bias Button app, the story apps, the cold cases.
    const tabs = ['<a class="ctab tab-bias" href="https://robmac10.github.io/bias-button/">Bias Button</a>'];
    if (stories.length) tabs.push('<a class="ctab ys" href="#contents" data-jump="part-stories">Story apps</a>');
    tabs.push('<a class="ctab tab-cold" href="#contents" data-jump="part-cases">Cold case apps</a>');
    if (BOOK.referendums) tabs.push('<a class="ctab tab-ref" href="#contents" data-jump="part-ref">Referendums</a>');
    chunks.push('<nav class="contents-tabs" aria-label="Jump to a section of the contents">' + tabs.join("") + "</nav>");
    if (stories.length) {
      chunks.push(
        '<section class="contents-part ys" aria-labelledby="part-stories">' +
        '<h2 class="part-title" id="part-stories" tabindex="-1">The story apps</h2>' +
        '<p class="part-note">Companions from the four-book series, in the order of the history they cover.</p>' +
        '<ul class="case-list">'
      );
      stories.forEach((s) => {
        chunks.push(
          '<li><a class="case-row story ys" href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener">' +
          '<span class="case-num" aria-hidden="true">◇</span>' +
          '<div><p class="span">' + escapeHtml(s.span) + "</p>" +
          "<h3>" + escapeHtml(s.title) + "</h3>" +
          '<p class="q">' + escapeHtml(s.blurb) + "</p>" +
          '<p class="meta"><span class="badge app">Story app</span>' +
          '<span class="codes">' + escapeHtml(s.codes) + "</span></p></div>" +
          '<div class="side"><span class="open">Open the app ↗</span><span class="codes">' + escapeHtml(s.label) + "</span></div></a></li>"
        );
      });
      chunks.push("</ul></section>");
    }
    chunks.push(
      '<section class="contents-part cold" aria-labelledby="part-cases">' +
      '<h2 class="part-title" id="part-cases" tabindex="-1">Cold cases</h2>' +
      '<p class="part-note">The case files in the book, by year level, in date order within each year.</p>'
    );
    YEAR_ORDER.forEach((year) => {
      const list = BOOK.cases
        .filter((c) => caseYears(c).indexOf(year) !== -1)
        .concat((BOOK.appCases || []).filter((c) => c.year === year).map((c) => Object.assign({ appCase: true }, c)))
        .sort((a, b) => caseSortKey(a) - caseSortKey(b));
      chunks.push(
        '<section class="year-block y' + year + '" aria-labelledby="year-' + year + '">' +
        '<h3 class="year-label" id="year-' + year + '" tabindex="-1"><b>Year ' + year + "</b></h3>" +
        '<ul class="case-list">'
      );
      if (!list.length) {
        chunks.push('<li><div class="case-row soon y' + year + '"><div><p>No cases in this year.</p></div></div></li>');
      }
      list.forEach((c) => {
        if (c.appCase) {
          // A cold case published as an app, not printed in this book.
          chunks.push(
            '<li><a class="case-row y' + year + '" href="' + escapeHtml(c.url) + '" target="_blank" rel="noopener">' +
            '<span class="case-num" aria-hidden="true">◆</span>' +
            "<div><h3>" + escapeHtml(c.title) + "</h3>" +
            '<p class="q">' + escapeHtml(c.question) + "</p>" +
            '<p class="meta"><span class="badge app">Case app</span>' +
            '<span class="codes">' + escapeHtml(c.codes) + "</span></p></div>" +
            '<div class="side"><span class="open">Open the case app ↗</span><span class="codes">' + escapeHtml(c.label) + "</span></div></a></li>"
          );
          return;
        }
        if (isStartCase(c)) {
          const s = BOOK.startHere;
          chunks.push(
            '<li><a class="start-row" href="#p=' + s.page + '">' +
            '<img src="assets/thumbs/p' + pad(s.page) + '.webp" width="72" alt="">' +
            "<div><h3>" + escapeHtml(s.title) + "</h3>" +
            "<p>" + escapeHtml(s.blurb) + "</p>" +
            '<p class="meta"><span class="badge app">Escape room</span></p></div>' +
            '<div class="side"><span class="open">Open page ' + s.page + " →</span></div></a></li>"
          );
        }
        const apps = (c.apps || [])
          .map((a) => '<span class="badge app">' + escapeHtml(a.label) + "</span>")
          .join("");
        const inner =
          '<span class="case-num" aria-hidden="true">◆</span>' +
          "<div><h3>" + escapeHtml(c.title) + "</h3>" +
          '<p class="q">' + escapeHtml(c.question) + "</p>" +
          '<p class="meta">' + statusBadge(c) + apps +
          (c.codes ? '<span class="codes">' + escapeHtml(c.codes) + "</span>" : "") +
          "</p></div>";
        if (c.written) {
          const cover = coverStoryOf(c);
          const filePage = isStartCase(c) ? (c.envelope || (c.start + 1)) : c.start;
          const href = cover ? cover.hash : ("#p=" + filePage);
          const range = cover
            ? "the cover"
            : (isStartCase(c) ? ("the case file, p. " + filePage + "–" + c.end) : ("pages " + c.start + "–" + c.end));
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
    chunks.push("</section>");
    if (BOOK.referendums) {
      const R = BOOK.referendums;
      chunks.push(
        '<section class="contents-part ref" aria-labelledby="part-ref">' +
        '<h2 class="part-title" id="part-ref" tabindex="-1">' + escapeHtml(R.title) + "</h2>" +
        '<p class="part-note">' + escapeHtml(R.note) + "</p>" +
        '<ol class="ref-list">' +
        R.rows.map((x) =>
          '<li class="ref-row' + (x.carried ? " carried" : "") + '">' +
          '<p class="ref-date">' + escapeHtml(x.date) + "</p>" +
          "<h3>" + escapeHtml(x.name) + "</h3>" +
          '<p><b>Asked:</b> ' + escapeHtml(x.question) + "</p>" +
          '<p><b>Result:</b> ' + escapeHtml(x.result) + "</p>" +
          '<p class="ref-why"><b>Why it matters:</b> ' + escapeHtml(x.why) + "</p>" +
          (x.page ? '<p class="ref-case"><a href="#p=' + x.page + '">Open the Anzac case, pages ' + x.page + "–" + ((caseByNum(x.case) || {}).end || x.page) + " →</a></p>" : "") +
          "</li>"
        ).join("") +
        "</ol>" +
        '<p class="ref-source">Source: ' + escapeHtml(R.source) + "</p></section>"
      );
    }
    chunks.push('<p class="back-to-top"><a href="#contents-title">Back to the top of the contents</a></p>');
    host.innerHTML = chunks.join("");
    host.dataset.ready = "1";
    const back = host.querySelector(".back-to-top a");
    if (back) {
      back.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById("contents-title") || $("view-contents");
        if (!target) return;
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
        target.focus({ preventScroll: true });
      });
    }
    host.querySelectorAll("[data-jump]").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(tab.dataset.jump);
        if (!target) return;
        const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
        target.focus({ preventScroll: true });
      });
    });
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
    opts.push('<option value="p-7">By year level (p. 7)</option>');
    YEAR_ORDER.forEach((year) => {
      const list = BOOK.cases.filter((c) => c.written && caseYears(c).indexOf(year) !== -1);
      if (!list.length) return;
      opts.push('<optgroup label="Year ' + year + '">');
      list.forEach((c) => {
        if (isStartCase(c) && year === c.year) {
          const s = BOOK.startHere;
          const env = c.envelope || (s.page + 1);
          opts.push(
            '<option value="p-' + s.page + '">Start here: In Case of Emergency (p. ' + s.page + ')</option>'
          );
          opts.push(
            '<option value="p-' + env + '">' + escapeHtml(c.title) + " (p. " + env + ")</option>"
          );
        } else if (isStartCase(c)) {
          // already listed under its primary year
        } else {
          if (coverStoryOf(c)) {
            opts.push(
              '<option value="story-' + c.coverStory.id + '">' +
                escapeHtml(c.coverStory.title) + "</option>"
            );
          }
          opts.push(
            '<option value="p-' + c.start + '">' +
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
    if (view === "story" && storyId) {
      const sv = "story-" + storyId;
      if (Array.from(sel.options).some((o) => o.value === sv)) sel.value = sv;
      return;
    }
    const want = "p-" + page;
    const exact = Array.from(sel.options).some((o) => o.value === want);
    if (exact) sel.value = want;
    else {
      // choose the written case that contains this page, else nearest front-matter
      const cnum = caseOn(page);
      if (cnum) {
        const c = caseByNum(cnum);
        const sh = BOOK.startHere;
        let start = c && c.start;
        if (c && sh && c.num === sh.case) {
          start = (page === sh.page) ? sh.page : (c.envelope || (sh.page + 1));
        }
        sel.value = "p-" + start;
      } else if (page <= 1) sel.value = "p-1";
      else if (page === 2) sel.value = "p-2";
      else if (page === 3) sel.value = "p-3";
      else if (page >= 4 && page <= 6) sel.value = "p-4";
      else sel.value = "contents";
    }
  }

  function preload(n) {
    if (n < 1 || n > TOTAL || isOmitted(n)) return;
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
    elImg.setAttribute("tabindex", "0");
    elImg.setAttribute("role", "button");
    elImg.setAttribute("aria-label", alt(n) + " Tap to enlarge.");
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
    if ($("fit-hint")) $("fit-hint").hidden = textMode;
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
        '<a class="secondary" href="#p=' + (caseByNum(BOOK.startHere.case).envelope || (BOOK.startHere.page + 1)) + '">Then open the case file →</a>'
      );
    } else if (cnum) {
      const c = caseByNum(cnum);
      bits.push('<span class="case-chip">' + escapeHtml(c.title) + "</span>");
      if (coverStoryOf(c)) {
        bits.push('<a class="secondary" href="' + escapeHtml(c.coverStory.hash) + '">The 1813 journey →</a>');
      }
      (c.apps || []).forEach((app) => {
        const onPage = !app.pages || app.pages.indexOf(page) !== -1;
        const cls = onPage ? "" : ' class="secondary"';
        bits.push(
          '<a' + cls + ' href="' + app.url + '" target="_blank" rel="noopener">' +
          escapeHtml(app.label) + " →</a>"
        );
      });
    } else if (page >= 4 && page <= 6) {
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
      const heading = "Page " + page;
      $("text-article").textContent = heading + "\n\n" + (raw || alt(page) + "\n\nNo printable text was extracted from this page. It may be a cover or envelope illustration.");
    });
  }

  function render() {
    views.cover.hidden = view !== "cover";
    views.contents.hidden = view !== "contents";
    views.reader.hidden = view !== "reader";
    if (views.story) views.story.hidden = view !== "story";
    navCurrent();
    document.body.classList.toggle("is-reader", view === "reader");
    document.body.classList.toggle("is-story", view === "story");
    setTitle();
    if (view === "contents") renderContents();
    if (view === "reader") {
      renderReader();
      requestAnimationFrame(function () {
        syncPageMax();
        requestAnimationFrame(syncPageMax);
      });
    }
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
    next = livePage(next, page);
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


  function syncPageMax() {
    if (view !== "reader" || textMode) return;
    const header = document.querySelector(".site-header");
    const toolbar = document.querySelector(".toolbar");
    const dock = $("dock");
    const hint = $("fit-hint");
    const stageEl = $("stage");
    if (!stageEl) return;
    const headerH = header && header.offsetParent !== null ? header.offsetHeight : 0;
    const toolbarH = toolbar ? toolbar.offsetHeight : 0;
    const hintH = hint && !hint.hidden && hint.offsetParent !== null ? hint.offsetHeight : 0;
    const dockH = dock ? dock.offsetHeight : 0;
    const cs = getComputedStyle(stageEl);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const vv = window.visualViewport;
    const vh = vv ? vv.height : window.innerHeight;
    const vw = vv ? vv.width : window.innerWidth;
    const h = Math.floor(vh - headerH - toolbarH - hintH - dockH - padY);
    const w = Math.floor(vw - padX);
    document.documentElement.style.setProperty("--page-max-h", Math.max(80, h) + "px");
    document.documentElement.style.setProperty("--page-max-w", Math.max(80, w) + "px");
  }

  let lightboxOpen = false;
  let lbPage = 1;
  let lbScale = 1;
  let lbX = 0;
  let lbY = 0;
  const lbPointers = new Map();
  let lbPinch0 = null;
  let lbDrag0 = null;
  let lastTap = { t: 0, x: 0, y: 0 };

  function lbFit() {
    const stageEl = $("lb-stage");
    const img = $("lb-img");
    if (!stageEl || !img || !img.naturalWidth) return { fit: 1, sw: 1, sh: 1, nw: 1, nh: 1 };
    const sw = stageEl.clientWidth;
    const sh = stageEl.clientHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fit = Math.min(sw / nw, sh / nh);
    return { fit: fit, sw: sw, sh: sh, nw: nw, nh: nh };
  }

  function layoutLb() {
    const img = $("lb-img");
    const info = lbFit();
    let w = info.nw * info.fit * lbScale;
    let h = info.nh * info.fit * lbScale;
    if (w <= info.sw) lbX = 0;
    if (h <= info.sh) lbY = 0;
    let left = (info.sw - w) / 2 + lbX;
    let top = (info.sh - h) / 2 + lbY;
    if (w > info.sw) {
      const minL = info.sw - w;
      const maxL = 0;
      left = Math.min(maxL, Math.max(minL, left));
      lbX = left - (info.sw - w) / 2;
    } else {
      left = (info.sw - w) / 2;
    }
    if (h > info.sh) {
      const minT = info.sh - h;
      const maxT = 0;
      top = Math.min(maxT, Math.max(minT, top));
      lbY = top - (info.sh - h) / 2;
    } else {
      top = (info.sh - h) / 2;
    }
    img.style.position = "absolute";
    img.style.left = left + "px";
    img.style.top = top + "px";
    img.style.width = w + "px";
    img.style.height = h + "px";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.transform = "none";
    $("lb-stage").style.cursor = lbScale > 1.01 ? "grab" : "zoom-in";
  }

  function zoomLbAt(cx, cy, next) {
    const stageEl = $("lb-stage");
    const rect = stageEl.getBoundingClientRect();
    const px = cx - rect.left;
    const py = cy - rect.top;
    const img = $("lb-img");
    const left0 = parseFloat(img.style.left) || 0;
    const top0 = parseFloat(img.style.top) || 0;
    const w0 = img.offsetWidth || 1;
    const h0 = img.offsetHeight || 1;
    const fx = (px - left0) / w0;
    const fy = (py - top0) / h0;
    lbScale = Math.max(1, Math.min(6, next));
    if (lbScale <= 1.01) {
      lbScale = 1;
      lbX = 0;
      lbY = 0;
      layoutLb();
      return;
    }
    const info = lbFit();
    const w2 = info.nw * info.fit * lbScale;
    const h2 = info.nh * info.fit * lbScale;
    lbX = px - (info.sw - w2) / 2 - fx * w2;
    lbY = py - (info.sh - h2) / 2 - fy * h2;
    layoutLb();
  }

  function openLightbox(n) {
    if (textMode) return;
    lbPage = livePage(n || page);
    lightboxOpen = true;
    document.body.classList.add("lb-open");
    $("lightbox").hidden = false;
    lbScale = 1;
    lbX = 0;
    lbY = 0;
    const img = $("lb-img");
    const show = function () {
      layoutLb();
    };
    img.onload = show;
    img.src = src(lbPage);
    img.setAttribute("data-page", String(lbPage));
    img.alt = alt(lbPage);
    if (img.complete && img.naturalWidth) show();
    $("lb-status").textContent = "Page " + lbPage + " of " + TOTAL;
    $("lb-prev").disabled = lbPage <= 1;
    $("lb-next").disabled = lbPage >= TOTAL;
    $("lb-close").focus();
    if (page !== lbPage) {
      page = lbPage;
      history.replaceState(null, "", location.pathname + location.search + "#p=" + page);
      setTitle();
      renderReader();
      requestAnimationFrame(syncPageMax);
    }
  }

  function closeLightbox() {
    if (!lightboxOpen) return;
    lightboxOpen = false;
    document.body.classList.remove("lb-open");
    $("lightbox").hidden = true;
    lbPointers.clear();
    lbPinch0 = null;
    lbDrag0 = null;
    lbScale = 1;
    lbX = 0;
    lbY = 0;
  }

  function lbTurn(delta) {
    const next = livePage(lbPage + delta, lbPage);
    if (next === lbPage) return;
    lbPage = next;
    page = next;
    history.replaceState(null, "", location.pathname + location.search + "#p=" + page);
    setTitle();
    renderReader();
    requestAnimationFrame(syncPageMax);
    lbScale = 1;
    lbX = 0;
    lbY = 0;
    const img = $("lb-img");
    const show = function () { layoutLb(); };
    img.onload = show;
    img.src = src(lbPage);
    img.setAttribute("data-page", String(lbPage));
    img.alt = alt(lbPage);
    if (img.complete && img.naturalWidth) show();
    $("lb-status").textContent = "Page " + lbPage + " of " + TOTAL;
    $("lb-prev").disabled = lbPage <= 1;
    $("lb-next").disabled = lbPage >= TOTAL;
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
    else if (v.indexOf("story-") === 0) go({ view: "story", story: v.slice(6) }, { push: true });
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
    if (lightboxOpen) {
      if (e.key === "Escape") { e.preventDefault(); closeLightbox(); return; }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault(); lbTurn(1); return;
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault(); lbTurn(-1); return;
      }
      if (e.key === "Home") { e.preventDefault(); lbTurn(1 - lbPage); return; }
      if (e.key === "End") { e.preventDefault(); lbTurn(TOTAL - lbPage); return; }
      return;
    }
    if (view !== "reader") return;
    if (e.target.matches("input, select, textarea")) return;
    if ((e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest(".leaf img")) {
      e.preventDefault();
      openLightbox(Number(e.target.getAttribute("data-page")) || page);
      return;
    }
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
      requestAnimationFrame(syncPageMax);
    }
  });

  const stage = $("stage");
  let swipe = null;
  function onStageDown(e) {
    if (textMode || lightboxOpen) return;
    if (e.target.closest(".edge, a, button, select, input, .dock")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipe = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      img: e.target.closest(".leaf img"),
      page: e.target.closest(".leaf img") ? Number(e.target.closest(".leaf img").getAttribute("data-page")) || page : page,
      moved: false
    };
  }
  function onStageMove(e) {
    if (!swipe) return;
    if (Math.abs(e.clientX - swipe.x) > 12 || Math.abs(e.clientY - swipe.y) > 12) swipe.moved = true;
  }
  function onStageUp(e) {
    if (!swipe) return;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    const started = swipe;
    swipe = null;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) turn(1);
      else turn(-1);
      return;
    }
    if (!started.moved && started.img && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      openLightbox(started.page);
    }
  }
  stage.addEventListener("pointerdown", onStageDown);
  stage.addEventListener("pointermove", onStageMove);
  stage.addEventListener("pointerup", onStageUp);
  stage.addEventListener("pointercancel", function () { swipe = null; });
  stage.addEventListener("keydown", function () { /* Enter handled globally */ });

  $("lb-close").addEventListener("click", closeLightbox);
  $("lb-prev").addEventListener("click", function (e) { e.stopPropagation(); lbTurn(-1); });
  $("lb-next").addEventListener("click", function (e) { e.stopPropagation(); lbTurn(1); });
  $("lightbox").addEventListener("click", function (e) {
    if (e.target === $("lightbox") || e.target === $("lb-stage") || e.target.classList.contains("lb-bar") || e.target.classList.contains("lb-caption") || e.target.classList.contains("lb-status")) {
      if (e.target === $("lb-stage")) return; // stage clicks handled as zoom / backdrop below
      if (e.target === $("lightbox") || e.target.classList.contains("lb-bar") || e.target.classList.contains("lb-caption") || e.target.id === "lb-status") {
        closeLightbox();
      }
    }
  });

  const lbStage = $("lb-stage");
  lbStage.addEventListener("click", function (e) {
    // Click on empty stage (backdrop), not the image, closes — unless it was a drag.
    if (e.target === lbStage && !lbDrag0) closeLightbox();
  });

  function pointerMid() {
    const pts = Array.from(lbPointers.values());
    if (pts.length === 0) return null;
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x: x, y: y };
  }
  function pointerDist() {
    const pts = Array.from(lbPointers.values());
    if (pts.length < 2) return 0;
    const a = pts[0], b = pts[1];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  lbStage.addEventListener("pointerdown", function (e) {
    if (!lightboxOpen) return;
    lbStage.setPointerCapture(e.pointerId);
    lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lbPointers.size === 2) {
      lbPinch0 = { dist: pointerDist(), scale: lbScale };
      lbDrag0 = null;
    } else if (lbPointers.size === 1) {
      lbDrag0 = { x: e.clientX, y: e.clientY, lx: lbX, ly: lbY, moved: false, t: Date.now() };
    }
  });
  lbStage.addEventListener("pointermove", function (e) {
    if (!lightboxOpen || !lbPointers.has(e.pointerId)) return;
    lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lbPointers.size >= 2 && lbPinch0 && lbPinch0.dist) {
      const mid = pointerMid();
      const d = pointerDist();
      zoomLbAt(mid.x, mid.y, lbPinch0.scale * (d / lbPinch0.dist));
      return;
    }
    if (lbDrag0 && lbPointers.size === 1) {
      const dx = e.clientX - lbDrag0.x;
      const dy = e.clientY - lbDrag0.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) lbDrag0.moved = true;
      if (lbScale > 1.01) {
        lbX = lbDrag0.lx + dx;
        lbY = lbDrag0.ly + dy;
        layoutLb();
      }
    }
  });
  function lbPointerEnd(e) {
    if (!lbPointers.has(e.pointerId)) return;
    const drag = lbDrag0;
    lbPointers.delete(e.pointerId);
    if (lbPointers.size < 2) lbPinch0 = null;
    if (lbPointers.size === 0) {
      const wasDrag = drag;
      lbDrag0 = null;
      if (wasDrag && wasDrag.moved) {
        if (lbScale <= 1.01) {
          const dx = e.clientX - wasDrag.x;
          const dy = e.clientY - wasDrag.y;
          if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) lbTurn(1);
            else lbTurn(-1);
          }
        }
        return;
      }
      if (e.target !== $("lb-img")) {
        closeLightbox();
        return;
      }
      const now = Date.now();
      const dt = now - lastTap.t;
      const dist = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y);
      if (dt < 320 && dist < 28) {
        lastTap.t = 0;
        if (lbScale > 1.01) zoomLbAt(e.clientX, e.clientY, 1);
        else zoomLbAt(e.clientX, e.clientY, 2.5);
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    }
  }
  lbStage.addEventListener("pointerup", lbPointerEnd);
  lbStage.addEventListener("pointercancel", function (e) {
    lbPointers.delete(e.pointerId);
    if (lbPointers.size < 2) lbPinch0 = null;
    if (lbPointers.size === 0) lbDrag0 = null;
  });
  lbStage.addEventListener("wheel", function (e) {
    if (!lightboxOpen) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomLbAt(e.clientX, e.clientY, lbScale * factor);
  }, { passive: false });

  window.addEventListener("popstate", () => {
    const next = parseHash();
    view = next.view;
    if (next.page) page = next.page;
    if (next.story) storyId = next.story;
    render();
  });
  window.addEventListener("hashchange", () => {
    const next = parseHash();
    if (next.view !== view || (next.page && next.page !== page) || (next.story && next.story !== storyId)) {
      view = next.view;
      if (next.page) page = next.page;
      if (next.story) storyId = next.story;
      render();
    }
  });
  function onViewportChange() {
    syncHeaderVar();
    if (view === "reader") {
      renderReader();
      syncPageMax();
    }
    if (lightboxOpen) layoutLb();
  }
  window.addEventListener("resize", onViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onViewportChange);
  }

  // Measure header for sticky toolbar offset
  function syncHeaderVar() {
    const h = document.querySelector(".site-header");
    if (h) document.documentElement.style.setProperty("--header-h", h.offsetHeight + "px");
  }
  syncHeaderVar();

  $("page-num").setAttribute("max", String(TOTAL));

  // First paint
  fillJump();
  const first = parseHash();
  view = first.view;
  if (first.page) page = first.page;
  if (first.story) storyId = first.story;
  render();
  // Warm nearby images if we landed in the reader
  if (view === "reader") {
    preload(page - 1);
    preload(page + 1);
  }

  const storyZoom = $("story-zoom");
  const storyZoomImg = $("story-zoom-img");
  function closeStoryZoom() {
    if (!storyZoom) return;
    storyZoom.hidden = true;
    if (storyZoomImg) { storyZoomImg.removeAttribute("src"); storyZoomImg.alt = ""; }
  }
  if ($("view-story")) {
    $("view-story").addEventListener("click", (e) => {
      const btn = e.target.closest(".story-img");
      if (!btn || !storyZoom || !storyZoomImg) return;
      const img = btn.querySelector("img");
      if (!img) return;
      storyZoomImg.src = img.currentSrc || img.src;
      storyZoomImg.alt = img.alt || "";
      storyZoom.hidden = false;
    });
  }
  if ($("story-zoom-close")) $("story-zoom-close").addEventListener("click", closeStoryZoom);
  if (storyZoom) {
    storyZoom.addEventListener("click", (e) => {
      if (e.target === storyZoom) closeStoryZoom();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && storyZoom && !storyZoom.hidden) {
      e.preventDefault();
      closeStoryZoom();
    }
  });

})();
