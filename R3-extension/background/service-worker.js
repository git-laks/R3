/**
 * R3 Background Service Worker
 * Handles message relay, tab management, and content script injection
 */

// State tracking
const state = {
  recordingTabId: null,
  playingTabId: null,
  steps: [],
  continueOnError: false,
  lastCompletedStepIndex: -1, // tracks playback progress for re-injection after navigation
  isSettingUp: false           // true while startPlayback is handling initial OPEN navigation
};

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  console.log('[R3] Extension installed');
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async responses
});

async function handleMessage(message, sender, sendResponse) {
  console.log('[R3] Background received:', message.type);

  try {
    switch (message.type) {
      case 'START_RECORDING':
        await startRecording(message.tabId);
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING':
        await stopRecording(message.tabId);
        sendResponse({ success: true });
        break;

      case 'STEP_RECORDED':
        // Store step in chrome.storage (popup receives this message directly)
        await saveRecordedStep(message.step);
        break;

      case 'START_PLAYBACK':
        // Respond immediately so the popup doesn't block waiting
        sendResponse({ success: true });
        await startPlayback(message.tabId, message.steps, message.continueOnError);
        break;

      case 'STOP_PLAYBACK':
        await stopPlayback();
        sendResponse({ success: true });
        break;

      case 'STEP_COMPLETE':
        // Track playback progress for re-injection after navigation
        state.lastCompletedStepIndex = message.index;
        forwardToPopup(message);
        break;

      case 'PLAYBACK_COMPLETE':
        state.playingTabId = null;
        state.lastCompletedStepIndex = -1;
        forwardToPopup(message);
        break;

      case 'NAVIGATE':
        await navigateTab(message.url, state.playingTabId);
        sendResponse({ success: true });
        break;

      default:
        console.log('[R3] Unknown message type:', message.type);
    }
  } catch (error) {
    console.error('[R3] Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Start recording on a tab
async function startRecording(tabId) {
  state.recordingTabId = tabId;

  // Inject selector utilities first
  await injectScript(tabId, 'utils/selectors.js');

  // Then inject recorder
  await injectScript(tabId, 'content/recorder.js');

  // Start recording
  await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });

  console.log('[R3] Recording started on tab', tabId);
}

// Stop recording
async function stopRecording(tabId) {
  if (state.recordingTabId) {
    try {
      await chrome.tabs.sendMessage(state.recordingTabId, { type: 'STOP_RECORDING' });
    } catch (e) {
      // Tab might be closed
      console.log('[R3] Could not send stop message to tab');
    }
  }
  state.recordingTabId = null;
  console.log('[R3] Recording stopped');
}

// Start playback
async function startPlayback(tabId, steps, continueOnError) {
  state.playingTabId = tabId;
  state.steps = steps;
  state.continueOnError = continueOnError;
  state.lastCompletedStepIndex = -1;

  try {
    // Handle first step if it's OPEN
    if (steps.length > 0 && steps[0].action.toUpperCase() === 'OPEN') {
      const url = steps[0].value;

      // Suppress re-injection handler during initial OPEN navigation
      state.isSettingUp = true;

      // Register load listener BEFORE navigating to avoid race condition
      const loadPromise = waitForTabLoad(tabId);
      await navigateTab(url, tabId);
      await loadPromise;

      // Report the OPEN step as complete to the popup
      state.lastCompletedStepIndex = 0;
      forwardToPopup({
        type: 'STEP_COMPLETE',
        index: 0,
        action: 'OPEN',
        status: 'success',
        error: ''
      });

      // Pass remaining steps with indexOffset so player reports correct indices
      await injectPlayerAndStart(tabId, steps.slice(1), continueOnError, 1);
      state.isSettingUp = false;
    } else {
      // Inject player directly
      await injectPlayerAndStart(tabId, steps, continueOnError, 0);
    }

    console.log('[R3] Playback started on tab', tabId);
  } catch (error) {
    console.error('[R3] Playback setup failed:', error);
    state.isSettingUp = false;
    state.playingTabId = null;
    forwardToPopup({
      type: 'PLAYBACK_COMPLETE',
      success: false,
      failedStep: 0,
      totalSteps: steps.length,
      error: error.message
    });
  }
}

async function injectPlayerAndStart(tabId, steps, continueOnError, indexOffset = 0) {
  // Inject utilities
  await injectScript(tabId, 'utils/selectors.js');

  // Inject player
  await injectScript(tabId, 'content/player.js');

  // Start playback with indexOffset so player reports correct step numbers
  await chrome.tabs.sendMessage(tabId, {
    type: 'START_PLAYBACK',
    steps,
    continueOnError,
    indexOffset
  });
}

// Stop playback
async function stopPlayback() {
  if (state.playingTabId) {
    try {
      await chrome.tabs.sendMessage(state.playingTabId, { type: 'STOP_PLAYBACK' });
    } catch (e) {
      console.log('[R3] Could not send stop message to tab');
    }
  }
  state.playingTabId = null;
  state.lastCompletedStepIndex = -1;
  console.log('[R3] Playback stopped');
}

// Navigate a tab to a URL
async function navigateTab(url, tabId) {
  if (tabId) {
    await chrome.tabs.update(tabId, { url });
    state.playingTabId = tabId;
  } else {
    // Fallback: find the active tab in the most recently focused normal window
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    for (const win of windows) {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
      if (tab) {
        await chrome.tabs.update(tab.id, { url });
        state.playingTabId = tab.id;
        return;
      }
    }
  }
}

// Wait for tab to finish loading
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (changedTabId, changeInfo) => {
      if (changedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Additional delay for framework hydration
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Timeout fallback
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });
}

