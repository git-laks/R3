/**
 * R3 Popup UI Logic
 * Manages recording/playback state, CSV import/export, and log display
 */

class R3Popup {
  constructor() {
    this.state = {
      mode: 'idle', // 'idle' | 'recording' | 'playing'
      steps: [],
      continueOnError: false,
      currentStepIndex: -1
    };

    this.playbackResults = []; // maps index → {status: 'pending'|'running'|'success'|'failed', error?}
    this.elements = {};
    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.loadState();
    this.updateUI();
  }

  cacheElements() {
    this.elements = {
      recordBtn: document.getElementById('recordBtn'),
      playBtn: document.getElementById('playBtn'),
      importBtn: document.getElementById('importBtn'),
      exportBtn: document.getElementById('exportBtn'),
      clearBtn: document.getElementById('clearBtn'),
      clearLogBtn: document.getElementById('clearLogBtn'),
      popoutBtn: document.getElementById('popoutBtn'),
      fileInput: document.getElementById('fileInput'),
      stepCount: document.getElementById('stepCount'),
      status: document.getElementById('status'),
      continueOnError: document.getElementById('continueOnError'),
      logView: document.getElementById('logView'),
      stepsView: document.getElementById('stepsView'),
      recordingToolbar: document.getElementById('recordingToolbar'),
      waitDuration: document.getElementById('waitDuration'),
      addWaitBtn: document.getElementById('addWaitBtn')
    };
  }

