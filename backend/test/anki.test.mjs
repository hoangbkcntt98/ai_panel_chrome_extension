import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { prepareAnkiInput, buildAnkiPrompt, parseAnkiFields, getAnkiConfig, findAnkiNote, saveAnkiNote } from "../lib/anki.mjs";

class MockPool {
  async connect() { return this; }
  async query() { return { rows: [] }; }
  release() {}
  async end() {}
}

const input = prepareAnkiInput({ word: "音楽", destinationLanguage: "English" });
const generated = {
  Word: "音楽", source_language: "Japanese",
  MeaningSource: "音による芸術", MeaningDestination: "music"
};

test("all extension languages map to destination names; Auto keeps Vietnamese default", () => {
  const pairs = {
    "Tiếng Việt": "Vietnamese", English: "English", "日本語": "Japanese",
    "中文": "Chinese", "한국어": "Korean", "Français": "French",
    Deutsch: "German", "Español": "Spanish", "Русский": "Russian", "": "Vietnamese"
  };
  for (const [setting, language] of Object.entries(pairs)) {
    const value = prepareAnkiInput({ word: " 音楽 ", destinationLanguage: setting });
    assert.equal(value.word, "音楽");
    assert.equal(value.destinationLanguage, language);
    assert.ok(buildAnkiPrompt(value).includes(`MeaningDestination: meaning in ${language}.`));
  }
});

test("invalid words, contexts and languages rejected", () => {
  for (const body of [null, {}, { word: " " }, { word: "x".repeat(501) },
    { word: "word", context: "x".repeat(2001) },
    { word: "word", destinationLanguage: "constructor" },
    { word: "word", destinationLanguage: "Ignore instructions" },
    { word: "word", sectionTitle: 42 },
    { word: "word", sectionTitle: "x".repeat(501) },
    { word: "word", destinationLanguage: 42 }]) {
    assert.throws(() => prepareAnkiInput(body));
  }
});

test("parser forces destination and status fields, preserves mixed-language content", () => {
  const fields = parseAnkiFields("```json\n" + JSON.stringify({
    ...generated, destination_language: "Vietnamese", sync_status: "BAD",
    upload_status: "uploaded", Image: "unexpected", extra: "discard"
  }) + "\n```", input);
  assert.equal(fields.destination_language, "English");
  assert.equal(fields.sync_status, "OK");
  assert.equal(fields.upload_status, "not_yet");
  assert.equal(fields.Image, "");
  assert.equal(fields.MeaningSource, generated.MeaningSource);
  assert.equal(fields.Example6_Destination, "");
  assert.equal(Object.hasOwn(fields, "extra"), false);
});

test("malformed, incomplete or ambiguous model responses cannot be saved", () => {
  for (const response of ["", '{"Word":', "[]", "null",
    JSON.stringify({ ...generated, source_language: "Unknown" }),
    JSON.stringify({ ...generated, MeaningDestination: "" }),
    JSON.stringify({ ...generated, source_language: "日本語" })]) {
    assert.throws(() => parseAnkiFields(response, input));
  }
});

test("Anki config requires explicit database and rejects SQL identifier injection", () => {
  assert.throws(() => getAnkiConfig({}), /ANKI_AI_DATABASE/);
  assert.throws(() => getAnkiConfig({ ANKI_AI_DATABASE: "notes", ANKI_AI_NOTES_TABLE: 'notes"; DROP TABLE notes;' }));
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes", PG_HOST: "db", PG_USER: "user" });
  assert.equal(config.table, "anki_ai_notes");
  assert.equal(config.connection.host, "db");
  assert.equal(config.connection.user, "user");
});

