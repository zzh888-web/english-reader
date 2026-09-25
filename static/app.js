/* English Reader — read English books with an AI companion. */
"use strict";

/* ============================== utils ============================== */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function toast(msg, isErr) {
  const d = document.createElement("div");
  d.className = "toast" + (isErr ? " err" : "");
  d.textContent = msg;
  document.getElementById("toasts").appendChild(d);
  setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 350); }, 3400);
}

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current or background information: facts about the author, publication history, cultural or historical references, word origins, anything outside the book text. Returns the top results with title, URL and snippet.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Search query, usually in English" } },
      required: ["query"],
    },
  },
};

/* ============================== constants ============================== */
const PROVIDER_PRESETS = [
  { name: "Custom…", baseUrl: "", model: "" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { name: "Google Gemini (OpenAI-compatible)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" },
  { name: "Ollama (local, no key needed)", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
];

/* Alice's Adventures in Wonderland, Chapter I (Lewis Carroll, public domain). */
const SAMPLE_BOOK = [
  "ALICE'S ADVENTURES IN WONDERLAND",
  "by Lewis Carroll",
  "CHAPTER I. Down the Rabbit-Hole",
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, 'and what is the use of a book,' thought Alice 'without pictures or conversations?'",
  "So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.",
  "There was nothing so very remarkable in that; nor did Alice think it so very much out of the way to hear the Rabbit say to itself, 'Oh dear! Oh dear! I shall be late!' (when she thought it over afterwards, it occurred to her that she ought to have wondered at this, but at the time it all seemed quite natural); but when the Rabbit actually took a watch out of its waistcoat-pocket, and looked at it, and then hurried on, Alice started to her feet, for it flashed across her mind that she had never before seen a rabbit with either a waistcoat-pocket, or a watch to take out of it, and burning with curiosity, she ran across the field after it, and fortunately was just in time to see it pop down a large rabbit-hole under the hedge.",
  "In another moment down went Alice after it, never once considering how in the world she was to get out again.",
  "The rabbit-hole went straight on like a tunnel for some way, and then dipped suddenly down, so suddenly that Alice had not a moment to think about stopping herself before she found herself falling down a very deep well.",
  "Either the well was very deep, or she fell very slowly, for she had plenty of time as she went down to look about her and to wonder what was going to happen next. First, she tried to look down and make out what she was coming to, but it was too dark to see anything; then she looked at the sides of the well, and noticed that they were filled with cupboards and book-shelves; here and there she saw maps and pictures hung upon pegs. She took down a jar from one of the shelves as she passed; it was labelled 'ORANGE MARMALADE', but to her great disappointment it was empty: she did not like to drop the jar for fear of killing somebody underneath, so managed to put it into one of the cupboards as she fell past it.",
  "'Well!' thought Alice to herself, 'after such a fall as this, I shall think nothing of tumbling down stairs! How brave they'll all think me at home! Why, I wouldn't say anything about it, even if I fell off the top of the house!' (Which was very likely true.)",
].join("\n\n");

/* ============================== state ============================== */
const defaultSettings = {
  providerIdx: 0, baseUrl: "", apiKey: "", model: "",
  temperature: 0.7, tempAuto: false,
  replyLang: "Chinese", translateTo: "Chinese",
  theme: "sepia", fontSize: 19, chatWidth: 400, showTr: true, chatOpen: true,
  searchOn: false, tavilyKey: "", explainPrompt: "",
  providerKeys: {},   // baseUrl -> last used API key (per provider)
  providerModels: {}, // baseUrl -> last used model name (per provider)
};

const DEFAULT_EXPLAIN_PROMPT = `Explain the passage below clearly and concisely: what it means, any difficult vocabulary or grammar, and any cultural or literary background a reader might miss.

Passage:
"""{TEXT}"""
{CONTEXT}`;

function buildExplainContent(text, context) {
  const tpl = state.settings.explainPrompt.trim() || DEFAULT_EXPLAIN_PROMPT;
  return tpl
    .replace(/\{TEXT\}/g, text)
    .replace(/\{CONTEXT\}/g, context && context !== text
      ? `Surrounding text for context:\n"""${context.slice(0, 1600)}"""`
      : "");
}
const state = {
  settings: Object.assign({}, defaultSettings, LS.get("er.settings", {})),
  bookId: null,
  book: null,            // { id, title, chapters:[{title, paragraphs|path}], zip? }
  chapterIdx: 0,
  translations: {},      // "chapterIdx:sentIdx" -> text
  chapterScrolls: {},
  chat: [],              // {role, content, kind, quote?}
  lastContext: "",
  streaming: false,
  abortCtrl: null,
  warnedQuota: false,
};
/* one-time migration: explanations used to default to English */
if (!state.settings._zhMigrated) {
  if (state.settings.replyLang === "English") state.settings.replyLang = "Chinese";
  state.settings._zhMigrated = true;
  LS.set("er.settings", state.settings);
}

/* ============================== DOM refs ============================== */
const readerWrap = $("#readerWrap"), reader = $("#reader");
const chatMessages = $("#chatMessages"), chatInput = $("#chatInput"), btnSend = $("#btnSend");
const ctxMenu = $("#ctxMenu"), toasts = $("#toasts");
const bookTitleEl = $("#bookTitle");

/* ============================== sentence splitting ============================== */
const ABBR_END = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|esp|Fig|No|Vol|Mt|Capt|Lt|Sgt|Rev|Hon|Ave|Co|Inc|Ltd|Corp|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.)$|(?:\b[A-Z]\.)$/;

function splitSentences(text) {
  const rough = text.split(/(?<=[.!?\u2026]["\u201D\u2019')\]]?)\s+(?=["\u201C\u2018'(\[]?[A-Z0-9])/);
  const out = [];
  for (const seg of rough) {
    const t = seg.trim();
    if (!t) continue;
    if (out.length && ABBR_END.test(out[out.length - 1].trim())) {
      out[out.length - 1] = out[out.length - 1].trim() + " " + t;
    } else {
      out.push(t);
    }
  }
  return out.length ? out : [text.trim()].filter(Boolean);
}

function assignSentenceIndexes(paragraphs) {
  let running = 0;
  for (const p of paragraphs) {
    p.sentences = p.type === "h" ? [p.text] : splitSentences(p.text);
    p.start = running;
    running += p.sentences.length;
  }
  return running;
}

/* ============================== plain text / markdown ============================== */
function parsePlainText(raw, fallbackTitle) {
  let text = raw.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const g = text.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n([\s\S]*?)\n\s*\*\*\*\s*END OF/si);
  if (g) text = g[1];
  text = text.replace(/^#{1,6}[ \t]*/gm, ""); // markdown heading marks

  const paras = text.split(/\n\s*\n+/).map(s => s.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const CH_RE = /^(chapter|part|book|prologue|epilogue|volume|section)\b.{0,80}$/i;
  const chapters = [];
  let cur = { title: "", paragraphs: [] };
  let titleGuess = "";
  for (const p of paras) {
    const isChapter = p.length <= 90 && CH_RE.test(p);
    const isCapsHead = p.length >= 8 && p.length <= 60 && !/[.!?]$/.test(p) && /[A-Z]/.test(p) && p === p.toUpperCase();
    if ((isChapter || isCapsHead) && cur.paragraphs.length) {
      chapters.push(cur);
      cur = { title: p.slice(0, 70), paragraphs: [] };
    } else if (!titleGuess && !cur.paragraphs.length && p.length <= 80 && !/[.!?]$/.test(p)) {
      titleGuess = p;
    }
    cur.paragraphs.push({ type: isChapter || isCapsHead ? "h" : "p", text: p });
  }
  if (cur.paragraphs.length) chapters.push(cur);
  if (!chapters.length) chapters.push({ title: "", paragraphs: [] });
  chapters.forEach(c => assignSentenceIndexes(c.paragraphs));
  const book = {
    id: null, title: (titleGuess || fallbackTitle || "Untitled book").replace(/\.(txt|md|epub)$/i, ""),
    chapters: chapters.map((c, i) => ({ title: c.title || `Section ${i + 1}`, paragraphs: c.paragraphs })),
  };
  return book;
}

/* ============================== epub (zip) reader ============================== */
class ZipReader {
  constructor(buf) {
    this.buf = new Uint8Array(buf);
    this.dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.entries = new Map();
    this._parse();
  }
  _u32(o) { return this.dv.getUint32(o, true); }
  _u16(o) { return this.dv.getUint16(o, true); }
  _parse() {
    const n = this.buf.length;
    let eocd = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65558); i--) {
      if (this._u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This file is not a valid EPUB (zip) archive.");
    const count = this._u16(eocd + 10);
    let p = this._u32(eocd + 16);
    const td = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (this._u32(p) !== 0x02014b50) break;
      const method = this._u16(p + 10), csize = this._u32(p + 20);
      const nlen = this._u16(p + 28), elen = this._u16(p + 30), clen = this._u16(p + 32);
      const off = this._u32(p + 42);
      this.entries.set(td.decode(this.buf.subarray(p + 46, p + 46 + nlen)), { method, csize, off });
      p += 46 + nlen + elen + clen;
    }
  }
  async raw(name) {
    const e = this.entries.get(name);
    if (!e) return null;
    const nlen = this._u16(e.off + 26), elen = this._u16(e.off + 28);
    const start = e.off + 30 + nlen + elen;
    const data = this.buf.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error("Unsupported zip compression method " + e.method);
  }
  async text(name) {
    const r = await this.raw(name);
    return r == null ? null : new TextDecoder("utf-8").decode(r);
  }
  has(name) { return this.entries.has(name); }
}

function resolveZipPath(baseDir, href) {
  let h = (href || "").split("#")[0];
  try { h = decodeURIComponent(h); } catch (e) { /* keep raw */ }
  const joined = h.startsWith("/") ? h : baseDir + h;
  const st = [];
  for (const part of joined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") st.pop(); else st.push(part);
  }
  return st.join("/");
}

const xmlEls = (doc, localName) => [...doc.getElementsByTagName("*")].filter(e => e.localName === localName);

async function parseEpub(buf, fallbackTitle) {
  const zip = new ZipReader(buf);
  const container = await zip.text("META-INF/container.xml");
  if (!container) throw new Error("Broken EPUB: META-INF/container.xml is missing.");
  const cdoc = new DOMParser().parseFromString(container, "application/xml");
  const rootfile = xmlEls(cdoc, "rootfile")[0];
  if (!rootfile) throw new Error("Broken EPUB: no rootfile entry.");
  const opfPath = rootfile.getAttribute("full-path");
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const opf = new DOMParser().parseFromString(await zip.text(opfPath), "application/xml");
  const manifest = {};
  for (const it of xmlEls(opf, "item")) {
    manifest[it.getAttribute("id")] = {
      href: resolveZipPath(dir, it.getAttribute("href") || ""),
      type: it.getAttribute("media-type") || "",
      props: it.getAttribute("properties") || "",
    };
  }
  const spineEl = xmlEls(opf, "spine")[0];
  const spineIds = xmlEls(spineEl || opf, "itemref").map(r => r.getAttribute("idref")).filter(Boolean);

  // table of contents labels: first anchor per file
  const toc = new Map();
  const navItem = Object.values(manifest).find(i => /\bnav\b/.test(i.props));
  let ncxItem = null;
  if (spineEl && spineEl.getAttribute("toc")) ncxItem = manifest[spineEl.getAttribute("toc")];
  if (!ncxItem) ncxItem = Object.values(manifest).find(i => i.type === "application/x-dtbncx+xml");
  const navDocPaths = [navItem && navItem.href, ncxItem && ncxItem.href].filter(Boolean);
  for (const p of navDocPaths) {
    try {
      const raw = await zip.text(p);
      if (!raw) continue;
      const doc = new DOMParser().parseFromString(raw, "application/xml");
      const anchors = [...doc.getElementsByTagName("a")].length
        ? [...doc.getElementsByTagName("a")]
        : xmlEls(doc, "content").map(c => ({ getAttribute: () => c.getAttribute("src"), textContent: (c.parentNode && c.parentNode.textContent) || "" }));
      for (const a of anchors) {
        if (!a.getAttribute("href")) continue;
        const key = resolveZipPath(p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "", a.getAttribute("href"));
        const label = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (label && !toc.has(key)) toc.set(key, label);
      }
    } catch (e) { /* tolerate broken toc */ }
  }

  const titleEl = xmlEls(opf, "title")[0];
  const title = (titleEl && titleEl.textContent.trim()) || fallbackTitle || "Untitled book";
  const chapters = spineIds.map((id, i) => {
    const item = manifest[id];
    return {
      title: (item && toc.get(item.href)) || `Section ${i + 1}`,
      path: item ? item.href : null,
      paragraphs: null,
    };
  }).filter(c => c.path);

  if (!chapters.length) throw new Error("Broken EPUB: the spine is empty.");
  return { id: null, title, chapters, zip };
}

async function ensureChapter(idx) {
  const ch = state.book.chapters[idx];
  if (ch.paragraphs) return;
  const html = await state.book.zip.text(ch.path);
  if (html == null) { ch.paragraphs = [{ type: "p", text: "(This section could not be read.)" }]; assignSentenceIndexes(ch.paragraphs); return; }
  const doc = new DOMParser().parseFromString(html, "text/html");
  $$("script,style", doc).forEach(x => x.remove());
  const els = [...doc.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote")];
  const paras = [];
  for (const el of els) {
    if (el.querySelector("p,h1,h2,h3,h4,h5,h6,li,blockquote")) continue;
    const t = el.textContent.replace(/\s+/g, " ").trim();
    if (!t || t.length > 6000) continue;
    const tag = el.tagName.toLowerCase();
    const isHead = /^h[1-6]$/.test(tag);
    if (!isHead && paras.length && paras[paras.length - 1].text === t) continue;
    paras.push({ type: isHead ? "h" : "p", text: t });
  }
  if (!paras.length) {
    const t = doc.body.textContent.replace(/\s+/g, " ").trim();
    if (t) paras.push({ type: "p", text: t.slice(0, 20000) });
  }
  ch.paragraphs = paras.length ? paras : [{ type: "p", text: "(empty section)" }];
  assignSentenceIndexes(ch.paragraphs);
}

/* ============================== file loading ============================== */
async function decodeFileBytes(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    try { return new TextDecoder("windows-1252").decode(buf); }
    catch (e2) { return new TextDecoder("utf-8").decode(buf); }
  }
}

async function loadFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  let book;
  try {
    if (ext === "epub") {
      book = await parseEpub(await file.arrayBuffer(), file.name.replace(/\.epub$/i, ""));
    } else if (ext === "txt" || ext === "md" || ext === "text" || file.type.startsWith("text/")) {
      book = parsePlainText(await decodeFileBytes(file), file.name);
    } else {
      toast("Unsupported file type. Please open .txt, .md or .epub.", true);
      return;
    }
  } catch (err) {
    toast("Could not open this book: " + err.message, true);
    return;
  }
  book.id = `${file.name}|${file.size}|${file.lastModified}`;
  openBook(book);
}

function loadSample() {
  const book = parsePlainText(SAMPLE_BOOK, "Alice's Adventures in Wonderland (sample)");
  book.id = "sample|alice";
  openBook(book);
}

function openBook(book) {
  state.book = book;
  state.bookId = book.id;
  state.translations = {};
  state.chapterScrolls = {};
  state.chat = [];
  state.chapterIdx = 0;
  const saved = LS.get("er.book." + book.id, null);
  if (saved) {
    state.translations = saved.translations || {};
    state.chat = saved.chat || [];
    state.chapterScrolls = saved.chapterScrolls || {};
    state.chapterIdx = Math.min(saved.chapterIdx || 0, book.chapters.length - 1);
  }
  bookTitleEl.textContent = book.title;
  document.title = book.title + " — English Reader";
  renderChat();
  gotoChapter(state.chapterIdx, { restore: true });
  if (!LS.get("er.tipShown", false)) { $("#tipbar").classList.remove("hidden"); }
}

function saveBookNow() {
  if (!state.bookId) return;
  const ok = LS.set("er.book." + state.bookId, {
    translations: state.translations,
    chat: state.chat.slice(-150),
    chapterIdx: state.chapterIdx,
    chapterScrolls: state.chapterScrolls,
  });
  if (!ok && !state.warnedQuota) {
    state.warnedQuota = true;
    toast("Browser storage is full — translations may not be saved.", true);
  }
}
const saveBookState = debounce(saveBookNow, 500);
window.addEventListener("beforeunload", saveBookNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveBookNow(); });

/* ============================== rendering ============================== */
function renderWelcome() {
  bookTitleEl.textContent = "";
  document.title = "English Reader";
  reader.innerHTML = `
    <div class="welcome">
      <h1>English Reader</h1>
      <div class="sub">Read English books with an AI companion beside you.</div>
      <div class="wbtns">
        <button class="btn primary" id="wlOpen">📖 Open a Book</button>
        <button class="btn" id="wlSample">Read the sample</button>
      </div>
      <div class="steps">
        <b>How it works</b><br>
        1. Open any <b>.txt</b>, <b>.md</b> or <b>.epub</b> book (or drag it here).<br>
        2. Right-click a sentence → <b>Translate</b> — the translation appears just below it.<br>
        3. Right-click → <b>Explain</b> — the explanation opens in the chat panel on the right.<br>
        4. Chat freely about the book, or ask about any word you select.<br>
        5. Set up any OpenAI-compatible API in <b>⚙ Settings</b> first.
      </div>
    </div>`;
  $("#wlOpen").onclick = () => $("#fileInput").click();
  $("#wlSample").onclick = loadSample;
}

async function gotoChapter(idx, opts = {}) {
  if (!state.book) return;
  state.chapterScrolls[state.chapterIdx] = readerWrap.scrollTop;
  state.chapterIdx = Math.max(0, Math.min(idx, state.book.chapters.length - 1));
  if (state.book.zip) { try { await ensureChapter(state.chapterIdx); } catch (e) { toast("Section failed to load: " + e.message, true); } }
  renderChapter();
  const top = opts.restore ? (state.chapterScrolls[state.chapterIdx] || 0) : 0;
  requestAnimationFrame(() => { readerWrap.scrollTop = top; });
  renderChapterPanel();
  saveBookState();
}

function renderChapter() {
  const ch = state.book.chapters[state.chapterIdx];
  const frag = document.createDocumentFragment();
  ch.paragraphs.forEach(p => {
    const el = document.createElement(p.type === "h" ? "h3" : "p");
    p.sentences.forEach((s, i) => {
      const sp = document.createElement("span");
      sp.className = "s";
      sp.dataset.i = String(p.start + i);
      sp.textContent = s + (i < p.sentences.length - 1 ? " " : "");
      el.appendChild(sp);
    });
    frag.appendChild(el);
  });
  const nav = document.createElement("div");
  nav.className = "chnav";
  const hasPrev = state.chapterIdx > 0, hasNext = state.chapterIdx < state.book.chapters.length - 1;
  nav.innerHTML = `
    <button class="btn" id="chPrev" ${hasPrev ? "" : "disabled"}>← Previous</button>
    <span class="ch-pos">Section ${state.chapterIdx + 1} of ${state.book.chapters.length}</span>
    <button class="btn" id="chNext" ${hasNext ? "" : "disabled"}>Next →</button>`;
  frag.appendChild(nav);
  reader.replaceChildren(frag);

  // restore saved translations for this chapter
  const prefix = state.chapterIdx + ":";
  for (const key of Object.keys(state.translations)) {
    if (!key.startsWith(prefix)) continue;
    const idx = key.slice(prefix.length);
    if (reader.querySelector(`.s[data-i="${idx}"]`)) insertTranslation(Number(idx), state.translations[key]);
  }
  $("#chPrev").onclick = () => gotoChapter(state.chapterIdx - 1);
  $("#chNext").onclick = () => gotoChapter(state.chapterIdx + 1);
}

function insertTranslation(sentIdx, text, pending) {
  const span = reader.querySelector(`.s[data-i="${sentIdx}"]`);
  if (!span) return null;
  let tr = reader.querySelector(`.tr[data-for="${sentIdx}"]`);
  if (!tr) {
    tr = document.createElement("span");
    tr.className = "tr";
    tr.dataset.for = String(sentIdx);
    span.after(tr);
  }
  span.classList.add("has-tr");
  tr.classList.toggle("loading", !!pending);
  tr.replaceChildren();
  const t = document.createElement("span");
  t.className = "tr-text";
  t.textContent = text;
  tr.appendChild(t);
  if (!pending) {
    const rm = document.createElement("button");
    rm.className = "tr-rm";
    rm.textContent = "✕";
    rm.title = "Remove translation";
    rm.onclick = () => removeTranslation(tr);
    tr.appendChild(rm);
  }
  return tr;
}

function removeTranslation(trEl) {
  if (!trEl) return;
  const idx = trEl.dataset.for;
  delete state.translations[state.chapterIdx + ":" + idx];
  trEl.remove();
  const sp = reader.querySelector(`.s[data-i="${idx}"]`);
  if (sp) sp.classList.remove("has-tr");
  saveBookNow();
}

/* ============================== context menu ============================== */
function hideMenu() { ctxMenu.classList.add("hidden"); }

function showMenu(x, y, headText, items) {
  ctxMenu.replaceChildren();
  if (headText) {
    const h = document.createElement("div");
    h.className = "ctx-head";
    h.textContent = headText.length > 130 ? headText.slice(0, 130) + "…" : headText;
    ctxMenu.appendChild(h);
  }
  for (const it of items) {
    if (it === "-") { const s = document.createElement("div"); s.className = "ctx-sep"; ctxMenu.appendChild(s); continue; }
    const b = document.createElement("button");
    b.className = "ctx-item";
    b.innerHTML = `<span>${escHtml(it.label)}</span>${it.hint ? `<span class="k">${escHtml(it.hint)}</span>` : ""}`;
    b.onclick = () => { hideMenu(); it.fn(); };
    ctxMenu.appendChild(b);
  }
  ctxMenu.classList.remove("hidden");
  const r = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  ctxMenu.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
}

function paragraphTextOfSpan(span) {
  const p = span.closest("p,h3");
  if (!p) return span.textContent.trim();
  return $$(".s", p).map(s => s.textContent.trim()).join(" ").trim();
}

readerWrap.addEventListener("contextmenu", e => {
  if (!state.book) return;
  const trEl = e.target.closest(".tr");
  const sEl = e.target.closest(".s");
  const selObj = window.getSelection();
  const selText = selObj && !selObj.isCollapsed ? selObj.toString().replace(/\s+/g, " ").trim() : "";
  if (!trEl && !sEl && !selText) return;
  e.preventDefault();

  if (trEl && !sEl && !selText) {
    showMenu(e.clientX, e.clientY, trEl.querySelector(".tr-text").textContent, [
      { label: "Remove translation", fn: () => removeTranslation(trEl) },
      { label: "Copy", fn: () => copyText(trEl.querySelector(".tr-text").textContent) },
    ]);
    return;
  }

  const targetSpan = sEl || closestSpanOf(selObj.focusNode);
  const target = selText || (targetSpan ? targetSpan.textContent.trim() : "");
  if (!target) return;
  const sentIdx = targetSpan ? Number(targetSpan.dataset.i) : null;
  const already = sentIdx != null && state.translations[state.chapterIdx + ":" + sentIdx] != null;

  const items = [];
  if (sentIdx != null) {
    items.push({
      label: already ? "Re-translate sentence" : "Translate sentence",
      hint: "below text", fn: () => actTranslate(target, sentIdx),
    });
  } else {
    items.push({ label: "Translate selection", hint: "below text", fn: () => actTranslate(target, spanEndIdx(selObj)) });
  }
  items.push({ label: "Explain", hint: "in chat", fn: () => actExplain(target, targetSpan) });
  items.push({ label: "Ask about this…", hint: "in chat", fn: () => actAsk(target) });
  items.push("-");
  items.push({ label: "Copy", fn: () => copyText(target) });
  if (already && sentIdx != null) {
    items.push({ label: "Remove translation", fn: () => removeTranslation(reader.querySelector(`.tr[data-for="${sentIdx}"]`)) });
  }
  showMenu(e.clientX, e.clientY, target, items);
});

function closestSpanOf(node) {
  if (!node) return null;
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el ? el.closest(".s") : null;
}
function spanEndIdx(selObj) {
  const sp = closestSpanOf(selObj.focusNode);
  return sp ? Number(sp.dataset.i) : null;
}

document.addEventListener("click", e => { if (!e.target.closest("#ctxMenu")) hideMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { hideMenu(); $("#modalBack").classList.add("hidden"); $("#chapterPanel").classList.add("hidden"); } });
window.addEventListener("blur", hideMenu);

function copyText(t) {
  navigator.clipboard.writeText(t).then(() => toast("Copied to clipboard.")).catch(() => toast("Copy failed.", true));
}

/* ============================== actions ============================== */
function apiReady() {
  const s = state.settings;
  const local = /\/\/(localhost|127\.0\.0\.1)/.test(s.baseUrl);
  if (!s.baseUrl || !s.model || (!s.apiKey && !local)) {
    toast("Add your API key in Settings first.", true);
    openSettings();
    return false;
  }
  return true;
}

async function actTranslate(text, sentIdx) {
  if (!apiReady()) return;
  const key = state.chapterIdx + ":" + sentIdx;
  const tr = insertTranslation(sentIdx, "Translating…", true);
  if (!tr) return;
  try {
    let out = await callChat({
      stream: false, temperature: 0.2,
      messages: [
        { role: "system", content: `You are a professional literary translator. Translate the user's English text into ${state.settings.translateTo}. Output ONLY the translation itself — no quotes, no notes, no explanations. If the text is a single word, give its most fitting meaning in this context.` },
        { role: "user", content: text },
      ],
    });
    out = (out || "").trim().replace(/^["\u201C\u201D]+|["\u201C\u201D]+$/g, "");
    if (!out) throw new Error("empty response");
    insertTranslation(sentIdx, out);
    state.translations[key] = out;
    saveBookNow();
  } catch (err) {
    if (state.translations[key] != null) insertTranslation(sentIdx, state.translations[key]);
    else tr.remove();
    toast("Translation failed: " + err.message, true);
  }
}

function actExplain(text, span) {
  if (!apiReady()) return;
  const context = span ? paragraphTextOfSpan(span) : text;
  state.lastContext = context;
  const isWord = /^[A-Za-z][A-Za-z'\u2019-]{0,25}$/.test(text);
  let content;
  if (isWord) {
    content = `Explain the English word "${text}" as used in the passage below. Give: pronunciation (IPA), part of speech, its meaning in this context, and one short example sentence.

Passage:
"""${text}"""
${context && context !== text ? `\nSurrounding text for context:\n"""${context.slice(0, 1600)}"""` : ""}`;
  } else {
    content = buildExplainContent(text, context);
  }
  state.chat.push({ role: "user", content, kind: "explain", quote: text });
  appendMsgEl(state.chat[state.chat.length - 1]);
  saveBookNow();
  runAssistantTurn("Explanation");
}

function actAsk(text) {
  const short = text.length > 120 ? text.slice(0, 120) + "…" : text;
  chatInput.value = `About "${short}": `;
  chatInput.focus();
  ensureChatOpen();
}

/* ============================== API ============================== */
async function callChat({ messages, temperature, stream, onDelta, signal, tools }) {
  if (location.protocol === "file:") throw new Error("please start the app with server.py");
  const s = state.settings;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseUrl: s.baseUrl, apiKey: s.apiKey, model: s.model, messages,
      // "follow model default" mode: omit the parameter entirely
      temperature: s.tempAuto ? undefined : temperature,
      stream: tools ? false : stream, tools,
    }),
    signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j.error && j.error.message) || `HTTP ${res.status}`);
  }
  if (tools) {  // non-streaming round that may return tool_calls
    const j = await res.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    if (!msg) throw new Error("empty response from model");
    return msg;
  }
  if (!stream) {
    const j = await res.json();
    const ch = j.choices && j.choices[0];
    return (ch && ch.message && ch.message.content) || "";
  }
  const rd = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", full = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const c0 = j.choices && j.choices[0];
        const d = (c0 && c0.delta && c0.delta.content) || (c0 && c0.message && c0.message.content) || "";
        if (d) { full += d; if (onDelta) onDelta(full); }
      } catch (e) { /* partial json line across chunks is impossible after newline split; ignore junk */ }
    }
  }
  return full;
}