// Check if a URL can have scripts injected into it
function isInjectableUrl(url) {
  if (!url) return false;
  const restricted = ['chrome://', 'chrome-extension://', 'edge://', 'about:', 'devtools://'];
  return !restricted.some(proto => url.startsWith(proto));
}

// Inject a script into a tab
async function injectScript(tabId, file) {
  // Validate the tab URL before attempting injection
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab.url)) {
      throw new Error(
        `Cannot inject into ${tab.url} — navigate to a regular webpage (http/https) first.`
      );
    }
  } catch (error) {
    if (error.message.includes('Cannot inject into')) throw error;
    throw new Error(`Tab ${tabId} not found or inaccessible.`);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [file]
    });
    console.log('[R3] Injected', file, 'into tab', tabId);
  } catch (error) {
    console.error('[R3] Failed to inject', file, ':', error.message);
    throw error;
  }
}

// Forward message to popup
function forwardToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed, that's okay
  });
}

// Save a recorded step to storage
async function saveRecordedStep(step) {
  try {
    const data = await chrome.storage.local.get(['r3Steps']);
    const steps = data.r3Steps || [];
    steps.push(step);
    await chrome.storage.local.set({ r3Steps: steps });
    console.log('[R3] Step saved to storage, total steps:', steps.length);
  } catch (error) {
    console.error('[R3] Failed to save step:', error);
  }
}

// Handle tab updates during playback — re-inject player after mid-playback navigation
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId !== state.playingTabId || changeInfo.status !== 'complete') return;
  if (state.isSettingUp) return;             // initial OPEN handled by startPlayback
  if (state.lastCompletedStepIndex < 0) return; // playback hasn't started yet

  // Check if player is still alive
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' });
    if (response && response.isPlaying) return; // player alive, no action needed
  } catch (e) {
    // No response — content script was destroyed by navigation
  }

  // The step after lastCompleted likely caused the navigation — credit it as success
  const navStepIndex = state.lastCompletedStepIndex + 1;
  if (navStepIndex >= state.steps.length) return; // no more steps

  console.log('[R3] Page navigated during playback. Re-injecting from step', navStepIndex + 1);

  forwardToPopup({
    type: 'STEP_COMPLETE',
    index: navStepIndex,
    action: state.steps[navStepIndex].action,
    status: 'success',
    error: ''
  });
  state.lastCompletedStepIndex = navStepIndex;

  // Continue with remaining steps
  const continueFrom = navStepIndex + 1;
  if (continueFrom >= state.steps.length) {
    // Navigation step was the last step — playback complete
    state.playingTabId = null;
    forwardToPopup({
      type: 'PLAYBACK_COMPLETE',
      success: true,
      failedStep: -1,
      totalSteps: state.steps.length
    });
    return;
  }

  try {
    const remaining = state.steps.slice(continueFrom);
    await injectPlayerAndStart(tabId, remaining, state.continueOnError, continueFrom);
    console.log('[R3] Re-injected player, continuing from step', continueFrom + 1);
  } catch (error) {
    console.error('[R3] Failed to re-inject player:', error);
    state.playingTabId = null;
    forwardToPopup({
      type: 'PLAYBACK_COMPLETE',
      success: false,
      failedStep: continueFrom,
      totalSteps: state.steps.length,
      error: error.message
    });
  }
});

// Clean up when recording tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.recordingTabId) {
    state.recordingTabId = null;
    forwardToPopup({ type: 'RECORDING_STOPPED' });
  }
  if (tabId === state.playingTabId) {
    state.playingTabId = null;
    forwardToPopup({
      type: 'PLAYBACK_COMPLETE',
      success: false,
      failedStep: -1,
      totalSteps: state.steps.length
    });
  }
});

console.log('[R3] Service worker initialized');