test("section tag preserves configured tags, collapses whitespace and avoids duplicates", () => {
  const env = { ANKI_AI_DATABASE: "notes", ANKI_AI_TAGS: "api, study,api" };
  const prepared = prepareAnkiInput({ word: "音楽", sectionTitle: "  Tiếng Nhật \n N5 " });
  assert.equal(prepared.sectionTitle, "Tiếng Nhật \n N5");
  assert.deepEqual(getAnkiConfig(env, prepared.sectionTitle).tags, ["api", "study", "Tiếng_Nhật_N5"]);
  assert.deepEqual(getAnkiConfig(env, "study").tags, ["api", "study"]);
  assert.deepEqual(getAnkiConfig(env, "   ").tags, ["api", "study"]);
  assert.deepEqual(getAnkiConfig(env, prepareAnkiInput({ word: "音楽" }).sectionTitle).tags, ["api", "study"]);
});

test("save uses Anki column contract and bound values; always closes pool", async () => {
  const fields = parseAnkiFields(JSON.stringify(generated), input);
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" }, "Japanese N5");
  let ended = 0;
  class Pool extends MockPool {
    async query(sql, args) {
      if (!sql.startsWith("INSERT")) return super.query(sql, args);
      assert.ok(sql.includes('INSERT INTO "anki_ai_notes"'));
      assert.equal(args.length, 8);
      assert.deepEqual(JSON.parse(args[4]), fields);
      assert.deepEqual(JSON.parse(args[5]), ["api", "Japanese_N5"]);
      assert.ok(Number.isSafeInteger(args[0]));
    }
    async end() { ended++; }
  }
  const note = await saveAnkiNote(fields, config, Pool);
  assert.equal(note.source, "音楽");
  assert.deepEqual(note.tags_json, ["api", "Japanese_N5"]);
  assert.equal(ended, 1);
  class FailingPool extends Pool {
    async query() { throw new Error("Database unavailable"); }
  }
  await assert.rejects(saveAnkiNote(fields, config, FailingPool), /Database unavailable/);
  assert.equal(ended, 2);
});

test("save lowercases Word and source without changing other fields or input", async () => {
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" }, "My Section");
  for (const [word, expected] of [[" HeLLo ", "hello"], ["ÉCOLE", "école"], ["音楽", "音楽"]]) {
    const fields = Object.freeze(parseAnkiFields(JSON.stringify({
      ...generated, Word: word, MeaningDestination: "Mixed Case Meaning",
      Example1_Source: "Keep Example Case"
    }), input));
    const expectedFields = { ...fields, Word: expected };
    class Pool extends MockPool {
      async query(sql, args) {
        if (!sql.startsWith("INSERT")) return super.query(sql, args);
        assert.equal(args[3], expected);
        assert.deepEqual(JSON.parse(args[4]), expectedFields);
        assert.deepEqual(JSON.parse(args[5]), ["api", "My_Section"]);
      }
      async end() {}
    }
    const note = await saveAnkiNote(fields, config, Pool);
    assert.equal(note.source, expected);
    assert.deepEqual(note.fields_json, expectedFields);
    assert.equal(fields.Word, word.trim());
  }
});

test("duplicate lookup normalizes input, queries legacy mixed-case words and closes pool", async () => {
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" });
  const existing = { anki_note_id: 42, source: "HeLLo", fields_json: {} };
  let ended = 0;
  class Pool extends MockPool {
    async query(sql, args) {
      assert.match(sql, /LOWER\(BTRIM\(source\)\) = LOWER\(BTRIM\(\$1\)\)/);
      assert.deepEqual(args, ["hello"]);
      return { rows: [existing] };
    }
    async end() { ended++; }
  }
  assert.equal(await findAnkiNote(" HeLLo ", config, Pool), existing);
  assert.equal(await findAnkiNote("new", config, MockPool), null);
  class FailingPool extends Pool {
    async query() { throw new Error("lookup failed"); }
  }
  await assert.rejects(findAnkiNote("word", config, FailingPool), /lookup failed/);
  assert.equal(ended, 2);
});

