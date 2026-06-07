import { BlockType, MessageRole, ContextType } from '../core/constants.js';

const { uuidv4 } = SillyTavern.getContext();

/**
 * Service for managing editor state and shared logic.
 */
export const EditorService = {
    /**
     * Creates a new context item with default values based on type.
     * @param {string} type - The ContextType.
     * @returns {Object}
     */
    createContextItem(type) {
        const item = {
            id: uuidv4(),
            name: '',
            role: MessageRole.USER,
            type: type,
            disabled: false,
        };

        if (type === ContextType.TEXT) {
            item.text = '';
        } else if (type === ContextType.LAST_MESSAGES) {
            item.messages_count = 10;
            item.messages_offset = 0;
            item.messages_separator = 'double_newline';
            item.user_prefix = '';
            item.user_suffix = '';
            item.char_prefix = '';
            item.char_suffix = '';
        } else if (type === ContextType.LAST_MESSAGES_KEYWORD) {
            item.keyword_stopper = '';
            item.messages_separator = 'double_newline';
            item.user_prefix = '';
            item.user_suffix = '';
            item.char_prefix = '';
            item.char_suffix = '';
        } else if (type === ContextType.PREVIOUS_BLOCK) {
            item.block_name = '';
            item.block_count = 1;
        }

        return item;
    },

    /**
     * Validates a context item.
     * @param {Object} item 
     * @returns {boolean}
     */
    validateContextItem(item) {
        return !!(item.name && item.name.trim() !== '');
    },

    /**
     * Prepares a block object for saving, ensuring all fields are present.
     * @param {Object} blockData - Raw data from the editor.
     * @returns {Object}
     */
    prepareBlockForSave(blockData) {
        const type = blockData.block_type || BlockType.GENERATED;
        const base = this._getBaseBlock(blockData);

        switch (type) {
            case BlockType.GENERATED:
            case BlockType.REWRITE:
                return { ...base, ...this._getGeneratedFields(blockData) };
            case BlockType.ACCUMULATION:
                return { ...base, ...this._getAccumulationFields(blockData) };
            case BlockType.SCRIPT:
                return { ...base, ...this._getScriptFields(blockData) };
            default:
                return base;
        }
    },

    /**
     * Returns universal fields for all block types.
     */
    _getBaseBlock(data) {
        return {
            id: data.id || uuidv4(),
            name: String(data.name || '').trim(),
            block_type: data.block_type || BlockType.GENERATED,
            disabled: !!data.disabled,
            user_message: !!data.user_message,
            char_message: !!data.char_message,
        };
    },

    /**
     * Returns fields specific to Generated and Rewrite blocks.
     */
    _getGeneratedFields(data) {
        return {
            template: String(data.template || ''),
            prompt: String(data.prompt || ''),
            generation_pause: !!data.generation_pause,
            period: parseInt(data.period) || 2,
            keyword: String(data.keyword || ''),
            keyword_is_regex: !!data.keyword_is_regex,
            hide_display: !!data.hide_display,
            inject_block: !!data.inject_block,
            injection_role: parseInt(data.injection_role) || 0,
            injection_position: parseInt(data.injection_position) || 0,
            injection_depth: parseInt(data.injection_depth) || 4,
            generation_order: data.generation_order || 'before',
            background: !!data.background,
            context: Array.isArray(data.context) ? data.context : [],
            api_preset: data.api_preset || 'big'
        };
    },

    /**
     * Returns fields specific to Accumulation blocks.
     */
    _getAccumulationFields(data) {
        return {
            updater_name: String(data.updater_name || '').trim(),
            hide_display: !!data.hide_display,
            inject_block: !!data.inject_block,
            injection_role: parseInt(data.injection_role) || 0,
            injection_position: parseInt(data.injection_position) || 0,
            injection_depth: parseInt(data.injection_depth) || 4,
        };
    },

    /**
     * Returns fields specific to Script blocks.
     */
    _getScriptFields(data) {
        return {
            script_type: data.script_type || 'stscript',
            script: String(data.script || ''),
            generation_pause: !!data.generation_pause,
            period: parseInt(data.period) || 2,
            keyword: String(data.keyword || ''),
            keyword_is_regex: !!data.keyword_is_regex,
            execution_order: data.execution_order || 'before',
        };
    }
};