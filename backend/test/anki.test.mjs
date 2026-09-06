import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { prepareAnkiInput, buildAnkiPrompt, parseAnkiFields, getAnkiConfig, saveAnkiNote } from "../lib/anki.mjs";

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

test("save uses Anki column contract and bound values; always closes pool", async () => {
  const fields = parseAnkiFields(JSON.stringify(generated), input);
  const config = getAnkiConfig({ ANKI_AI_DATABASE: "notes" });
  let ended = 0;
  class Pool {
    async query(sql, args) {
      assert.ok(sql.includes('INSERT INTO "anki_ai_notes"'));
      assert.equal(args.length, 8);
      assert.deepEqual(JSON.parse(args[4]), fields);
      assert.ok(Number.isSafeInteger(args[0]));
    }
    async end() { ended++; }
  }
  const note = await saveAnkiNote(fields, config, Pool);
  assert.equal(note.source, "音楽");
  assert.equal(ended, 1);
  class FailingPool extends Pool {
    async query() { throw new Error("Database unavailable"); }
  }
  await assert.rejects(saveAnkiNote(fields, config, FailingPool), /Database unavailable/);
  assert.equal(ended, 2);
});

test("panel sends configured language and model, guards double click, restores button", async () => {
  const source = readFileSync(new URL("../../extension/sidepanel.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("const pendingAnkiNotes"), source.indexOf("// ===== Word management ====="));
  const button = { textContent: "Add To Anki", disabled: false };
  let release;
  let calls = 0;
  const sandbox = {
    state: { settings: { outputLanguage: "English", model: "test-model" } },
    el: { addToAnkiButton: button }, getApiBase: () => "http://backend",
    setStatus: () => {},
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "http://backend/api/anki");
      assert.deepEqual(JSON.parse(options.body), {
        word: "音楽", context: "", destinationLanguage: "English", model: "test-model"
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
  release();
  await pending;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Add To Anki");
  sandbox.fetch = async () => { throw new Error("offline"); };
  let status;
  sandbox.setStatus = message => { status = message; };
  await sandbox.addToAnki("音楽");
  assert.match(status, /offline/);
  assert.equal(button.disabled, false);
});