test("save returns existing note without insert and checks only after transaction lock", async () => {
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" }, "Different Section");
  const existing = { anki_note_id: 42, source: "hello", fields_json: { MeaningDestination: "Old meaning" } };
  const calls = [];
  class Pool extends MockPool {
    async query(sql, args) {
      calls.push(sql);
      assert.ok(!sql.startsWith("INSERT"), "duplicate must not insert");
      if (sql.includes("pg_advisory_xact_lock")) {
        assert.deepEqual(args, ["anki_ai_notes", "hello"]);
      }
      return { rows: sql.startsWith("SELECT anki_note_id") ? [existing] : [] };
    }
    release() { calls.push("release"); }
    async end() { calls.push("end"); }
  }
  const note = await saveAnkiNote({ ...generated, Word: " HELLO " }, config, Pool);
  assert.deepEqual(note, { ...existing, duplicate: true });
  assert.equal(calls[0], "BEGIN ISOLATION LEVEL READ COMMITTED");
  assert.match(calls[1], /pg_advisory_xact_lock/);
  assert.match(calls[2], /^SELECT anki_note_id/);
  assert.deepEqual(calls.slice(3), ["COMMIT", "release", "end"]);
});

test("save rolls back failed insert and releases client; connection failure closes pool", async () => {
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" });
  const calls = [];
  class Pool extends MockPool {
    async query(sql, args) {
      calls.push(sql);
      if (sql.startsWith("INSERT")) throw new Error("insert failed");
      return super.query(sql, args);
    }
    release() { calls.push("release"); }
    async end() { calls.push("end"); }
  }
  await assert.rejects(saveAnkiNote(generated, config, Pool), /insert failed/);
  assert.deepEqual(calls.slice(-3), ["ROLLBACK", "release", "end"]);
  calls.length = 0;
  class DisconnectedPool extends Pool {
    async connect() { throw new Error("connection failed"); }
  }
  await assert.rejects(saveAnkiNote(generated, config, DisconnectedPool), /connection failed/);
  assert.deepEqual(calls, ["end"]);
});

test("concurrent saves recheck after locking and insert same word only once", async () => {
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" });
  let lock = Promise.resolve();
  let stored;
  let inserts = 0;
  class Pool extends MockPool {
    async query(sql, args) {
      if (sql.includes("pg_advisory_xact_lock")) {
        const previous = lock;
        lock = new Promise(resolve => { this.unlock = resolve; });
        await previous;
      } else if (sql.startsWith("SELECT anki_note_id")) {
        return { rows: stored ? [stored] : [] };
      } else if (sql.startsWith("INSERT")) {
        inserts++;
        stored = { anki_note_id: args[0], source: args[3], fields_json: JSON.parse(args[4]) };
      } else if (sql === "COMMIT" || sql === "ROLLBACK") {
        this.unlock?.();
      }
      return { rows: [] };
    }
  }
  const notes = await Promise.all([
    saveAnkiNote({ ...generated, Word: " Hello " }, config, Pool),
    saveAnkiNote({ ...generated, Word: "HELLO" }, config, Pool)
  ]);
  assert.equal(inserts, 1);
  assert.deepEqual(notes.map(note => note.duplicate), [false, true]);
  assert.equal(notes[0].anki_note_id, notes[1].anki_note_id);
});