/* ============================== chat ============================== */
function mdToHtml(src) {
  let h = escHtml(src);
  h = h.replace(/```([\s\S]*?)```/g, (m, c) => `<pre>${c.trim()}</pre>`);
  h = h.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  h = h.replace(/^#{1,6}\s*(.+)$/gm, "<h4>$1</h4>");
  h = h.replace(/^[-\u2022]\s+(.+)$/gm, "<li>$1</li>");
  h = h.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t) return "";
    if (/^<(h4|pre|li)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br>")}</p>`;
  }).join("");
  return h || "<p></p>";
}

function appendMsgEl(m) {
  if (m.kind === "search") {
    const line = document.createElement("div");
    line.className = "msg search-line";
    const sp = document.createElement("span");
    sp.textContent = "🔍 web_search · " + m.content;
    line.appendChild(sp);
    chatMessages.appendChild(line);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return { div: line, body: line };
  }
  const div = document.createElement("div");
  div.className = "msg " + m.role + (m.error ? " error" : "");
  const who = m.role === "user" ? "You" : "Assistant";
  let inner = `<div class="who">${escHtml(who)}${m.label ? `<span class="tag">${escHtml(m.label)}</span>` : ""}</div><div class="body"></div>`;
  div.innerHTML = inner;
  const body = $(".body", div);
  if (m.role === "user" && m.kind === "explain") {
    // prominent card with the exact passage being explained
    const card = document.createElement("div");
    card.className = "ex-quote";
    const label = document.createElement("div");
    label.className = "ex-label";
    label.textContent = "EXPLAINING THIS";
    const txt = document.createElement("div");
    txt.className = "ex-text";
    txt.textContent = m.quote.length > 700 ? m.quote.slice(0, 700) + "…" : m.quote;
    card.append(label, txt);
    body.appendChild(card);
  } else {
    body.innerHTML = mdToHtml(m.content || "");
  }
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return { div, body };
}

