const { SelectorUtils } = require('../../R3-extension/utils/selectors');

describe('SelectorUtils', () => {
    beforeEach(() => {
        // Polyfill CSS.escape since JSDOM doesn't support it
        if (!global.CSS) {
            global.CSS = {};
        }
        global.CSS.escape = (s) => s; // Simple mock for testing

        // Reset the DOM before each test
        document.body.innerHTML = '';
    });

    describe('generateSelector', () => {
        test('should return empty string for invalid input', () => {
            expect(SelectorUtils.generateSelector(null)).toBe('');
            expect(SelectorUtils.generateSelector({})).toBe('');
        });

        test('should prioritize data-testid', () => {
            const element = document.createElement('div');
            element.setAttribute('data-testid', 'test-element');
            element.id = 'some-id';
            document.body.appendChild(element);

            expect(SelectorUtils.generateSelector(element)).toBe('[data-testid="test-element"]');
        });

        test('should prioritize id if valid', () => {
            const element = document.createElement('div');
            element.id = 'valid-id';
            document.body.appendChild(element);

            expect(SelectorUtils.generateSelector(element)).toBe('#valid-id');
        });

        test('should skip dynamic ids', () => {
            const element = document.createElement('div');
            element.id = '12345'; // Numeric ID
            document.body.appendChild(element);

            // Should fall back to something else, e.g., tag name path
            expect(SelectorUtils.generateSelector(element)).not.toBe('#12345');
        });

        test('should usage name attribute', () => {
            const element = document.createElement('input');
            element.setAttribute('name', 'username');
            document.body.appendChild(element);

            expect(SelectorUtils.generateSelector(element)).toBe('input[name="username"]');
        });

        test('should use aria-label', () => {
            const element = document.createElement('button');
            element.setAttribute('aria-label', 'Close');
            document.body.appendChild(element);

            expect(SelectorUtils.generateSelector(element)).toBe('[aria-label="Close"]');
        });

        test('should use placeholder', () => {
            const element = document.createElement('input');
            element.setAttribute('placeholder', 'Enter text');
            document.body.appendChild(element);

            expect(SelectorUtils.generateSelector(element)).toBe('input[placeholder="Enter text"]');
        });
    });

    describe('isValidId', () => {
        test('should return true for valid IDs', () => {
            expect(SelectorUtils.isValidId('my-id')).toBe(true);
            expect(SelectorUtils.isValidId('header')).toBe(true);
        });

        test('should return false for dynamic IDs', () => {
            expect(SelectorUtils.isValidId('12345')).toBe(false);
            expect(SelectorUtils.isValidId('r:123')).toBe(false);
            expect(SelectorUtils.isValidId('a1b2c3d4e5')).toBe(false); // Hex like string
        });
    });

    describe('isDynamicClass', () => {
        test('should detect dynamic classes', () => {
            expect(SelectorUtils.isDynamicClass('css-1a2b3c')).toBe(true);
            expect(SelectorUtils.isDynamicClass('sc-abcdef')).toBe(true);
        });

        test('should accept static classes', () => {
            expect(SelectorUtils.isDynamicClass('btn-primary')).toBe(false);
            expect(SelectorUtils.isDynamicClass('container')).toBe(false);
        });
    });
});