  bindEvents() {
    this.elements.recordBtn.addEventListener('click', () => this.toggleRecording());
    this.elements.playBtn.addEventListener('click', () => this.togglePlayback());
    this.elements.importBtn.addEventListener('click', () => this.elements.fileInput.click());
    this.elements.exportBtn.addEventListener('click', () => this.exportCSV());
    this.elements.clearBtn.addEventListener('click', () => this.clearSteps());
    this.elements.clearLogBtn.addEventListener('click', () => this.clearLog());
    this.elements.popoutBtn.addEventListener('click', () => this.popOut());
    this.elements.fileInput.addEventListener('change', (e) => this.importCSV(e));
    this.elements.addWaitBtn.addEventListener('click', () => this.addWaitStep());
    this.elements.continueOnError.addEventListener('change', (e) => {
      this.state.continueOnError = e.target.checked;
      this.saveState();
    });

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message);
    });
  }

  async loadState() {
    try {
      const data = await chrome.storage.local.get(['r3State', 'r3Steps']);
      if (data.r3State) {
        this.state.mode = data.r3State.mode || 'idle';
        this.state.continueOnError = data.r3State.continueOnError || false;
      }
      if (data.r3Steps) {
        this.state.steps = data.r3Steps;
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    }
  }

  async saveState() {
    try {
      await chrome.storage.local.set({
        r3State: {
          mode: this.state.mode,
          continueOnError: this.state.continueOnError
        },
        r3Steps: this.state.steps
      });
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  updateUI() {
    const { mode, steps, continueOnError } = this.state;

    // Update step count
    this.elements.stepCount.textContent = steps.length;

    // Update checkbox
    this.elements.continueOnError.checked = continueOnError;

    // Update status
    this.elements.status.textContent = this.getStatusText(mode);
    this.elements.status.className = `stat-value status-${mode}`;

    // Update record button
    this.elements.recordBtn.classList.toggle('recording', mode === 'recording');
    this.elements.recordBtn.querySelector('.text').textContent =
      mode === 'recording' ? 'Stop Recording' : 'Start Recording';
    this.elements.recordBtn.disabled = mode === 'playing';

    // Update play button
    this.elements.playBtn.classList.toggle('playing', mode === 'playing');
    this.elements.playBtn.querySelector('.text').textContent =
      mode === 'playing' ? 'Stop Playback' : 'Play Recording';
    this.elements.playBtn.disabled = mode === 'recording' || steps.length === 0;

    // Toggle recording toolbar — show only during recording
    this.elements.recordingToolbar.style.display = mode === 'recording' ? 'flex' : 'none';

    // Update other buttons
    this.elements.importBtn.disabled = mode !== 'idle';
    this.elements.exportBtn.disabled = steps.length === 0 || mode !== 'idle';
    this.elements.clearBtn.disabled = mode !== 'idle';

    // Update steps view
    this.renderSteps();
  }

  getStatusText(mode) {
    switch (mode) {
      case 'recording': return 'Recording...';
      case 'playing': return 'Playing...';
      default: return 'Idle';
    }
  }

  renderSteps() {
    const { steps, mode } = this.state;
    const container = this.elements.stepsView;

    if (steps.length === 0) {
      container.innerHTML = '<div class="steps-empty">No steps recorded</div>';
      return;
    }

    const isEditable = mode === 'idle' || mode === 'recording';
    const isPlaying = mode === 'playing';
    const actions = ['CLICK', 'DBLCLICK', 'RIGHTCLICK', 'TYPE', 'TYPE_CHAR', 'CLEAR', 'SELECT', 'CHECK', 'UNCHECK', 'PRESS', 'WAIT', 'ASSERT_EXISTS', 'OPEN'];

    container.innerHTML = '';

    steps.forEach((step, index) => {
      const div = document.createElement('div');
      div.className = 'step-item';
      div.dataset.stepIndex = index;

      // Playback state styling
      if (isPlaying) {
        const result = this.playbackResults[index];
        const status = result ? result.status : 'pending';
        div.classList.add(`step-${status}`);

        // Status icon
        const statusIcon = document.createElement('span');
        statusIcon.className = `step-status-icon status-${status}`;
        const icons = { pending: '\u25CB', running: '\u25B6', success: '\u2713', failed: '\u2717' };
        statusIcon.textContent = icons[status] || icons.pending;
        div.appendChild(statusIcon);
      }

      // Step number
      const numSpan = document.createElement('span');
      numSpan.className = 'step-number';
      numSpan.textContent = index + 1;
      div.appendChild(numSpan);

      if (isEditable) {
        // Action dropdown
        const actionSelect = document.createElement('select');
        actionSelect.className = 'step-action-select';
        actions.forEach(a => {
          const opt = document.createElement('option');
          opt.value = a;
          opt.textContent = a;
          if (a === step.action) opt.selected = true;
          actionSelect.appendChild(opt);
        });
        actionSelect.addEventListener('change', () => this.updateStep(index, 'action', actionSelect.value));
        div.appendChild(actionSelect);

        // Target input
        const targetInput = document.createElement('input');
        targetInput.type = 'text';
        targetInput.className = 'step-input step-target-input';
        targetInput.value = step.target || '';
        targetInput.placeholder = 'selector';
        targetInput.title = step.target || '';
        targetInput.addEventListener('change', () => this.updateStep(index, 'target', targetInput.value));
        div.appendChild(targetInput);

        // Value input
        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'step-input step-value-input';
        valueInput.value = step.value || '';
        valueInput.placeholder = 'value';
        valueInput.title = step.value || '';
        valueInput.addEventListener('change', () => this.updateStep(index, 'value', valueInput.value));
        div.appendChild(valueInput);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'step-delete-btn';
        deleteBtn.textContent = '\u2715';
        deleteBtn.title = 'Delete step';
        deleteBtn.addEventListener('click', () => this.deleteStep(index));
        div.appendChild(deleteBtn);
      } else {
        // Read-only display (during playback)
        const actionSpan = document.createElement('span');
        actionSpan.className = 'step-action';
        actionSpan.textContent = step.action;
        div.appendChild(actionSpan);

        const targetSpan = document.createElement('span');
        targetSpan.className = 'step-target';
        targetSpan.title = step.target || '';
        targetSpan.textContent = step.target || '-';
        div.appendChild(targetSpan);

        const valueSpan = document.createElement('span');
        valueSpan.className = 'step-value';
        valueSpan.title = step.value || '';
        valueSpan.textContent = step.value || '';
        div.appendChild(valueSpan);
      }

      container.appendChild(div);
    });

    // Auto-scroll: during playback scroll to current running step, otherwise scroll to bottom
    if (isPlaying) {
      const runningEl = container.querySelector('.step-running');
      if (runningEl) {
        runningEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }

  updateStep(index, field, value) {
    if (index >= 0 && index < this.state.steps.length) {
      this.state.steps[index][field] = value;
      this.saveState();
      // Update step count in case it's relevant
      this.elements.stepCount.textContent = this.state.steps.length;
    }
  }

  deleteStep(index) {
    if (index >= 0 && index < this.state.steps.length) {
      this.state.steps.splice(index, 1);
      this.saveState();
      this.updateUI();
    }
  }

  highlightStep(index, status, error) {
    // Update the result for this step
    if (index >= 0 && index < this.playbackResults.length) {
      this.playbackResults[index] = { status, error };
    }

    // Mark the next step as running (if there is one and it's still pending)
    const nextIndex = index + 1;
    if (nextIndex < this.playbackResults.length && this.playbackResults[nextIndex].status === 'pending') {
      this.playbackResults[nextIndex] = { status: 'running' };
    }

    // Re-render to reflect updated states
    this.renderSteps();
  }

  async toggleRecording() {
    if (this.state.mode === 'recording') {
      await this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async getTargetTab() {
    // When popped out, currentWindow is the popup window (not a browser window)
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow.type === 'popup') {
      // Find the active tab in the most recently focused normal browser window
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      for (const win of windows) {
        const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
        if (tab) return tab;
      }
      return null;
    }
    // Normal popup: active tab in the current window
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async startRecording() {
    try {
      const tab = await this.getTargetTab();
      if (!tab) {
        this.addLog('error', 'No active tab found');
        return;
      }

      // Validate the tab URL before attempting to record
      if (!tab.url || !tab.url.startsWith('http')) {
        this.addLog('error', `Cannot record on this page (${tab.url || 'unknown'}). Navigate to a regular webpage first.`);
        return;
      }

      // Record initial OPEN action
      this.state.steps.push({
        action: 'OPEN',
        target: '',
        value: tab.url,
        description: 'Navigate to starting page'
      });

      // Persist state BEFORE starting recording to avoid race condition:
      // saveState passes the steps array by reference, so if recording starts
      // first and a step arrives while the write is in-flight, the mutation
      // gets picked up by the write AND saved again by the background.
      this.state.mode = 'recording';
      await this.saveState();

      // Now start recording — storage is already committed
      await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId: tab.id
      });

      this.updateUI();
      this.addLog('info', 'Recording started');
    } catch (error) {
      this.addLog('error', `Failed to start recording: ${error.message}`);
    }
  }

  async stopRecording() {
    try {
      const tab = await this.getTargetTab();
      if (tab) {
        await chrome.runtime.sendMessage({
          type: 'STOP_RECORDING',
          tabId: tab.id
        });
      }

      this.state.mode = 'idle';
      await this.saveState();
      this.updateUI();
      this.addLog('info', `Recording stopped. ${this.state.steps.length} steps recorded.`);
    } catch (error) {
      this.addLog('error', `Failed to stop recording: ${error.message}`);
      this.state.mode = 'idle';
      this.updateUI();
    }
  }

  async togglePlayback() {
    if (this.state.mode === 'playing') {
      await this.stopPlayback();
    } else {
      await this.startPlayback();
    }
  }

  async startPlayback() {
    if (this.state.steps.length === 0) {
      this.addLog('error', 'No steps to play');
      return;
    }

    try {
      const tab = await this.getTargetTab();
      if (!tab) {
        this.addLog('error', 'No active tab found. Make sure a browser window is open.');
        return;
      }

      // For non-OPEN first steps, validate the tab is injectable
      const firstStep = this.state.steps[0];
      if (!firstStep || firstStep.action.toUpperCase() !== 'OPEN') {
        if (!tab.url || !tab.url.startsWith('http')) {
          this.addLog('error', `Cannot play on this page (${tab.url || 'unknown'}). Navigate to a regular webpage first.`);
          return;
        }
      }

      this.state.mode = 'playing';
      this.state.currentStepIndex = 0;

      // Initialize playback results: all pending, first one running
      this.playbackResults = this.state.steps.map(() => ({ status: 'pending' }));
      this.playbackResults[0] = { status: 'running' };

      await this.saveState();
      this.updateUI();
      this.addLog('info', `Starting playback of ${this.state.steps.length} steps...`);

      await chrome.runtime.sendMessage({
        type: 'START_PLAYBACK',
        tabId: tab.id,
        steps: this.state.steps,
        continueOnError: this.state.continueOnError
      });
    } catch (error) {
      this.addLog('error', `Failed to start playback: ${error.message}`);
      this.state.mode = 'idle';
      this.updateUI();
    }
  }

  async stopPlayback() {
    try {
      await chrome.runtime.sendMessage({ type: 'STOP_PLAYBACK' });
      this.state.mode = 'idle';
      await this.saveState();
      this.updateUI();
      this.addLog('info', 'Playback stopped');
    } catch (error) {
      this.addLog('error', `Failed to stop playback: ${error.message}`);
      this.state.mode = 'idle';
      this.updateUI();
    }
  }

  handleMessage(message) {
    switch (message.type) {
      case 'STEP_RECORDED':
        this.state.steps.push(message.step);
        this.updateUI();
        this.addLog('info', `Recorded: ${message.step.action} ${message.step.target || ''}`);
        break;

      case 'STEP_COMPLETE':
        // Track result for step highlighting
        this.highlightStep(message.index, message.status === 'success' ? 'success' : 'failed', message.error);

        if (message.status === 'success') {
          this.addLog('success', `Step ${message.index + 1}: ${message.action} - Success`);
        } else {
          this.addLog('error', `Step ${message.index + 1}: ${message.action} - Failed: ${message.error}`);
        }
        break;

      case 'PLAYBACK_COMPLETE':
        this.state.mode = 'idle';
        this.saveState();
        this.updateUI();
        if (message.success) {
          this.addLog('success', `Playback complete! All ${message.totalSteps} steps passed.`);
          this.elements.status.textContent = 'Success';
          this.elements.status.className = 'stat-value status-success';
        } else {
          const errorDetail = message.error ? `: ${message.error}` : '';
          this.addLog('error', `Playback failed at step ${message.failedStep + 1}${errorDetail}`);
          this.elements.status.textContent = 'Failed';
          this.elements.status.className = 'stat-value status-error';
        }
        break;

      case 'RECORDING_STOPPED':
        this.state.mode = 'idle';
        this.saveState();
        this.updateUI();
        break;
    }
  }

  importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csvText = e.target.result;
        const rows = CSV.parse(csvText);

        // Parse rows (skip header if present)
        const steps = [];
        const startIndex = this.isHeaderRow(rows[0]) ? 1 : 0;

        const unescape = (str) => {
          str = (str || '').trim();
          // Remove leading single quote if it was added for CSV injection protection
          if (str.startsWith("'") && (
            str.startsWith("'=") ||
            str.startsWith("'+") ||
            str.startsWith("'-") ||
            str.startsWith("'@")
          )) {
            return str.substring(1);
          }
          return str;
        };

        for (let i = startIndex; i < rows.length; i++) {
          const row = rows[i];
          // Skip empty rows
          if (row.length >= 1 && row[0].trim()) {
            steps.push({
              action: unescape(row[0] || '').toUpperCase(),
              target: unescape(row[1] || ''),
              value: unescape(row[2] || ''),
              description: unescape(row[3] || '')
            });
          }
        }

        this.state.steps = steps;
        this.saveState();
        this.updateUI();
        this.addLog('success', `Imported ${steps.length} steps from CSV`);
      } catch (error) {
        this.addLog('error', `Failed to import CSV: ${error.message}`);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset file input
  }

  isHeaderRow(row) {
    if (!row || row.length === 0) return false;
    const firstCell = (row[0] || '').toLowerCase().trim();
    return firstCell === 'action' || firstCell === 'step' || firstCell === 'command';
  }

  exportCSV() {
    if (this.state.steps.length === 0) {
      this.addLog('error', 'No steps to export');
      return;
    }

    try {
      // Prepare data with header
      const data = [
        ['Action', 'Target (Selector)', 'Value (Input Data)', 'Description (Optional)'],
        ...this.state.steps.map(step => [
          step.action,
          step.target || '',
          step.value || '',
          step.description || ''
        ])
      ];

      const csv = CSV.stringify(data);

      // Generate filename with timestamp
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `recording_${timestamp}.csv`;

      // Trigger download
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      this.addLog('success', `Exported ${this.state.steps.length} steps to ${filename}`);
    } catch (error) {
      this.addLog('error', `Failed to export CSV: ${error.message}`);
    }
  }

  async clearSteps() {
    if (this.state.steps.length === 0) return;

    if (confirm('Are you sure you want to clear all recorded steps?')) {
      this.state.steps = [];
      await this.saveState();
      this.updateUI();
      this.addLog('info', 'All steps cleared');
    }
  }

  addWaitStep() {
    const duration = parseInt(this.elements.waitDuration.value) || 2000;
    this.state.steps.push({
      action: 'WAIT',
      target: '',
      value: String(duration),
      description: `Wait ${duration}ms`
    });
    this.saveState();
    this.updateUI();
    this.addLog('info', `Added WAIT step (${duration}ms)`);
  }

  clearLog() {
    this.elements.logView.innerHTML = '<div class="log-empty">No activity yet</div>';
  }

  popOut() {
    const popupUrl = chrome.runtime.getURL('popup/popup.html?popout=1');
    chrome.windows.create({
      url: popupUrl,
      type: 'popup',
      width: 400,
      height: 700,
      focused: true
    });
    // Close the current popup since the new window takes over
    window.close();
  }

  addLog(type, message) {
    // Remove empty message if present
    const empty = this.elements.logView.querySelector('.log-empty');
    if (empty) empty.remove();

    const icons = {
      success: '&#10003;',
      error: '&#10007;',
      running: '&#9654;',
      info: '&#8226;'
    };

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `
      <span class="log-icon">${icons[type] || icons.info}</span>
      <span class="log-text">${this.escapeHtml(message)}</span>
    `;

    this.elements.logView.appendChild(entry);
    this.elements.logView.scrollTop = this.elements.logView.scrollHeight;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ==================== Built-in CSV Utilities ====================

const CSV = {
  /**
   * Parse CSV string into array of arrays
   */
  parse(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (insideQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // Escaped quote
            currentCell += '"';
            i++;
          } else {
            // End of quoted field
            insideQuotes = false;
          }
        } else {
          currentCell += char;
        }
      } else {
        if (char === '"') {
          insideQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentCell);
          currentCell = '';
        } else if (char === '\r' && nextChar === '\n') {
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
          i++;
        } else if (char === '\n' || char === '\r') {
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
        } else {
          currentCell += char;
        }
      }
    }

    // Don't forget the last cell and row
    currentRow.push(currentCell);
    if (currentRow.length > 0 && currentRow.some(c => c !== '')) {
      rows.push(currentRow);
    }

    return rows;
  },

  /**
   * Convert array of arrays to CSV string
   */
  stringify(data) {
    return data.map(row => {
      return row.map(cell => {
        let str = (cell == null) ? '' : String(cell);

        // Security: Prevent CSV Injection by prepending a single quote
        // if the cell starts with =, +, -, or @
        if (str.startsWith('=') || str.startsWith('+') || str.startsWith('-') || str.startsWith('@')) {
          str = "'" + str;
        }

        // Quote if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      }).join(',');
    }).join('\r\n');
  }
};

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  // Mark body if running in popped-out window
  if (window.location.search.includes('popout=1')) {
    document.body.classList.add('popped-out');
  }
  new R3Popup();
});