function renderChat() {
  chatMessages.replaceChildren();
  for (const m of state.chat) appendMsgEl(m);
}

function buildSystemPrompt() {
  const s = state.settings;
  const lang = s.replyLang === "Auto (match the user)"
    ? "Reply in the same language the user writes in."
    : `Reply in ${s.replyLang}.`;
  let ctx = "";
  if (state.book) ctx += `The user is currently reading "${state.book.title}". `;
  if (state.lastContext) ctx += `The passage they are looking at:\n"""${state.lastContext.slice(0, 1600)}"""\n`;
  const search = s.searchOn
    ? "You have a web_search tool available. Use it whenever the answer benefits from outside knowledge (author background, publication history, cultural references, word origins, current facts) — do not guess what a quick search could verify. After searching, mention the source title or URL briefly. "
    : "";
  return `You are a warm, insightful reading companion helping the user read English books. ${ctx}${search}You help with meaning, vocabulary, grammar, style, and cultural or literary background. Be clear and concise; use short paragraphs. ${lang}`;
}

function setStreamingUI(on) {
  state.streaming = on;
  btnSend.textContent = on ? "Stop" : "Send";
  btnSend.classList.toggle("stop", on);
  $("#chatModel").textContent = on ? " · generating…" : (state.settings.model ? " · " + state.settings.model : "");
}

