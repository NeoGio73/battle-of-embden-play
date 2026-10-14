/* Browser Practice wrapper for The Battle of Embden. Saves stay in the browser; no LMS is contacted. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  let busy = true, pendingImport = null;
  const build = window.EMBDEN_BUILD_FILES;
  const gameControls = ['download-save', 'load-save', 'fullscreen', 'save-exit'];
  function setBusy(value) {
    busy = value;
    gameControls.forEach(id => { byId(id).disabled = value || EmbdenSave.details().ended; });
  }
  window.EmbdenShowMessage = function (title, body) {
    byId('message-title').textContent = title;
    byId('message-body').textContent = body;
    if (!byId('message-dialog').open) byId('message-dialog').showModal();
  };
  function askUnityForCheckpoint() {
    if (!window.embdenUnity || busy || EmbdenSave.details().ended) return;
    window.embdenUnity.SendMessage('EmbdenGame', 'SaveProgress');
  }
  function downloadSave() {
    let checkpointWarning = '';
    try { askUnityForCheckpoint(); }
    catch (_) { checkpointWarning = 'The game could not provide a fresh checkpoint. This file contains the last retained progress and may omit your latest change.'; }
    const contents = EmbdenSave.exportSave();
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Battle-of-Embden-Save-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return checkpointWarning;
  }
  byId('download-save').addEventListener('click', () => {
    try {
      const warning = downloadSave();
      EmbdenShowMessage('Save file requested', (warning ? warning + '\n\n' : '') + 'Check your browser’s downloads for Battle-of-Embden-Save…json. Keep this file as a backup, or choose Load Save in the game on another computer. If your browser asks whether to keep the file, allow the download.');
    } catch (error) { EmbdenShowMessage('Save file unavailable', error.message); }
  });
  byId('backup-before-load').addEventListener('click', () => {
    try { const warning = downloadSave(); byId('import-error').hidden = false; byId('import-error').textContent = (warning ? warning + ' ' : '') + 'Download requested. Check your downloads before replacing this progress.'; }
    catch (error) { byId('import-error').hidden = false; byId('import-error').textContent = error.message; }
  });
  byId('load-save').addEventListener('click', () => { byId('save-file').value = ''; byId('save-file').click(); });
  byId('save-file').addEventListener('change', async () => {
    const file = byId('save-file').files[0];
    if (!file || busy) return;
    try {
      if (file.size > 32768) throw new Error('This file is too large to be a Battle of Embden save. Choose a save downloaded from this game.');
      const text = await file.text();
      const preview = EmbdenSave.inspectSave(text);
      askUnityForCheckpoint();
      const current = EmbdenSave.report();
      pendingImport = text;
      byId('import-summary').textContent = 'Selected save: ' + preview.stages + '/4 stages complete · ' + preview.questions + '/66 questions cleared.' +
        '\nSaved: ' + (preview.savedAt ? new Date(preview.savedAt).toLocaleString() : 'Date unavailable') +
        '\n\nCurrent game: ' + (current.currentStages || 0) + '/4 stages · ' + (current.currentQuestions || 0) + '/66 questions.';
      byId('import-error').hidden = true;
      byId('import-dialog').showModal();
    } catch (error) { pendingImport = null; EmbdenShowMessage('Save file not loaded', error.message + '\n\nYour current progress has not been replaced.'); }
  });
  byId('cancel-load').addEventListener('click', () => byId('import-dialog').close());
  byId('import-dialog').addEventListener('close', () => { pendingImport = null; });
  byId('confirm-load').addEventListener('click', async () => {
    if (!pendingImport || busy) return;
    const selected = pendingImport;
    try {
      askUnityForCheckpoint();
      // The bridge holds old Unity writes before Quit can emit its final checkpoint.
      EmbdenSave.applyImport(selected);
      setBusy(true);
      byId('import-dialog').close();
      byId('loading').hidden = false;
      byId('loading-label').textContent = 'RESTORING YOUR MISSION RECORD';
      const oldInstance = window.embdenUnity;
      window.embdenUnity = null;
      if (oldInstance) await oldInstance.Quit();
      const freshCanvas = document.createElement('canvas');
      freshCanvas.id = 'unity-canvas'; freshCanvas.tabIndex = 0;
      freshCanvas.setAttribute('aria-label', 'The Battle of Embden, a glycolysis practice game.');
      byId('unity-canvas').replaceWith(freshCanvas);
      EmbdenSave.resumeAfterImport();
      await startGame();
      EmbdenShowMessage('Mission record loaded', 'Your selected save is now open.\n\n' + EmbdenSave.status());
    } catch (error) {
      if (busy) loadFailure('The selected save could not be opened. ' + error.message + ' Keep your downloaded save file so you can load it again.');
      else { byId('import-error').hidden = false; byId('import-error').textContent = error.message; }
    }
  });
  byId('help').addEventListener('click', () => EmbdenShowMessage('Your mission record',
    'Take the bunker: three assaults over the ten steps of glycolysis, then the fate of pyruvate, with unlimited hints and retries.\n\nExtra credit: answer all 66 questions in one visit. The completion screen then unlocks a certificate: type your name as it appears in D2L, download the picture and upload it to the D2L assignment folder. The certificate count starts over when the page is closed or reloaded; progress saved from earlier visits does not count toward it.\n\nAutosave remembers progress in this browser profile at this activity address. It does not use your D2L account and does not move automatically between computers. Private browsing, clearing site data, or a lab computer reset can remove it.\n\nDownload Save keeps a portable backup. Load Save lets you select that file and review it before replacing your current game. On a shared computer, load your own save before playing; the browser save may belong to someone else.\n\nUse Save & exit before closing. If browser saving is unavailable, Download Save still lets you keep your progress. Press Esc to leave full screen and reach these controls.\n\nModels: AT-ST Scout by Sean Turner (BlenderKit, Royalty Free); speeder bike by Idmenthal (Sketchfab, CC BY 4.0); rider from “Obi Wan rig”, posted by maxigrec (Sketchfab, listed as CC BY 4.0); Chewbacca, posted by Stym (Sketchfab, listed as CC BY 4.0); Ewok by Ulrik S. Selvik (Sketchfab, CC BY 4.0); Endor bunker by aclarke064 (Sketchfab, CC BY-NC-SA 4.0). Unofficial fan learning game, not affiliated with Lucasfilm or Disney.'));
  byId('save-details').addEventListener('click', () => {
    const info = EmbdenSave.report();
    EmbdenShowMessage('Save details', EmbdenSave.status() +
      '\n\nCurrent mission record: ' + (info.currentStages || 0) + '/4 stages · ' + (info.currentQuestions || 0) + '/66 questions cleared · ' + (info.currentFirstTry || 0) + ' on the first try' +
      '\nLast browser save: ' + (info.lastSavedAt ? new Date(info.lastSavedAt).toLocaleString() : 'No confirmed save this session') +
      '\n\nDownload Save keeps a separate backup. Progress is not linked to a D2L account or gradebook.\nBrowser edition 1.1.0');
  });
  byId('save-exit').addEventListener('click', () => {
    try {
      askUnityForCheckpoint();
      if (EmbdenSave.finish()) {
        setBusy(true);
        document.querySelector('main').inert = true;
        byId('unity-canvas').style.opacity = '.35';
        byId('save-exit').textContent = 'Saved';
        EmbdenShowMessage('Saved in this browser', 'Your progress is saved here. You may close this tab and return to your course. Reopen the same activity in this browser profile to continue.');
        byId('download-save').disabled = false;
      } else EmbdenShowMessage('Keep a save file before leaving', EmbdenSave.status() + '\n\nUse Download Save to keep this progress. Keep this tab open until you have the file.');
    } catch (error) { EmbdenShowMessage('Save needs attention', error.message + '\nUse Download Save before leaving.'); }
  });
  byId('fullscreen').addEventListener('click', () => { if (!busy && window.embdenUnity) window.embdenUnity.SetFullscreen(1); });
  byId('retry').addEventListener('click', () => location.reload());
  function loadFailure(message) {
    byId('loading').hidden = false;
    byId('load-error').hidden = false;
    byId('load-error').textContent = 'The game could not start. ' + String(message || '') + ' Try a current desktop browser. If this continues, ask your instructor to check the game files.';
    byId('loading-label').textContent = 'MISSION NEEDS ATTENTION';
    byId('retry').hidden = false;
    // Allow saving the retained checkpoint even when the Unity renderer cannot start.
    byId('download-save').disabled = false;
  }
  async function startGame() {
    setBusy(true);
    byId('loading').hidden = false; byId('load-error').hidden = true; byId('retry').hidden = true;
    const config = { dataUrl: build.dataUrl, frameworkUrl: build.frameworkUrl, codeUrl: build.codeUrl,
      streamingAssetsUrl: build.streamingAssetsUrl || 'StreamingAssets', companyName: 'Battle of Embden',
      productName: 'The Battle of Embden', productVersion: '1.1.0-browser', backgroundColor: '#050b16',
      showBanner: (text, type) => { if (type === 'error') loadFailure(text); } };
    const instance = await createUnityInstance(byId('unity-canvas'), config, progress => {
      const value = Math.round(progress * 100);
      byId('progress-fill').style.width = value + '%';
      document.querySelector('.progress').setAttribute('aria-valuenow', String(value));
      byId('loading-label').textContent = 'LOADING THE MISSION · ' + value + '%';
    });
    window.embdenUnity = instance;
    byId('loading').hidden = true; setBusy(false); byId('unity-canvas').focus();
  }
  const initial = EmbdenSave.init();
  if (EmbdenSave.details().warning) EmbdenShowMessage('Browser save needs attention', initial.status + '\n\nYou can still play and use Download Save to keep a file.');
  const loader = document.createElement('script'); loader.src = build.loaderUrl;
  loader.onerror = () => loadFailure('The Unity loader file is unavailable.');
  loader.onload = () => startGame().catch(error => loadFailure(error.message));
  document.body.appendChild(loader);
})();
