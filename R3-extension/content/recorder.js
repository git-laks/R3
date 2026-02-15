/**
 * R3 Recording Engine
 * Captures user interactions and generates selectors
 */

(function() {
  'use strict';

  const DEBUG = false;

  function log(...args) {
    if (DEBUG) {
      console.log(...args);
    }
  }

  // Prevent multiple injections
  if (window.R3Recorder) {
    window.R3Recorder.start();
    return;
  }

  // SelectorUtils should be injected by background script before this file

  class R3Recorder {
    constructor() {
      this.isRecording = false;
      this.lastInputElement = null;
      this.lastInputValue = '';
      this.highlightedElement = null;
      this.boundHandlers = {};
    }

    start() {
      if (this.isRecording) return;
      this.isRecording = true;
      this.attachListeners();
      log('[R3] Recording started');
    }

    stop() {
      if (!this.isRecording) return;
      this.isRecording = false;
      this.detachListeners();
      this.removeHighlight();
      log('[R3] Recording stopped');
    }

    attachListeners() {
      // Bind handlers to preserve 'this' context
      this.boundHandlers = {
        click: this.handleClick.bind(this),
        dblclick: this.handleDblClick.bind(this),
        contextmenu: this.handleContextMenu.bind(this),
        change: this.handleChange.bind(this),
        blur: this.handleBlur.bind(this),
        keydown: this.handleKeyDown.bind(this),
        focus: this.handleFocus.bind(this)
      };

      // Use capture phase to catch events before they're handled
      document.addEventListener('click', this.boundHandlers.click, true);
      document.addEventListener('dblclick', this.boundHandlers.dblclick, true);
      document.addEventListener('contextmenu', this.boundHandlers.contextmenu, true);
      document.addEventListener('change', this.boundHandlers.change, true);
      document.addEventListener('blur', this.boundHandlers.blur, true);
      document.addEventListener('keydown', this.boundHandlers.keydown, true);
      document.addEventListener('focus', this.boundHandlers.focus, true);
    }

    detachListeners() {
      document.removeEventListener('click', this.boundHandlers.click, true);
      document.removeEventListener('dblclick', this.boundHandlers.dblclick, true);
      document.removeEventListener('contextmenu', this.boundHandlers.contextmenu, true);
      document.removeEventListener('change', this.boundHandlers.change, true);
      document.removeEventListener('blur', this.boundHandlers.blur, true);
      document.removeEventListener('keydown', this.boundHandlers.keydown, true);
      document.removeEventListener('focus', this.boundHandlers.focus, true);
    }

    handleClick(event) {
      if (!this.isRecording) return;

      let element = event.target;

      // Skip text-entry inputs (blur handles their value changes),
      // but allow button-like inputs (button, submit, reset, image) through
      if (this.isTextInputElement(element)) {
        return;
      }

      // Find the actual clickable element (button, link, or element with onclick)
      // This handles cases where user clicks on a span inside a button
      const clickable = element.closest('button, a, [role="button"], [onclick], [ng-click], [data-ng-click], input[type="button"], input[type="submit"], input[type="reset"]');
      if (clickable) {
        element = clickable;
      }

      // Record click action
      this.recordStep('CLICK', element);
      this.showFeedback(element);
    }

    handleDblClick(event) {
      if (!this.isRecording) return;

      const element = event.target;
      this.recordStep('DBLCLICK', element);
      this.showFeedback(element);
    }

    handleContextMenu(event) {
      if (!this.isRecording) return;

      const element = event.target;
      this.recordStep('RIGHTCLICK', element);
      this.showFeedback(element);
    }

    handleFocus(event) {
      if (!this.isRecording) return;

      const element = event.target;
      if (this.isInputElement(element)) {
        this.lastInputElement = element;
        this.lastInputValue = element.value || '';
      }
    }

    handleBlur(event) {
      if (!this.isRecording) return;

      const element = event.target;

      // Only handle input elements
      if (!this.isInputElement(element)) return;

      // Check if value changed
      const currentValue = element.value || '';
      const tagName = element.tagName.toLowerCase();

      // For text inputs, record TYPE action if value changed
      if (tagName === 'input' || tagName === 'textarea') {
        const inputType = element.getAttribute('type') || 'text';

        // Skip checkbox/radio (handled by change event)
        if (['checkbox', 'radio'].includes(inputType)) return;

        if (currentValue !== this.lastInputValue && currentValue !== '') {
          const action = this.isDynamicInput(element) ? 'TYPE_CHAR' : 'TYPE';
          this.recordStep(action, element, currentValue);
          this.showFeedback(element);
        } else if (currentValue === '' && this.lastInputValue !== '') {
          // Field was cleared
          this.recordStep('CLEAR', element);
          this.showFeedback(element);
        }
      }

      this.lastInputElement = null;
      this.lastInputValue = '';
    }

    handleChange(event) {
      if (!this.isRecording) return;

      const element = event.target;
      const tagName = element.tagName.toLowerCase();

      if (tagName === 'select') {
        // Record SELECT action
        const selectedOption = element.options[element.selectedIndex];
        const value = element.value;
        const description = selectedOption ? selectedOption.text : '';
        this.recordStep('SELECT', element, value, `Select "${description}"`);
        this.showFeedback(element);
      } else if (tagName === 'input') {
        const inputType = element.getAttribute('type') || 'text';

        if (inputType === 'checkbox') {
          // Record CHECK or UNCHECK
          const action = element.checked ? 'CHECK' : 'UNCHECK';
          this.recordStep(action, element);
          this.showFeedback(element);
        } else if (inputType === 'radio') {
          // Record CHECK for radio buttons
          this.recordStep('CHECK', element);
          this.showFeedback(element);
        }
      }
    }

    handleKeyDown(event) {
      if (!this.isRecording) return;

      const key = event.key;

      // Only record special keys
      const specialKeys = ['Enter', 'Tab', 'Escape'];
      if (!specialKeys.includes(key)) return;

      const element = event.target;

      // For Enter key on forms, this might trigger a submit
      // We record it as a PRESS action
      this.recordStep('PRESS', element, key, `Press ${key} key`);
      this.showFeedback(element);
    }

    isInputElement(element) {
      if (!element || !element.tagName) return false;
      const tagName = element.tagName.toLowerCase();
      return ['input', 'textarea', 'select'].includes(tagName);
    }

    isTextInputElement(element) {
      if (!element || !element.tagName) return false;
      const tagName = element.tagName.toLowerCase();
      if (tagName === 'textarea' || tagName === 'select') return true;
      if (tagName === 'input') {
        const inputType = (element.getAttribute('type') || 'text').toLowerCase();
        const buttonTypes = ['button', 'submit', 'reset', 'image'];
        return !buttonTypes.includes(inputType);
      }
      return false;
    }

    /**
     * Detect if an input field requires character-by-character typing.
     * These are fields with per-keystroke handlers (autocomplete, typeahead,
     * live search, etc.) where setting the value directly won't trigger
     * the expected behavior during playback.
     */
    isDynamicInput(element) {
      // AngularJS: per-keystroke event/model attributes
      const ngAttrs = ['ng-change', 'ng-keyup', 'ng-keydown', 'ng-keypress'];
      for (const attr of ngAttrs) {
        if (element.hasAttribute(attr) || element.hasAttribute(`data-${attr}`)) {
          return true;
        }
      }

      // ARIA autocomplete indicators (used by most autocomplete libraries)
      if (element.getAttribute('role') === 'combobox') return true;
      if (element.getAttribute('aria-autocomplete')) return true;

      // HTML5 datalist binding
      if (element.hasAttribute('list')) return true;

      // Angular 2+: reflected model binding
      if (element.hasAttribute('ng-reflect-model')) return true;

      // Common autocomplete library data attributes
      if (element.hasAttribute('data-autocomplete')) return true;
      if (element.hasAttribute('data-typeahead')) return true;

      return false;
    }

    recordStep(action, element, value = '', description = '') {
      try {
        // Generate selector using SelectorUtils or fallback
        const selector = window.SelectorUtils
          ? window.SelectorUtils.generateSelector(element)
          : this.fallbackSelector(element);

        const elementDesc = window.SelectorUtils
          ? window.SelectorUtils.getElementDescription(element)
          : element.tagName.toLowerCase();

        const step = {
          action,
          target: selector,
          value: value || '',
          description: description || `${action} on ${elementDesc}`
        };

        // Send to background script
        chrome.runtime.sendMessage({
          type: 'STEP_RECORDED',
          step
        }).then(() => {
          log('[R3] Recorded:', step);
        }).catch(err => {
          console.error('[R3] Failed to send step:', err);
        });
      } catch (error) {
        console.error('[R3] Error recording step:', error);
      }
    }

    fallbackSelector(element) {
      // Simple fallback if SelectorUtils isn't loaded yet
      if (element.id) return `#${element.id}`;
      if (element.name) return `[name="${element.name}"]`;
      return element.tagName.toLowerCase();
    }

    showFeedback(element) {
      // Remove previous highlight
      this.removeHighlight();

      // Add highlight effect
      const originalOutline = element.style.outline;
      const originalOutlineOffset = element.style.outlineOffset;

      element.style.outline = '2px solid #d32f2f';
      element.style.outlineOffset = '2px';

      this.highlightedElement = {
        element,
        originalOutline,
        originalOutlineOffset
      };

      // Flash animation - remove after 500ms
      setTimeout(() => {
        this.removeHighlight();
      }, 500);
    }

    removeHighlight() {
      if (this.highlightedElement) {
        const { element, originalOutline, originalOutlineOffset } = this.highlightedElement;
        if (element && element.style) {
          element.style.outline = originalOutline;
          element.style.outlineOffset = originalOutlineOffset;
        }
        this.highlightedElement = null;
      }
    }
  }

  // Create global instance
  window.R3Recorder = new R3Recorder();

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING':
        window.R3Recorder.start();
        sendResponse({ success: true });
        break;
      case 'STOP_RECORDING':
        window.R3Recorder.stop();
        sendResponse({ success: true });
        break;
      case 'GET_STATUS':
        sendResponse({ isRecording: window.R3Recorder.isRecording });
        break;
    }
    return true; // Keep channel open for async response
  });

  log('[R3] Recorder injected');
})();
