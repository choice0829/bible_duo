/* 책장성경 — 개역한글 + 책 넘김 효과 (PWA)
 * - 쪽 나누기: 숨은 요소(#measure)에 글을 넣어 보며 한 쪽에 들어가는 만큼 자른다.
 * - 책 넘김: page-flip(StPageFlip) 라이브러리
 * - 화면이 넓으면(펼친 상태) 두 쪽, 좁으면(접힌 상태) 한 쪽
 */
(() => {
  'use strict';

  // ---------- 설정 ----------
  const AUTO_SPREAD_MIN_WIDTH = 700;   // 자동 모드에서 이 폭(px) 이상이면 두 쪽 펼침
  // 여백 기본값. 설정 → 고급설정에서 바꾸거나 기본값으로 되돌릴 수 있다.
  //  - 윗 여백: 머리줄(책 이름·메뉴)과 상태 아이콘이 차지하는 윗부분(px)
  //  - 가로 위치: 펼친 화면에서 두 쪽을 오른쪽으로 옮기는 양(px)
  //  - 아래 여백(펼침): 펼친 화면의 맨 아래 비워 두는 높이(px)
  const TOP_DEFAULT = { topSpread: 96, topSingle: 150 };
  const SHIFT_DEFAULT = 52;
  const BOTTOM_SPREAD_DEFAULT = 20;
  // 여백 기본값을 바꿀 때 이 번호를 올리면, 기기에 저장돼 있던 펼침 여백 값이 새 기본값으로 한 번 바뀐다.
  const MARGIN_REV = 19;
  const TOP_MIN_SPREAD = 48, TOP_MIN_SINGLE = 96, TOP_MAX = 280;
  const SIDE_PAD = 8;   // 본문 좌우 여백(px). 더 줄이려면 숫자를 낮추세요
  const FONT_MIN = 14, FONT_MAX = 30;
  const THEMES = { paper: '종이', sepia: '세피아', night: '야간' };
  const SYS_SERIF = '"AppleMyungjo","Noto Serif KR","Noto Serif CJK KR","Apple SD Gothic Neo",serif';
  const SYS_SANS = '"Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",-apple-system,sans-serif';
  // 글씨체: face가 있는 것은 fonts/ 폴더의 글꼴 파일(앱에 포함, 오프라인 사용 가능)
  const FONTS = {
    myeongjo: { label: '기본 명조', stack: SYS_SERIF },
    gothic: { label: '기본 고딕', stack: SYS_SANS },
    nanumM: { label: '나눔명조', face: 'KF Nanum Myeongjo', stack: '"KF Nanum Myeongjo",' + SYS_SERIF },
    gowunB: { label: '고운바탕', face: 'KF Gowun Batang', stack: '"KF Gowun Batang",' + SYS_SERIF },
    gowunD: { label: '고운돋움', face: 'KF Gowun Dodum', stack: '"KF Gowun Dodum",' + SYS_SANS },
    nanumG: { label: '나눔고딕', face: 'KF Nanum Gothic', stack: '"KF Nanum Gothic",' + SYS_SANS },
  };
  const LAYOUTS = { auto: '자동', single: '한 쪽', spread: '펼침(두 쪽)' };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const store = {
    get(key, fallback) {
      try { return Object.assign({}, fallback, JSON.parse(localStorage.getItem(key))); }
      catch (e) { return Object.assign({}, fallback); }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 무시 */ } },
  };

  let settings = store.get('bf.settings', { fontSize: 18, theme: 'paper', layout: 'auto', font: 'myeongjo', topSpread: TOP_DEFAULT.topSpread, topSingle: TOP_DEFAULT.topSingle });
  // 이전 버전에서 저장된 펼침 여백(윗 144 · 아래 8 등)을 새 기본값(96 · 52 · 20)으로 한 번만 바꾼다.
  // 이후에는 고급설정에서 바꾼 값이 그대로 유지된다.
  if (settings.marginRev !== MARGIN_REV) {
    settings = Object.assign({}, settings, {
      topSpread: TOP_DEFAULT.topSpread, shiftX: SHIFT_DEFAULT, bottomSpread: BOTTOM_SPREAD_DEFAULT, marginRev: MARGIN_REV,
    });
    store.set('bf.settings', settings);
  }
  let pos = store.get('bf.pos', { book: 0, chapter: 0, verse: 1 });
  // 표시(하이라이트·동그라미 등): { 'gen.6.8': [ { id, s, e, kind, pen, c } ] }  (s~e = 그 절 본문의 글자 위치)
  let anns = store.get('bf.ann', {});
  let tool = store.get('bf.tool', { pen: 'marker', c: 0 });   // 마지막으로 고른 펜 종류와 색
  let sel = null;       // 지금 고른 낱말들 { items: [{ bookId, k, s, e }], act: 마지막으로 만진 범위 번호 }
  let selecting = false; // 길게 누른 채 끌어서 범위를 넓히는 중
  let bible = null;     // { version, books: [{id, name, chapters: [[{n,t}]]}] }
  let flip = null;      // St.PageFlip (펼친 화면에서만)
  let scroller = null;  // 접힌(한 쪽) 화면: 한 쪽씩 옆으로 밀어 넘기는 스크롤 영역
  let scrollIdx = 0;
  let pg = null;        // 현재 책의 쪽 나누기 결과
  let generation = 0;   // 오래된 비동기 작업을 버리기 위한 번호
  let lastGeo = '';

  const stage = $('#stage');
  const measure = $('#measure');

  // ---------- 화면 크기 ----------
  // 실제로 화면을 채우는 보이지 않는 요소의 크기를 잰다. (접기/펼치기 직후 innerWidth가 어긋나는 경우를 피한다)
  const vp = document.createElement('div');
  vp.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;visibility:hidden;pointer-events:none;z-index:-1';
  document.body.appendChild(vp);
  function viewSize() {
    return {
      w: Math.floor(vp.clientWidth || window.innerWidth),
      h: Math.floor(vp.clientHeight || window.innerHeight),
    };
  }
  function safeInsets() {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const r = {
      top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0,
    };
    probe.remove();
    return r;
  }

  // 펼친 화면에서 두 쪽을 오른쪽으로 옮기는 양. 아이폰 듀오는 오른쪽 상태 아이콘 자리만큼 화면이 더 넓은데
  // 앱에는 그 폭이 빠진 채로 알려져 두 쪽이 왼쪽으로 쏠려 보인다. 설정에서 직접 고칠 수 있다.
  function spreadShift() {
    return typeof settings.shiftX === 'number' ? settings.shiftX : SHIFT_DEFAULT;
  }
  function geometry() {
    const { w: W, h: H } = viewSize();
    const si = safeInsets();
    const spread = settings.layout === 'spread' ||
      (settings.layout === 'auto' && W >= AUTO_SPREAD_MIN_WIDTH);
    // 펼친 화면: 오른쪽으로 옮긴 만큼 쪽 폭을 줄여, 오른쪽 끝이 화면 밖으로 잘리지 않게 한다
    const shiftX = spread ? spreadShift() : 0;
    const pageW = spread ? Math.floor((W - shiftX) / 2) : W;
    // 좌우 안전영역은 무시한다. 아이폰 듀오 앱 모드는 오른쪽 상태 아이콘 때문에 오른쪽 안전영역을 84px로 알리는데,
    // 아이콘은 맨 위에만 있고 윗부분은 따로 비워 두므로 본문 좌우는 끝까지 쓴다.
    const padX = SIDE_PAD;
    // 윗부분: 머리줄(책 이름·버튼)과 상태 아이콘 자리. 아랫부분 여백은 최소로 줄여 이쪽으로 옮겼다.
    const topSetting = spread ? settings.topSpread : settings.topSingle;
    const padTop = Math.max(si.top + 56, Math.min(TOP_MAX, Math.round(topSetting) || (spread ? TOP_DEFAULT.topSpread : TOP_DEFAULT.topSingle)));
    const padBottom = spread
      ? (typeof settings.bottomSpread === 'number' ? settings.bottomSpread : BOTTOM_SPREAD_DEFAULT)
      : si.bottom + 10;
    return {
      W, H, spread, pageW, pageH: H, bookW: spread ? pageW * 2 : pageW,
      padX, padTop, padBottom, si, shiftX,
      textW: pageW - padX * 2, textH: H - padTop - padBottom,
    };
  }

  function applyLook(g) {
    const root = document.documentElement.style;
    root.setProperty('--fs', settings.fontSize + 'px');
    const fstack = (FONTS[settings.font] || FONTS.myeongjo).stack;
    root.setProperty('--serif', fstack);
    root.setProperty('--sans', fstack);   // 상단 메뉴·굵은 글씨·창도 같은 글씨체
    root.setProperty('--padx', g.padX + 'px');
    root.setProperty('--padtop', g.padTop + 'px');
    root.setProperty('--padbottom', g.padBottom + 'px');
    // 상단: 접힘 = 책 이름 위, 메뉴 아래(본문 바로 위) / 펼침 = 한 줄(책 이름 왼쪽, 메뉴 오른쪽)
    const titleFs = g.spread ? 44 : 44, titleH = Math.round(titleFs * 1.2);
    const rowH = g.spread ? Math.max(titleH, 34) : titleH + 4 + 34;
    root.setProperty('--title-fs', titleFs + 'px');
    root.setProperty('--head-top', Math.max(g.si.top + 4, g.padTop - 12 - rowH) + 'px');
    document.body.className = document.body.className
      .replace(/\btheme-\w+/g, '').trim() + ' theme-' + settings.theme;
    const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute('content', bg);
    stage.style.width = g.bookW + 'px';
    stage.style.height = g.H + 'px';
    stage.style.marginLeft = g.shiftX ? g.shiftX + 'px' : '';   // 펼친 화면 가운데 맞춤
    root.setProperty('--shiftx', g.shiftX + 'px');
    stage.classList.toggle('spread', g.spread);
    document.body.classList.toggle('is-spread', g.spread);
  }

  // ---------- 표시(하이라이트 · 동그라미 · 네모 · 물결 · 밑줄) ----------
  const markKey = (bookId, k) => bookId + '.' + (Math.floor(k / 1000) + 1) + '.' + (k % 1000);
  const KINDS = { fill: '형광', circle: '동그라미', rect: '네모', wave: '물결', under: '밑줄' };
  const KIND_ORDER = { fill: 0, under: 1, wave: 2, rect: 3, circle: 4, sel: 5 };
  const PENS = { marker: '싸인펜', pencil: '색연필' };
  const COLORS = [
    { n: '노랑', f: '#FFD93B', s: '#E3A400' },
    { n: '초록', f: '#7BD88F', s: '#2FA84F' },
    { n: '파랑', f: '#6EC1FF', s: '#2F86E0' },
    { n: '분홍', f: '#FF8FB8', s: '#E23E7C' },
    { n: '주황', f: '#FFA65C', s: '#E8661A' },
  ];
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const saveAnns = () => {
    Object.keys(anns).forEach((k) => { if (!anns[k] || !anns[k].length) delete anns[k]; });
    store.set('bf.ann', anns);
  };

  // 손으로 그린 듯한 모양은 작은 SVG 그림을 배경으로 깔아 만든다. (글자 위치·줄 바꿈에는 영향이 없다)
  // 같은 모양이 모두 똑같아 보이지 않도록 표시마다 3가지 변형 중 하나를 쓴다.
  const styleEl = document.createElement('style');
  document.head.appendChild(styleEl);
  const ruleDone = new Set();
  function seedOf(str) {
    let h = 2166136261;
    for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const fx = (v) => v.toFixed(1);
  const poly = (pts, close) => 'M' + pts.map((q) => fx(q[0]) + ',' + fx(q[1])).join(' L') + (close ? ' Z' : '');
  const svgBG = (inner, vb) => 'url("data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" preserveAspectRatio="none">' + inner + '</svg>') + '")';
  const rgba = (hex, al) => {
    const n = parseInt(hex.slice(1), 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + al + ')';
  };

  // 표시 하나에 쓸 클래스 이름. 처음 쓰일 때 CSS를 만든다.
  // 색연필 질감은 무거운 SVG 필터 대신 가는 빗금(그라데이션)과 끊어 그은 선으로 표현한다. (아이폰에서 가볍게 돌아가도록)
  function ruleFor(a) {
    const v = seedOf(a.id) % 3;
    const cls = 'an-' + a.kind + '-' + a.pen + '-' + a.c + '-' + v;
    if (ruleDone.has(cls)) return cls;
    ruleDone.add(cls);
    const col = COLORS[a.c] || COLORS[0];
    const r = rng(seedOf(cls));
    const j = (m) => (r() - 0.5) * m;
    const pencil = a.pen === 'pencil';
    const sattr = (w, op, dash) => 'fill="none" stroke="' + col.s + '" stroke-width="' + w.toFixed(1) +
      '" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="' + op + '"' +
      (dash ? ' stroke-dasharray="' + dash + '"' : '');
    // 선 모양 만들기: 색연필은 살짝 다르게 두 번 긋고 군데군데 끊는다
    const strokes = (gen, w) => pencil
      ? '<path d="' + gen() + '" ' + sattr(w * 0.72, 0.78, '34 2 18 3 46 2') + '/><path d="' + gen() + '" ' + sattr(w * 0.6, 0.62, '20 3 40 2 24 3') + '/>'
      : '<path d="' + gen() + '" ' + sattr(w, 0.9) + '/>';
    const NR = 'background-repeat:no-repeat;';
    let css = '';
    if (a.kind === 'fill') {
      const top = [], bot = [];
      for (let x = 2; x <= 98; x += 12) { top.push([x + j(1.6), 6 + j(2.8)]); bot.push([x + j(1.6), 35 + j(2.8)]); }
      bot.reverse();
      const d = poly(top.concat(bot), true);
      if (pencil) {
        const base = svgBG('<path d="' + d + '" fill="' + col.f + '" fill-opacity=".3"/>', '0 0 100 40');
        const h1 = 'repeating-linear-gradient(' + (112 + v * 8) + 'deg,' + rgba(col.s, 0.5) + ' 0 1px,transparent 1px ' + (2.7 + v * 0.4) + 'px)';
        const h2 = 'repeating-linear-gradient(' + (68 - v * 6) + 'deg,' + rgba(col.f, 0.75) + ' 0 1.2px,transparent 1.2px ' + (3.5 + v * 0.3) + 'px)';
        css = 'padding:.04em 0 .12em;' + NR + 'background-size:100% 72%,100% 72%,100% 100%;background-position:0 55%,0 55%,0 0;background-image:' + h1 + ',' + h2 + ',' + base;
      } else {
        const inner = '<path d="' + d + '" fill="' + col.f + '" fill-opacity=".5" stroke="' + col.f + '" stroke-opacity=".4" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
        css = 'padding:.04em 0 .12em;' + NR + 'background-size:100% 100%;background-image:' + svgBG(inner, '0 0 100 40');
      }
    } else if (a.kind === 'circle') {
      const gen = () => {
        const pts = [], n = 46, a0 = -2 + j(1), turns = 1.1 + r() * 0.05;
        for (let i = 0; i <= n; i++) {
          const t = i / n, th = a0 + t * turns * Math.PI * 2, k = 1 - t * 0.06 + j(0.03);
          pts.push([50 + Math.cos(th) * 45 * k, 20 + Math.sin(th) * 15.5 * k]);
        }
        return poly(pts);
      };
      css = 'padding:.12em .3em .22em;margin:0 -.3em;' + NR + 'background-size:100% 100%;background-image:' + svgBG(strokes(gen, 2.1), '0 0 100 40');
    } else if (a.kind === 'rect') {
      const gen = () => poly([[6 + j(2), 7 + j(2)], [94 + j(2), 5 + j(2)], [95 + j(2), 35 + j(2)], [5 + j(2), 36 + j(2)], [7 + j(2), 4 + j(2)], [15, 5 + j(1)]]);
      css = 'padding:.1em .2em .2em;margin:0 -.2em;' + NR + 'background-size:100% 100%;background-image:' + svgBG(strokes(gen, 2.1), '0 0 100 40');
    } else if (a.kind === 'under') {
      const gen = () => { const pts = []; for (let x = 1; x <= 99; x += 14) pts.push([x + j(2), 4 + j(1.8)]); return poly(pts); };
      css = 'padding:0 0 .28em;' + NR + 'background-size:100% .34em;background-position:0 100%;background-image:' + svgBG(strokes(gen, 2.2), '0 0 100 8');
    } else if (a.kind === 'wave') {
      const gen = () => {
        let d = 'M0,4', x = 0;
        for (let i = 0; i < 6; i++) { const dir = i % 2 ? 1 : -1, amp = 2.8 + j(1.4); d += ' Q' + fx(x + 3.33) + ',' + fx(4 + dir * amp) + ' ' + fx(x + 6.67) + ',4'; x += 6.67; }
        return d;
      };
      css = 'padding:0 0 .3em;background-repeat:repeat-x;background-size:2.3em .44em;background-position:0 100%;background-image:' + svgBG(strokes(gen, 1.9), '0 0 40 8');
    }
    styleEl.appendChild(document.createTextNode('.' + cls + '{' + css + '}\n'));
    return cls;
  }

  // 절 본문의 [off, off+raw.length) 부분을 표시가 입혀진 HTML로 만든다.
  // 표시끼리 겹치면 안쪽부터 층층이 감싸고, 엇갈리는 부분은 나누어 감싼다.
  function annOpen(a) {
    return a.kind === 'sel' ? '<span class="a-sel">' : '<span class="a ' + ruleFor(a) + '">';
  }
  function renderRange(text, off, items) {
    if (!items.length) return esc(text);
    items.sort((x, y) => x.s - y.s || y.e - x.e || KIND_ORDER[x.a.kind] - KIND_ORDER[y.a.kind]);
    const first = items[0];
    const inner = [], after = [];
    for (let i = 1; i < items.length; i++) {
      const q = items[i];
      if (q.s < first.e) inner.push({ a: q.a, s: q.s, e: Math.min(q.e, first.e) });
      if (q.e > first.e) after.push({ a: q.a, s: Math.max(q.s, first.e), e: q.e });
    }
    return esc(text.slice(0, first.s - off)) +
      annOpen(first.a) + renderRange(text.slice(first.s - off, first.e - off), first.s, inner) + '</span>' +
      renderRange(text.slice(first.e - off), first.e, after);
  }
  function annotate(bookId, k, off, raw) {
    const list = (anns[markKey(bookId, k)] || []).slice();
    if (sel) sel.items.forEach((i) => { if (i.bookId === bookId && i.k === k) list.push({ id: 'sel', kind: 'sel', s: i.s, e: i.e }); });
    if (!list.length) return esc(raw);
    const end = off + raw.length, items = [];
    list.forEach((a) => {
      const s = Math.max(a.s, off), e = Math.min(a.e, end);
      if (e > s) items.push({ a, s, e });
    });
    return renderRange(raw, off, items);
  }
  // 화면에 있는 그 절의 본문(여러 쪽에 걸쳐 있으면 모두)을 다시 그린다.
  function paintVerse(bookId, k) {
    if (!pg || !bible.books[pg.bookIndex] || bible.books[pg.bookIndex].id !== bookId) return;
    const t = verseText(pg.bookIndex, Math.floor(k / 1000), k % 1000) + ' ';
    document.querySelectorAll('#stage p[data-k="' + k + '"]').forEach((p) => {
      const o = +p.dataset.o, e = +p.dataset.e;
      p.innerHTML = (p.dataset.h ? '<sup class="vn">' + (k % 1000) + '</sup>' : '') + annotate(bookId, k, o, t.slice(o, e));
    });
  }
  // 범위 [s,e)를 지운 나머지 표시들 (pred를 만족하는 표시만 깎는다)
  function cutRange(list, s, e, pred) {
    const out = [];
    list.forEach((a) => {
      if (!pred(a) || a.e <= s || a.s >= e) { out.push(a); return; }
      if (a.s < s) out.push(Object.assign({}, a, { id: newId(), e: s }));
      if (a.e > e) out.push(Object.assign({}, a, { id: newId(), s: e }));
    });
    return out;
  }
  // 예전 방식(절 전체 하이라이트)으로 저장한 것을 새 방식으로 옮긴다.
  function migrateMarks() {
    let old = null;
    try { old = JSON.parse(localStorage.getItem('bf.hl')); } catch (e) { old = null; }
    if (!old || !Object.keys(old).length) return;
    Object.keys(old).forEach((key) => {
      const [id, c, n] = key.split('.');
      const bi = bible.books.findIndex((b) => b.id === id);
      if (bi < 0) return;
      const t = verseText(bi, +c - 1, +n);
      if (!t || (anns[key] && anns[key].length)) return;
      anns[key] = [{ id: newId(), s: 0, e: t.length, kind: 'fill', pen: 'marker', c: 0 }];
    });
    saveAnns();
    try { localStorage.setItem('bf.hl.old', JSON.stringify(old)); localStorage.removeItem('bf.hl'); } catch (e) { /* 무시 */ }
  }

  // ---------- 본문 → 조각(unit) ----------
  // 조각 종류: 0 = 장 제목, 1 = 절 번호, 2 = 낱말
  // K[i] = 그 조각이 속한 절의 표식(장 번호 × 1000 + 절 번호). 이동 후 절 강조에 쓴다.
  function buildUnits(bookIndex) {
    const book = bible.books[bookIndex];
    const unitName = book.id === 'psa' ? '편' : '장';
    const T = [], H = [], K = [], W = [], O = [];   // W: 낱말 원문, O: 그 낱말이 절 본문에서 시작하는 글자 위치
    const chapterStart = [], verseAt = [];
    book.chapters.forEach((verses, c) => {
      chapterStart.push(T.length);
      T.push(0); K.push(c * 1000); W.push(''); O.push(-1);
      H.push('<h2 class="ch">' + (c + 1) + unitName + '</h2>');   // 책 이름은 위쪽 머리줄에 있으므로 '11장'만 쓴다
      const va = [];
      verses.forEach((v) => {
        const key = c * 1000 + v.n;
        va.push({ n: v.n, u: T.length });
        T.push(1); K.push(key); W.push(''); O.push(-1);
        H.push('<sup class="vn">' + v.n + '</sup>');
        const words = v.t.split(' ');
        let off = 0;
        words.forEach((w) => { T.push(2); K.push(key); H.push(esc(w) + ' '); W.push(w); O.push(off); off += w.length + 1; });
      });
      verseAt.push(va);
    });
    return { T, H, K, W, O, chapterStart, verseAt, unitName, bookIndex, bookId: book.id };
  }

  // 절마다 새 문단(<p>)으로 시작한다. 쪽이 절 중간에서 시작하면 이어지는 문단으로 연다.
  // 문단에는 data-o(절 본문에서 이 문단이 시작하는 글자 위치)·data-e(끝)를 달아, 낱말 선택·표시 위치를 알아낸다.
  function sliceHTML(u, a, b) {
    let out = '', cur = null;
    const close = () => {
      if (!cur) return;
      const o = Math.max(cur.off, 0);
      out += '<p data-k="' + cur.k + '" data-o="' + o + '" data-e="' + (o + cur.raw.length) + '"' + (cur.head ? ' data-h="1"' : '') + '>' +
        cur.head + annotate(u.bookId, cur.k, o, cur.raw) + '</p>';
      cur = null;
    };
    for (let i = a; i < b; i++) {
      const t = u.T[i];
      if (t === 0) { close(); out += u.H[i]; continue; }
      if (t === 1) { close(); cur = { k: u.K[i], head: u.H[i], off: -1, raw: '' }; continue; }   // 절 번호 = 새 줄
      if (!cur) cur = { k: u.K[i], head: '', off: -1, raw: '' };
      if (cur.off < 0) cur.off = u.O[i];
      cur.raw += u.W[i] + ' ';
    }
    close();
    return out;
  }

  // ---------- 쪽 나누기 ----------
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function paginate(u, g, gen) {
    measure.style.width = g.textW + 'px';
    measure.style.height = (g.textH - 2) + 'px';   // 2px 여유: 마지막 줄이 잘리지 않게
    const n = u.T.length;
    const fits = (i, k) => {
      measure.innerHTML = sliceHTML(u, i, i + k);
      return measure.scrollHeight <= measure.clientHeight;
    };

    const starts = [];
    let i = 0, guess = 150;
    while (i < n) {
      starts.push(i);
      const maxK = n - i;
      let hi = Math.min(maxK, Math.ceil(guess * 1.4) + 8);
      let hiFits = fits(i, hi);
      while (hiFits && hi < maxK) {
        hi = Math.min(maxK, hi * 2);
        hiFits = fits(i, hi);
      }
      let k;
      if (hiFits) {
        k = hi;                       // 남은 글이 모두 들어간다
      } else {
        let lo = 1, up = hi;          // lo: 들어감, up: 안 들어감
        while (up - lo > 1) {
          const mid = (lo + up) >> 1;
          if (fits(i, mid)) lo = mid; else up = mid;
        }
        k = lo;
      }
      // 쪽 끝에 장 제목이나 절 번호만 덩그러니 남지 않게 앞으로 물린다
      while (k > 1 && u.T[i + k - 1] !== 2) k--;
      i += k;
      guess = k;
      if (starts.length % 10 === 0) {
        await tick();
        if (gen !== generation) return null;
      }
    }
    measure.innerHTML = '';
    return starts;
  }

  // ---------- 위치 ↔ 쪽 ----------
  function pageOfUnit(u) {
    const s = pg.starts;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= u) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function positionOfUnit(u, bookIndex) {
    const cs = pg.chapterStart;
    let c = 0;
    for (let i = 0; i < cs.length; i++) { if (cs[i] <= u) c = i; else break; }
    let verse = 1;
    for (const v of pg.verseAt[c]) { if (v.u <= u) verse = v.n; else break; }
    return { book: bookIndex, chapter: c, verse };
  }

  function unitOfPosition(p) {
    const c = Math.min(Math.max(p.chapter, 0), pg.chapterStart.length - 1);
    if (p.verse > 1) {
      let found = null;
      for (const v of pg.verseAt[c]) { if (v.n <= p.verse) found = v; else break; }
      if (found) return found.u;
    }
    return pg.chapterStart[c];
  }

  // ---------- 책 만들기 ----------
  function showLoading(on) {
    $('#loading').hidden = !on;
  }

  // 이동한 절을 잠깐 강조한다. (책장이 자리 잡을 시간을 조금 준 뒤 표시)
  function highlightVerse(p) {
    if (!p || !(p.verse > 1)) return;
    const key = p.chapter * 1000 + p.verse;
    setTimeout(() => {
      const els = document.querySelectorAll('#stage p[data-k="' + key + '"]');
      els.forEach((el) => el.classList.add('hl'));
      setTimeout(() => els.forEach((el) => el.classList.remove('hl')), 3000);
    }, 150);
  }

  async function ensureFont() {
    const f = FONTS[settings.font] || FONTS.myeongjo;
    if (!f.face) return;
    try {
      await Promise.race([
        document.fonts.load('18px "' + f.face + '"', '가나다라 1:2'),
        document.fonts.load('700 18px "' + f.face + '"', '가나다라 1:2'),
        new Promise((r) => setTimeout(r, 8000)),
      ]);
    } catch (e) { /* 글꼴을 못 불러오면 기본 글꼴로 대체되어 보인다 */ }
  }

  async function rebuild(target, highlight) {
    const gen = ++generation;
    showLoading(true);
    await tick();
    const g = geometry();
    lastGeo = [g.W, g.H, g.si.top, g.si.bottom].join('x');
    applyLook(g);
    await ensureFont();   // 글씨체 파일이 준비된 뒤에 쪽을 나눠야 쪽 경계가 맞는다
    if (gen !== generation) return;

    if (!g.spread) {   // 접힌 화면: 한 장(chapter)씩 위아래로 스크롤, 쪽 나누기 없음
      pg = { bookIndex: target.book, g, unitName: bible.books[target.book].id === 'psa' ? '편' : '장', scroll: true };
      mountChapters(target);
      showLoading(false);
      if (highlight) highlightVerse(target);
      maybeShowHint();
      return;
    }

    const u = buildUnits(target.book);
    const starts = await paginate(u, g, gen);
    if (starts === null || gen !== generation) return;

    pg = Object.assign(u, { starts, g });
    const startUnit = unitOfPosition(target);
    mount(pageOfUnit(startUnit));
    showLoading(false);
    if (highlight) highlightVerse(target);
    maybeShowHint();
  }

  function pageElement(i) {
    const first = pg.starts[i];
    const end = i + 1 < pg.starts.length ? pg.starts[i + 1] : pg.T.length;
    const el = document.createElement('div');
    el.className = 'page';
    el.innerHTML =
      '<div class="txt typo">' + sliceHTML(pg, first, end) + '</div>';
    return el;
  }

  // 접힌 화면: 한 장(chapter)이 한 칸. 위아래로 읽고, 옆으로 밀면 다음·이전 장이 슬라이드로 넘어온다.
  let scrollTimer = null;
  function chapterHTML(book, c) {
    const unit = book.id === 'psa' ? '편' : '장';
    let h = '<h2 class="ch">' + (c + 1) + unit + '</h2>';
    book.chapters[c].forEach((v) => {
      const k = c * 1000 + v.n;
      h += '<p data-k="' + k + '" data-o="0" data-e="' + v.t.length + '" data-h="1"><sup class="vn">' + v.n + '</sup>' + annotate(book.id, k, 0, v.t) + '</p>';
    });
    const bi = bible.books.indexOf(book);
    const prev = c > 0 ? '‹ ' + c + unit : (bi > 0 ? '‹ ' + bible.books[bi - 1].name : '');
    const nextB = bi < bible.books.length - 1 ? bible.books[bi + 1].name : '';
    const next = c < book.chapters.length - 1 ? (c + 2) + unit + ' ›' : (nextB ? nextB + ' ›' : '');
    h += '<div class="chnav"><button data-go="-1"' + (prev ? '' : ' disabled') + '>' + esc(prev || ' ') + '</button>' +
      '<button data-go="1"' + (next ? '' : ' disabled') + '>' + esc(next || ' ') + '</button></div>';
    return h;
  }

  function scrollToVerse(pane, c, verse) {
    pane.scrollTop = 0;
    if (verse > 1) {
      const el = pane.querySelector('p[data-k="' + (c * 1000 + verse) + '"]');
      if (el) pane.scrollTop = Math.max(0, el.offsetTop - 6);
    }
  }

  function goChapter(delta) {   // 같은 책 안에서는 슬라이드, 책이 바뀌면 다시 만든다
    const book = bible.books[pos.book];
    const c = pos.chapter + delta;
    if (c >= 0 && c < book.chapters.length) { scroller.scrollTo({ left: c * scroller.clientWidth, behavior: 'smooth' }); return; }
    const nb = pos.book + (delta > 0 ? 1 : -1);
    if (nb < 0 || nb >= bible.books.length) return;
    jumpTo({ book: nb, chapter: delta > 0 ? 0 : bible.books[nb].chapters.length - 1, verse: 1 });
  }

  function mountChapters(target) {
    if (flip) { try { flip.destroy(); } catch (e) { /* 무시 */ } flip = null; }
    clearSelection();
    stage.innerHTML = '';
    stage.classList.add('scroll');
    const book = bible.books[target.book];
    const root = document.createElement('div');
    root.id = 'book';
    root.className = 'scroll';
    book.chapters.forEach((_, c) => {
      const pane = document.createElement('section');
      pane.className = 'chap typo';
      pane.innerHTML = chapterHTML(book, c);
      root.appendChild(pane);
    });
    stage.appendChild(root);
    scroller = root;
    pos = { book: target.book, chapter: Math.min(Math.max(target.chapter, 0), book.chapters.length - 1), verse: target.verse || 1 };
    scrollIdx = pos.chapter;
    root.scrollLeft = pos.chapter * root.clientWidth;
    scrollToVerse(root.children[pos.chapter], pos.chapter, pos.verse);

    root.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('.chnav button');
      if (b && !b.disabled) goChapter(+b.dataset.go);
    });
    // 읽던 위치 저장: 가로로 넘어가 멈췄을 때 장, 세로로 멈췄을 때 맨 위에 보이는 절
    root.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const w = root.clientWidth || 1;
        const idx = Math.round(root.scrollLeft / w);
        if (Math.abs(root.scrollLeft - idx * w) > 3) return;   // 아직 넘어가는 중
        const pane = root.children[idx];
        if (!pane) return;
        if (idx !== scrollIdx) { scrollIdx = idx; clearSelection(); }
        let verse = 1;
        for (const el of pane.querySelectorAll('p[data-k]')) {
          if (el.offsetTop + el.offsetHeight > pane.scrollTop + 8) { verse = (+el.dataset.k) % 1000; break; }
        }
        if (pos.chapter !== idx || pos.verse !== verse) {
          pos = { book: target.book, chapter: idx, verse };
          store.set('bf.pos', pos);
          updateHeader();
        }
      }, 120);
    }, { passive: true, capture: true });
    updateHeader();
  }

  function mount(pageIndex) {
    if (flip) { try { flip.destroy(); } catch (e) { /* 무시 */ } flip = null; }
    scroller = null;
    clearSelection();
    stage.innerHTML = '';
    stage.classList.remove('scroll');
    const root = document.createElement('div');
    root.id = 'book';
    stage.appendChild(root);

    const g = pg.g;
    const pages = pg.starts.map((_, i) => pageElement(i));
    pages.forEach((el) => root.appendChild(el));

    const start = g.spread ? pageIndex - (pageIndex % 2) : pageIndex;   // 펼침은 (짝수, 홀수) 쌍
    flip = new St.PageFlip(root, {
      width: g.pageW,
      height: g.pageH,
      size: 'fixed',
      startPage: start,
      showCover: false,
      usePortrait: true,
      drawShadow: true,
      maxShadowOpacity: 0.45,
      flippingTime: 950,
      swipeDistance: 20,
      mobileScrollSupport: false,
      showPageCorners: false,
      disableFlipByClick: true,
      useMouseEvents: false,   // 끌기·탭은 아래 우리 코드가 직접 처리한다 (뒤로 넘기기가 안 되던 문제)
    });
    flip.loadFromHTML(pages);
    flip.on('flip', (e) => { clearSelection(); onPage(e.data, true); });
    onPage(start, false);
  }

  // user=true: 사용자가 책장을 넘긴 경우에만 읽던 위치(pos)를 갱신한다.
  // 화면 크기·글자 크기가 바뀌어 다시 만들 때는 위치를 유지해서, 접었다 펴도 위치가 뒤로 밀리지 않게 한다.
  function onPage(index, user) {
    if (!pg) return;
    if (user) {
      pos = positionOfUnit(pg.starts[index], pg.bookIndex);
      store.set('bf.pos', pos);
    }
    updateHeader();
  }
  function updateHeader() {
    const book = bible.books[pos.book];
    $('#loc-book').textContent = book.name;
    $('#loc-ch').textContent = (pos.chapter + 1) + (book.id === 'psa' ? '편' : '장');
  }

  function jumpTo(p) {
    if (pg && pg.bookIndex === p.book && scroller) {
      const c = Math.min(Math.max(p.chapter, 0), scroller.children.length - 1);
      pos = { book: p.book, chapter: c, verse: p.verse || 1 };
      store.set('bf.pos', pos);
      scrollIdx = c;
      scroller.scrollLeft = c * scroller.clientWidth;
      scrollToVerse(scroller.children[c], c, pos.verse);
      updateHeader();
      highlightVerse(pos);
    } else if (pg && pg.bookIndex === p.book && flip) {
      const page = pageOfUnit(unitOfPosition(p));
      pos = p;
      store.set('bf.pos', pos);
      flip.turnToPage(pg.g.spread ? page - (page % 2) : page);
      onPage(flip.getCurrentPageIndex(), false);
      highlightVerse(p);
    } else {
      pos = p;
      store.set('bf.pos', pos);
      rebuild(p, true);
    }
  }

  // ---------- 낱말 고르기 + 표시 도구 ----------
  // 길게 누르면 그 낱말이 골라지고(누른 채 끌면 범위가 넓어짐), 고른 뒤에는 다른 낱말을 눌러 계속 더할 수 있다(여러 곳 선택).
  // 이미 고른 낱말을 다시 누르면 그 낱말만 빠진다. 고르면 도구 상자(#ann-bar)가 뜬다.
  const bar = $('#ann-bar');
  const barKinds = $('#ab-kinds'), barPens = $('#ab-pens'), barColors = $('#ab-colors');
  let barTop = false;      // 고른 낱말이 화면 아래쪽이면 도구 상자를 위에 띄운다
  let dragBase = [], dragAnchor = null;   // 끌어서 넓히는 동안의 기준

  // 한 번이라도 문제가 생기면 화면에 알리고 '고르는 중' 상태를 풀어, 앱이 멈춘 것처럼 되지 않게 한다.
  function guard(fn) {
    try { return fn(); } catch (err) { selecting = false; showError(err); return undefined; }
  }

  const sameVerse = (i, j) => i.bookId === j.bookId && i.k === j.k;
  const bookIdx = (id) => bible.books.findIndex((b) => b.id === id);
  const itemText = (it) => verseText(bookIdx(it.bookId), Math.floor(it.k / 1000), it.k % 1000);
  const sig = (n) => n.items.map((i) => i.k + ':' + i.s + '-' + i.e).join(',') + '#' + n.act;

  // 같은 절 안에서 겹치거나 맞닿은(낱말 하나 차이) 범위는 하나로 합친다. act: 마지막으로 만진 범위
  function normalize(items, act) {
    const out = [];
    items.slice().sort((x, y) => x.k - y.k || x.s - y.s).forEach((it) => {
      const last = out[out.length - 1];
      if (last && sameVerse(last, it) && it.s <= last.e + 1) last.e = Math.max(last.e, it.e);
      else out.push({ bookId: it.bookId, k: it.k, s: it.s, e: it.e });
    });
    let idx = 0;
    if (act) {
      const f = out.findIndex((it) => sameVerse(it, act) && act.s >= it.s && act.s <= it.e);
      idx = f < 0 ? 0 : f;
    }
    return { items: out, act: idx };
  }

  function clearSelection() { selecting = false; setSel(null); }
  function setSel(next) {
    const old = sel;
    sel = next && next.items.length ? next : null;
    const keys = new Set();
    [old, sel].forEach((x) => x && x.items.forEach((i) => keys.add(i.bookId + '|' + i.k)));
    keys.forEach((kk) => { const q = kk.split('|'); paintVerse(q[0], +q[1]); });
    updateBar();
  }

  // 손가락 위치에서 가장 가까운 낱말을 찾는다. (낱말마다 화면 위치를 재어 비교)
  function hitWord(x, y) {
    const el = document.elementFromPoint(x, y);
    const p = el && el.closest ? el.closest('#stage p[data-k]') : null;
    if (!p || !pg) return null;
    const k = +p.dataset.k, o0 = +p.dataset.o;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const rg = document.createRange();
    let base = 0, best = null, node;
    while ((node = walker.nextNode())) {
      if (node.parentNode.closest && node.parentNode.closest('sup.vn')) continue;
      const txt = node.nodeValue, re = /\S+/g;
      let m;
      while ((m = re.exec(txt))) {
        rg.setStart(node, m.index);
        rg.setEnd(node, m.index + m[0].length);
        const rects = rg.getClientRects();
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
          const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
          const sc = dy * 4 + dx;
          if (!best || sc < best.sc) best = { sc, s: o0 + base + m.index, e: o0 + base + m.index + m[0].length };
        }
      }
      base += txt.length;
    }
    return best ? { bookId: bible.books[pg.bookIndex].id, k, s: best.s, e: best.e } : null;
  }
  const findIn = (items, h) => items.find((i) => sameVerse(i, h) && h.s >= i.s && h.e <= i.e);

  function beginSelect(x, y) {
    const h = hitWord(x, y);
    if (!h) return false;
    if (!sel) barTop = y > window.innerHeight * 0.5;
    const items = sel ? sel.items.slice() : [];
    const ex = findIn(items, h);   // 이미 고른 곳을 길게 누르면 그 범위를 끌어 넓힌다
    dragBase = ex ? items.filter((i) => i !== ex) : items;
    dragAnchor = ex ? { bookId: ex.bookId, k: ex.k, s: ex.s, e: ex.e } : { bookId: h.bookId, k: h.k, s: h.s, e: h.e };
    setSel(normalize(dragBase.concat([Object.assign({}, dragAnchor)]), dragAnchor));
    selecting = true;
    return true;
  }
  function extendSelect(x, y) {
    if (!sel || !dragAnchor) return;
    const h = hitWord(x, y);
    if (!h || !sameVerse(h, dragAnchor)) return;   // 한 절 안에서만 넓힌다
    const rng2 = { bookId: h.bookId, k: h.k, s: Math.min(dragAnchor.s, h.s), e: Math.max(dragAnchor.e, h.e) };
    const next = normalize(dragBase.concat([rng2]), rng2);
    if (sig(next) !== sig(sel)) setSel(next);
  }
  // 한 번 누르기: 고르는 중이면 그 낱말을 더하거나 뺀다. 아직 아무것도 안 골랐으면 그 낱말을 고른다.
  function tapSelect(x, y) {
    const h = hitWord(x, y);
    if (!h) return;
    const items = sel ? sel.items.slice() : [];
    const ex = findIn(items, h);
    if (ex) {
      const rest = items.filter((i) => i !== ex);
      if (h.s - 1 > ex.s) rest.push({ bookId: ex.bookId, k: ex.k, s: ex.s, e: h.s - 1 });
      if (ex.e > h.e + 1) rest.push({ bookId: ex.bookId, k: ex.k, s: h.e + 1, e: ex.e });
      setSel(normalize(rest, null));
      return;
    }
    if (!sel) barTop = y > window.innerHeight * 0.5;
    items.push({ bookId: h.bookId, k: h.k, s: h.s, e: h.e });
    setSel(normalize(items, h));
  }

  // ---- 도구 상자 ----
  const previewOf = (kind) => '<span class="a ' + ruleFor({ id: 'pv' + kind, kind, pen: tool.pen, c: tool.c }) + '">' + KINDS[kind] + '</span>';
  function buildBar() {
    barKinds.innerHTML = Object.keys(KINDS).map((kd) => '<button type="button" data-kind="' + kd + '"></button>').join('');
    barPens.innerHTML = Object.keys(PENS).map((pn) => '<button type="button" data-pen="' + pn + '">' + PENS[pn] + '</button>').join('');
    barColors.innerHTML = COLORS.map((c, i) => '<button type="button" class="dot" data-c="' + i + '" aria-label="' + c.n + '" style="background:' + c.f + '"></button>').join('');
    paintBarTools();
  }
  function paintBarTools() {
    barKinds.querySelectorAll('button').forEach((b) => { b.innerHTML = previewOf(b.dataset.kind); });
    barPens.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.pen === tool.pen));
    barColors.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.c === tool.c));
  }
  function updateBar() {
    if (!sel) { bar.hidden = true; return; }
    const it = sel.items[sel.act] || sel.items[0];
    const bi = bookIdx(it.bookId);
    const snip = itemText(it).slice(it.s, it.e);
    $('#ab-ref').textContent = bible.books[bi].name + ' ' + (Math.floor(it.k / 1000) + 1) + ':' + (it.k % 1000) +
      '  「' + (snip.length > 14 ? snip.slice(0, 14) + '…' : snip) + '」' + (sel.items.length > 1 ? '  외 ' + (sel.items.length - 1) + '곳' : '');
    bar.classList.toggle('top', barTop);
    bar.hidden = false;
  }
  function applyKind(kind) {
    if (!sel) return;
    const lists = {};
    sel.items.forEach((it) => {
      const key = markKey(it.bookId, it.k);
      let list = lists[key] || (anns[key] || []).slice();
      const same = list.find((a) => a.kind === kind && a.s === it.s && a.e === it.e);
      list = list.filter((a) => a !== same);
      if (!(same && same.pen === tool.pen && same.c === tool.c)) {   // 똑같은 표시를 다시 누르면 지워진다
        if (kind === 'fill') list = cutRange(list, it.s, it.e, (a) => a.kind === 'fill');   // 형광은 겹치지 않게 덮어쓴다
        list.push({ id: newId(), s: it.s, e: it.e, kind, pen: tool.pen, c: tool.c });
      }
      lists[key] = list;
    });
    Object.assign(anns, lists);
    saveAnns();
    clearSelection();
  }
  function eraseSel() {
    if (!sel) return;
    sel.items.forEach((it) => {
      const key = markKey(it.bookId, it.k);
      anns[key] = cutRange(anns[key] || [], it.s, it.e, () => true);
    });
    saveAnns();
    clearSelection();
  }
  function replaceAct(mut) {   // 마지막으로 만진 범위만 바꾼다
    if (!sel) return;
    const items = sel.items.map((i) => Object.assign({}, i));
    const cur = items[sel.act] || items[0];
    mut(cur);
    if (cur.e > cur.s) setSel(normalize(items, cur));
  }
  // 범위의 경계를 낱말 하나씩 옮긴다. which: 's' 시작 / 'e' 끝, dir: -1 앞으로 / +1 뒤로
  function moveEdge(which, dir) {
    replaceAct((it) => {
      const t = itemText(it);
      if (which === 's') {
        if (dir < 0) {
          let i = it.s - 1;
          while (i > 0 && t[i] === ' ') i--;
          while (i > 0 && t[i - 1] !== ' ') i--;
          it.s = Math.max(i, 0);
        } else {
          let i = it.s;
          while (i < it.e && t[i] !== ' ') i++;
          while (i < it.e && t[i] === ' ') i++;
          if (i < it.e) it.s = i;
        }
      } else if (dir > 0) {
        let i = it.e;
        while (i < t.length && t[i] === ' ') i++;
        while (i < t.length && t[i] !== ' ') i++;
        it.e = i;
      } else {
        let i = it.e - 1;
        while (i > it.s && t[i] !== ' ') i--;
        while (i > it.s && t[i - 1] === ' ') i--;
        if (i > it.s) it.e = i;
      }
    });
  }
  barKinds.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) guard(() => applyKind(b.dataset.kind)); });
  barPens.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tool.pen = b.dataset.pen; store.set('bf.tool', tool); paintBarTools();
  });
  barColors.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tool.c = +b.dataset.c; store.set('bf.tool', tool); paintBarTools();
  });
  $('#ab-close').addEventListener('click', clearSelection);
  $('#ab-all').addEventListener('click', () => guard(() => replaceAct((it) => { it.s = 0; it.e = itemText(it).length; })));
  $('#ab-erase').addEventListener('click', () => guard(eraseSel));
  $('#ab-s-prev').addEventListener('click', () => guard(() => moveEdge('s', -1)));
  $('#ab-s-next').addEventListener('click', () => guard(() => moveEdge('s', 1)));
  $('#ab-e-prev').addEventListener('click', () => guard(() => moveEdge('e', -1)));
  $('#ab-e-next').addEventListener('click', () => guard(() => moveEdge('e', 1)));
  buildBar();

  // ---------- 책장 넘기기: 탭·끌기·길게 누르기·키보드 ----------
  // 가장자리 탭 = 넘김, 가운데 탭 = 낱말 고르기, 어디서든 길게 누르기 = 낱말 고르기(누른 채 끌면 범위 넓힘),
  // 좌우로 끌면 끄는 방향대로(왼쪽으로 = 다음, 오른쪽으로 = 이전) 책장이 따라온다.
  const FWD = 0, BACK = 1;
  let down = null, pressTimer = null, drag = null, selPt = null, selRaf = 0;

  // 탭·키보드로 넘길 때도 '끌기'와 똑같은 모양이 되도록, 가상 손가락을 움직여 책장을 넘긴다.
  // (라이브러리 기본 넘김 애니메이션은 한 쪽 화면에서 앞쪽으로 넘길 때 효과가 거의 보이지 않는다)
  const TURN_MS = 720;
  let turning = false;
  function turn(dir) {   // dir > 0: 다음, < 0: 이전
    if (scroller) {
      goChapter(dir > 0 ? 1 : -1);
      return;
    }
    if (!flip || turning || flip.getState() !== 'read') return;
    const r = stage.getBoundingClientRect();
    const portrait = flip.getOrientation() === 'portrait';
    const D = dir > 0 ? FWD : BACK;
    const edge = r.height - 2;
    const x0 = D === FWD ? r.width - 2 : 2;
    const x1 = D === FWD ? (portrait ? -r.width * 0.05 : 1) : r.width - 1;
    const ms = window.TURN_MS || TURN_MS;
    turning = true;
    try {
      flip.startUserTouch({ x: -9999, y: -9999 });
      flip.userMove({ x: x0, y: edge }, true);      // 방향·모서리 결정
    } catch (err) { turning = false; return; }
    const t0 = performance.now();
    const pt = (k) => {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // 천천히 시작해 빨라졌다 느려지게
      return { x: x0 + (x1 - x0) * e, y: edge - r.height * 0.1 * Math.sin(Math.PI * k) };
    };
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      try { flip.userMove(pt(k), true); } catch (err) { /* 무시 */ }
      if (k < 1) { requestAnimationFrame(step); return; }
      try { flip.userStop(pt(1), false); } catch (err) { /* 무시 */ }
      setTimeout(() => { turning = false; }, 300);
    };
    requestAnimationFrame(step);
  }

  // 손가락의 위아래 움직임은 15%만 반영한다. 그대로 쓰면 접힘선이 크게 비스듬해져 어색하다.
  function stagePt(e, r, corner) {
    const edge = corner === 'bottom' ? r.height - 2 : 2;
    const y = e.clientY - r.top;
    return { x: e.clientX - r.left, y: edge + (y - edge) * 0.15 };
  }

  function startDrag(dir, e) {
    const r = stage.getBoundingClientRect();
    const corner = (down.y - r.top) >= r.height / 2 ? 'bottom' : 'top';
    drag = { dir, r, corner, started: false };
    try {
      flip.startUserTouch({ x: -9999, y: -9999 });
      // 첫 점을 가장자리로 줘서 끄는 방향대로 넘김 방향이 정해지게 한다
      const sy = corner === 'bottom' ? r.height - 2 : 2;
      flip.userMove({ x: dir === FWD ? r.width - 2 : 2, y: sy }, true);
      flip.userMove(stagePt(e, r, corner), true);
      drag.started = true;
    } catch (err) { drag.started = false; }
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (turning || (flip && flip.getState() !== 'read')) return;
    if (!scroller) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ } }
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    drag = null;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      if (!down || drag) return;
      const d = down;
      down = null;
      guard(() => beginSelect(d.x, d.y));
    }, 480);
  });
  stage.addEventListener('pointermove', (e) => {
    if (selecting) {   // 화면 한 번 그릴 때마다 한 번만 계산한다 (손가락이 빨라도 버벅이지 않게)
      selPt = { x: e.clientX, y: e.clientY };
      if (!selRaf) selRaf = requestAnimationFrame(() => { selRaf = 0; if (selecting && selPt) guard(() => extendSelect(selPt.x, selPt.y)); });
      return;
    }
    if (scroller) {   // 스크롤은 브라우저가 처리한다. 손가락이 움직이면 탭·길게 누르기가 아니다.
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { clearTimeout(pressTimer); down = null; }
      return;
    }
    if (!down || !flip) return;
    if (drag) {
      if (drag.started) {
        try { flip.userMove(stagePt(e, drag.r, drag.corner), true); } catch (err) { /* 무시 */ }
      }
      return;
    }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) <= 10) return;
    clearTimeout(pressTimer);
    if (Math.abs(dx) > Math.abs(dy) * 1.2) { clearSelection(); startDrag(dx < 0 ? FWD : BACK, e); }
  });
  function endPointer(e, cancelled) {
    clearTimeout(pressTimer);
    if (selecting) { selecting = false; down = null; drag = null; return; }   // 끌어서 고르기 끝 — 도구 상자는 그대로 둔다
    const d = down, dg = drag;
    down = null; drag = null;
    if (scroller) {
      if (!d || cancelled || performance.now() - d.t > 450 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
      const rr = stage.getBoundingClientRect();
      const fx = (e.clientX - rr.left) / rr.width;
      if (sel) guard(() => tapSelect(e.clientX, e.clientY));   // 고르는 중에는 어디를 눌러도 낱말을 더하거나 뺀다
      else if (fx < 0.28) turn(-1);
      else if (fx > 0.72) turn(1);
      else guard(() => tapSelect(e.clientX, e.clientY));
      return;
    }
    if (!d || !flip) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const took = performance.now() - d.t;
    if (dg) {
      if (!dg.started) { turn(dg.dir === FWD ? 1 : -1); return; }
      const r = dg.r;
      const commit = !cancelled && (Math.abs(dx) > r.width * 0.22 || (took < 350 && Math.abs(dx) > 30));
      try {
        // 충분히 끌었거나 빠르게 쓸었으면 끝까지 넘기고, 아니면 제자리로 돌린다
        const portrait = flip.getOrientation() === 'portrait';
        const ey = dg.corner === 'bottom' ? r.height - 2 : 2;
        const far = portrait ? -r.width : 1;   // 한 쪽 화면은 손가락이 화면 왼쪽 끝을 지나야 '넘김'으로 계산된다
        const end = commit
          ? { x: dg.dir === FWD ? far : r.width - 1, y: ey }
          : { x: dg.dir === FWD ? r.width - 1 : (portrait ? -r.width : 1), y: ey };   // 제자리로
        flip.userMove(end, true);
        flip.userStop(end, false);
      } catch (err) { /* 무시 */ }
      return;
    }
    if (cancelled || Math.hypot(dx, dy) > 10 || took > 450) return;
    const r = stage.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (sel) guard(() => tapSelect(e.clientX, e.clientY));
    else if (x < 0.28) turn(-1);
    else if (x > 0.72) turn(1);
    else guard(() => tapSelect(e.clientX, e.clientY));
  }
  // 낱말을 끌어 고르는 동안에는 화면이 같이 스크롤되지 않게 막는다
  stage.addEventListener('touchmove', (e) => { if (selecting && e.cancelable) e.preventDefault(); }, { passive: false });
  // 어떤 이유로든 손가락이 떨어지면 '고르는 중'을 반드시 끝낸다 (스크롤이 막힌 채로 남지 않게)
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach((ev) => window.addEventListener(ev, () => { selecting = false; }));
  stage.addEventListener('pointerup', (e) => endPointer(e, false));
  stage.addEventListener('pointercancel', (e) => endPointer(e, true));
  window.addEventListener('keydown', (e) => {
    if (!flip && !scroller) return;
    if (e.key === 'ArrowRight' || e.key === ' ') turn(1);
    else if (e.key === 'ArrowLeft') turn(-1);
  });

  // ---------- 크기 변화(접기/펼치기, 회전) ----------
  // 접거나 펼친 직후에는 화면 크기가 잠깐 어긋나게 읽힐 수 있어, 조금 뒤에 한 번 더 확인한다.
  let resizeTimers = [];
  function checkGeometry() {
    if (!bible) return;
    const g = geometry();
    const key = [g.W, g.H, g.si.top, g.si.bottom].join('x');
    if (key !== lastGeo) rebuild(pos);
  }
  function onResize() {
    resizeTimers.forEach(clearTimeout);
    resizeTimers = [setTimeout(checkGeometry, 250), setTimeout(checkGeometry, 900)];
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('pageshow', onResize);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) onResize(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(vp);

  // ---------- 화면이 밀려 올라갔을 때 바로잡기 ----------
  // 아이폰에서 드물게 화면 전체나 본문 쪽이 위로 밀려 올라가 위·아래가 비어 보이는 일이 있다.
  // 밀린 것을 발견하면 제자리로 돌리고, 그래도 안 되면 책을 다시 만든다. 몇 번 있었는지는 설정의 '화면 진단'에 남는다.
  let healCount = 0, healLast = '', healRebuilt = 0;
  function pageShift() {
    const out = [];
    const vv = window.visualViewport;
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (window.scrollY || window.scrollX) out.push('창스크롤 ' + Math.round(window.scrollX) + ',' + Math.round(window.scrollY));
    if (document.documentElement.scrollTop || document.body.scrollTop) out.push('문서스크롤');
    if (vv && !typing && (Math.abs(vv.offsetTop) > 1 || Math.abs(vv.offsetLeft) > 1)) out.push('보이는영역 ' + Math.round(vv.offsetLeft) + ',' + Math.round(vv.offsetTop));
    const st = stage.getBoundingClientRect();
    if (Math.abs(st.top) > 1) out.push('무대 위 ' + Math.round(st.top));
    if (stage.scrollTop || stage.scrollLeft) out.push('무대스크롤');
    if (!scroller) {
      let n = 0;
      document.querySelectorAll('#stage .page .txt, #stage .page, #book').forEach((e) => { if (e.scrollTop || e.scrollLeft) n++; });
      if (n) out.push('쪽스크롤 ' + n + '곳');
    }
    return out;
  }
  function heal() {
    if (!bible || !pg) return;
    const found = pageShift();
    if (!found.length) {
      if (sel && bar.hidden) updateBar();   // 고른 낱말이 있는데 도구 상자가 안 보이는 경우
      return;
    }
    healCount++;
    healLast = found.join(' · ');
    try { window.scrollTo(0, 0); } catch (e) { /* 무시 */ }
    document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
    stage.scrollTop = 0; stage.scrollLeft = 0; stage.style.transform = '';
    if (!scroller) document.querySelectorAll('#stage .page .txt, #stage .page, #book').forEach((e) => { e.scrollTop = 0; e.scrollLeft = 0; });
    if (sel && bar.hidden) updateBar();
    if (Math.abs(stage.getBoundingClientRect().top) > 1 && Date.now() - healRebuilt > 8000) {   // 그래도 어긋나 있으면 다시 만든다
      healRebuilt = Date.now();
      rebuild(pos);
    }
  }
  let healRaf = 0;
  const healSoon = () => { if (!healRaf) healRaf = requestAnimationFrame(() => { healRaf = 0; heal(); }); };
  window.addEventListener('scroll', healSoon, true);   // 쪽 안쪽이 스크롤되는 것도 잡는다
  if (window.visualViewport) { window.visualViewport.addEventListener('scroll', healSoon); window.visualViewport.addEventListener('resize', healSoon); }
  ['pointerup', 'pointercancel', 'touchend'].forEach((ev) => window.addEventListener(ev, () => { setTimeout(heal, 80); setTimeout(heal, 600); }));
  document.addEventListener('focusout', () => { setTimeout(heal, 100); setTimeout(heal, 500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(heal, 200); });
  setInterval(() => { if (!document.hidden) heal(); }, 1500);
  // 위쪽 메뉴줄·도구 상자를 끌어도 문서 전체가 끌려 움직이지 않게 막는다
  ['#topbar', '#ann-bar'].forEach((q) => $(q).addEventListener('touchmove', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false }));

  // ---------- 시트: 책 고르기 / 설정 ----------
  const sheet = $('#sheet'), sheetBody = $('#sheet-body'), sheetTitle = $('#sheet-title');
  const backBtn = $('#sheet-back');
  let sheetBack = null;

  // 창은 화면 한가운데에 띄운다. 키보드가 올라오면 보이는 영역(visualViewport)의 가운데로 맞춘다.
  // tall=true: 검색처럼 결과 길이가 바뀌는 창은 높이를 고정해 흔들리지 않게 한다.
  function clearSheetFit() {
    ['top', 'left', 'width', 'height', 'right', 'bottom'].forEach((q) => { sheet.style[q] = ''; });
  }
  function fitSheet() {
    if (sheet.hidden) return;
    const v = window.visualViewport;
    // 평소에는 화면 전체(CSS inset:0)를 쓴다. 키보드가 올라와 보이는 영역이 줄었을 때만 그 영역에 맞춘다.
    // (보이는 영역 값이 이상하게 읽히는 기기에서 창이 화면 밖으로 밀려나는 일을 막는다)
    const typing = document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
    const kb = v && typing && v.height < window.innerHeight - 80 && v.offsetTop >= 0 && v.offsetTop < window.innerHeight;
    if (kb) {
      sheet.style.top = v.offsetTop + 'px';
      sheet.style.left = v.offsetLeft + 'px';
      sheet.style.width = v.width + 'px';
      sheet.style.height = v.height + 'px';
      sheet.style.right = 'auto';
      sheet.style.bottom = 'auto';
    } else {
      clearSheetFit();
    }
    // 그래도 창이 화면을 제대로 덮지 못하면 원래대로 되돌린다
    const r = sheet.getBoundingClientRect();
    if (r.height < window.innerHeight * 0.6 || r.top < -2 || r.top > window.innerHeight * 0.5) clearSheetFit();
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitSheet);
    window.visualViewport.addEventListener('scroll', fitSheet);
  }
  document.addEventListener('focusin', () => setTimeout(fitSheet, 50));
  document.addEventListener('focusout', () => setTimeout(fitSheet, 50));
  let openedAt = 0;
  function openSheet(tall) {
    openedAt = performance.now();
    sheet.classList.toggle('tall', !!tall);
    sheet.hidden = false;
    fitSheet();
    setTimeout(fitSheet, 120);
    setTimeout(fitSheet, 500);
  }
  function closeSheet() {
    sheet.hidden = true;
    ['top', 'left', 'width', 'height', 'right', 'bottom'].forEach((p) => { sheet.style[p] = ''; });
    sheetBack = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  $('#sheet-close').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet && performance.now() - openedAt > 450) closeSheet(); });
  backBtn.addEventListener('click', () => { if (sheetBack) sheetBack(); });

  function showBooks(testament) {
    sheetTitle.textContent = '성경';
    backBtn.hidden = true;
    sheetBack = null;
    const ot = testament !== 'nt';
    const from = ot ? 0 : 39, to = ot ? 39 : bible.books.length;
    let html = '<div class="tabs"><button class="tab' + (ot ? ' on' : '') + '" data-t="ot">구약</button>' +
      '<button class="tab' + (!ot ? ' on' : '') + '" data-t="nt">신약</button></div><div class="grid">';
    for (let i = from; i < to; i++) {
      html += '<button class="cell' + (i === pos.book ? ' on' : '') + '" data-b="' + i + '">' + esc(bible.books[i].name) + '</button>';
    }
    sheetBody.innerHTML = html + '</div>';
    sheetBody.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => showBooks(b.dataset.t)));
    sheetBody.querySelectorAll('[data-b]').forEach((b) =>
      b.addEventListener('click', () => showChapters(+b.dataset.b, ot ? 'ot' : 'nt')));
  }

  function showChapters(bookIndex, testament) {
    const book = bible.books[bookIndex];
    const unit = book.id === 'psa' ? '편' : '장';
    sheetTitle.textContent = book.name + ' (' + book.chapters.length + unit + ')';
    backBtn.hidden = false;
    sheetBack = () => showBooks(testament);
    let html = '<div class="grid ch">';
    for (let c = 0; c < book.chapters.length; c++) {
      const on = bookIndex === pos.book && c === pos.chapter;
      html += '<button class="cell' + (on ? ' on' : '') + '" data-c="' + c + '">' + (c + 1) + '</button>';
    }
    sheetBody.innerHTML = html + '</div>';
    sheetBody.querySelectorAll('[data-c]').forEach((b) =>
      b.addEventListener('click', () => {
        closeSheet();
        jumpTo({ book: bookIndex, chapter: +b.dataset.c, verse: 1 });
      }));
  }

  // 화면 크기 진단: 접은 화면의 좌우 공백 원인을 찾기 위해 실제로 그려진 크기를 보여 준다.
  function diagText() {
    const R = (el) => { if (!el) return '-'; const r = el.getBoundingClientRect(); return Math.round(r.left) + '~' + Math.round(r.right) + ' (폭 ' + Math.round(r.width) + ') × 위 ' + Math.round(r.top) + '~' + Math.round(r.bottom); };
    const vis = [...document.querySelectorAll('#stage .page')].find((el) => el.getBoundingClientRect().width > 0);
    const v = window.visualViewport;
    const g = pg && pg.g;
    return [
      '창 ' + window.innerWidth + '×' + window.innerHeight + ' · 보이는 영역 ' + (v ? Math.round(v.width) + '×' + Math.round(v.height) + ' 배율 ' + v.scale : '-'),
      '화면 ' + screen.width + '×' + screen.height + ' · DPR ' + window.devicePixelRatio,
      '계산 ' + (g ? '폭 ' + g.W + ' 쪽폭 ' + g.pageW + ' 좌우여백 ' + g.padX + ' 본문폭 ' + g.textW : '-'),
      '무대 ' + R($('#stage')),
      '쪽 ' + R(vis),
      '본문 ' + R(vis && vis.querySelector('.txt')),
      '밀림 바로잡음 ' + healCount + '번' + (healLast ? ' (마지막: ' + healLast + ')' : '') + ' · 스크롤 ' + Math.round(window.scrollY) + ' · 보이는 영역 위 ' + (v ? Math.round(v.offsetTop) : '-'),
    ].join('<br>');
  }

  let settingsTimer = null;
  // view: 값을 바꾼 뒤 다시 그릴 화면(기본은 읽기 설정). 다시 그려도 보던 위치가 그대로 유지된다.
  function changeSettings(patch, view) {
    settings = Object.assign({}, settings, patch);
    store.set('bf.settings', settings);
    const keep = sheetBody.scrollTop;
    (view || showSettings)();
    sheetBody.scrollTop = keep;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => rebuild(pos), 250);
  }

  function showSettings() {
    sheetTitle.textContent = '읽기 설정';
    backBtn.hidden = true;
    sheetBack = null;
    const seg = (map, cur, key) => '<div class="seg">' + Object.keys(map).map((k) =>
      '<button class="' + (k === cur ? 'on' : '') + '" data-k="' + key + '" data-v="' + k + '">' + map[k] + '</button>').join('') + '</div>';
    sheetBody.innerHTML =
      '<div class="row"><span>글자 크기</span><div class="stepper">' +
      '<button data-f="-1" aria-label="작게">A−</button><b>' + settings.fontSize + '</b>' +
      '<button data-f="1" aria-label="크게">A+</button></div></div>' +
      '<div class="row"><span>테마</span>' + seg(THEMES, settings.theme, 'theme') + '</div>' +
      '<div class="row col"><span>글씨체</span><div class="fontgrid">' + Object.keys(FONTS).map((k) =>
        '<button class="fbtn' + (k === settings.font ? ' on' : '') + '" data-k="font" data-v="' + k +
        '" style="font-family:' + FONTS[k].stack.replace(/"/g, "'") + '">' + FONTS[k].label + '<small>가나다 창조 Aa</small></button>').join('') +
      '</div></div>' +
      '<div class="row"><span>화면 구성</span>' + seg(LAYOUTS, settings.layout, 'layout') + '</div>' +
      '<button class="row rowlink" id="go-adv" type="button"><span>고급설정 <small class="sub">여백 · 위치 · 화면 정보</small></span><span class="chev">›</span></button>' +
      '<p class="note">자동: 화면이 넓으면(펼친 상태) 두 쪽, 좁으면(접힌 상태) 한 쪽으로 보여 줍니다.<br>본문: 개역한글 (퍼블릭 도메인)</p>';
    $('#go-adv').addEventListener('click', () => { showAdvanced(); sheetBody.scrollTop = 0; });
    sheetBody.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      const next = Math.min(FONT_MAX, Math.max(FONT_MIN, settings.fontSize + (+b.dataset.f)));
      if (next !== settings.fontSize) changeSettings({ fontSize: next });
    }));
    sheetBody.querySelectorAll('[data-k]').forEach((b) =>
      b.addEventListener('click', () => changeSettings({ [b.dataset.k]: b.dataset.v })));
  }

  // ---------- 고급설정: 여백 · 위치 · 화면 정보 ----------
  function showAdvanced() {
    sheetTitle.textContent = '고급설정';
    backBtn.hidden = false;
    sheetBack = () => { showSettings(); sheetBody.scrollTop = 0; };
    const g = geometry();
    const topSp = settings.topSpread, topSi = settings.topSingle;
    const shift = typeof settings.shiftX === 'number' ? settings.shiftX : SHIFT_DEFAULT;
    const bot = typeof settings.bottomSpread === 'number' ? settings.bottomSpread : BOTTOM_SPREAD_DEFAULT;
    // 한 항목 = 이름 + 값 조절(− 값 +) + 설명
    const item = (name, sub, key, step, val, minus, plus, desc) =>
      '<div class="adv"><div class="row"><span>' + name + ' <small class="sub">' + sub + '</small></span><div class="stepper">' +
      '<button data-adv="' + key + '" data-step="-' + step + '" aria-label="' + minus + '">' + (key === 'shiftX' ? '◂' : '−') + '</button><b>' + val + '</b>' +
      '<button data-adv="' + key + '" data-step="' + step + '" aria-label="' + plus + '">' + (key === 'shiftX' ? '▸' : '+') + '</button></div></div>' +
      '<p class="adv-desc">' + desc + '</p></div>';
    // 안전영역 때문에 실제 적용된 윗 여백이 설정값과 다른 경우만 알려 준다
    const topNote = g.spread && g.padTop !== topSp
      ? '<br><b>※ 지금 화면의 안전영역(위 ' + g.si.top + ') 때문에 실제로는 ' + g.padTop + 'px로 적용됩니다.</b>' : '';
    sheetBody.innerHTML =
      '<div class="adv-head">펼친 화면 (두 쪽)</div>' +
      item('윗 여백', '(펼침)', 'topSpread', 4, topSp, '줄이기', '늘리기',
        '화면 맨 위에서 본문이 시작되는 곳까지의 높이입니다. 이 안에 책 이름·메뉴 아이콘과 오른쪽 위 상태 아이콘이 들어갑니다. 줄이면 본문이 더 위로 올라와 한 쪽에 들어가는 줄 수가 늘어납니다.' + topNote) +
      item('가로 위치', '(오른쪽으로)', 'shiftX', 4, shift, '왼쪽으로', '오른쪽으로',
        '두 쪽 전체를 오른쪽으로 옮기는 양입니다. 아이폰 듀오를 펼치면 앱이 실제 화면보다 좁은 영역만 알려 받아 두 쪽이 왼쪽으로 쏠려 보입니다. 값을 키우면 가운데로 오지만, 옮긴 만큼 한 쪽의 폭이 좁아져 한 줄에 들어가는 글자가 줄어듭니다.') +
      item('아래 여백', '(펼침)', 'bottomSpread', 4, bot, '줄이기', '늘리기',
        '본문 맨 아래에 비워 두는 높이입니다. 화면 맨 아래 일부는 앱이 그릴 수 없는 영역이라, 0으로 해도 그만큼은 비어 보입니다.') +
      '<div class="adv-head">접은 화면 (한 쪽)</div>' +
      item('윗 여백', '(한 쪽)', 'topSingle', 4, topSi, '줄이기', '늘리기',
        '접은 상태에서 본문이 시작되는 높이입니다. 접은 화면은 책 이름 아래에 메뉴 아이콘이 한 줄 더 있어서, 너무 줄이면 본문과 겹칩니다.') +
      '<div class="row"><span>여백 기본값으로 되돌리기</span><button class="seg-btn" id="adv-reset" type="button">되돌리기</button></div>' +
      '<button class="row rowlink" id="go-bk" type="button"><span>데이터 백업 <small class="sub">하이라이트 · 읽던 위치 내보내기/불러오기</small></span><span class="chev">›</span></button>' +
      '<p class="note">기본값: 윗 여백(펼침) ' + TOP_DEFAULT.topSpread + ' · 가로 위치 ' + SHIFT_DEFAULT + ' · 아래 여백(펼침) ' + BOTTOM_SPREAD_DEFAULT + ' · 윗 여백(한 쪽) ' + TOP_DEFAULT.topSingle +
      '<br>값을 바꾸면 본문이 잠시 뒤에 새로 정렬됩니다. 읽던 위치는 그대로 유지됩니다.</p>' +
      '<div class="adv-head">화면 정보</div>' +
      '<p class="note tight">현재 화면 ' + g.W + ' × ' + g.H + ' px (창 ' + window.innerWidth + ' × ' + window.innerHeight + ') · ' + (g.spread ? '펼침(두 쪽)' : '한 쪽') +
      ' (자동 기준: 폭 ' + AUTO_SPREAD_MIN_WIDTH + 'px 이상)<br>안전영역 위 ' + g.si.top + ' · 아래 ' + g.si.bottom + ' · 좌 ' + g.si.left + ' · 우 ' + g.si.right + '</p>' +
      '<p class="note diag"><b>화면 진단</b><br>' + diagText() + '</p>';
    const LIMITS = { topSpread: [TOP_MIN_SPREAD, TOP_MAX], topSingle: [TOP_MIN_SINGLE, TOP_MAX], shiftX: [0, 160], bottomSpread: [0, 80] };
    sheetBody.querySelectorAll('[data-adv]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.adv, cur = key === 'shiftX' ? shift : key === 'bottomSpread' ? bot : settings[key];
      const next = Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], cur + (+b.dataset.step)));
      if (next !== cur) changeSettings({ [key]: next }, showAdvanced);
    }));
    $('#go-bk').addEventListener('click', () => { showBackup(); sheetBody.scrollTop = 0; });
    $('#adv-reset').addEventListener('click', () => changeSettings({
      topSpread: TOP_DEFAULT.topSpread, topSingle: TOP_DEFAULT.topSingle, shiftX: SHIFT_DEFAULT, bottomSpread: BOTTOM_SPREAD_DEFAULT,
    }, showAdvanced));
  }

  // ---------- 데이터 백업: 하이라이트·읽던 위치·글꼴 설정을 글자로 내보내고 다시 불러온다 ----------
  // 이 앱의 기록은 기기 안(주소별)에만 저장되므로, 앱 주소를 옮기거나 앱을 지우기 전에 한 번 백업해 둔다.
  function backupText() {
    return JSON.stringify({
      app: 'bibleflip', ver: 1, savedAt: new Date().toISOString(),
      pos, tool, anns,
      settings: { fontSize: settings.fontSize, theme: settings.theme, font: settings.font, layout: settings.layout },
    });
  }
  // 붙여 넣은 글을 검사해서 쓸 수 있는 것만 골라 적용한다. 잘못된 내용이면 오류를 던진다.
  function applyBackup(text) {
    let d;
    try { d = JSON.parse(String(text).trim()); } catch (e) { d = null; }
    if (!d || d.app !== 'bibleflip' || !d.anns || typeof d.anns !== 'object' || Array.isArray(d.anns)) {
      throw new Error('백업 내용이 아닙니다. 복사해 둔 글을 처음부터 끝까지 붙여 넣었는지 확인해 주세요.');
    }
    const clean = {};
    let verses = 0, marks = 0;
    Object.keys(d.anns).forEach((key) => {
      if (!/^[a-z0-9]+\.\d+\.\d+$/.test(key) || !Array.isArray(d.anns[key])) return;
      const list = d.anns[key].filter((a) => a && Number.isFinite(a.s) && Number.isFinite(a.e) && a.e > a.s && a.s >= 0 && KINDS[a.kind])
        .map((a) => ({
          id: typeof a.id === 'string' ? a.id.slice(0, 24) : newId(),
          s: Math.floor(a.s), e: Math.floor(a.e), kind: a.kind,
          pen: PENS[a.pen] ? a.pen : 'marker',
          c: Number.isInteger(a.c) && a.c >= 0 && a.c < COLORS.length ? a.c : 0,
        }));
      if (list.length) { clean[key] = list; verses++; marks += list.length; }
    });
    anns = clean;
    saveAnns();
    const p = d.pos;
    if (p && Number.isInteger(p.book) && p.book >= 0 && p.book < bible.books.length &&
        Number.isInteger(p.chapter) && p.chapter >= 0 && p.chapter < bible.books[p.book].chapters.length) {
      pos = { book: p.book, chapter: p.chapter, verse: Number.isInteger(p.verse) && p.verse > 0 ? p.verse : 1 };
      store.set('bf.pos', pos);
    }
    if (d.tool && PENS[d.tool.pen] && Number.isInteger(d.tool.c) && d.tool.c >= 0 && d.tool.c < COLORS.length) {
      tool = { pen: d.tool.pen, c: d.tool.c };
      store.set('bf.tool', tool);
    }
    const s = d.settings || {}, patch = {};
    if (Number.isFinite(s.fontSize) && s.fontSize >= FONT_MIN && s.fontSize <= FONT_MAX) patch.fontSize = Math.round(s.fontSize);
    if (THEMES[s.theme]) patch.theme = s.theme;
    if (FONTS[s.font]) patch.font = s.font;
    if (LAYOUTS[s.layout]) patch.layout = s.layout;
    settings = Object.assign({}, settings, patch);
    store.set('bf.settings', settings);
    return { verses, marks };
  }

  function showBackup() {
    sheetTitle.textContent = '데이터 백업';
    backBtn.hidden = false;
    sheetBack = () => { showAdvanced(); sheetBody.scrollTop = 0; };
    const n = Object.keys(anns).length;
    sheetBody.innerHTML =
      '<p class="note tight">하이라이트·읽던 위치·글꼴 설정은 <b>이 기기의 이 앱 안</b>에만 저장됩니다. ' +
      '앱 주소를 옮기거나 앱을 지우면 사라지므로, 그 전에 아래에서 백업해 두세요.</p>' +
      '<div class="adv-head">내보내기 <small class="sub">(표시한 구절 ' + n + '개)</small></div>' +
      '<p class="adv-desc">버튼을 눌러 복사한 뒤 메모 앱이나 카카오톡 「나에게」 같은 곳에 붙여 두세요.</p>' +
      '<textarea id="bk-out" class="bk-text" rows="4" readonly aria-label="백업 내용"></textarea>' +
      '<div class="row"><span id="bk-out-msg" class="sub">&nbsp;</span><button class="seg-btn" id="bk-copy" type="button">백업 내용 복사</button></div>' +
      '<div class="adv-head">불러오기</div>' +
      '<p class="adv-desc">복사해 둔 백업 내용을 아래 상자에 붙여 넣으세요. <b>지금 있는 표시는 모두 백업 내용으로 바뀝니다.</b></p>' +
      '<textarea id="bk-in" class="bk-text" rows="4" placeholder="여기에 붙여 넣기" aria-label="불러올 백업 내용"></textarea>' +
      '<div class="row"><span id="bk-in-msg" class="sub">&nbsp;</span><button class="seg-btn" id="bk-apply" type="button">불러오기</button></div>';
    const out = $('#bk-out'), inp = $('#bk-in'), outMsg = $('#bk-out-msg'), inMsg = $('#bk-in-msg');
    out.value = backupText();
    $('#bk-copy').addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(out.value); ok = true; } catch (e) {
        try { out.focus(); out.select(); out.setSelectionRange(0, out.value.length); ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      }
      outMsg.textContent = ok ? '복사했습니다. 붙여 둘 곳에 붙여 넣으세요.' : '복사가 안 됐습니다. 위 상자를 길게 눌러 전체 선택 → 복사하세요.';
    });
    let armed = 0, armTimer = null;
    const apply = $('#bk-apply');
    apply.addEventListener('click', () => {
      if (!inp.value.trim()) { inMsg.textContent = '붙여 넣은 내용이 없습니다.'; return; }
      if (!armed) {
        armed = 1; apply.textContent = '한 번 더 누르면 적용';
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = 0; apply.textContent = '불러오기'; }, 5000);
        return;
      }
      clearTimeout(armTimer); armed = 0; apply.textContent = '불러오기';
      try {
        const r = applyBackup(inp.value);
        closeSheet();
        rebuild(pos);
        showToastLine('불러왔습니다 · ' + r.verses + '구절, 표시 ' + r.marks + '개');
      } catch (err) {
        inMsg.textContent = err.message || '불러오지 못했습니다.';
      }
    });
  }

  // ---------- 하이라이트·표시 모아 보기 ----------
  function showHighlights() {
    clearSelection();
    sheetTitle.textContent = '하이라이트·표시';
    backBtn.hidden = true;
    sheetBack = null;
    const idx = {};
    bible.books.forEach((b, i) => { idx[b.id] = i; });
    const items = Object.keys(anns).map((key) => {
      const [id, c, n] = key.split('.');
      return { key, id, b: idx[id], c: +c - 1, n: +n };
    }).filter((x) => x.b !== undefined && bible.books[x.b].chapters[x.c] && verseText(x.b, x.c, x.n))
      .sort((a, b) => a.b - b.b || a.c - b.c || a.n - b.n);
    if (!items.length) {
      sheetBody.innerHTML = '<p class="note">아직 표시한 본문이 없습니다.<br>' +
        '본문의 낱말을 <b>길게 누르고</b>(누른 채 끌면 범위가 넓어집니다) 또는 화면 <b>가운데를 눌러</b> 고른 뒤, ' +
        '아래에 뜨는 도구 상자에서 형광·동그라미·네모·물결·밑줄과 색을 고르세요.</p>';
      return;
    }
    const CHUNK = 30;   // 많으면 한꺼번에 그리지 않고 나누어 보여 준다
    let shown = 0;
    sheetBody.innerHTML = '<div class="res-head">' + items.length + '개 구절</div><div id="hl-list"></div>' +
      '<div id="hl-more"></div><p class="note">✕는 그 구절의 표시를 모두 지웁니다. 낱말 하나만 지우려면 본문에서 그 낱말을 골라 <b>지우기</b>를 누르세요.</p>';
    const list = $('#hl-list'), more = $('#hl-more');
    function addRows() {
      const part = items.slice(shown, shown + CHUNK);
      shown += part.length;
      list.insertAdjacentHTML('beforeend', part.map((x) =>
        '<div class="hrow"><button class="res" data-b="' + x.b + '" data-c="' + x.c + '" data-n="' + x.n + '">' +
        '<span class="ref">' + esc(refLabel(x.b, x.c, x.n)) + '</span>' +
        '<span class="snip">' + annotate(x.id, x.c * 1000 + x.n, 0, verseText(x.b, x.c, x.n)) + '</span></button>' +
        '<button class="hdel" data-key="' + x.key + '" aria-label="이 구절의 표시 모두 지우기">✕</button></div>').join(''));
      more.innerHTML = shown < items.length ? '<button class="res more" type="button">더 보기 (' + (items.length - shown) + '개 남음)</button>' : '';
    }
    addRows();
    sheetBody.querySelector('#hl-more').addEventListener('click', (e) => { if (e.target.closest('.more')) addRows(); });
    list.addEventListener('click', (e) => {
      const del = e.target.closest('.hdel');
      if (del) {
        const [id, c, n] = del.dataset.key.split('.');
        delete anns[del.dataset.key];
        saveAnns();
        paintVerse(id, (+c - 1) * 1000 + (+n));
        const keep = sheetBody.scrollTop;
        showHighlights();
        sheetBody.scrollTop = keep;
        return;
      }
      const b = e.target.closest('.res');
      if (b) { closeSheet(); jumpTo({ book: +b.dataset.b, chapter: +b.dataset.c, verse: +b.dataset.n }); }
    });
  }

  // ---------- 검색: 구절 바로가기 + 본문 검색 ----------
  // 약칭(요, 시, 고전 …) → 책 번호
  const ABBR = {
    창: 0, 출: 1, 레: 2, 민: 3, 신: 4, 수: 5, 삿: 6, 룻: 7, 삼상: 8, 삼하: 9, 왕상: 10, 왕하: 11,
    대상: 12, 대하: 13, 스: 14, 느: 15, 에: 16, 욥: 17, 시: 18, 잠: 19, 전: 20, 아: 21, 사: 22,
    렘: 23, 애: 24, 겔: 25, 단: 26, 호: 27, 욜: 28, 암: 29, 옵: 30, 욘: 31, 미: 32, 나: 33,
    합: 34, 습: 35, 학: 36, 슥: 37, 말: 38, 마: 39, 막: 40, 눅: 41, 요: 42, 행: 43, 롬: 44,
    고전: 45, 고후: 46, 갈: 47, 엡: 48, 빌: 49, 골: 50, 살전: 51, 살후: 52, 딤전: 53, 딤후: 54,
    딛: 55, 몬: 56, 히: 57, 약: 58, 벧전: 59, 벧후: 60, 요일: 61, 요이: 62, 요삼: 63, 유: 64, 계: 65,
  };
  const MAX_RESULTS = 80;
  let flat = null;   // 모든 절을 한 줄로 편 목록 (처음 검색할 때 한 번 만든다)

  function allVerses() {
    if (flat) return flat;
    flat = [];
    bible.books.forEach((b, bi) => b.chapters.forEach((vs, ci) =>
      vs.forEach((v) => flat.push({ b: bi, c: ci, n: v.n, t: v.t }))));
    return flat;
  }

  function verseText(b, c, n) {
    const hit = bible.books[b].chapters[c].find((v) => v.n === n);
    return hit ? hit.t : '';
  }

  // "요 3:16", "요한복음 3장 16절", "시편 23", "창세기" 같은 입력을 읽어 이동할 위치 후보를 돌려준다.
  function parseRef(q) {
    // 책 이름은 한글을 최대한 길게 읽는다(그래야 '시편'의 '편'이 단위로 잘못 읽히지 않는다).
    const m = q.trim().match(/^([가-힣]+)\s*(\d+)?\s*(?:장|편)?\s*(?:[:：.]|\s)?\s*(\d+)?\s*절?$/);
    if (!m) return [];
    const name = m[1];
    const chapterNo = m[2] ? parseInt(m[2], 10) : 1;
    const verseNo = m[3] ? parseInt(m[3], 10) : 1;

    const books = [];
    if (Object.prototype.hasOwnProperty.call(ABBR, name)) books.push(ABBR[name]);
    bible.books.forEach((b, i) => {
      if (b.name === name || (name.length >= 2 && b.name.startsWith(name))) books.push(i);
    });

    const out = [], seen = new Set();
    books.forEach((bi) => {
      if (seen.has(bi)) return;
      seen.add(bi);
      const book = bible.books[bi];
      const c = chapterNo - 1;
      if (c < 0 || c >= book.chapters.length) return;
      const hasVerse = book.chapters[c].some((v) => v.n === verseNo);
      out.push({ b: bi, c, n: hasVerse ? verseNo : 1, exact: hasVerse && !!m[3] });
    });
    return out;
  }

  function refLabel(b, c, n) {
    const book = bible.books[b];
    return book.name + ' ' + (c + 1) + ':' + n;
  }

  function highlightTerms(text, tokens) {
    const re = new RegExp(tokens.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    return esc(text).replace(re, '<mark>$&</mark>');
  }

  function renderResults(q, box) {
    q = q.trim();
    if (!q) {
      box.innerHTML = '<p class="note">구절로 바로 이동하거나, 낱말로 찾아보세요.<br>' +
        '예) <b>요 3:16</b> · <b>시편 23</b> · <b>고전 13</b> · <b>사랑</b> · <b>여호와 목자</b></p>';
      return;
    }
    let html = '';

    const refs = parseRef(q);
    if (refs.length) {
      html += '<div class="res-head">이동</div>';
      refs.forEach((r) => {
        const snippet = r.exact ? esc(verseText(r.b, r.c, r.n)) : '';
        html += '<button class="res" data-b="' + r.b + '" data-c="' + r.c + '" data-n="' + r.n + '">' +
          '<span class="ref">' + esc(refLabel(r.b, r.c, r.n)) + ' 로 이동</span>' +
          (snippet ? '<span class="snip">' + snippet + '</span>' : '') + '</button>';
      });
    }

    const tokens = q.split(/\s+/).filter(Boolean);
    const hits = [];
    let total = 0;
    for (const v of allVerses()) {
      if (tokens.every((t) => v.t.includes(t))) {
        total++;
        if (hits.length < MAX_RESULTS) hits.push(v);
      }
    }
    // 구절 이동 후보가 있고 낱말 검색 결과가 없으면, 빈 검색 결과 안내는 생략한다.
    if (total || !refs.length) {
      html += '<div class="res-head">본문 검색 · ' + total + '건' +
        (total > MAX_RESULTS ? ' (앞 ' + MAX_RESULTS + '건만 표시 — 낱말을 더 넣어 좁혀 보세요)' : '') + '</div>';
    }
    if (!total && !refs.length) html += '<p class="note">일치하는 구절이 없습니다.</p>';
    hits.forEach((v) => {
      html += '<button class="res" data-b="' + v.b + '" data-c="' + v.c + '" data-n="' + v.n + '">' +
        '<span class="ref">' + esc(refLabel(v.b, v.c, v.n)) + '</span>' +
        '<span class="snip">' + highlightTerms(v.t, tokens) + '</span></button>';
    });
    box.innerHTML = html;
  }

  function showSearch() {
    sheetTitle.textContent = '검색';
    backBtn.hidden = true;
    sheetBack = null;
    sheetBody.innerHTML =
      '<input id="q" class="search-input" type="search" inputmode="search" enterkeyhint="search" ' +
      'placeholder="구절(요 3:16) 또는 낱말" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
      '<div id="results"></div>';
    const input = $('#q'), box = $('#results');
    renderResults('', box);
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => renderResults(input.value, box), 160);
    });
    // 결과를 누르면 그 절로 이동
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.res');
      if (!btn) return;
      closeSheet();
      jumpTo({ book: +btn.dataset.b, chapter: +btn.dataset.c, verse: +btn.dataset.n });
    });
    // 키보드의 '검색/이동' 키: 첫 결과로 이동
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      renderResults(input.value, box);
      const first = box.querySelector('.res');
      if (first) first.click();
    });
    return input;
  }

  // 상단 메뉴: 누른 손가락을 떼는 순간(pointerup)에 열고, 같은 터치의 click은 한 번만 처리한다.
  // (일부 기기에서 click이 빠져도 열리도록 이중으로 연결, 오류가 나면 화면에 알려 준다)
  function showError(err) {
    let t = document.getElementById('errtoast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'errtoast';
      t.style.cssText = 'position:fixed;left:12px;right:12px;bottom:60px;z-index:99;background:#7a1f1f;color:#fff;' +
        'padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.4;word-break:break-all';
      t.addEventListener('click', () => t.remove());
      document.body.appendChild(t);
    }
    t.textContent = '오류: ' + (err && err.message ? err.message : err) + ' (눌러서 닫기)';
  }
  // 잠깐 떴다 사라지는 안내 (눌러서 바로 닫을 수 있다)
  function showToastLine(msg) {
    let t = document.getElementById('infotoast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'infotoast';
      t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:60px;z-index:99;max-width:90%;background:#222;color:#fff;' +
        'padding:11px 16px;border-radius:12px;font-size:14px;line-height:1.4;text-align:center';
      t.addEventListener('click', () => t.remove());
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(showToastLine.timer);
    showToastLine.timer = setTimeout(() => t.remove(), 3500);
  }
  function onMenu(btn, fn) {
    let last = 0, downAt = null;
    const run = () => {
      const now = performance.now();
      if (now - last < 500) return;
      last = now;
      try { fn(); } catch (err) { showError(err); }
    };
    btn.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    btn.addEventListener('pointerup', (e) => {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved < 12) run();
    });
    btn.addEventListener('pointercancel', () => { downAt = null; });
    btn.addEventListener('click', run);
  }
  onMenu($('#btn-pick'), () => { showBooks(pos.book >= 39 ? 'nt' : 'ot'); openSheet(false); });
  onMenu($('#btn-settings'), () => { showSettings(); openSheet(false); });
  onMenu($('#btn-hl'), () => { showHighlights(); openSheet(false); });
  onMenu($('#btn-search'), () => {
    const input = showSearch();
    openSheet(true);
    input.focus();   // 버튼을 누른 같은 순간에 포커스를 줘야 아이폰에서 키보드가 올라온다
  });

  // ---------- 설치 안내(아이폰 Safari에서만) ----------
  function maybeShowHint() {
    const standalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const seen = localStorage.getItem('bf.hint') === '1';
    if (standalone || !ios || seen) return;
    $('#hint').hidden = false;
  }
  $('#hint-close').addEventListener('click', () => {
    $('#hint').hidden = true;
    try { localStorage.setItem('bf.hint', '1'); } catch (e) { /* 무시 */ }
  });

  // ---------- 시작 ----------
  async function start() {
    try {
      const res = await fetch('data/krv.json');
      bible = await res.json();
    } catch (e) {
      $('#loading').textContent = '본문을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 열어 주세요.';
      return;
    }
    if (!(pos.book >= 0 && pos.book < bible.books.length)) pos = { book: 0, chapter: 0, verse: 1 };
    migrateMarks();
    await rebuild(pos);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  start();
})();