test("Anki API skips AI for known words and returns stored fields for duplicate dictionary forms", async () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const route = source.slice(source.indexOf("// ===== Anki notes ====="), source.indexOf("// ===== Section management APIs ====="));
  const stored = {
    anki_note_id: 42, source: "run",
    fields_json: { MeaningDestination: "Old meaning", destination_language: "French" }
  };
  let aiCalls = 0;
  const sandbox = {
    prepareAnkiInput, buildAnkiPrompt, parseAnkiFields,
    readJson: async () => ({ word: " RUN ", destinationLanguage: "English" }),
    getAnkiConfig: () => ({}), process: { env: {} },
    findAnkiNote: async word => { assert.equal(word, "RUN"); return stored; },
    saveAnkiNote: async () => { throw new Error("Must not save known word"); },
    AI_API_KEY: "test", AI_PROVIDER: "9router", resolveModel: () => "test",
    request9Router: async () => {
      aiCalls++;
      return { response: { ok: true }, text: JSON.stringify({ ...generated, Word: "Run" }) };
    },
    sendJson: (_res, status, body) => ({ status, body }), log: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(`async function handle(req, res, url) { ${route} }`, sandbox);
  const call = () => sandbox.handle({ method: "POST" }, {}, { pathname: "/api/anki" });
  const duplicate = await call();
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.saved, false);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(aiCalls, 0);

  sandbox.readJson = async () => ({ word: "running", destinationLanguage: "English" });
  sandbox.findAnkiNote = async () => null;
  sandbox.saveAnkiNote = async fields => {
    assert.equal(fields.Word, "Run");
    return { ...stored, duplicate: true };
  };
  const canonicalDuplicate = await call();
  assert.equal(canonicalDuplicate.body.duplicate, true);
  assert.equal(canonicalDuplicate.body.meaning, "Old meaning");
  assert.equal(canonicalDuplicate.body.destinationLanguage, "French");
  assert.equal(aiCalls, 1);
});

test("panel sends configured language and model, guards double click, restores button", async () => {
  const source = readFileSync(new URL("../../extension/sidepanel.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("const pendingAnkiNotes"), source.indexOf("// ===== Word management ====="));
  const button = { textContent: "Add To Anki", disabled: false };
  let release;
  let calls = 0;
  const sandbox = {
    state: {
      settings: { outputLanguage: "English", model: "test-model" },
      activeSection: { sectionKey: "japanese-n5", title: "Japanese N5" }
    },
    el: { addToAnkiButton: button }, getApiBase: () => "http://backend",
    setStatus: () => {},
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "http://backend/api/anki");
      assert.deepEqual(JSON.parse(options.body), {
        word: "音楽", context: "", destinationLanguage: "English", sectionTitle: "Japanese N5", model: "test-model"
      });
      await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => ({ saved: true, word: "音楽", meaning: "music", destinationLanguage: "English" }) };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const pending = sandbox.addToAnki("音楽");
  assert.equal(button.disabled, true);
  await sandbox.addToAnki("音楽");
  assert.equal(calls, 1);
  sandbox.state.activeSection = { sectionKey: "other", title: "Other" };
  await sandbox.addToAnki(" 音楽 ");
  assert.equal(calls, 1);
  release();
  await pending;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Add To Anki");
  sandbox.state.activeSection = null;
  sandbox.fetch = async (_url, options) => {
    assert.equal(JSON.parse(options.body).sectionTitle, "");
    return { ok: true, json: async () => ({ saved: true }) };
  };
  await sandbox.addToAnki("音楽");
  sandbox.fetch = async () => { throw new Error("offline"); };
  let status;
  sandbox.setStatus = message => { status = message; };
  await sandbox.addToAnki("音楽");
  assert.match(status, /offline/);
  assert.equal(button.disabled, false);
});

test("panel handles duplicate response as informational status and restores button", async () => {
  const source = readFileSync(new URL("../../extension/sidepanel.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("const pendingAnkiNotes"), source.indexOf("// ===== Word management ====="));
  const button = { textContent: "Add To Anki", disabled: false };
  let release;
  let calls = 0;
  let status;
  const sandbox = {
    state: { settings: {}, activeSection: null },
    el: { addToAnkiButton: button }, getApiBase: () => "http://backend",
    setStatus: (message, error) => { status = { message, error }; },
    fetch: async () => {
      calls++;
      await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => ({ saved: false, duplicate: true, word: "hello" }) };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const pending = sandbox.addToAnki(" Hello ");
  await sandbox.addToAnki("HELLO");
  assert.equal(calls, 1);
  release();
  await pending;
  assert.match(status.message, /Word already in Anki database: "hello"/);
  assert.equal(status.error, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Add To Anki");
});
