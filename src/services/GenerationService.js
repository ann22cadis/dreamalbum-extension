import { BlockType, ExtTopic } from '../core/constants.js';
import { extStates } from '../core/state.js';
import { PluginRegistry } from '../core/PluginRegistry.js';
import { BlockService } from './BlockService.js';
import { ApiService } from './ApiService.js';
import { stringToRegex } from '../utils/stringUtils.js';
const { chat } = SillyTavern.getContext();
export const GenerationService = {
    /**
     * Categorizes blocks into generated, rewrite, and script blocks.
     */
    categorizeBlocks(triggeredBlocks) {
        return triggeredBlocks.reduce((acc, block) => {
            if (block.block_type === BlockType.REWRITE) {
                acc.rewriteBlocks.push(block);
            } else if (block.block_type === BlockType.SCRIPT) {
                acc.scriptBlocks.push(block);
            } else {
                acc.generatedBlocks.push(block);
            }
            return acc;
        }, { generatedBlocks: [], rewriteBlocks: [], scriptBlocks: [] });
    },
    /**
     * Orchestrates the generation of blocks, including scripts and rewrites.
     */
    async handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks, additionalMacro = {}, is_separate = false) {
        const { generatedBlocks, rewriteBlocks, scriptBlocks } = this.categorizeBlocks(triggeredBlocks);
        const scriptPlugin = PluginRegistry.get(BlockType.SCRIPT);
        const rewritePlugin = PluginRegistry.get(BlockType.REWRITE);
        const generatedPlugin = PluginRegistry.get(BlockType.GENERATED);
        const options = { messageId, isUser, allBlocks, triggeredBlocks, additionalMacro, is_separate };
        if (scriptPlugin) await scriptPlugin.execute(scriptBlocks, { ...options, execution_order: 'before' });
        if (rewritePlugin) await rewritePlugin.execute(rewriteBlocks, { messageId, allBlocks, generation_order: 'before', additionalMacro });
        let blocksList = [];
        if (generatedPlugin) {
            blocksList = await generatedPlugin.execute(generatedBlocks, { messageId, allBlocks, additionalMacro, is_separate });
        }
        if (rewritePlugin) await rewritePlugin.execute(rewriteBlocks, { messageId, allBlocks, generation_order: 'after', additionalMacro });
        if (scriptPlugin) await scriptPlugin.execute(scriptBlocks, { ...options, execution_order: 'after' });
        return blocksList;
    },
    /**
     * Gets accumulation blocks triggered by the given text.
     */
    getTriggeredAccumulationBlocks(allBlocks, text, isUser) {
        return allBlocks.filter((block) => {
            if (block.block_type !== BlockType.ACCUMULATION) {
                return false;
            }
            const trigger_predicate = isUser ? block.user_message : block.char_message;
            return trigger_predicate && text.includes(`<${block.updater_name}>`);
        });
    },
    /**
     * Orchestrates the accumulation of blocks.
     */
    async handleBlocksAccumulation(messageId, isUser, allBlocks, externalContent = null) {
        const text = externalContent || chat[messageId].mes;
        const triggeredAccumulationBlocks = this.getTriggeredAccumulationBlocks(allBlocks, text, isUser);
        const accumulationPlugin = PluginRegistry.get(BlockType.ACCUMULATION);
        if (accumulationPlugin && triggeredAccumulationBlocks.length > 0) {
            await accumulationPlugin.execute(triggeredAccumulationBlocks, { messageId, externalContent });
        }
    },
    /**
     * Handles message triggers for both user and character messages.
     */
    async handleMessageTrigger(messageId, isUser) {
        const allBlocks = BlockService.getAllEnabledBlocks();
        let messageText = chat[messageId].mes;
        if (extStates.pauseCounter > 0 && !isUser) {
            const messagesToCombine = chat.slice(Math.max(0, messageId - extStates.pauseCounter), messageId + 1);
            messageText = messagesToCombine.map(m => m.mes).join('\n');
        }
        await this.handleBlocksAccumulation(messageId, isUser, allBlocks);
        const triggeredBlocks = allBlocks.filter((block) => {
            if (block.block_type === BlockType.ACCUMULATION) {
                return false;
            }
            if (extStates.generationPaused) {
                if (!block.generation_pause) {
                    return false;
                }
                if (block.keyword && block.keyword !== '') {
                    let keyword_predicate;
                    if (block.keyword_is_regex) {
                        try {
                            const regex = stringToRegex(block.keyword);
                            keyword_predicate = regex.test(chat[messageId].mes);
                        } catch (e) {
                            console.error(`DreamAlbum: Invalid regex for block "${block.name}": ${block.keyword}`, e);
                            keyword_predicate = false;
                        }
                    } else {
                        keyword_predicate = chat[messageId].mes.includes(block.keyword);
                    }
                    return keyword_predicate;
                }
                return false;
            }
            const trigger_predicate = isUser ? block.user_message : block.char_message;
            if (block.keyword && block.keyword !== '') {
                let keyword_predicate;
                if (block.keyword_is_regex) {
                    try {
                        const regex = stringToRegex(block.keyword);
                        keyword_predicate = regex.test(messageText);
                    } catch (e) {
                        console.error(`DreamAlbum: Invalid regex for block "${block.name}": ${block.keyword}`, e);
                        keyword_predicate = false;
                    }
                } else {
                    keyword_predicate = messageText.includes(block.keyword);
                }
                return trigger_predicate && keyword_predicate;
            } else {
                const period_predicate = isUser ? ((messageId - 1) % block.period === 0) : (messageId % block.period === 0);
                return trigger_predicate && period_predicate;
            }
        });
        const generatedBlocksList = await this.handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
        if (generatedBlocksList && generatedBlocksList.length > 0) {
            const combinedGeneratedContent = generatedBlocksList.join('\n');
            await this.handleBlocksAccumulation(messageId, isUser, allBlocks, combinedGeneratedContent);
        }
    },
    /**
     * Handles user message triggers.
     */
    async handleUserTrigger(messageId, is_swipe = false) {
        if (chat[messageId].is_system) {
            return;
        }
        if ((!is_swipe) || (is_swipe && extStates.is_chat_modified && chat[messageId].is_user)) {
            extStates.pauseCounter = 0;
            await BlockService.purgeBlocksExtra(messageId, true);
            extStates.is_chat_modified = false;
            await this.handleMessageTrigger(messageId, true);
        }
    },
    /**
     * Handles character message triggers.
     */
    async handleCharTrigger(messageId) {
        if (['...', ''].includes(chat[messageId]?.mes)) {
            return;
        }
        if (chat[messageId]?.mes.includes('Proxy error')) {
            return;
        }
        await BlockService.purgeBlocksExtra(messageId, true);
        extStates.is_chat_modified = false;
        await this.handleMessageTrigger(messageId, false);
    },
    /**
     * Triggers generation based on a specific style (set).
     */
    async triggerStyleGeneration(set, additionalPrompt = null) {
        const { getContext } = SillyTavern;
        const ctx = getContext();
        const { chat, eventSource, event_types, substituteParams } = ctx;
        
        const apiPresetName = set.api_preset || 'big';
        const preset = ApiService.getApiPreset(apiPresetName);
        const messageId = chat.length - 1;
        const allBlocks = BlockService.getAllEnabledBlocks();
        
        
        const fullContext = BlockService.getBlocksFullPrompt([set], messageId, allBlocks);
        
        let systemContent = '';
        if (preset.include_char_card) {
            if (ctx.groupId !== undefined) {
                const activeGroup = ctx.groups?.find(g => g.id === ctx.groupId);
                if (activeGroup && activeGroup.members) {
                    activeGroup.members.forEach(charId => {
                        const char = ctx.characters?.find(c => c.avatar === charId || c.id == charId);
                        if (char) {
                            systemContent += `Character (${char.name}) Description: ${char.description}\n`;
                        }
                    });
                }
            } else {
                systemContent += substituteParams("{{description}}\n{{personality}}\n{{scenario}}\n\n");
            }
        }
        if (preset.include_persona) {
            systemContent += substituteParams("{{persona}}\n\n");
        }
        if (preset.include_lorebooks) {
            systemContent += substituteParams("{{world_info}}\n\n");
        }
        
        const maxContext = preset.context_size || 10;
        const chatMessages = chat || [];
        const lastMessages = chatMessages
            .filter(m => !m.is_system && m.mes && m.mes.trim() !== '')
            .slice(-maxContext)
            .map(m => {
                let text = `${m.is_user ? 'User' : 'Character'}: ${m.mes}`;
                if (preset.include_previous_blocks && m.extra?.extblocks) {
                    text += `\n[Previously Generated Blocks:\n${m.extra.extblocks.trim()}\n]`;
                }
                return text;
            })
            .join('\n');
        const systemMessage = {
            role: 'system',
            content: `GLOBAL CONTEXT:\n${systemContent}\nCHAT HISTORY:\n${lastMessages}`
        };
        fullContext.unshift(systemMessage);

        if (additionalPrompt && additionalPrompt.trim() !== '') {
            fullContext.push({
                role: 'user',
                content: `[User instruction: ${additionalPrompt.trim()}]`
            });
        }

        const data = await ApiService.generateBlocks(fullContext, apiPresetName);
        const text = ApiService.extractMessageFromData(data, preset);
        await BlockService.addBlocksToExtra(messageId, text);
        if (eventSource) {
            eventSource.emit(ExtTopic.BLOCKS_GENERATED_IIG, { messageId });
            // "Пинок" для расширений генерации картинок
            if (text.includes('<img')) {
                eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, 'DreamAlbum');
            }
        } else {
            console.warn('[DreamAlbum] eventSource is not available to emit BLOCKS_GENERATED_IIG');
        }
        
        return text;
    }
};