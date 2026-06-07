import { defaultExtPrefix, ExtTopic } from '../core/constants.js';
import { extStates } from '../core/state.js';
import {
    stringToRegex,
    removeAfterRegexMatch,
    removeAfterSubstring
} from '../utils/stringUtils.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { MacroService } from '../services/MacroService.js';
import { SettingsService } from '../services/SettingsService.js';
import { MainUI } from './MainUI.js';
import { FloatingUI } from './FloatingUI.js';
import { getRegexForBlock } from '../utils/blockUtils.js';
const {
    eventSource,
    event_types,
    chat,
    extensionSettings,
    saveSettingsDebounced,
    updateMessageBlock,
    saveChat,
    stopGeneration,
    callPopup
} = SillyTavern.getContext();
export const EventController = {
    /**
     * Initializes all event listeners for the extension.
     */
    init() {
        FloatingUI.init();
        
        eventSource.makeFirst(event_types.CHAT_CHANGED, async () => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                FloatingUI.render(); // Clear if disabled
                return;
            }
            const context = SillyTavern.getContext();
            if (context.characterId === undefined && context.groupId === undefined) {
                FloatingUI.render(); // Clear if no chat
                return;
            }
            if (extStates.self_reload_flag) {
                extStates.self_reload_flag = false;
            } else {
                extStates.is_chat_modified = false;
                await MainUI.loadBlocks();
                extStates.cachedPauseBlocks = null;
                extStates.pauseCounter = 0;
            }
            
            setTimeout(() => {
                MainUI.attachAllBlockWrappers();
                FloatingUI.render();
            }, 500);
            MainUI.addEditButtons();
        });
        eventSource.makeFirst(event_types.MESSAGE_EDITED, () => {
            extStates.is_chat_modified = true;
        });
        eventSource.makeLast(event_types.MESSAGE_UPDATED, async (messageId) => {
            if (extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                await BlockService.extractBlocksFromMessage(messageId);
                await BlockService.updateBlocksDisplay(messageId);
                MainUI.attachBlockWrappers(messageId);
            }
        });
        eventSource.on(event_types.MESSAGE_DELETED, () => extStates.is_chat_modified = true);
        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, (type, data, dryRun) => {
            if (!dryRun && type !== 'quiet') {
                const messageId = type === 'regenerate' ? chat.length - 2 : chat.length - 1;
                if (messageId >= 0) BlockService.injectAllEnabledBlocks(messageId);
                else BlockService.removeAllBlockInjects();
            }
        });
        eventSource.makeFirst(event_types.USER_MESSAGE_RENDERED, async (messageId) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                return;
            }
            
            await BlockService.extractBlocksFromMessage(messageId);
            await GenerationService.handleUserTrigger(messageId);
            MainUI.attachBlockWrappers(messageId);
            MainUI.addEditButtonToLastMessage();
        });
        eventSource.makeFirst(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                return;
            }
            extStates.cachedPauseBlocks = null;
            if (extStates.generationPaused) {
                await GenerationService.handleMessageTrigger(messageId, false);
                extStates.generationPaused = false;
                setTimeout(() => {
                    $('#send_but').trigger('click');
                    toastr.info(`${defaultExtPrefix} Generation resumed...`);
                }, 1000);
            } else if (messageId > 0) {
                await BlockService.extractBlocksFromMessage(messageId);
                await GenerationService.handleCharTrigger(messageId);
                if (messageId > 2) {
                    await BlockService.updateBlocksDisplay(messageId - 2);
                }
                extStates.pauseCounter = 0;
            } else {
                await BlockService.extractBlocksFromMessage(0);
                await BlockService.checkBlocksInFirstMessage();
            }
            MainUI.attachBlockWrappers(messageId);
            MainUI.addEditButtonToLastMessage();
        });
        eventSource.makeFirst(event_types.MESSAGE_RECEIVED, async (messageId) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled || !extStates.generationPaused || !extStates.triggeredPauseBlock) {
                return;
            }
        
            const block = extStates.triggeredPauseBlock;
            const message = chat[messageId];
        
            if (block.keyword_is_regex) {
                const regex = stringToRegex(block.keyword);
                message.mes = removeAfterRegexMatch(message.mes, regex);
            } else {
                message.mes = removeAfterSubstring(message.mes, block.keyword);
            }
        
            if (message.swipes) {
                message.swipes[message.swipe_id] = message.mes;
            }
        
            extStates.triggeredPauseBlock = null;
        
            updateMessageBlock(messageId, message, { rerenderMessage: true });
            await saveChat();
        });
        
        eventSource.makeFirst(event_types.MESSAGE_SWIPED, async (messageId) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                return;
            }
            const current_swipe_id = chat[messageId].swipe_id;
            if (messageId !== 0) {
                if (current_swipe_id === chat[messageId].swipes.length) {
                    if (current_swipe_id === 1) {
                        BlockService.firstSwipeBlockExtra(messageId);
                    }
                    await GenerationService.handleUserTrigger(messageId - 1, true);
                    await BlockService.swipeBlockExtra(messageId, current_swipe_id, false);
                } else {
                    await BlockService.swipeBlockExtra(messageId, current_swipe_id);
                }
            } else {
                await BlockService.checkBlocksInFirstMessage();
                await BlockService.swipeBlockExtra(messageId, current_swipe_id);
            }
        });
        eventSource.makeFirst(event_types.STREAM_TOKEN_RECEIVED, (text) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled || extStates.generationPaused) {
                return;
            }
            if (extStates.cachedPauseBlocks === null) {
                const allBlocks = BlockService.getAllEnabledBlocks();
                extStates.cachedPauseBlocks = allBlocks
                    .filter(b => b.generation_pause && b.keyword)
                    .map(b => ({ block: b, regex: stringToRegex(b.keyword) }))
                    .filter(item => item.regex);
            }
        
            for (const item of extStates.cachedPauseBlocks) {
                if (item.regex.test(text)) {
                    extStates.generationPaused = true;
                    extStates.pauseCounter++;
                    extStates.triggeredPauseBlock = item.block;
                    extStates.cachedPauseBlocks = null;
                    toastr.info(`${defaultExtPrefix} Generation paused...`);
                    stopGeneration();
                    return;
                }
            }
        });
    
        eventSource.on(ExtTopic.FATPRESETS_IMPORT, ({ setObject, returnCode }) => {
            const isOk = SettingsService.importSetFromObject(setObject);
            returnCode.code = isOk;
        });
        
        eventSource.on(ExtTopic.FATPRESETS_CHANGE, async ({ presetName, reloadFlag }) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                extensionSettings.DreamAlbum.dreamalbum_is_enabled = true;
                $('#dreamalbum_is_enabled').prop('checked', extensionSettings.DreamAlbum.dreamalbum_is_enabled);
                await BlockService.updateDisplayForBlocks();
                reloadFlag.value = true;
                MacroService.registerExtensionMacros();
                saveSettingsDebounced();
            }
            if (extensionSettings.DreamAlbum.active_set === presetName) return;
            
            const index = extensionSettings.DreamAlbum.sets.findIndex(set => set.name === presetName);
            if (index !== -1) {
                await SettingsService.changeSet(index);
            }
        });
        
        eventSource.on(ExtTopic.FATPRESETS_DISABLE, async () => {
            extensionSettings.DreamAlbum.dreamalbum_is_enabled = false;
            $('#dreamalbum_is_enabled').prop('checked', extensionSettings.DreamAlbum.dreamalbum_is_enabled);
            MacroService.unregisterExtensionMacros();
            
            const context = SillyTavern.getContext();
            if (context.characterId !== undefined || context.groupId !== undefined) {
                await BlockService.purgeAllBlocksDisplayText();
            }
            
            saveSettingsDebounced();
        });
        eventSource.on(ExtTopic.GENERATE_BLOCKS, async (messageId, isUser, allBlocks, triggeredBlocks, callback) => {
            const blocksList = await GenerationService.handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
            
            if (!callback) return;
            try {
                callback(blocksList);
            } catch (error) {
                console.log(`${defaultExtPrefix} ${error}`);
                return;
            }
        });
        
        eventSource.on(ExtTopic.BLOCKS_GENERATED_IIG, ({ messageId }) => {
            if (extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
                MainUI.attachBlockWrappers(messageId);
                
                
                const $mes = $(`#chat .mes[mesid="${messageId}"]`);
                $mes.find('.DA-block-loading').hide();
                $mes.find('.DA-block-content > *:not(.DA-block-loading)').show();
            }
        });
        
        const chatObserver = new MutationObserver((mutations) => {
            if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled) return;
            let shouldAttach = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if ($(node).find('img[data-iig-instruction], .da-block-container').addBack('img[data-iig-instruction], .da-block-container').length > 0) {
                            shouldAttach = true;
                            break;
                        }
                    }
                }
                if (shouldAttach) break;
            }
            if (shouldAttach) {
                MainUI.attachAllBlockWrappers();
            }
        });
        const chatEl = document.getElementById('chat');
        if (chatEl) {
            chatObserver.observe(chatEl, { childList: true, subtree: true });
        }
        // Click on image → toggle action buttons visibility
        $(document).on('click', '.DA-img-block .DA-block-content img', function(e) {
            e.stopPropagation();
            const $block = $(this).closest('.DA-interactive-block');
            const wasVisible = $block.hasClass('DA-actions-visible');
            // Hide all other open blocks
            $('.DA-interactive-block.DA-actions-visible').not($block).removeClass('DA-actions-visible');
            $block.toggleClass('DA-actions-visible', !wasVisible);
        });
        // Click anywhere else → hide all action panels
        $(document).on('click', function(e) {
            if (!$(e.target).closest('.DA-interactive-block').length) {
                $('.DA-interactive-block.DA-actions-visible').removeClass('DA-actions-visible');
            }
        });
        $(document).on('click', '.DA-img-fullscreen', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const $block = $(this).closest('.DA-interactive-block');
            const $img = $block.find('img[data-iig-instruction]');
            if (!$img.length) return;
            const src = $img.attr('src');
            if (!src || src === '[IMG:GEN]') return;
            const { AlbumUI } = await import('./AlbumUI.js');
            AlbumUI.openFullScreenViewer([src], 0);
        });
        $(document).on('click', '.DA-img-copy', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const $block = $(this).closest('.DA-interactive-block');
            const $img = $block.find('img[data-iig-instruction]');
            if (!$img.length) return;
            const instructionRaw = $img.attr('data-iig-instruction');
            if (!instructionRaw) {
                toastr.warning('Промпт не найден.');
                return;
            }
            try {
                const instruction = typeof instructionRaw === 'string' ? JSON.parse(instructionRaw) : instructionRaw;
                if (instruction && instruction.prompt) {
                    navigator.clipboard.writeText(instruction.prompt)
                        .then(() => toastr.success('Промпт скопирован в буфер обмена.'))
                        .catch(() => toastr.error('Не удалось скопировать промпт.'));
                } else {
                    toastr.warning('Промпт пуст.');
                }
            } catch (err) {
                toastr.error('Ошибка при чтении промпта.');
            }
        });
        $(document).on('click', '.DA-img-edit', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const $block = $(this).closest('.DA-interactive-block');
            
            const $img = $block.find('img[data-iig-instruction]');
            const $mes = $(this).closest('.mes');
            const messageId = parseInt($mes.attr('mesid'), 10);
            
            if (isNaN(messageId) || !$img.length) {
                return;
            }
            
            let instructionRaw = $img.attr('data-iig-instruction');
            if (!instructionRaw) {
                toastr.warning('Промпт не найден для этого блока.');
                return;
            }
            
            let instruction;
            try {
                // First attempt standard JSON parsing
                instruction = typeof instructionRaw === 'string' ? JSON.parse(instructionRaw) : instructionRaw;
            } catch (e) {
                console.warn('[DreamAlbum] Failed to parse JSON instruction:', e);
                // Fallback: try to fix common JSON issues or extract just the prompt using regex
                try {
                    // Try to fix unescaped quotes or newlines if possible
                    let fixedRaw = instructionRaw.replace(/\n/g, '\\n').replace(/\r/g, '');
                    instruction = JSON.parse(fixedRaw);
                } catch (e2) {
                    console.error('[DreamAlbum] Fallback parse failed', e2);
                    // Extract prompt using regex as last resort
                    const promptMatch = instructionRaw.match(/"prompt"\s*:\s*"(.*?)"/s);
                    const blockMatch = instructionRaw.match(/"block"\s*:\s*"(.*?)"/s);
                    
                    if (promptMatch) {
                        instruction = {
                            prompt: promptMatch[1],
                            block: blockMatch ? blockMatch[1] : 'unknown'
                        };
                        toastr.warning('Структура тега повреждена, но промпт удалось извлечь.');
                    } else {
                        toastr.error('Критическая ошибка в структуре тега. Невозможно прочитать промпт.');
                        return;
                    }
                }
            }
            
            const popupHtml = $(`
                <div class="DA-prompt-editor-popup" style="display: flex; flex-direction: column; gap: 14px; min-width: 320px; width: 100%; box-sizing: border-box; text-align: left;">
                    <div style="font-size: 1.1rem; font-weight: bold; border-bottom: 1px solid var(--da-border); padding-bottom: 8px; color: var(--da-accent); display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-pen-to-square"></i>
                        <span>Редактирование промпта</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 0.85rem; color: var(--da-text-muted);">Текст промпта для генерации:</span>
                        <textarea class="DA-popup-textarea text_pole" style="width: 100%; min-height: 120px; font-family: var(--mono_font); font-size: var(--main_font_size); resize: vertical; box-sizing: border-box; background: var(--da-surface2); border: 1px solid var(--da-border); color: var(--da-text); padding: 10px; border-radius: 8px; outline: none; transition: border-color 0.2s;" placeholder="Введите промпт..."></textarea>
                    </div>
                </div>
            `);
            popupHtml.find('.DA-popup-textarea').val(instruction.prompt || '');
            setTimeout(() => popupHtml.find('.DA-popup-textarea').focus(), 150);
            const popupResult = await callPopup(popupHtml, 'confirm', undefined, { okButton: 'Сохранить', cancelButton: 'Отмена' });
            if (!popupResult) {
                return;
            }
            const newPrompt = popupHtml.find('.DA-popup-textarea').val();
            if (newPrompt === null || newPrompt.trim() === '') {
                return;
            }
            instruction.prompt = newPrompt.trim();
            const newInstructionStr = JSON.stringify(instruction);
            
            const message = chat[messageId];
            if (message && message.extra && message.extra.extblocks) {
                
                $block.find('.DA-block-loading').show();
                $block.find('.DA-block-content > *:not(.DA-block-loading)').hide();
                const replaceTarget = (content) => {
                    if (!content) return content;
                    const escapedInst = instructionRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`<img[^>]*${escapedInst}[^>]*>`, 'i');
                    return content.replace(regex, match => {
                        return match.replace(instructionRaw, newInstructionStr).replace(/src=(?:'|")[^'"]*(?:'|")/, 'src="[IMG:GEN]"');
                    });
                };
                message.extra.extblocks = replaceTarget(message.extra.extblocks);
                if (message.swipe_id !== undefined && message.swipe_info?.[message.swipe_id]?.extra) {
                    const extra = message.swipe_info[message.swipe_id].extra;
                    if (extra.extblocks) {
                        extra.extblocks = replaceTarget(extra.extblocks);
                    }
                }
                await saveChat();
                await BlockService.updateBlocksDisplay(messageId);
                
                
                eventSource.emit(ExtTopic.BLOCKS_GENERATED_IIG, { messageId });
                toastr.success('Промпт обновлен, запуск генерации...');
            }
        });
        $(document).on('click', '.DA-block-delete', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            const $block = $(this).closest('.DA-interactive-block');
            const $img = $block.find('img[data-iig-instruction]');
            const blockName = $block.attr('data-block-name');
            const $mes = $(this).closest('.mes');
            const messageId = parseInt($mes.attr('mesid'), 10);
            if (isNaN(messageId)) return;
            const confirmResult = await new Promise((resolve) => {
                const $overlay = $(`
                    <div id="DA-global-confirm" class="DA-confirm-wrapper">
                        <div class="DA-confirm-box">
                            <div class="DA-confirm-text">Вы действительно хотите удалить этот блок?</div>
                            <div class="DA-confirm-actions">
                                <button id="DA-global-yes" class="DA-btn-confirm DA-btn-primary">Удалить</button>
                                <button id="DA-global-no" class="DA-btn-confirm DA-btn-secondary">Отмена</button>
                            </div>
                        </div>
                    </div>
                `);
                $('body').append($overlay);
                $overlay.find('#DA-global-yes').on('click', () => {
                    $overlay.remove();
                    resolve(true);
                });
                $overlay.find('#DA-global-no').on('click', () => {
                    $overlay.remove();
                    resolve(false);
                });
            });
            if (!confirmResult) return;
            const message = chat[messageId];
            if (message && message.extra && message.extra.extblocks) {
                const removeMatch = (content) => {
                    if (!content) return '';
                    
                    let blockIndex = -1;
                    
                    if (blockName && blockName !== 'unknown') {
                        const allBlocksOfThisName = $mes.find(`.DA-interactive-block[data-block-name="${blockName}"]`);
                        blockIndex = allBlocksOfThisName.index($block);
                        
                        console.log('[DreamAlbum] Deleting block:', blockName, 'at index:', blockIndex);
                        
                        if (blockIndex > -1) {
                            const regexStr = getRegexForBlock(blockName);
                            const regex = new RegExp(regexStr, 'gi');
                            let occurrence = 0;
                            let replaced = false;
                            
                            const result = content.replace(regex, (match) => {
                                if (occurrence === blockIndex) {
                                    occurrence++;
                                    replaced = true;
                                    console.log('[DreamAlbum] Block matched by name and removed');
                                    return '';
                                }
                                occurrence++;
                                return match;
                            }).trim();
                            
                            if (replaced) return result;
                        }
                    }

                    // Fallback: If it's an image block that somehow didn't match the regex (e.g. raw IMG tag), 
                    // try to match the exact data-iig-instruction string
                    const instructionRaw = $img.length ? $img.attr('data-iig-instruction') : '';
                    if (instructionRaw) {
                        const escapedInst = instructionRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const imgRegex = new RegExp(`<img[^>]*${escapedInst}[^>]*>`, 'i');
                        if (imgRegex.test(content)) {
                             console.log('[DreamAlbum] Block matched by IMG tag instruction and removed');
                             return content.replace(imgRegex, '').trim();
                        }
                    }

                    console.warn('[DreamAlbum] Block deletion fallback failed to match content.');
                    return content;
                };
                message.extra.extblocks = removeMatch(message.extra.extblocks);
                if (message.swipe_id !== undefined && message.swipe_info?.[message.swipe_id]?.extra) {
                    const extra = message.swipe_info[message.swipe_id].extra;
                    extra.extblocks = removeMatch(extra.extblocks);
                }
                await saveChat();
                await BlockService.updateBlocksDisplay(messageId);
                toastr.success('Блок удален.');
            }
        });
    }
};