/**
 * Utility for providing JavaScript autocomplete in textareas.
 */

import { BlockService } from '../services/BlockService.js';
import { ContextService } from '../services/ContextService.js';
import { GenerationService } from '../services/GenerationService.js';
import { GeneratedPlugin } from '../plugins/GeneratedPlugin.js';
import { RewritePlugin } from '../plugins/RewritePlugin.js';
import { ScriptPlugin } from '../plugins/ScriptPlugin.js';
import { AccumulationPlugin } from '../plugins/AccumulationPlugin.js';
import { extStates } from '../core/state.js';

const API_OBJECTS = {
    BlockService,
    ContextService,
    GenerationService,
    GeneratedPlugin,
    RewritePlugin,
    ScriptPlugin,
    AccumulationPlugin,
    extStates,
    context: SillyTavern.getContext(),
    Math,
    JSON,
    Array,
    Object,
    console,
    toastr,
};

/**
 * Extracts parameter names from a function.
 * @param {Function} fn
 * @returns {string}
 */
function getFunctionParams(fn) {
    const str = fn.toString();
    const match = str.match(/\(([^)]*)\)/);
    if (match) {
        return match[0];
    }
    return '()';
}

/**
 * Dynamically extracts properties and methods from an object.
 * @param {Object} obj
 * @returns {string[]}
 */
function getObjectSuggestions(obj) {
    if (!obj) return [];
    const suggestions = new Set();
    
    // Get own properties
    Object.getOwnPropertyNames(obj).forEach(prop => {
        try {
            if (typeof obj[prop] === 'function') {
                suggestions.add(`${prop}${getFunctionParams(obj[prop])}`);
            } else {
                suggestions.add(prop);
            }
        } catch {
            suggestions.add(prop);
        }
    });

    // Get prototype properties (for classes/built-ins)
    const proto = Object.getPrototypeOf(obj);
    if (proto && proto !== Object.prototype) {
        Object.getOwnPropertyNames(proto).forEach(prop => {
            if (prop === 'constructor') return;
            try {
                if (typeof obj[prop] === 'function') {
                    suggestions.add(`${prop}${getFunctionParams(obj[prop])}`);
                } else {
                    suggestions.add(prop);
                }
            } catch {
                suggestions.add(prop);
            }
        });
    }

    return Array.from(suggestions).sort();
}

const GLOBAL_KEYWORDS = [
    ...Object.keys(API_OBJECTS),
    'messageId', 'isUser', 'allBlocks', 'triggeredBlocks', 'additionalMacro', 'is_separate',
    'executeST(text)', 'const', 'let', 'var', 'async', 'await', 'function', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'
];

/**
 * Gets the coordinates of the cursor in a textarea.
 * @param {HTMLTextAreaElement} element 
 * @returns {{top: number, left: number}}
 */
function getCursorCoordinates(element) {
    const { offsetLeft, offsetTop, selectionEnd } = element;
    const div = document.createElement('div');
    const copyStyle = window.getComputedStyle(element);
    
    for (const prop of copyStyle) {
        div.style[prop] = copyStyle[prop];
    }
    
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.height = 'auto';
    div.style.width = element.offsetWidth + 'px';
    
    const textContent = element.value.substring(0, selectionEnd);
    div.textContent = textContent;
    
    const span = document.createElement('span');
    span.textContent = element.value.substring(selectionEnd) || '.';
    div.appendChild(span);
    
    document.body.appendChild(div);
    const { offsetLeft: spanLeft, offsetTop: spanTop } = span;
    document.body.removeChild(div);
    
    return {
        top: offsetTop + spanTop - element.scrollTop,
        left: offsetLeft + spanLeft - element.scrollLeft
    };
}

export class JSAutocomplete {
    /**
     * @param {HTMLTextAreaElement} textarea 
     */
    constructor(textarea) {
        this.textarea = textarea;
        this.popup = null;
        this.suggestions = [];
        this.selectedIndex = 0;
        this.isActive = false;
        
        this.onInput = this.onInput.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onBlur = this.onBlur.bind(this);
        
        this.init();
    }

    init() {
        this.textarea.addEventListener('input', this.onInput);
        this.textarea.addEventListener('keydown', this.onKeyDown);
        this.textarea.addEventListener('blur', this.onBlur);
    }

    destroy() {
        this.textarea.removeEventListener('input', this.onInput);
        this.textarea.removeEventListener('keydown', this.onKeyDown);
        this.textarea.removeEventListener('blur', this.onBlur);
        this.hide();
    }

