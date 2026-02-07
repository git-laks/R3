/**
 * R3 Replay Engine
 * Executes recorded steps with polling and synthetic events
 */

(function() {
  'use strict';

  // Prevent multiple injections
  if (window.R3Player) {
    return;
  }

  class R3Player {
    constructor() {
      this.isPlaying = false;
      this.steps = [];
      this.currentStepIndex = 0;
      this.continueOnError = false;
      this.abortController = null;
      this.indexOffset = 0; // offset for step indices when OPEN was handled by background

      // Polling configuration
      this.pollInterval = 100;    // ms between polls
      this.maxPollTime = 15000;   // max wait time for element
      this.postActionDelay = 300; // delay after each action
    }

    async start(steps, continueOnError = false, indexOffset = 0) {
      if (this.isPlaying) {
        console.log('[R3] Player already running');
        return;
      }

      this.steps = steps;
      this.continueOnError = continueOnError;
      this.currentStepIndex = 0;
      this.indexOffset = indexOffset;
      this.isPlaying = true;
      this.abortController = new AbortController();

      console.log('[R3] Starting playback of', steps.length, 'steps');

      try {
        await this.playSteps();
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('[R3] Playback error:', error);
        }
      }

      this.isPlaying = false;
    }

    stop() {
      if (this.abortController) {
        this.abortController.abort();
      }
      this.isPlaying = false;
      console.log('[R3] Playback stopped');
    }

    async playSteps() {
      let allSuccess = true;
      let failedStep = -1;

      for (let i = 0; i < this.steps.length; i++) {
        if (!this.isPlaying) break;

        this.currentStepIndex = i;
        const step = this.steps[i];

        try {
          await this.executeStep(step, i);
          this.reportStepComplete(i, step.action, 'success');
        } catch (error) {
          allSuccess = false;
          failedStep = i;
          this.reportStepComplete(i, step.action, 'failed', error.message);

          if (!this.continueOnError) {
            this.reportPlaybackComplete(false, i, this.steps.length);
            return;
          }
        }

        // Small delay between steps for stability
        await this.delay(this.postActionDelay);
      }

      this.reportPlaybackComplete(allSuccess, failedStep, this.steps.length);
    }

    async executeStep(step, index) {
      const action = (step.action || '').toUpperCase().trim();
      const target = (step.target || '').trim();
      const value = (step.value || '').trim();

      console.log(`[R3] Step ${index + 1}: ${action}`, target, value);

      switch (action) {
        case 'OPEN':
          await this.actionOpen(value);
          break;
        case 'CLICK':
          await this.actionClick(target);
          break;
        case 'DBLCLICK':
          await this.actionDblClick(target);
          break;
        case 'RIGHTCLICK':
          await this.actionRightClick(target);
          break;
        case 'TYPE':
          await this.actionType(target, value);
          break;
        case 'TYPE_CHAR':
          await this.actionTypeChar(target, value);
          break;
        case 'CLEAR':
          await this.actionClear(target);
          break;
        case 'SELECT':
          await this.actionSelect(target, value);
          break;
        case 'CHECK':
          await this.actionCheck(target, true);
          break;
        case 'UNCHECK':
          await this.actionCheck(target, false);
          break;
        case 'PRESS':
          await this.actionPress(target, value);
          break;
        case 'WAIT':
          await this.actionWait(target, value);
          break;
        case 'ASSERT_EXISTS':
          await this.actionAssertExists(target);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    }

    // ==================== Actions ====================

    async actionOpen(url) {
      // Send navigation request to background script
      chrome.runtime.sendMessage({
        type: 'NAVIGATE',
        url: url
      });

      // Wait for page to load
      await this.waitForPageLoad();
    }

    async actionClick(selector) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      // Focus the element first (matches real user interaction)
      element.focus();

      // Dispatch synthetic mouse events for better framework compatibility
      this.dispatchMouseEvent(element, 'mousedown');
      this.dispatchMouseEvent(element, 'mouseup');
      this.dispatchMouseEvent(element, 'click');

      // Native click() provides activation behavior (form submission, checkbox toggle)
      // but skip for <a> elements — the synthetic click already fires event handlers,
      // and native click would double-fire framework handlers (e.g. ng-click)
      // which can cause toggle/undo effects making the click appear to do nothing.
      if (element.tagName.toLowerCase() !== 'a') {
        element.click();
      }
    }

    async actionDblClick(selector) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      this.dispatchMouseEvent(element, 'mousedown');
      this.dispatchMouseEvent(element, 'mouseup');
      this.dispatchMouseEvent(element, 'click');
      this.dispatchMouseEvent(element, 'mousedown');
      this.dispatchMouseEvent(element, 'mouseup');
      this.dispatchMouseEvent(element, 'click');
      this.dispatchMouseEvent(element, 'dblclick');
    }

    async actionRightClick(selector) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      this.dispatchMouseEvent(element, 'contextmenu', { button: 2 });
    }

    async actionType(selector, value) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      // Focus the element
      element.focus();
      this.dispatchFocusEvent(element, 'focus');

      // Clear existing value and set new value
      element.value = value;

      // Dispatch input events for React/Angular/Vue compatibility
      this.dispatchInputEvents(element, value);
    }

    async actionTypeChar(selector, value) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      // Focus the element
      element.focus();
      this.dispatchFocusEvent(element, 'focus');

      // Determine the appropriate native value setter
      const isTextArea = element.tagName.toLowerCase() === 'textarea';
      const nativeSetter = Object.getOwnPropertyDescriptor(
        isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value'
      )?.set;

      // Clear existing value
      if (nativeSetter) {
        nativeSetter.call(element, '');
      } else {
        element.value = '';
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));

      // Type each character individually
      for (let i = 0; i < value.length; i++) {
        if (!this.isPlaying) {
          throw new DOMException('Playback aborted', 'AbortError');
        }

        const char = value[i];
        const keyCode = char.charCodeAt(0);

        element.dispatchEvent(new KeyboardEvent('keydown', {
          key: char, code: `Key${char.toUpperCase()}`,
          keyCode, which: keyCode, bubbles: true
        }));

        // Set value using native setter for React/Angular compatibility
        const newValue = value.substring(0, i + 1);
        if (nativeSetter) {
          nativeSetter.call(element, newValue);
        } else {
          element.value = newValue;
        }

        element.dispatchEvent(new Event('input', { bubbles: true }));

        element.dispatchEvent(new KeyboardEvent('keyup', {
          key: char, code: `Key${char.toUpperCase()}`,
          keyCode, which: keyCode, bubbles: true
        }));

        await this.delay(30);
      }

      // Final change and blur events
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    }

    async actionClear(selector) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      element.focus();
      element.value = '';
      this.dispatchInputEvents(element, '');
    }

    async actionSelect(selector, value) {
      const element = await this.waitForElement(selector);

      if (element.tagName.toLowerCase() !== 'select') {
        throw new Error('Element is not a select dropdown');
      }

      this.scrollIntoView(element);
      element.focus();

      // Set the value
      element.value = value;

      // If value didn't match exactly, try to find option by text
      if (element.value !== value) {
        const options = Array.from(element.options);
        const match = options.find(opt =>
          opt.text.toLowerCase().includes(value.toLowerCase()) ||
          opt.value.toLowerCase() === value.toLowerCase()
        );
        if (match) {
          element.value = match.value;
        }
      }

      // Dispatch change event
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async actionCheck(selector, checked) {
      const element = await this.waitForElement(selector);
      this.scrollIntoView(element);

      if (element.checked !== checked) {
        element.checked = checked;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    async actionPress(selector, key) {
      const element = selector ? await this.waitForElement(selector) : document.activeElement;

      const keyCode = this.getKeyCode(key);

      // Dispatch key events
      element.dispatchEvent(new KeyboardEvent('keydown', {
        key: key,
        code: keyCode,
        keyCode: this.getKeyCodeNum(key),
        which: this.getKeyCodeNum(key),
        bubbles: true
      }));

      element.dispatchEvent(new KeyboardEvent('keyup', {
        key: key,
        code: keyCode,
        keyCode: this.getKeyCodeNum(key),
        which: this.getKeyCodeNum(key),
        bubbles: true
      }));

      // For Enter key, also dispatch keypress
      if (key === 'Enter') {
        element.dispatchEvent(new KeyboardEvent('keypress', {
          key: key,
          code: keyCode,
          keyCode: 13,
          which: 13,
          bubbles: true
        }));
      }
    }

    async actionWait(selector, value) {
      const timeout = parseInt(value) || 1000;

      if (selector) {
        // Wait for element to appear
        await this.waitForElement(selector, timeout);
      } else {
        // Fixed delay
        await this.delay(timeout);
      }
    }

    async actionAssertExists(selector) {
      const element = await this.waitForElement(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
    }

    // ==================== Helpers ====================

    async waitForElement(selector, timeout = this.maxPollTime) {
      const startTime = Date.now();
      let foundButNotVisible = false;

      while (Date.now() - startTime < timeout) {
        if (!this.isPlaying) {
          throw new DOMException('Playback aborted', 'AbortError');
        }

        const element = this.findElement(selector);
        if (element) {
          if (this.isVisible(element)) {
            return element;
          }
          if (!foundButNotVisible) {
            // Log why visibility check failed (first occurrence only)
            try {
              const win = element.ownerDocument.defaultView || window;
              const style = win.getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              console.log('[R3] Element found but not visible:', selector, {
                tag: element.tagName,
                display: style.display,
                visibility: style.visibility,
                opacity: style.opacity,
                width: rect.width,
                height: rect.height,
                inIframe: element.ownerDocument !== document
              });
            } catch (e) {
              console.log('[R3] Visibility check error:', e.message);
            }
          }
          foundButNotVisible = true;
        }

        await this.delay(this.pollInterval);
      }

      if (foundButNotVisible) {
        throw new Error(`Element exists but not visible within ${timeout}ms: ${selector}`);
      }
      throw new Error(`Element not found in DOM within ${timeout}ms: ${selector}`);
    }

    findElement(selector) {
      if (!selector) return null;

      let firstMatch = null;

      // Search ALL matches in main document, return first visible one
      // (SPAs can have duplicate IDs across different views)
      for (const el of this.querySelectorAllSafe(selector, document)) {
        if (!firstMatch) firstMatch = el;
        if (this.isVisible(el)) return el;
      }

      // Search inside same-origin iframes (enterprise apps often use iframes)
      const iframeMatch = this.findInIframes(selector, document);
      if (iframeMatch) return iframeMatch;

      // No visible match — return first match so caller can log diagnostics
      return firstMatch;
    }

    querySelectorAllSafe(selector, doc) {
      try {
        return doc.querySelectorAll(selector);
      } catch (e) {
        try {
          const unescaped = selector.replace(/\\(.)/g, '$1');
          return doc.querySelectorAll(unescaped);
        } catch (e2) {
          return [];
        }
      }
    }

    findInIframes(selector, doc) {
      const iframes = doc.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iframeDoc) continue; // cross-origin, skip

          // Check all matches in this iframe
          for (const el of this.querySelectorAllSafe(selector, iframeDoc)) {
            if (this.isVisible(el)) return el;
          }

          // Recurse into nested iframes
          const nested = this.findInIframes(selector, iframeDoc);
          if (nested) return nested;
        } catch (e) {
          // cross-origin iframe, can't access
          continue;
        }
      }
      return null;
    }

    isVisible(element) {
      if (!element) return false;

      // Prefer the modern checkVisibility API — it checks the entire
      // ancestor chain for display:none, visibility:hidden, opacity:0
      if (typeof element.checkVisibility === 'function') {
        return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }

      // Fallback for older browsers
      const win = element.ownerDocument.defaultView || window;
      const style = win.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    scrollIntoView(element) {
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
    }

    async waitForPageLoad() {
      // Wait for document ready state
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          const handler = () => {
            if (document.readyState === 'complete') {
              window.removeEventListener('load', handler);
              resolve();
            }
          };
          window.addEventListener('load', handler);
        });
      }

      // Additional buffer for framework hydration
      await this.delay(500);
    }

    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    dispatchMouseEvent(element, type, options = {}) {
      const rect = element.getBoundingClientRect();
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: options.button || 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        ...options
      });
      element.dispatchEvent(event);
    }

    dispatchFocusEvent(element, type) {
      element.dispatchEvent(new FocusEvent(type, { bubbles: true }));
    }

    dispatchInputEvents(element, value) {
      // For React compatibility, we need to set the value via native setter
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;

      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;

      if (element.tagName.toLowerCase() === 'textarea' && nativeTextAreaValueSetter) {
        nativeTextAreaValueSetter.call(element, value);
      } else if (nativeInputValueSetter) {
        nativeInputValueSetter.call(element, value);
      }

      // Dispatch events in order
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    }

    getKeyCode(key) {
      const codes = {
        'Enter': 'Enter',
        'Tab': 'Tab',
        'Escape': 'Escape',
        'Backspace': 'Backspace',
        'Delete': 'Delete'
      };
      return codes[key] || key;
    }

    getKeyCodeNum(key) {
      const codes = {
        'Enter': 13,
        'Tab': 9,
        'Escape': 27,
        'Backspace': 8,
        'Delete': 46
      };
      return codes[key] || key.charCodeAt(0);
    }

    reportStepComplete(index, action, status, error = '') {
      chrome.runtime.sendMessage({
        type: 'STEP_COMPLETE',
        index: index + this.indexOffset,
        action,
        status,
        error
      });
    }

    reportPlaybackComplete(success, failedStep, totalSteps) {
      chrome.runtime.sendMessage({
        type: 'PLAYBACK_COMPLETE',
        success,
        failedStep: failedStep >= 0 ? failedStep + this.indexOffset : failedStep,
        totalSteps: totalSteps + this.indexOffset
      });
    }
  }

  // Create global instance
  window.R3Player = new R3Player();

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_PLAYBACK':
        window.R3Player.start(message.steps, message.continueOnError, message.indexOffset || 0);
        sendResponse({ success: true });
        break;
      case 'STOP_PLAYBACK':
        window.R3Player.stop();
        sendResponse({ success: true });
        break;
      case 'GET_STATUS':
        sendResponse({ isPlaying: window.R3Player.isPlaying });
        break;
    }
    return true;
  });

  console.log('[R3] Player injected');
})();
