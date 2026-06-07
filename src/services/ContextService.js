import { getRegexedString } from '../../../../../extensions/regex/engine.js'
import { extStates } from '../core/state.js';
import { ContextType, MessageRole } from '../core/constants.js';
import { getBlockFromMessage } from '../utils/blockUtils.js';

const { 
    substituteParams, 
    chat 
} = SillyTavern.getContext();

export const ContextService = {
    /**
     * Gets the combined context for a block.
     */
    getBlockCombinedContext(block, messageId, allBlocks, additionalMacro = {}) {
        const contextMessages = [];
        let currentRole = null;
        let currentContent = [];
        
        const flushCurrent = () => {
            if (currentContent.length > 0) {
                contextMessages.push({
                    role: currentRole || MessageRole.USER,
                    content: currentContent.join('\n')
                });
                currentContent = [];
            }
        };
        flushCurrent();

        if (Array.isArray(block.context)) {
            block.context.forEach((context_item) => {
                if (context_item.disabled) return;
                const content = this.getContextItemContent(context_item, messageId, allBlocks, additionalMacro);
                if (!content) return;

                const role = context_item.role || MessageRole.USER;
                if (role !== currentRole) {
                    flushCurrent();
                    currentRole = role;
                }
                currentContent.push(content);
            });
        }

        flushCurrent();
        return contextMessages;
        },

    /**
     * Gets the content for a single context item.
     */
    getContextItemContent(context_item, messageId, allBlocks, additionalMacro) {
        if (context_item.type === ContextType.TEXT) {
            return substituteParams(context_item.text, { dynamicMacros: additionalMacro });
        } else if (context_item.type === ContextType.LAST_MESSAGES || context_item.type === ContextType.LAST_MESSAGES_KEYWORD) {
            return this.getLastMessagesContext(context_item, messageId);
        } else if (context_item.type === ContextType.PREVIOUS_BLOCK) {
            return this.getPreviousBlockContext(context_item, messageId, allBlocks);
        }
        return '';
    },

    /**
     * Gets context from last messages.
     */
    getLastMessagesContext(item, messageId) {
        let lastMessages;
        let messages_count = item.messages_count;
        const sliced_chat = chat.slice(0, messageId + 1);
        let visibleChat = sliced_chat.filter(message => message.is_system !== true);
        const offset = item.messages_offset ?? 0;
        
        if (offset > 0 && visibleChat.length > offset) {
            visibleChat = visibleChat.slice(0, -offset);
        }

        if (messages_count === undefined) {
            const keyword_stopper = item.keyword_stopper;
            if (keyword_stopper && keyword_stopper !== '') {
                let lastMessageId;
                if (extStates.pauseCounter > 0) {
                    const last_message_combined = visibleChat.slice(-extStates.pauseCounter - 1).map(m => m.mes).join('\n');
                    if (last_message_combined.includes(keyword_stopper)) {
                        lastMessageId = visibleChat.slice(0, -extStates.pauseCounter - 1).findLastIndex(message => message.mes.includes(keyword_stopper));
                    } else {
                        lastMessageId = visibleChat.slice(0, -1).findLastIndex(message => message.mes.includes(keyword_stopper));
                    }
                } else {
                    lastMessageId = visibleChat.slice(0, -1).findLastIndex(message => message.mes.includes(keyword_stopper));
                }
                if (lastMessageId === -1) {
                    lastMessageId = 0;
                }
                messages_count = visibleChat.length - lastMessageId;
            } else {
                return '';
            }
        }

        if (messages_count > 0) {
            lastMessages = visibleChat.slice(-messages_count);
        } else if (messages_count < 0) {
            lastMessages = visibleChat.slice(0, -messages_count);
        } else {
            return '';
        }

        let separator;
        if (item.messages_separator === 'newline') {
            separator = '\n';
        } else if (item.messages_separator === 'space') {
            separator = ' ';
        } else {
            separator = '\n\n';
        }

        const dreamAlbumSettings = SillyTavern.getContext().extensionSettings?.DreamAlbum || {};
        const activePresetName = dreamAlbumSettings.active_api_preset || 'big';
        const preset = dreamAlbumSettings.api_presets?.[activePresetName] || {};
        const includeBlocks = preset.include_previous_blocks;

        const combinedLastMessages = lastMessages.map((message, index) => {
            const is_user_message = message.is_user;
            let prefix = is_user_message ? item.user_prefix : item.char_prefix;
            prefix = substituteParams(prefix);
            let suffix = is_user_message ? item.user_suffix : item.char_suffix;
            suffix = substituteParams(suffix);
            const placement = is_user_message ? 1 : 2;
            const depth = messages_count - index - 1;
            
            let text = `${prefix}${getRegexedString(message.mes.trim(), placement, {depth: depth, isPrompt: true})}${suffix}`;
            if (includeBlocks && message.extra?.extblocks) {
                text += `\n[Previously Generated Blocks:\n${message.extra.extblocks.trim()}\n]`;
            }
            return text;
        }).join(separator);

        return combinedLastMessages;
    },

    /**
     * Gets context from a previous block.
     */
    getPreviousBlockContext(item, messageId, allBlocks) {
        const previousBlockConfig = allBlocks.find(obj => obj.name === item.block_name);
        if (previousBlockConfig) {
            return this.getPreviousBlockContextUnconditional(previousBlockConfig, messageId, false, item.block_count);
        }
        return '';
    },

    /**
     * Gets context from a previous block without conditions.
     */
    getPreviousBlockContextUnconditional(block, messageId, may_current = false, count = 1) {
        const blocks = [];
        if (count === undefined || count < 1) {
            count = 1;
        }
        const startId = messageId - (may_current ? 0 : 1);

        for (let i = startId; i >= 0 && blocks.length < count; i--) {
            const message = chat[i];
            if (message.extra?.extblocks) {
                const blockContent = getBlockFromMessage(message.extra.extblocks, block.name);
                if (blockContent !== '') {
                    blocks.push(blockContent);
                }
            }
        }

        return blocks.reverse().join('\n\n');
    }
};