function chatHistory() {
  return state.chat
    .filter(m => !m.error && m.kind !== "search")
    .map(m => ({ role: m.role, content: m.content }));
}

function typingBubble() {
  const { div, body } = appendMsgEl({ role: "assistant", content: "" });
  body.innerHTML = '<span class="typing-dots"></span>';
  return div;
}

async function runAssistantTurn(label) {
  ensureChatOpen();
  const msgs = [{ role: "system", content: buildSystemPrompt() }, ...chatHistory()];
  if (state.settings.searchOn) return toolLoopReply(msgs, label);
  return streamReply(msgs, label);
}

/* streaming reply without tools */
async function streamReply(msgs, label) {
  const msg = { role: "assistant", content: "", label };
  state.chat.push(msg);
  const { body } = appendMsgEl(msg);
  body.innerHTML = '<span class="typing-dots"></span>';
  state.abortCtrl = new AbortController();
  setStreamingUI(true);
  let pinned = true;
  chatMessages.onscroll = () => { pinned = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 60; };
  try {
    await callChat({
      messages: msgs,
      temperature: state.settings.temperature,
      stream: true,
      signal: state.abortCtrl.signal,
      onDelta: t => { msg.content = t; body.innerHTML = mdToHtml(t); if (pinned) chatMessages.scrollTop = chatMessages.scrollHeight; },
    });
  } catch (err) {
    if (err.name === "AbortError") {
      msg.content = (msg.content || "") + (msg.content ? "\n\n*(stopped)*" : "*(stopped)*");
    } else {
      msg.error = true;
      msg.content = "Request failed: " + err.message;
      toast("Chat failed: " + err.message, true);
    }
  } finally {
    chatMessages.onscroll = null;
    if (!msg.content) msg.content = "*(no content returned)*";
    body.innerHTML = mdToHtml(msg.content);
    body.classList.toggle("error", !!msg.error);
    setStreamingUI(false);
    state.abortCtrl = null;
    saveBookNow();
  }
}

