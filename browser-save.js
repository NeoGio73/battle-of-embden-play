/* The Battle of Embden: device-only practice saves and portable progress files.
   The record mirrors ProgressData in Assets/Scripts/EmbdenData.cs: one bit per question in each of four stages. */
(function (root) {
  'use strict';
  if (root.EmbdenSave) return;
  var RELEASE = '1.0.0-browser', FORMAT = 'battle-of-embden-save', FORMAT_VERSION = 1;
  // Questions per stage: assault 1, assault 2, assault 3, the bunker.
  var COUNTS = [20, 20, 20, 6];
  var path = String(root.location && root.location.pathname || '/');
  var canonicalPath = /\/$/.test(path) ? path + 'index.html' : path;
  var STORAGE_KEY = 'battle-of-embden:browser-save:v1:' + canonicalPath;
  var initialized = false, ended = false, importPending = false, timer = null;
  var progress = freshProgress(), expectedRaw = null, baselineKnown = false, revision = 0;
  var dirty = false, saved = false, protectedSave = false, conflict = false, storageBlocked = false;
  var message = 'Preparing browser saves…', warning = false, lastSavedAt = null, lastError = null;
  var initialMetrics = { stages: 0, questions: 0, firstTry: 0 };

  function freshProgress() {
    return { version: 1, solved: [0, 0, 0, 0], missed: [0, 0, 0, 0], tries: 0,
      muted: false, music: true, volume: 0.45 };
  }
  function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
  function masks(list) {
    return Array.isArray(list) && list.length === COUNTS.length &&
      list.every(function (n, i) { return integer(n, 0, Math.pow(2, COUNTS[i]) - 1); });
  }
  function validateProgress(value) {
    if (!object(value) || value.version !== 1) throw new Error('This progress file uses an unsupported game version.');
    if (!masks(value.solved) || !masks(value.missed) || !integer(value.tries, 0, 2147483647) ||
        typeof value.muted !== 'boolean' || typeof value.music !== 'boolean' ||
        typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1)
      throw new Error('This progress file is incomplete or damaged. Your current progress has not been replaced.');
    // Copy only fields understood by Unity; never carry arbitrary imported properties forward.
    return { version: 1, solved: value.solved.slice(), missed: value.missed.slice(), tries: value.tries,
      muted: value.muted, music: value.music, volume: value.volume };
  }
  function parseJSON(text) {
    if (typeof text !== 'string' || text.length > 65536) throw new Error('Choose a Battle of Embden progress file smaller than 64 KB.');
    try { return JSON.parse(text); }
    catch (_) { throw new Error('This file is not readable JSON. Choose a downloaded Battle of Embden progress file.'); }
  }
  function readEnvelope(text, local) {
    var value = parseJSON(text);
    if (!object(value) || value.format !== FORMAT || value.formatVersion !== FORMAT_VERSION)
      throw new Error('Choose a supported Battle of Embden progress file.');
    if (typeof value.savedAt !== 'string' || value.savedAt.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt)))
      throw new Error('This progress file has an invalid save date.');
    var canonicalDate = value.savedAt.replace(/(?:\.(\d{1,3}))?Z$/, function (_, fraction) {
      return '.' + ((fraction || '') + '000').slice(0, 3) + 'Z';
    });
    if (new Date(Date.parse(value.savedAt)).toISOString() !== canonicalDate)
      throw new Error('This progress file has an invalid save date.');
    if (local && !integer(value.revision, 1, Number.MAX_SAFE_INTEGER)) throw new Error('Invalid browser save revision.');
    return { progress: validateProgress(value.progress), savedAt: value.savedAt, revision: local ? value.revision : 0 };
  }
  function bits(mask) { var n = 0; while (mask > 0) { n += mask & 1; mask = Math.floor(mask / 2); } return n; }
  function metrics(value) {
    var result = { stages: 0, questions: 0, firstTry: 0 };
    value.solved.forEach(function (mask, i) {
      if (mask === Math.pow(2, COUNTS[i]) - 1) result.stages++;
      result.questions += bits(mask);
      result.firstTry += bits(mask & ~value.missed[i]);
    });
    return result;
  }
  function details() {
    return { mode: 'browser', connected: false, ended: ended, importPending: importPending,
      status: metrics(progress).stages === COUNTS.length ? 'completed' : 'incomplete',
      saved: saved, message: message, warning: warning };
  }
  function notify(text, isWarning) {
    message = text; warning = !!isWarning;
    try {
      var el = root.document && root.document.getElementById('save-status');
      if (el) { el.textContent = text; el.dataset.warning = String(warning); }
      if (root.dispatchEvent && root.CustomEvent) root.dispatchEvent(new root.CustomEvent('embden-save-status', { detail: details() }));
    } catch (_) { /* UI notifications must not interrupt saving. */ }
  }
  function fail(code, text) { saved = false; lastError = code; notify(text, true); return false; }
  function unavailable() {
    storageBlocked = true;
    return fail('storage-unavailable', 'Browser saving is unavailable · download a save file before closing to keep your progress.');
  }
  function conflictFailure() {
    conflict = true;
    return fail('another-tab-changed-save', 'Another tab changed this browser save · download your current progress, then reload or load a save file.');
  }
  function ensureTimer() {
    if (timer === null && root.setInterval) timer = root.setInterval(function () { if (!ended && !importPending) flush(); }, 30000);
  }
  function init() {
    if (!initialized) {
      initialized = true;
      var raw;
      try { raw = root.localStorage.getItem(STORAGE_KEY); expectedRaw = raw; baselineKnown = true; }
      catch (_) { unavailable(); }
      if (baselineKnown && raw !== null) {
        try {
          var restored = readEnvelope(raw, true);
          progress = restored.progress; revision = restored.revision; lastSavedAt = restored.savedAt; saved = true;
          notify('Progress restored · autosaves in this browser. Download a save to keep a backup.', false);
        } catch (_) {
          protectedSave = true;
          fail('unreadable-browser-save', 'Existing browser save is unreadable and protected · load a backup, or download today’s progress before closing.');
        }
      } else if (baselineKnown) notify('Practice autosaves in this browser · download a save to keep a backup.', false);
      initialMetrics = metrics(progress);
      ensureTimer();
    }
    return { state: JSON.stringify(progress), status: message, connected: false };
  }
  function persist(importWrite) {
    if (ended || (importPending && !importWrite)) return false;
    if (protectedSave) return fail('unreadable-browser-save', 'Existing browser save is protected · load a backup, or download your current progress before closing.');
    if (conflict) return conflictFailure();
    var raw;
    try { raw = root.localStorage.getItem(STORAGE_KEY); }
    catch (_) { return unavailable(); }
    storageBlocked = false;
    if (!baselineKnown) {
      // A failed startup read must never silently overwrite an existing checkpoint after recovery.
      if (raw !== null) return conflictFailure();
      expectedRaw = null; baselineKnown = true;
    }
    if (raw !== expectedRaw) return conflictFailure();
    if (!dirty && saved) return true;
    var timestamp = new Date(Date.now()).toISOString();
    var nextRevision = revision < Number.MAX_SAFE_INTEGER ? revision + 1 : 1;
    var serialized = JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION,
      savedAt: timestamp, revision: nextRevision, progress: progress });
    try { root.localStorage.setItem(STORAGE_KEY, serialized); }
    catch (_) { return unavailable(); }
    expectedRaw = serialized; revision = nextRevision; dirty = false; saved = true;
    lastSavedAt = timestamp; lastError = null;
    notify('Progress saved in this browser · download a save for another device or a backup.', false);
    return true;
  }
  function flush() { if (!initialized) init(); if (ended) return saved; return persist(false); }
  function save(stateString) {
    if (!initialized) init();
    if (ended || importPending) return false;
    var next;
    try { next = validateProgress(parseJSON(stateString)); }
    catch (error) { return fail('invalid-game-progress', 'Progress was not saved: ' + error.message); }
    if (JSON.stringify(next) !== JSON.stringify(progress)) dirty = true;
    progress = next;
    return persist(false);
  }
  function finish() {
    if (importPending) return false;
    if (ended) return saved;
    if (!flush()) return false;
    ended = true;
    if (timer !== null && root.clearInterval) { root.clearInterval(timer); timer = null; }
    notify('Progress saved in this browser. You may close this window.', false);
    return true;
  }
  function saveAndExit() {
    if (importPending) return false;
    if (!ended && root.embdenUnity && typeof root.embdenUnity.SendMessage === 'function') {
      try { root.embdenUnity.SendMessage('EmbdenGame', 'SaveProgress'); }
      catch (_) { return fail('game-save-request-failed', 'Could not request the latest progress · keep this window open and try again.'); }
    }
    return finish();
  }
  function exportSave() {
    if (!initialized) init();
    return JSON.stringify({ format: FORMAT, formatVersion: FORMAT_VERSION,
      savedAt: new Date(Date.now()).toISOString(), progress: progress }, null, 2);
  }
  function inspectSave(text) {
    var parsed = readEnvelope(text, false), result = metrics(parsed.progress);
    result.savedAt = parsed.savedAt;
    return result;
  }
  function applyImport(text) {
    // Fully validate before initialization, mutation, or storage access.
    var parsed = readEnvelope(text, false), result = metrics(parsed.progress);
    if (!initialized) init();
    importPending = true; ended = false; protectedSave = false; conflict = false;
    progress = parsed.progress; dirty = true; saved = false; lastError = null;
    // Explicit Load Save is permission to replace the current browser checkpoint, including a damaged one.
    try { expectedRaw = root.localStorage.getItem(STORAGE_KEY); baselineKnown = true; }
    catch (_) { baselineKnown = false; expectedRaw = null; }
    result.savedAt = parsed.savedAt; result.persisted = persist(true);
    if (result.persisted) notify('Save file loaded and saved in this browser · restarting the game…', false);
    else if (storageBlocked) notify('Save file loaded for this session · browser saving is unavailable. Download a save before closing.', true);
    ensureTimer();
    return result;
  }
  function resumeAfterImport() {
    if (!importPending) return false;
    importPending = false; ended = false; ensureTimer();
    if (saved) notify('Save file loaded · progress saves in this browser.', false);
    return true;
  }
  function report() {
    var current = metrics(progress);
    return { release: RELEASE, mode: 'browser', connected: false, ended: ended,
      importPending: importPending, initialStages: initialMetrics.stages, initialQuestions: initialMetrics.questions,
      currentStages: current.stages, currentQuestions: current.questions, currentFirstTry: current.firstTry, lastSavedAt: lastSavedAt,
      storageBlocked: storageBlocked, protectedSave: protectedSave, conflict: conflict,
      saved: saved, lastError: lastError };
  }
  root.EmbdenSave = { init: init, save: save, status: function () { return message; }, details: details, report: report,
    flush: flush, finish: finish, saveAndExit: saveAndExit, exportSave: exportSave, inspectSave: inspectSave,
    applyImport: applyImport, resumeAfterImport: resumeAfterImport };
  if (root.addEventListener) {
    // Flush without ending the session: a frozen page can return from the back/forward cache.
    root.addEventListener('pagehide', function () { if (initialized && !ended && !importPending) flush(); });
    root.addEventListener('beforeunload', function () { if (initialized && !ended && !importPending) flush(); });
    root.addEventListener('storage', function (event) {
      if (!initialized || ended || importPending || (event.key !== STORAGE_KEY && event.key !== null)) return;
      if (event.key === null || event.newValue !== expectedRaw) conflictFailure();
    });
  }
})(window);
