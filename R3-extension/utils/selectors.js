/**
 * Selector Generation Utilities
 * Priority: data-testid > id > name > aria-label > placeholder > label > CSS path
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.SelectorUtils) {
    return;
  }

  const SelectorUtils = {
    /**
     * Generate the best selector for an element based on priority hierarchy
     * @param {Element} element - The DOM element to generate a selector for
     * @returns {string} - The generated selector
     */
    generateSelector(element) {
      if (!element || !element.tagName) {
        return '';
      }

      // Priority 1: data-testid, data-test-id, data-cy
      const testId = element.getAttribute('data-testid') ||
        element.getAttribute('data-test-id') ||
        element.getAttribute('data-cy');
      if (testId) {
        return `[data-testid="${testId}"]`;
      }

      // Priority 2: id (if not dynamic)
      const id = element.id;
      if (id && this.isValidId(id)) {
        return `#${CSS.escape(id)}`;
      }

      // Priority 3: name attribute
      const name = element.getAttribute('name');
      if (name) {
        const tagName = element.tagName.toLowerCase();
        return `${tagName}[name="${name}"]`;
      }

      // Priority 4: aria-label
      const ariaLabel = element.getAttribute('aria-label');
      if (ariaLabel) {
        return `[aria-label="${ariaLabel}"]`;
      }

      // Priority 5: placeholder attribute
      const placeholder = element.getAttribute('placeholder');
      if (placeholder) {
        const tagName = element.tagName.toLowerCase();
        return `${tagName}[placeholder="${placeholder}"]`;
      }

      // Priority 6: Associated label text
      const labelSelector = this.findByLabel(element);
      if (labelSelector) {
        return labelSelector;
      }

      // Priority 7: CSS path fallback
      return this.buildCssPath(element);
    },

    /**
     * Check if an ID is valid (not dynamically generated)
     * Rejects IDs that match common dynamic patterns:
     * - Contains 3+ consecutive digits
     * - Starts with r: followed by digits
     * - Contains 8+ character hex strings
     * @param {string} id - The ID to validate
     * @returns {boolean} - True if the ID is valid
     */
    isValidId(id) {
      if (!id) return false;

      // Pattern to detect dynamic IDs
      const dynamicPatterns = [
        /[-_]?\d{3,}/,           // 3+ consecutive digits (with optional prefix)
        /^r:\d/,                  // React-style IDs starting with r:
        /[a-f0-9]{8,}/i,         // 8+ char hex strings (UUIDs, hashes)
        /^:r/,                    // Another React pattern
        /^\d+$/,                  // Pure numeric IDs
        /^ember\d+/,             // Ember.js IDs
        /^ng-/,                   // Angular generated IDs
        /^react-/,               // React generated IDs
      ];

      return !dynamicPatterns.some(pattern => pattern.test(id));
    },

    /**
     * Find an element by its associated label
     * @param {Element} element - The form element to find label for
     * @returns {string|null} - A selector using the label, or null
     */
    findByLabel(element) {
      const id = element.id;

      // Check for label with 'for' attribute
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label && label.textContent) {
          const labelText = label.textContent.trim();
          if (labelText) {
            // Use XPath-style selector isn't standard, so use a combination
            // Return a hint that can be used for finding
            const tagName = element.tagName.toLowerCase();
            return `${tagName}#${CSS.escape(id)}`;
          }
        }
      }

      // Check for parent label (wrapping the element)
      const parentLabel = element.closest('label');
      if (parentLabel && parentLabel.textContent) {
        const labelText = parentLabel.textContent.trim();
        // Get the input type for more specific selection
        const tagName = element.tagName.toLowerCase();
        const type = element.getAttribute('type');

        if (type) {
          return `label:has(${tagName}[type="${type}"])`;
        }
      }

      return null;
    },

    /**
     * Build a CSS path fallback selector using nth-child
     * @param {Element} element - The element to build a path for
     * @returns {string} - A CSS path selector
     */
    buildCssPath(element) {
      const path = [];
      let current = element;

      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let selector = current.tagName.toLowerCase();

        // Add class names if they exist and aren't dynamic-looking
        const classes = Array.from(current.classList)
          .filter(cls => !this.isDynamicClass(cls))
          .slice(0, 2); // Limit to 2 classes for readability

        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }

        // If we're not at the root, add nth-child for specificity
        if (current.parentElement) {
          const siblings = Array.from(current.parentElement.children);
          const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);

          if (sameTagSiblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            selector += `:nth-child(${index})`;
          }
        }

        path.unshift(selector);

        // Stop at body or when we have enough specificity
        if (current.tagName.toLowerCase() === 'body' || path.length >= 4) {
          break;
        }

        current = current.parentElement;
      }

      return path.join(' > ');
    },

    /**
     * Check if a class name looks dynamically generated
     * @param {string} className - The class name to check
     * @returns {boolean} - True if the class looks dynamic
     */
    isDynamicClass(className) {
      const dynamicPatterns = [
        /^[a-z]{1,3}-[a-f0-9]{6,}/i,  // CSS modules hash
        /^css-[a-z0-9]+/i,            // Emotion/styled-components
        /^sc-[a-zA-Z]+/,              // Styled-components
        /^_[a-f0-9]{5,}/i,            // Webpack generated
        /^jsx-[0-9]+/,                // Styled JSX
        /\d{5,}/,                     // Contains 5+ digits
      ];

      return dynamicPatterns.some(pattern => pattern.test(className));
    },

    /**
     * Find an element by a selector with multiple fallback strategies
     * @param {string} selector - The selector to try
     * @returns {Element|null} - The found element or null
     */
    findElement(selector) {
      if (!selector) return null;

      try {
        // Try the selector directly
        const element = document.querySelector(selector);
        if (element) return element;

        // If selector failed, try some fallbacks
        // Handle escaped characters that might not work in all browsers
        const unescapedSelector = selector.replace(/\\(.)/g, '$1');
        if (unescapedSelector !== selector) {
          const fallbackElement = document.querySelector(unescapedSelector);
          if (fallbackElement) return fallbackElement;
        }

        return null;
      } catch (e) {
        console.error('Selector error:', e.message, 'for selector:', selector);
        return null;
      }
    },

    /**
     * Get a human-readable description of an element
     * @param {Element} element - The element to describe
     * @returns {string} - A description of the element
     */
    getElementDescription(element) {
      if (!element) return 'Unknown element';

      const tagName = element.tagName.toLowerCase();
      const type = element.getAttribute('type');
      const text = element.textContent?.trim().substring(0, 30);
      const placeholder = element.getAttribute('placeholder');
      const name = element.getAttribute('name');
      const ariaLabel = element.getAttribute('aria-label');

      let desc = tagName;
      if (type) desc += `[type=${type}]`;
      if (name) desc += ` name="${name}"`;
      if (placeholder) desc += ` placeholder="${placeholder}"`;
      if (ariaLabel) desc += ` aria-label="${ariaLabel}"`;
      if (text && tagName === 'button') desc += ` "${text}"`;

      return desc;
    }
  };

  // Export for use in content scripts
  window.SelectorUtils = SelectorUtils;

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SelectorUtils: window.SelectorUtils };
}