    onInput() {
        const text = this.textarea.value;
        const pos = this.textarea.selectionEnd;
        const lastChar = text[pos - 1];
        
        if (/\s/.test(lastChar) || pos === 0) {
            this.hide();
            return;
        }

        const beforeCursor = text.substring(0, pos);
        const match = beforeCursor.match(/([a-zA-Z0-9_.]+?)$/);
        
        if (!match) {
            this.hide();
            return;
        }

        const query = match[1];
        this.showSuggestions(query);
    }

    onKeyDown(e) {
        if (!this.isActive) return;

        switch (e.key) {
            case 'ArrowUp':
                e.preventDefault();
                this.selectedIndex = (this.selectedIndex - 1 + this.suggestions.length) % this.suggestions.length;
                this.updateSelection();
                break;
            case 'ArrowDown':
                e.preventDefault();
                this.selectedIndex = (this.selectedIndex + 1) % this.suggestions.length;
                this.updateSelection();
                break;
            case 'Enter':
            case 'Tab':
                e.preventDefault();
                this.selectSuggestion();
                break;
            case 'Escape':
                e.preventDefault();
                this.hide();
                break;
        }
    }

    onBlur() {
        // Delay hiding to allow click on suggestion
        setTimeout(() => this.hide(), 200);
    }

    showSuggestions(query) {
        let list = [];
        let prefix = '';
        
        if (query.includes('.')) {
            const parts = query.split('.');
            const objName = parts[parts.length - 2];
            prefix = parts.slice(0, -1).join('.') + '.';
            const subQuery = parts[parts.length - 1].toLowerCase();
            
            if (API_OBJECTS[objName]) {
                const suggestions = getObjectSuggestions(API_OBJECTS[objName]);
                list = suggestions.filter(s => s.toLowerCase().startsWith(subQuery));
            }
        } else {
            const subQuery = query.toLowerCase();
            list = GLOBAL_KEYWORDS.filter(s => s.toLowerCase().startsWith(subQuery));
        }

        if (list.length === 0) {
            this.hide();
            return;
        }

        this.suggestions = list;
        this.selectedIndex = 0;
        this.renderPopup(prefix);
    }

    renderPopup(prefix) {
        if (!this.popup) {
            this.popup = document.createElement('div');
            this.popup.className = 'dreamalbum-autocomplete-popup';
            document.body.appendChild(this.popup);
        }

        this.popup.innerHTML = '';
        this.suggestions.forEach((s, i) => {
            const item = document.createElement('div');
            item.className = 'dreamalbum-autocomplete-item' + (i === this.selectedIndex ? ' selected' : '');
            item.textContent = s;
            item.onclick = () => {
                this.selectedIndex = i;
                this.selectSuggestion(prefix);
            };
            this.popup.appendChild(item);
        });

        const coords = getCursorCoordinates(this.textarea);
        const rect = this.textarea.getBoundingClientRect();
        
        this.popup.style.display = 'block';
        this.popup.style.left = (rect.left + coords.left) + 'px';
        this.popup.style.top = (rect.top + coords.top + 20) + 'px';
        
        this.isActive = true;
        this.updateSelection();
    }

    updateSelection() {
        if (!this.popup) return;
        const items = this.popup.querySelectorAll('.dreamalbum-autocomplete-item');
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === this.selectedIndex);
            if (i === this.selectedIndex) {
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    selectSuggestion(prefix = '') {
        const suggestion = this.suggestions[this.selectedIndex];
        const text = this.textarea.value;
        const pos = this.textarea.selectionEnd;
        const beforeCursor = text.substring(0, pos);
        const afterCursor = text.substring(pos);
        
        const match = beforeCursor.match(/([a-zA-Z0-9_.]+?)$/);
        const start = match ? pos - match[1].length : pos;
        
        let insertText = suggestion;
        if (queryIncludesDot(beforeCursor.substring(start))) {
            const parts = beforeCursor.substring(start).split('.');
            parts[parts.length - 1] = suggestion;
            insertText = parts.join('.');
        }

        this.textarea.value = text.substring(0, start) + insertText + afterCursor;
        this.textarea.selectionStart = this.textarea.selectionEnd = start + insertText.length;
        
        // Trigger input event for syntax highlighting
        this.textarea.dispatchEvent(new Event('input'));
        
        this.hide();
    }

    hide() {
        if (this.popup) {
            this.popup.style.display = 'none';
        }
        this.isActive = false;
    }
}

function queryIncludesDot(query) {
    return query.includes('.');
}