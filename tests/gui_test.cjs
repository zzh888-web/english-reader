/* Black-box GUI test for English Reader using real Chromium via Playwright.
   Run:  node tests/gui_test.cjs  (from english-reader/)  */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8765";
const SHOTS = path.join(__dirname, "gui-shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const consoleErrors = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || "" });
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  -- " + extra : ""));
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false });
const waitIdle = page => page.waitForFunction(
  () => document.getElementById("btnSend") && document.getElementById("btnSend").textContent === "Send",
  undefined, { timeout: 30000 });

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  // ---- env prep: pre-seed settings pointing at the local mock LLM ----
  // replyLang stays "English" on purpose: simulates a pre-existing user whose
  // stored settings must be migrated to the new Chinese default.
  await context.addInitScript(() => {
    localStorage.setItem("er.settings", JSON.stringify({
      providerIdx: 0, baseUrl: "http://127.0.0.1:8766/v1", apiKey: "test-key", model: "mock-gpt",
      temperature: 0.7, replyLang: "English", translateTo: "Chinese",
      theme: "sepia", fontSize: 19, chatWidth: 420, showTr: true, chatOpen: true,
    }));
    localStorage.setItem("er.introSeen", "true");
  });

  const page = await context.newPage();
  page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded" });

  // ---------- T0 migration: stored "English" flips to Chinese default ----------
  const migratedLang = await page.evaluate(() => (JSON.parse(localStorage.getItem("er.settings") || "{}").replyLang));
  check("T0 stored replyLang migrated to Chinese", migratedLang === "Chinese", String(migratedLang));

  // ---------- T1 welcome + sample book ----------
  await shot(page, "t1_welcome");
  check("T1 welcome screen shows", await page.locator("#wlSample").count() === 1);
  await page.click("#wlSample");
  await page.waitForSelector(".s[data-i]");
  await page.click("#chNext"); // front matter -> chapter 1 body
  await page.waitForTimeout(300);
  await shot(page, "t1_sample_loaded");
  check("T1 sample book renders sentences", await page.locator(".s").count() > 10,
        "spans=" + await page.locator(".s").count());

  // ---------- T2 right-click context menu ----------
  await page.locator('.s[data-i="1"]').click({ button: "right" });
  await page.waitForSelector("#ctxMenu:not(.hidden)");
  const menuItems = await page.locator("#ctxMenu .ctx-item").allTextContents();
  await shot(page, "t2_context_menu");
  check("T2 menu items", /Translate sentence/.test(menuItems.join("|")) && /Explain/.test(menuItems.join("|")),
        JSON.stringify(menuItems.map(s => s.trim())));

  // ---------- T3 translate a sentence ----------
  await page.locator(".ctx-item", { hasText: "Translate sentence" }).click();
  await page.waitForFunction(() => {
    const t = document.querySelector('.tr[data-for="1"] .tr-text');
    return t && !/Translating/.test(t.textContent) && t.textContent.trim().length > 0;
  }, undefined, { timeout: 15000 });
  const trText = await page.locator('.tr[data-for="1"] .tr-text').textContent();
  const trBelow = await page.locator('.s[data-i="1"] ~ .tr[data-for="1"], .tr[data-for="1"]').first().evaluate(
    el => el.getBoundingClientRect().top > el.previousElementSibling.getBoundingClientRect().bottom - 5);
  await shot(page, "t3_translation_below_sentence");
  check("T3 mock translation inserted", /模拟翻译/.test(trText), trText.trim().slice(0, 30));
  check("T3 translation sits below the English sentence", trBelow === true);
  check("T3 sentence carries has-tr pairing mark", await page.locator('.s[data-i="1"].has-tr').count() === 1);

  // ---------- T4 persistence across reload ----------
  await page.waitForTimeout(700); // let any debounced save settle
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#wlSample");
  await page.waitForSelector('.tr[data-for="1"] .tr-text', { timeout: 8000 });
  const trAfter = await page.locator('.tr[data-for="1"] .tr-text').textContent();
  await shot(page, "t4_translation_restored");
  check("T4 translation persists after reload", /模拟翻译/.test(trAfter));

  // ---------- T5 explain -> chat panel ----------
  await page.locator('.s[data-i="1"]').click({ button: "right" });
  await page.waitForSelector("#ctxMenu:not(.hidden)");
  await page.locator(".ctx-item", { hasText: "Explain" }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll("#chatMessages .msg.assistant").length > 0 &&
    /mock explanation/i.test(document.querySelector("#chatMessages .msg.assistant:last-child .body").textContent || ""),
    undefined, { timeout: 20000 });
  await waitIdle(page);
  const exCard = await page.locator("#chatMessages .msg.user .ex-quote .ex-text").first().textContent();
  await shot(page, "t5_explain_in_chat");
  check("T5 explain streamed into chat", true);
  check("T5 quoted passage shown in a prominent card", /Alice was beginning/.test(exCard), exCard.slice(0, 40));

  // ---------- T10 custom explanation prompt round trip ----------
  await page.click("#btnSettings");
  await page.waitForSelector("#settingsModal:not(.hidden)");
  await page.fill("#setExplainPrompt", "CUSTOM-MARKER Passage under test: {TEXT} | ctx: {CONTEXT}");
  await page.click("#btnSave");
  await page.locator('.s[data-i="1"]').click({ button: "right" });
  await page.waitForSelector("#ctxMenu:not(.hidden)");
  await page.locator(".ctx-item", { hasText: "Explain" }).click();
  await page.waitForFunction(() => {
    const bodies = document.querySelectorAll("#chatMessages .msg.assistant .body");
    const last = bodies[bodies.length - 1];
    const done = document.getElementById("btnSend").textContent === "Send";
    return done && last && /Received prompt:/.test(last.textContent || "")
      && /Alice was beginning/.test(last.textContent || "");
  }, undefined, { timeout: 30000 });
  const echoed = await page.locator("#chatMessages .msg.assistant .body").last().textContent();
  await shot(page, "t10_custom_prompt");
  check("T10 custom prompt reaches the model with {TEXT} replaced",
    /CUSTOM-MARKER/.test(echoed) && /Alice was beginning/.test(echoed) && !/\{TEXT\}/.test(echoed),
    echoed.slice(0, 60));
  // restore built-in prompt
  await page.click("#btnSettings");
  await page.waitForSelector("#settingsModal:not(.hidden)");
  await page.fill("#setExplainPrompt", "");
  await page.click("#btnSave");

  // ---------- T6 free chat with streaming ----------
  await waitIdle(page); // wait for the explain stream to fully finish
  await page.fill("#chatInput", "What does the White Rabbit symbolize?");
  await page.press("#chatInput", "Enter");
  await page.waitForFunction(() =>
    /Mock reply/.test(document.querySelector("#chatMessages .msg.assistant:last-child .body")?.textContent || ""),
    undefined, { timeout: 20000 });
  await shot(page, "t6_chat_reply");
  check("T6 chat reply streamed", true);

  // ---------- T7 EPUB open + chapters + translate ----------
  await page.setInputFiles("#fileInput", path.join(__dirname, "assets", "test-book.epub"));
  await page.waitForFunction(() => /Test Edition/.test(document.getElementById("bookTitle").textContent), { timeout: 10000 });
  await page.waitForSelector(".s[data-i]");
  await shot(page, "t7_epub_loaded");
  check("T7 epub title read from OPF metadata", /Alice in Wonderland — Test Edition/.test(await page.locator("#bookTitle").textContent()));

  await page.click("#btnChapters");
  await page.waitForSelector("#chapterPanel:not(.hidden)");
  const chTitles = (await page.locator("#chapterList .ch-item").allTextContents()).join("|");
  await shot(page, "t7_chapter_panel");
  check("T7 epub TOC labels from nav.xhtml", /The Pool of Tears/.test(chTitles) && /A Caucus-Race/.test(chTitles), chTitles);

  await page.locator("#chapterList .ch-item", { hasText: "A Caucus-Race" }).click();
  await page.waitForFunction(() => /A Caucus-Race/.test(document.querySelector("#reader h3")?.textContent || ""));
  const epubSent = await page.locator(".s[data-i]").first().textContent();
  await page.locator(".s[data-i]").first().click({ button: "right" });
  await page.waitForSelector("#ctxMenu:not(.hidden)");
  await page.locator(".ctx-item", { hasText: "Translate" }).first().click();
  await page.waitForFunction(() => {
    const t = document.querySelector(".tr .tr-text");
    return t && !/Translating/.test(t.textContent) && t.textContent.trim().length > 0;
  }, undefined, { timeout: 15000 });
  await shot(page, "t7_epub_translation");
  check("T7 epub chapter nav + translation works", true, epubSent.slice(0, 40));

  // ---------- T8 theme + hide translations ----------
  await page.click("#btnTheme"); // sepia -> light
  await page.click("#btnTheme"); // light -> dark
  await page.click("#btnTrToggle"); // hide translations
  const trHidden = await page.locator(".tr").first().evaluate(el => getComputedStyle(el).display === "none");
  await shot(page, "t8_dark_hidden_tr");
  check("T8 dark theme applied", await page.locator("body[data-theme='dark']").count() === 1);
  check("T8 translations hidden on toggle", trHidden === true);
  await page.click("#btnTrToggle"); // restore

  // ---------- T9 web search tool loop ----------
  await waitIdle(page);
  await page.click("#btnSearchToggle");
  check("T9 search toggle activates", (await page.locator("#btnSearchToggle.active").count()) === 1);
  await page.fill("#chatInput", "Tell me about the author of this book.");
  await page.press("#chatInput", "Enter");
  await page.waitForFunction(() =>
    document.querySelectorAll("#chatMessages .msg.search-line").length > 0,
    undefined, { timeout: 30000 });
  await shot(page, "t9_searching");
  await page.waitForFunction(() => {
    const bodies = document.querySelectorAll("#chatMessages .msg.assistant .body");
    const last = bodies[bodies.length - 1];
    const btn = document.getElementById("btnSend").textContent;
    return btn === "Send" && last && /Search-informed mock answer/.test(last.textContent || "");
  }, undefined, { timeout: 45000 });
  await shot(page, "t9_web_search_answer");
  const searchLine = await page.locator("#chatMessages .msg.search-line").last().textContent();
  check("T9 model called web_search tool", /web_search/.test(searchLine), searchLine.trim().slice(0, 60));
  check("T9 search-informed answer rendered", true);
  await page.click("#btnSearchToggle"); // back to off

  // ---------- T11 per-provider API key memory ----------
  await page.click("#btnSettings");
  await page.waitForSelector("#settingsModal:not(.hidden)");
  await page.fill("#setApiKey", "key-A-111");
  await page.click("#btnSave"); // save mock provider with key-A
  await page.click("#btnSettings");
  await page.waitForSelector("#settingsModal:not(.hidden)");
  await page.selectOption("#setProvider", "1"); // -> OpenAI preset
  await page.waitForTimeout(200);
  const afterSwitch = {
    baseUrl: await page.inputValue("#setBaseUrl"),
    apiKey: await page.inputValue("#setApiKey"),
    model: await page.inputValue("#setModel"),
  };
  check("T11 switching provider clears key and fills preset model",
    /api\.openai\.com/.test(afterSwitch.baseUrl) && afterSwitch.apiKey === "" && afterSwitch.model === "gpt-4o-mini",
    JSON.stringify(afterSwitch));
  await page.fill("#setApiKey", "key-B-222");
  await page.click("#btnSave"); // save OpenAI with key-B
  await page.click("#btnSettings");
  await page.waitForSelector("#settingsModal:not(.hidden)");
  await page.fill("#setBaseUrl", "http://127.0.0.1:8766/v1");
  await page.locator("#setModel").click(); // blur -> change event -> autofill
  await page.waitForFunction(() => document.getElementById("setApiKey").value === "key-A-111",
    undefined, { timeout: 5000 });
  const restored = {
    apiKey: await page.inputValue("#setApiKey"),
    model: await page.inputValue("#setModel"),
  };
  const stored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("er.settings") || "{}");
    return s.providerKeys || {};
  });
  await shot(page, "t11_provider_key_memory");
  check("T11 switching back auto-restores the first provider's key and model",
    restored.apiKey === "key-A-111" && restored.model === "mock-gpt", JSON.stringify(restored));
  check("T11 both keys stored per provider",
    stored["http://127.0.0.1:8766/v1"] === "key-A-111" && stored["https://api.openai.com/v1"] === "key-B-222",
    JSON.stringify(stored));
  await page.click("#btnSave"); // restore mock as active provider

  // ---------- results ----------
  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log("\n==== SUMMARY ====");
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  if (consoleErrors.length) {
    console.log("\nconsole errors:");
    consoleErrors.forEach(e => console.log("  - " + e.slice(0, 200)));
  } else {
    console.log("console errors: none");
  }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("FATAL:", e.message); process.exit(2); });