/* reply with the web_search tool available (function-calling loop) */
async function toolLoopReply(msgs, label) {
  let live = typingBubble();
  state.abortCtrl = new AbortController();
  setStreamingUI(true);
  let finalText = null;
  try {
    for (let round = 0; round < 4; round++) {
      const message = await callChat({
        messages: msgs,
        temperature: state.settings.temperature,
        tools: [WEB_SEARCH_TOOL],
        signal: state.abortCtrl.signal,
      });
      const calls = message.tool_calls || [];
      if (!calls.length) { finalText = message.content || "*(no content returned)*"; break; }
      msgs.push({ role: "assistant", content: message.content || "", tool_calls: calls });
      for (const tc of calls) {
        let query = "";
        try { query = JSON.parse(tc.function.arguments || "{}").query || ""; } catch (e) { query = ""; }
        if (tc.function.name !== "web_search" || !query) {
          msgs.push({ role: "tool", tool_call_id: tc.id, content: "Unknown tool or missing query." });
          continue;
        }
        live.remove();
        state.chat.push({ role: "assistant", content: query, kind: "search" });
        appendMsgEl(state.chat[state.chat.length - 1]);
        live = typingBubble();
        let toolContent;
        try {
          const r = await fetch("/api/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, tavilyKey: state.settings.tavilyKey || undefined }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !(j.results && j.results.length)) {
            throw new Error((j.error && j.error.message) || (r.ok ? "no results" : "HTTP " + r.status));
          }
          toolContent = j.results.map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${x.content || ""}`).join("\n\n");
        } catch (err) {
          toolContent = "Web search failed: " + err.message + ". Answer from your own knowledge instead.";
        }
        msgs.push({ role: "tool", tool_call_id: tc.id, content: toolContent });
      }
    }
    if (finalText == null) finalText = "*(search rounds exhausted — please try rephrasing)*";
  } catch (err) {
    finalText = err.name === "AbortError" ? "*(stopped)*" : "Request failed: " + err.message;
    if (err.name !== "AbortError") toast("Chat failed: " + err.message, true);
  } finally {
    live.remove();
    state.chat.push({ role: "assistant", content: finalText, label, error: /^Request failed/.test(finalText) });
    appendMsgEl(state.chat[state.chat.length - 1]);
    setStreamingUI(false);
    state.abortCtrl = null;
    saveBookNow();
  }
}

function sendChat() {
  if (state.streaming) { state.abortCtrl && state.abortCtrl.abort(); return; }
  const t = chatInput.value.trim();
  if (!t) return;
  if (!apiReady()) return;
  chatInput.value = "";
  state.chat.push({ role: "user", content: t, kind: "chat" });
  appendMsgEl(state.chat[state.chat.length - 1]);
  saveBookNow();
  runAssistantTurn();
}

btnSend.onclick = sendChat;
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$("#btnChatClear").onclick = () => {
  state.chat = [];
  renderChat();
  saveBookState();
};

function ensureChatOpen() {
  if (!state.settings.chatOpen) toggleChat();
}

/* ============================== settings modal ============================== */
const modalBack = $("#modalBack");
const setProvider = $("#setProvider"), setBaseUrl = $("#setBaseUrl"), setApiKey = $("#setApiKey"),
  setModel = $("#setModel"), setTemp = $("#setTemp"), tempVal = $("#tempVal"),
  setReplyLang = $("#setReplyLang"), setTranslateTo = $("#setTranslateTo"),
  setTavilyKey = $("#setTavilyKey"), setExplainPrompt = $("#setExplainPrompt");

PROVIDER_PRESETS.forEach((p, i) => {
  const o = document.createElement("option");
  o.value = i; o.textContent = p.name;
  setProvider.appendChild(o);
});

function openSettings() {
  const s = state.settings;
  setBaseUrl.value = s.baseUrl; setApiKey.value = s.apiKey; setModel.value = s.model;
  setTemp.value = s.temperature; tempVal.textContent = s.temperature;
  setTempAuto.checked = !!s.tempAuto;
  setTemp.disabled = !!s.tempAuto;
  if (s.tempAuto) tempVal.textContent = "模型默认";
  setReplyLang.value = s.replyLang; setTranslateTo.value = s.translateTo;
  setTavilyKey.value = s.tavilyKey || "";
  setExplainPrompt.value = s.explainPrompt || "";
  let pi = PROVIDER_PRESETS.findIndex(p => p.baseUrl && p.baseUrl === s.baseUrl);
  if (pi < 0) pi = 0;
  setProvider.value = String(pi);
  const hint = $("#searchHint");
  hint.textContent = "正在检查搜索引擎…";
  fetch("/api/search-config").then(r => r.json()).then(j => {
    hint.textContent = j.tavily
      ? "搜索引擎：Tavily（已自动检测到本机密钥）。"
      : "搜索引擎：免费网页搜索（无需密钥）。填写 Tavily 密钥可获得更好的搜索结果。";
  }).catch(() => { hint.textContent = ""; });
  modalBack.classList.remove("hidden");
  setTimeout(() => setBaseUrl.focus(), 50);
}

setProvider.onchange = () => {
  const p = PROVIDER_PRESETS[Number(setProvider.value)];
  if (!p) return;
  if (p.baseUrl) {
    setBaseUrl.value = p.baseUrl;
    const base = p.baseUrl.replace(/\/+$/, "");
    setApiKey.value = state.settings.providerKeys[base] || "";
    setModel.value = state.settings.providerModels[base] || p.model || setModel.value;
  }
};
setBaseUrl.addEventListener("change", autofillForBaseUrl);
setTemp.oninput = () => { tempVal.textContent = setTemp.value; };
const setTempAuto = $("#setTempAuto");
setTempAuto.onchange = () => {
  setTemp.disabled = setTempAuto.checked;
  tempVal.textContent = setTempAuto.checked ? "模型默认" : setTemp.value;
};

/* restore the API key and model last used with this base URL */
function autofillForBaseUrl() {
  const base = setBaseUrl.value.trim().replace(/\/+$/, "");
  if (!base) return;
  setApiKey.value = state.settings.providerKeys[base] || "";
  const m = state.settings.providerModels[base];
  if (m) setModel.value = m;
}

$("#btnKeyEye").onclick = () => {
  const show = setApiKey.type === "password";
  setApiKey.type = show ? "text" : "password";
  $("#btnKeyEye").textContent = show ? "🙈" : "👁";
};

$("#btnSave").onclick = () => {
  const base = setBaseUrl.value.trim().replace(/\/+$/, "");
  const key = setApiKey.value.trim();
  const model = setModel.value.trim();
  if (base) {  // remember per provider so switching back auto-fills
    state.settings.providerKeys[base] = key;
    state.settings.providerModels[base] = model;
  }
  Object.assign(state.settings, {
    baseUrl: base,
    apiKey: key,
    model,
    temperature: Number(setTemp.value),
    tempAuto: setTempAuto.checked,
    replyLang: setReplyLang.value,
    translateTo: setTranslateTo.value,
    tavilyKey: setTavilyKey.value.trim(),
    explainPrompt: setExplainPrompt.value,
  });
  LS.set("er.settings", state.settings);
  modalBack.classList.add("hidden");
  setStreamingUI(false);
  toast("设置已保存。");
};
$("#btnCancel").onclick = () => modalBack.classList.add("hidden");
modalBack.addEventListener("click", e => { if (e.target === modalBack) modalBack.classList.add("hidden"); });
$("#btnSettings").onclick = openSettings;

$("#btnFetchModels").onclick = async () => {
  const base = setBaseUrl.value.trim().replace(/\/+$/, "");
  if (!base) return toast("请先填写接口地址。", true);
  const btn = $("#btnFetchModels");
  btn.disabled = true; btn.textContent = "获取中…";
  try {
    const qs = new URLSearchParams({ baseUrl: base, apiKey: setApiKey.value.trim() });
    const res = await fetch("/api/models?" + qs);
    const j = await res.json();
    const ids = ((j.data || []) || []).map(m => m.id || m.name).filter(Boolean);
    if (!ids.length) throw new Error("no models returned");
    const dl = $("#modelList");
    dl.replaceChildren();
    ids.slice(0, 300).forEach(id => {
      const o = document.createElement("option");
      o.value = id; dl.appendChild(o);
    });
    if (!ids.includes(setModel.value)) setModel.value = ids[0];
    toast(`已获取 ${ids.length} 个模型。`);
  } catch (err) {
    toast("获取模型列表失败：" + err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "获取模型列表";
  }
};

$("#btnTest").onclick = async () => {
  const base = setBaseUrl.value.trim().replace(/\/+$/, "");
  const model = setModel.value.trim();
  if (!base || !model) return toast("请先填写接口地址和模型名称。", true);
  const btn = $("#btnTest");
  btn.disabled = true; btn.textContent = "测试中…";
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: base, apiKey: setApiKey.value.trim(), model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        max_tokens: 10,
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error((j.error && j.error.message) || `HTTP ${res.status}`);
    const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    toast(`连接成功 — 模型回复："${(txt || "").trim().slice(0, 40)}"`);
  } catch (err) {
    toast("连接失败：" + err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "测试连接";
  }
};

/* ============================== toolbar ============================== */
$("#btnOpen").onclick = () => $("#fileInput").click();
$("#fileInput").onchange = e => {
  const f = e.target.files[0];
  if (f) loadFile(f);
  e.target.value = "";
};

$("#btnTheme").onclick = () => {
  const order = ["sepia", "light", "dark"];
  const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
  state.settings.theme = next;
  applyPrefs();
  LS.set("er.settings", state.settings);
};
const THEME_ICON = { sepia: "☀", light: "◍", dark: "🌙" };

$("#btnFontUp").onclick = () => { state.settings.fontSize = Math.min(26, state.settings.fontSize + 1); applyPrefs(); LS.set("er.settings", state.settings); };
$("#btnFontDown").onclick = () => { state.settings.fontSize = Math.max(15, state.settings.fontSize - 1); applyPrefs(); LS.set("er.settings", state.settings); };

$("#btnTrToggle").onclick = () => {
  state.settings.showTr = !state.settings.showTr;
  applyPrefs();
  LS.set("er.settings", state.settings);
};

function toggleChat() {
  state.settings.chatOpen = !state.settings.chatOpen;
  applyPrefs();
  LS.set("er.settings", state.settings);
  if (state.settings.chatOpen) chatInput.focus();
}
$("#btnChatToggle").onclick = toggleChat;
$("#btnChatClose").onclick = toggleChat;

$("#btnSearchToggle").onclick = () => {
  state.settings.searchOn = !state.settings.searchOn;
  applyPrefs();
  LS.set("er.settings", state.settings);
  toast(state.settings.searchOn ? "Web search enabled — the assistant can now look things up." : "Web search off.");
};

function applyPrefs() {
  const s = state.settings;
  document.body.dataset.theme = s.theme;
  $("#btnTheme").textContent = THEME_ICON[s.theme] || "☀";
  document.body.style.setProperty("--fs", s.fontSize + "px");
  document.body.style.setProperty("--chatw", s.chatWidth + "px");
  document.body.classList.toggle("hide-tr", !s.showTr);
  $("#btnTrToggle").classList.toggle("active", s.showTr);
  $("#btnChatToggle").classList.toggle("active", s.chatOpen);
  document.body.classList.toggle("chat-closed", !s.chatOpen);
  $("#btnSearchToggle").classList.toggle("active", s.searchOn);
  setStreamingUI(state.streaming);
}

/* divider drag */
(() => {
  const divider = $("#divider");
  let dragging = false;
  divider.addEventListener("pointerdown", e => {
    dragging = true;
    divider.setPointerCapture(e.pointerId);
    document.body.style.userSelect = "none";
  });
  divider.addEventListener("pointermove", e => {
    if (!dragging) return;
    const w = Math.max(280, Math.min(window.innerWidth * 0.6, document.body.clientWidth - e.clientX));
    state.settings.chatWidth = Math.round(w);
    document.body.style.setProperty("--chatw", w + "px");
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    LS.set("er.settings", state.settings);
  };
  divider.addEventListener("pointerup", stop);
  divider.addEventListener("pointercancel", stop);
})();

/* chapter panel */
const chapterPanel = $("#chapterPanel");
$("#btnChapters").onclick = e => {
  e.stopPropagation();
  renderChapterPanel();
  chapterPanel.classList.toggle("hidden");
};
document.addEventListener("click", e => { if (!e.target.closest("#chapterPanel, #btnChapters")) chapterPanel.classList.add("hidden"); });

function renderChapterPanel() {
  if (!state.book) return;
  const list = $("#chapterList");
  list.replaceChildren();
  state.book.chapters.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "ch-item" + (i === state.chapterIdx ? " current" : "");
    b.textContent = `${i + 1}. ${c.title}`;
    b.onclick = () => { chapterPanel.classList.add("hidden"); gotoChapter(i); };
    list.appendChild(b);
  });
  const cur = list.children[state.chapterIdx];
  if (cur) cur.scrollIntoView({ block: "center" });
}

/* tip bar */
$("#tipClose").onclick = () => {
  $("#tipbar").classList.add("hidden");
  LS.set("er.tipShown", true);
};

/* scroll position save */
readerWrap.addEventListener("scroll", debounce(() => {
  if (!state.bookId) return;
  state.chapterScrolls[state.chapterIdx] = readerWrap.scrollTop;
  saveBookState();
}, 400));

/* drag & drop a book file */
["dragover", "drop"].forEach(ev => document.addEventListener(ev, e => {
  e.preventDefault();
  if (ev === "drop") {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  }
}));

/* ============================== init ============================== */
applyPrefs();
renderWelcome();
renderChat();
if (!state.settings.apiKey && !state.settings.baseUrl && !LS.get("er.introSeen", false)) {
  openSettings();
  LS.set("er.introSeen", true);
  setTimeout(() => toast("Welcome! Add your API key in Settings to start."), 250);
}
