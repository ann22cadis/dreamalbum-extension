import { getFileText } from '../../../../../utils.js';
import { extStates } from '../core/state.js';
import { extName, BlockType, defaultExtPrefix, MessageRole } from '../core/constants.js';
import { ContextService } from './ContextService.js';
import { ApiService } from './ApiService.js';
import { getRegexForBlock, getBlockFromMessage, wrapInDAContainer, checkAttributesInBlockName } from '../utils/blockUtils.js';
import { updateOrInsert } from '../utils/dataUtils.js';

const {
    saveSettingsDebounced,
    writeExtensionField,
    characters,
    chat,
    updateMessageBlock,
    saveChat,
    uuidv4,
    reloadCurrentChat,
    extensionSettings,
    setExtensionPrompt,
    extensionPrompts,
    substituteParams
} = SillyTavern.getContext();

export const BlockService = {
    /**
     * Gets all blocks (global + scoped) combined with priority.
     */
    getAllBlocks() {
        const context = SillyTavern.getContext();
        let embeddedBlocks = [];

        if (context.groupId !== undefined && context.groups) {
            const group = context.groups.find(g => g.id === context.groupId);
            embeddedBlocks = (group && group.data && group.data.extensions) ? group.data.extensions.DreamAlbum ?? [] : [];
        } else if (context.characterId !== undefined && characters[context.characterId]) {
            const char = characters[context.characterId];
            embeddedBlocks = (char.data && char.data.extensions) ? char.data.extensions.DreamAlbum ?? [] : [];
        }

        const globalBlocks = extStates.current_set?.global_blocks ?? [];
        // ... rest of function ...

        const combined = {};
        if (Array.isArray(embeddedBlocks)) {
            embeddedBlocks.forEach(obj => {
                combined[obj.name] = obj;
            });
        }

        if (Array.isArray(globalBlocks)) {
            globalBlocks.forEach(obj => {
                if (!combined[obj.name]) {
                    combined[obj.name] = obj;
                }
            });
        }
        return Object.values(combined);
    },

    /**
     * Gets all enabled blocks.
     */
    getAllEnabledBlocks() {
        return this.getAllBlocks().filter(item => !item.disabled);
    },

    /**
     * Gets blocks by type.
     */
    getBlocksByType(types, enabledOnly = false) {
        const blocks = enabledOnly ? this.getAllEnabledBlocks() : this.getAllBlocks();
        return blocks.filter(block => types.includes(block.block_type ?? BlockType.GENERATED));
    },

    /**
     * Saves or updates a block.
     */
    async saveBlock(block, index, isScoped) {
        const array = this._getBlockArray(isScoped);

        if (!block.id) {
            block.id = uuidv4();
        }

        if (!block.name) {
            toastr.error('Could not save block: The block name was undefined or empty!');
            return;
        }

        const existingData = array.find((e) => e.name === block.name);
        if (existingData && index === -1) {
            toastr.error('Could not save block: The block name must be unique.');
            return;
        }

        if (index !== -1) {
            array[index] = block;
        } else {
            array.push(block);
        }

        if (isScoped) {
            const context = SillyTavern.getContext();
            if (context.characterId === undefined && context.groupId === undefined) {
                toastr.error('No character or group selected.');
                return;
            }

            if (context.characterId !== undefined) {
                await writeExtensionField(context.characterId, extName, array);
            } else if (context.groupId !== undefined) {
                const group = context.groups?.find(g => g.id === context.groupId);
                if (group) {
                    if (!group.data) group.data = {};
                    if (!group.data.extensions) group.data.extensions = {};
                    group.data.extensions[extName] = array;
                }
            }
        }

        saveSettingsDebounced();
    },

    /**
     * Deletes a block by ID.
     */
    async deleteBlock(id, isScoped) {
        const array = this._getBlockArray(isScoped);
        const index = array.findIndex((block) => block.id === id);

        if (index !== -1) {
            array.splice(index, 1);
            if (isScoped) {
                const context = SillyTavern.getContext();
                if (context.characterId !== undefined) {
                    await writeExtensionField(context.characterId, extName, array);
                } else if (context.groupId !== undefined) {
                    const group = context.groups?.find(g => g.id === context.groupId);
                    if (group) {
                        if (!group.data) group.data = {};
                        if (!group.data.extensions) group.data.extensions = {};
                        group.data.extensions[extName] = array;
                    }
                }
            }
            saveSettingsDebounced();
        }
    },

    /**
     * Purges display text for a message.
     */
    purgeBlocksDisplayText(messageId) {
        if (chat[messageId]?.extra?.display_text) {
            delete chat[messageId].extra.display_text;
        }
    },

    /**
     * Purges block storage from a message.
     */
    async purgeBlocksExtra(messageId, noUpdate = false) {
        const message = chat[messageId];
        if (!message || !message.extra) return;

        message.extra.extblocks = '';

        if (message.swipe_id) {
            const current_swipe_id = message.swipe_id;
            if (message.swipe_info?.[current_swipe_id]?.extra) {
                message.swipe_info[current_swipe_id].extra.extblocks = '';
            }
        }

        if (!noUpdate) {
            await this.updateBlocksDisplay(messageId);
            await saveChat();
        }
    },

    /**
     * Purges display text for all messages in the chat.
     */
    async purgeAllBlocksDisplayText() {
        for (let messageId = 0; messageId < chat.length; messageId++) {
            const message = chat[messageId];
            if (message?.extra?.display_text) {
                delete message.extra.display_text;
            }
            updateMessageBlock(messageId, message, { rerenderMessage: true });
        }
        await saveChat();
    },

    /**
     * Gets blocks from message extra storage.
     */
    getBlocksFromExtra(messageId) {
        return chat[messageId]?.extra?.extblocks || '';
    },

    /**
     * Gets all enabled blocks as a combined string from previous messages.
     */
    getAllPreviousBlocks() {
        const blocks = this.getAllEnabledBlocks();
        let blocksStrArray = [];
        blocks.forEach(block => {
            blocksStrArray.push(ContextService.getPreviousBlockContextUnconditional(block, chat.length - 1, true).trim());
        });

        return blocksStrArray.join('\n\n');
    },

    /**
     * Adds blocks to message extra storage.
     */
    async addBlocksToExtra(messageId, blocksStr) {
        let effectiveId = Math.max(Math.min(messageId, chat.length - 1), 0);
        const message = chat[effectiveId];
        if (!message) return;

        if (!message.extra) message.extra = {};

        // Auto-wrap block if not already wrapped in a known block tag name
        const allBlocks = this.getAllBlocks();
        const trimStr = blocksStr.trim();
        const startTagMatch = trimStr.match(/^<([^\s>]+)/);
        const startTagName = startTagMatch ? startTagMatch[1] : '';
        const isWrapped = allBlocks.some(b => {
            const { upper_block_name } = checkAttributesInBlockName(b.name);
            return upper_block_name.toLowerCase() === startTagName.toLowerCase();
        });

        let finalBlocksStr = blocksStr;
        if (!isWrapped && startTagName.toLowerCase() !== 'div') {
            const genBlock = allBlocks.find(b => !b.disabled && (b.block_type ?? BlockType.GENERATED) === BlockType.GENERATED);
            const blockName = genBlock ? genBlock.name : 'DreamAlbum';
            finalBlocksStr = `<${blockName}>\n${blocksStr.trim()}\n</${blockName}>`;
        }

        // Deduplicate: remove old entries for the same block names before adding new ones
        const blockNames = [...finalBlocksStr.matchAll(/<([^\/\s>]+)/g)].map(match => match[1]);
        const purgeBlocks = (content) => {
            let result = content || '';
            for (const name of blockNames) {
                const purgeRegex = new RegExp(getRegexForBlock(name), 'g');
                result = result.replace(purgeRegex, '').trim();
            }
            return result;
        };

        const currentExtBlocks = purgeBlocks(message.extra.extblocks);
        message.extra.extblocks = (currentExtBlocks === '' ? finalBlocksStr : `${currentExtBlocks}\n${finalBlocksStr}`).trim();

        if (message.swipe_id) {
            const swipeId = message.swipe_id;
            if (!message.swipe_info) message.swipe_info = {};
            if (!message.swipe_info[swipeId]) {
                message.swipe_info[swipeId] = structuredClone({
                    send_date: message.send_date,
                    gen_started: message.gen_started,
                    gen_finished: message.gen_finished,
                    extra: {},
                });
            };
            if (!message.swipe_info[swipeId].extra) message.swipe_info[swipeId].extra = {};

            const swipeExtra = message.swipe_info[swipeId].extra;
            const currentSwipeExtBlocks = purgeBlocks(swipeExtra.extblocks);
            swipeExtra.extblocks = (currentSwipeExtBlocks === '' ? finalBlocksStr : `${currentSwipeExtBlocks}\n${finalBlocksStr}`).trim();
        }

        if (finalBlocksStr) {
            console.log(`[DreamAlbum] Adding blocks to message ${effectiveId}:`, finalBlocksStr);
        }
        
        // Add a small delay to ensure no race conditions with other extensions
        setTimeout(async () => {
            await this.updateBlocksDisplay(effectiveId);
            await saveChat();
        }, 100);
    },

    /**
     * Updates the display text of a message based on its blocks.
     * Mirrors the reference ext-blocks-custom-master implementation:
     * filters by getAllBlocks() order and hide_display flag, does NOT use rerenderMessage.
     */
    async updateBlocksDisplay(messageId) {
        const message = chat[messageId];
        if (!message) return;

        if (!message.extra?.extblocks) {
            if (message.extra?.display_text) {
                delete message.extra.display_text;
            }
        } else {
            const allBlocks = this.getAllBlocks();
            const blocksToDisplay = [];
            
            // Get all block tag names actually present in extblocks content
            const presentBlockNames = [...message.extra.extblocks.matchAll(/<([^\/\s>]+)/g)].map(match => match[1]);
            const uniqueNames = [...new Set(presentBlockNames)];

            for (const tagName of uniqueNames) {
                // If it is a standard HTML tag inside a block (e.g. img), getBlockFromMessage will return empty, so it is safe.
                const blockConfig = allBlocks.find(b => b.name.toLowerCase() === tagName.toLowerCase());
                if (blockConfig && blockConfig.hide_display) {
                    continue;
                }

                const blockContent = getBlockFromMessage(message.extra.extblocks, tagName);
                if (blockContent) {
                    // All blocks are wrapped in a standard container for better rendering
                    blocksToDisplay.push(wrapInDAContainer(tagName, blockContent));
                }
            }
            if (blocksToDisplay.length === 0) {
                console.warn(`[DreamAlbum] No valid blocks found to display for message ${messageId} in extblocks content:`, message.extra.extblocks);
            } else {
                console.log(`[DreamAlbum] Prepared ${blocksToDisplay.length} blocks for display in message ${messageId}`);
            }
            message.extra.display_text = message.mes + `\n${blocksToDisplay.join('\n')}`;
        }

        // Trigger rerenderMessage to ensure the new blocks appear in the chat UI
        updateMessageBlock(messageId, message, { rerenderMessage: true });
    },

    /**
     * Updates display text for all messages in the chat.
     */
    async updateAllBlocksDisplayText() {
        try {
            for (let messageId = chat.length - 1; messageId >= 0; messageId--) {
                await this.updateBlocksDisplay(messageId);
            }
        } catch (e) {
            // ignore
        }

        await saveChat();
    },

    /**
     * Gets the full prompt for a group of blocks, including context and template.
     */
    getBlocksFullPrompt(blocks, messageId, allBlocks, additionalMacro = {}) {
        const context = SillyTavern.getContext();
        if (context.characterId === undefined && context.groupId === undefined) {
            return [];
        }

        const isGenerated = blocks.some(b => (b.block_type ?? BlockType.GENERATED) === BlockType.GENERATED);

        const combinedTemplate = blocks.map(block => block.template ? substituteParams(block.template, { dynamicMacros: additionalMacro }) : '').filter(t => t !== '').join('\n');
        const combinedPrompt = blocks.map(block => block.prompt ? substituteParams(block.prompt, { dynamicMacros: additionalMacro }) : '').filter(p => p !== '').join('\n');
        
        let finalInstruction = '';
        if (combinedPrompt) finalInstruction += `### Block(s) prompt:\n${combinedPrompt}\n\n`;
        if (combinedTemplate) finalInstruction += `### Block(s) template:\n${combinedTemplate}\n\n`;
        finalInstruction += `Strictly output exactly one tag.`;

        let combinedContext = [];
        if (blocks.length > 0) {
            combinedContext = ContextService.getBlockCombinedContext(blocks[0], messageId, allBlocks, additionalMacro);

            // Inject extra context based on API preset
            const apiPresetName = blocks[0].api_preset || 'big';
            const preset = ApiService.getApiPreset(apiPresetName);
            
            let extraContext = '';
            if (preset.include_char_card) {
                if (context.groupId !== undefined) {
                    const activeGroup = context.groups?.find(g => g.id === context.groupId);
                    if (activeGroup && activeGroup.members) {
                        activeGroup.members.forEach(charId => {
                            const char = context.characters?.find(c => c.id == charId);
                            if (char) {
                                extraContext += `Character (${char.name}) Description: ${char.description}\n`;
                            }
                        });
                    }
                } else {
                    extraContext += `Character (${context.name2}) Description: ${context.description}\n`;
                }
            }

            if (preset.include_persona) {
                extraContext += `User (${context.name1}) Description: ${context.user_description || 'No description provided'}\n`;
            }

            if (preset.include_lorebooks) {
                const wi = substituteParams('{{wiAll}}');
                if (wi && wi !== '{{wiAll}}') {
                    extraContext += `World Info:\n${wi}\n`;
                }
            }

            if (extraContext) {
                combinedContext.unshift({
                    role: MessageRole.SYSTEM,
                    content: `CONTEXT INFORMATION:\n${extraContext.trim()}`
                });
            }
        }

        // Context limiting for generated blocks (images) to avoid character dialogue drift
        if (isGenerated && combinedContext.length > 10) {
            // Keep first message (often system/lore/extra context we just added) and last 9 messages
            combinedContext = [combinedContext[0], ...combinedContext.slice(-9)];
        }

        if (isGenerated) {
            // For images (generated), we safely append the instruction while maintaining role alternating rules
            const lastMsg = combinedContext[combinedContext.length - 1];
            if (lastMsg && lastMsg.role === MessageRole.USER) {
                lastMsg.content += `\n\n${finalInstruction}`;
            } else {
                combinedContext.push({
                    role: MessageRole.USER,
                    content: finalInstruction
                });
            }
        } else {
            // Traditional behavior for other types
            if (combinedContext.length > 0 && combinedContext[0].role === MessageRole.SYSTEM) {
                combinedContext[0].content = `${combinedPrompt}\n\n${combinedTemplate}\n\n${combinedContext[0].content}`;
            } else if (combinedContext.length > 0) {
                combinedContext.unshift({ role: MessageRole.SYSTEM, content: `${combinedPrompt}\n\n${combinedTemplate}` });
            } else {
                combinedContext = [{ role: MessageRole.USER, content: `${combinedPrompt}\n\n${combinedTemplate}` }];
            }
        }

        return combinedContext;
    },

    /**
     * Gets the full prompt for a single block, including context and template.
     */
    getSingleBlockFullPrompt(block, messageId, allBlocks, additionalMacro = {}) {
        if (messageId === undefined) {
            messageId = chat.length - 1;
        }
        if (allBlocks === undefined) {
            allBlocks = this.getAllEnabledBlocks();
        }
        return this.getBlocksFullPrompt([block], messageId, allBlocks, additionalMacro);
    },

    /**
     * Handles swipe block extra storage.
     */
    async swipeBlockExtra(messageId, swipeId, updateDisplay = true) {
        const message = chat[messageId];
        if (!message) return;

        if (message.swipe_info?.[swipeId]?.extra?.extblocks) {
            message.extra.extblocks = message.swipe_info[swipeId].extra.extblocks;
        } else {
            message.extra.extblocks = '';
        }

        if (updateDisplay) {
            await this.updateBlocksDisplay(messageId);
            await saveChat();
        }
    },

    /**
     * Sets the first swipe block extra storage.
     */
    firstSwipeBlockExtra(messageId) {
        const message = chat[messageId];
        if (!message || !message.extra) return;

        if (!message.swipe_info) message.swipe_info = {};
        if (!message.swipe_info[0]) {
            message.swipe_info[0] = {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: {},
            };
        };
        if (!message.swipe_info[0].extra) message.swipe_info[0].extra = {};

        message.swipe_info[0].extra.extblocks = message.extra.extblocks || '';
    },

    /**
     * Checks for blocks in the first message and moves them to extra storage.
     */
    async checkBlocksInFirstMessage() {
        if (!chat[0]) return;

        const allBlocks = this.getAllBlocks();
        const allBlocksPurgeRegex = new RegExp(`${allBlocks.map(block => getRegexForBlock(block.name)).join('|')}`, 'g');

        let blocksStr = '';
        for (let idx = 0; idx < allBlocks.length; idx++) {
            const block = allBlocks[idx];
            const enclosedBlock = getBlockFromMessage(chat[0].mes, block.name);
            if (enclosedBlock !== '') {
                blocksStr += blocksStr === '' ? enclosedBlock : `\n${enclosedBlock}`
            }
        }

        if (blocksStr !== '') {
            blocksStr = blocksStr.replaceAll(/\r/g, '');
            chat[0].mes = chat[0].mes.replaceAll(allBlocksPurgeRegex, '').trim();
            await this.addBlocksToExtra(0, blocksStr);
        }
    },

    async extractBlocksFromMessage(messageId) {
        const message = chat[messageId];
        if (!message || !message.mes) return false;

        const allBlocks = this.getAllEnabledBlocks();
        if (allBlocks.length === 0) return false;

        let blocksStr = '';
        let modifiedMes = message.mes;
        let hasFoundAny = false;

        // 1. First, search for tagged blocks
        for (const block of allBlocks) {
            // Regex from blockUtils now supports unclosed/self-closing tags
            const regex = new RegExp(getRegexForBlock(block.name), 'g');
            const matches = modifiedMes.match(regex);
            
            if (matches) {
                hasFoundAny = true;
                for (const match of matches) {
                    blocksStr += (blocksStr === '' ? match : `\n${match}`);
                    modifiedMes = modifiedMes.replace(match, '');
                }
            }
        }

        // 2. Special case: if it contains an image tag [IMG:GEN:...] or [IMG:...] but wasn't tagged
        if (modifiedMes.trim().match(/\[IMG:(?:GEN:)?([^\]]+)\]/i)) {
            const imageBlock = allBlocks.find(b => (b.block_type ?? BlockType.GENERATED) === BlockType.GENERATED);
            if (imageBlock) {
                const imgMatch = modifiedMes.trim().match(/\[IMG:(?:GEN:)?([^\]]+)\]/i)[0];
                const wrapped = `<${imageBlock.name}>${imgMatch}</${imageBlock.name}>`;
                blocksStr += (blocksStr === '' ? wrapped : `\n${wrapped}`);
                modifiedMes = modifiedMes.replace(imgMatch, '');
                hasFoundAny = true;
            }
        }

        if (hasFoundAny) {
            message.mes = modifiedMes.trim();
            
            // Sync with swipes if necessary
            if (message.swipe_id !== undefined && message.swipes) {
                message.swipes[message.swipe_id] = message.mes;
            }

            await this.addBlocksToExtra(messageId, blocksStr);
            return true;
        }

        // Always ensure rendering is updated if we have something in extblocks
        if (message.extra?.extblocks) {
            await this.updateBlocksDisplay(messageId);
        }

        return false;
    },

    /**
     * Imports a block from a JSON object.
     */
    async importBlock(blockOrFile, isScoped) {
        let block = blockOrFile;

        if (blockOrFile instanceof File) {
            try {
                const fileText = await getFileText(blockOrFile);
                block = JSON.parse(fileText);
            } catch (error) {
                console.error(error);
                toastr.error('Invalid JSON file.');
                return false;
            }
        }

        if (!block || !block.name) {
            toastr.error('Could not import block: No name provided.');
            return false;
        }

        if (!block.id) {
            block.id = uuidv4();
        }

        const array = this._getBlockArray(isScoped);
        const existingData = array.find((e) => e.id === block.id);
        const idx = updateOrInsert(array, block);

        if (existingData && idx === array.length - 1) {
            toastr.error('Could not import block: The block id must be unique.');
            array.splice(idx, 1);
            return false;
        }

        if (isScoped) {
            const context = SillyTavern.getContext();
            if (context.characterId === undefined && context.groupId === undefined) {
                toastr.error('No character or group selected.');
                return false;
            }

            if (context.characterId !== undefined) {
                await writeExtensionField(context.characterId, extName, array);
            } else if (context.groupId !== undefined) {
                const group = context.groups?.find(g => g.id === context.groupId);
                if (group) {
                    if (!group.data) group.data = {};
                    if (!group.data.extensions) group.data.extensions = {};
                    group.data.extensions[extName] = array;
                }
            }
        }

        saveSettingsDebounced();
        toastr.success(`DreamAlbum block "${block.name}" imported.`);
        return true;
    },

    /**
     * Injects a block into the extension prompt.
     */
    injectBlock(block, blockConfig) {
        const key = `${defaultExtPrefix} ${blockConfig.name}`;
        const position = blockConfig.injection_position;
        const role = blockConfig.injection_role;
        let depth = blockConfig.injection_depth;
        if (depth < 0) {
            depth = chat.length - depth;
        }
        setExtensionPrompt(key, block, position, depth, true, role);
    },

    /**
     * Injects all enabled blocks into the extension prompt.
     */
    injectAllEnabledBlocks(messageId) {
        const allBlocks = this.getAllEnabledBlocks();
        allBlocks.forEach(blockConfig => {
            if (blockConfig.inject_block && blockConfig.block_type !== BlockType.REWRITE && blockConfig.block_type !== BlockType.SCRIPT) {
                const previous_block_full = ContextService.getPreviousBlockContextUnconditional(blockConfig, messageId, true, 1);
                if (previous_block_full) {
                    const previous_block_content = getBlockFromMessage(previous_block_full, blockConfig.name);
                    this.injectBlock(previous_block_content, blockConfig);
                } else {
                    this.injectBlock('', blockConfig);
                }
            } else if (!blockConfig.inject_block && blockConfig.block_type !== BlockType.REWRITE && blockConfig.block_type !== BlockType.SCRIPT) {
                this.removeBlockInject(blockConfig);
            }
        });
    },

    /**
     * Removes the block inject from the extension prompt.
     */
    removeBlockInject(blockConfig) {
        const blockKey = `${defaultExtPrefix} ${blockConfig.name}`;
        for (const key of Object.keys(extensionPrompts)) {
            if (key === blockKey) {
                delete extensionPrompts[key];
            }
        }
    },

    /**
     * Removes all block injects from the extension prompt.
     */
    removeAllBlockInjects() {
        for (const key of Object.keys(extensionPrompts)) {
            if (key.startsWith(defaultExtPrefix)) {
                delete extensionPrompts[key];
            }
        }
    },

    /**
     * Reloads the current chat if enabled.
     */
    async selfReloadCurrentChat() {
        const context = SillyTavern.getContext();
        if ((context.characterId !== undefined || context.groupId !== undefined) && extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
            extStates.self_reload_flag = true;
            await reloadCurrentChat();
        }
    },

    /**
     * Updates display text for blocks.
     */
    async updateDisplayForBlocks() {
        const context = SillyTavern.getContext();
        if (context.characterId !== undefined || context.groupId !== undefined) {
            await this.updateAllBlocksDisplayText();
        }
    },

    /**
     * Internal helper to get the correct block array.
     */
    _getBlockArray(isScoped) {
        if (isScoped) {
            const context = SillyTavern.getContext();
            if (context.groupId !== undefined) {
                const group = context.groups?.find(g => g.id === context.groupId);
                return group?.data?.extensions?.DreamAlbum ?? [];
            }
            return characters[context.characterId]?.data?.extensions?.DreamAlbum ?? [];
        }
        return extStates.current_set?.global_blocks ?? [];
    }
};