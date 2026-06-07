import { download } from '../../../../../utils.js';
import {
    templates_path,
    ElementTemplate,
    BlockType,
    extName,
    editButton,
    defaultExtPrefix
} from '../core/constants.js';
import { extStates } from '../core/state.js';
import { interactiveSortData } from '../utils/uiUtils.js';
import { SettingsService } from '../services/SettingsService.js';
import { BlockService } from '../services/BlockService.js';
import { MacroService } from '../services/MacroService.js';
import { GeneratedEditor } from './editors/GeneratedEditor.js';
import { AccumulationEditor } from './editors/AccumulationEditor.js';
import { ScriptEditor } from './editors/ScriptEditor.js';
const {
    writeExtensionField, extensionSettings,
    renderExtensionTemplateAsync, characters, uuidv4,
    callPopup, chat
 } = SillyTavern.getContext();
export const MainUI = {
    /**
     * Adds edit buttons to all messages in the chat.
     */
    addEditButtons() {
        $('#chat .mes').each(function() {
            if ($(this).find('.extraMesButtons .DreamAlbum-storage-edit').length === 0) {
                $(this).find('.extraMesButtons').append(editButton);
            }
        });
    },
    /**
     * Adds an edit button to the last message in the chat.
     */
    addEditButtonToLastMessage() {
        var lastMes = $('#chat .mes').last();
        if (lastMes.find('.extraMesButtons .DreamAlbum-storage-edit').length === 0) {
            lastMes.find('.extraMesButtons').append(editButton);
        }
    },
    /**
     * Loads and renders the block list in the settings panel.
     */
    async loadBlocks() {
        $('#DreamAlbum-blocks-global-list').empty();
        $('#DreamAlbum-blocks-scoped-list').empty();
        await SettingsService.refreshSettings();
        const blockTemplate = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.BLOCK));
        const renderBlock = async (container, block, isScoped, index) => {
            const blockHtml = blockTemplate.clone();
            if (!block.id) {
                block.id = uuidv4();
            }
            let block_type = block.block_type ?? BlockType.GENERATED;
            let editor_func;
            if (block_type === BlockType.GENERATED) {
                blockHtml.find('.DreamAlbum-block-atype-icon').hide();
                blockHtml.find('.DreamAlbum-block-stype-icon').hide();
                blockHtml.find('.DreamAlbum-block-rtype-icon').hide();
                editor_func = GeneratedEditor.open.bind(GeneratedEditor);
                blockHtml.find('.export_prompt_DreamAlbum').on('click', async function () {
                    if (SillyTavern.getContext().characterId === undefined) {
                        toastr.warning(`${defaultExtPrefix} Please select a chat first.`);
                        return;
                    }
                    const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                    const messageId = chat.length - 1;
                    const allBlocks = BlockService.getAllEnabledBlocks();
                    const fullPrompt = await MacroService.checkAllMacros(BlockService.getSingleBlockFullPrompt(block, messageId, allBlocks));
                    const fileData = JSON.stringify({ fullPrompt }, null, 4);
                    download(fileData, fileName, 'application/json');
                });
            } else if (block_type === BlockType.ACCUMULATION) {
                blockHtml.find('.DreamAlbum-block-gtype-icon').hide();
                blockHtml.find('.DreamAlbum-block-stype-icon').hide();
                blockHtml.find('.DreamAlbum-block-rtype-icon').hide();
                blockHtml.find('.export_prompt_DreamAlbum').hide();
                blockHtml.find('.DreamAlbum-block-preset').hide();
                editor_func = AccumulationEditor.open.bind(AccumulationEditor);
            } else if (block_type === BlockType.REWRITE) {
                blockHtml.find('.DreamAlbum-block-gtype-icon').hide();
                blockHtml.find('.DreamAlbum-block-stype-icon').hide();
                blockHtml.find('.DreamAlbum-block-atype-icon').hide();
                editor_func = GeneratedEditor.open.bind(GeneratedEditor);
                blockHtml.find('.export_prompt_DreamAlbum').on('click', async function () {
                    if (SillyTavern.getContext().characterId === undefined) {
                        toastr.warning(`${defaultExtPrefix} Please select a chat first.`);
                        return;
                    }
                    const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                    const messageId = chat.length - 1;
                    const allBlocks = BlockService.getAllEnabledBlocks();
                    const fullPrompt = await MacroService.checkAllMacros(BlockService.getSingleBlockFullPrompt(block, messageId, allBlocks));
                    const fileData = JSON.stringify({ fullPrompt }, null, 4);
                    download(fileData, fileName, 'application/json');
                });
            } else if (block_type === BlockType.SCRIPT) {
                blockHtml.find('.DreamAlbum-block-gtype-icon').hide();
                blockHtml.find('.DreamAlbum-block-rtype-icon').hide();
                blockHtml.find('.DreamAlbum-block-atype-icon').hide();
                blockHtml.find('.export_prompt_DreamAlbum').hide();
                blockHtml.find('.DreamAlbum-block-preset').hide();
                editor_func = ScriptEditor.open.bind(ScriptEditor);
            }
            blockHtml.attr('id', block.id);
            blockHtml.find('.DreamAlbum_block_name').text(block.name);
            const presetButtonContainer = blockHtml.find('.DreamAlbum-block-preset');
            const presetButtonIcon = presetButtonContainer.find('i');
            const presets = ['big', 'medium', 'small'];
            const presetIcons = {
                'big': 'fa-battery-full',
                'medium': 'fa-battery-half',
                'small': 'fa-battery-empty',
            };
            const presetTitles = {
                'big': 'API Preset: Big',
                'medium': 'API Preset: Medium',
                'small': 'API Preset: Small',
            };
            if (block.api_preset === undefined) {
                block.api_preset = 'big';
            }
            let currentPreset = block.api_preset;
            const updateIcon = () => {
                presetButtonIcon.removeClass('fa-battery-full fa-battery-half fa-battery-empty');
                const iconClass = presetIcons[currentPreset];
                presetButtonIcon.addClass(iconClass);
                presetButtonContainer.attr('title', presetTitles[currentPreset]);
            };
            updateIcon();
            presetButtonContainer.on('click', async function () {
                const currentIndex = presets.indexOf(currentPreset);
                currentPreset = presets[(currentIndex + 1) % presets.length];
                block.api_preset = currentPreset;
                updateIcon();
                await BlockService.saveBlock(block, index, isScoped);
                await this.loadBlocks();
            }.bind(this));
            const $checkbox = blockHtml.find('.disable_DreamAlbum');
            $checkbox.prop('checked', block.disabled ?? false);
            const toggleBlock = async () => {
                block.disabled = !!$checkbox.prop('checked');
                if (block.disabled) {
                    BlockService.removeBlockInject(block);
                }
                await BlockService.saveBlock(block, index, isScoped);
            };
            $checkbox.on('change', async function () {
                await toggleBlock();
            });
            blockHtml.find('.DreamAlbum-toggle-on, .DreamAlbum-toggle-off').on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                $checkbox.prop('checked', !$checkbox.prop('checked')).trigger('change');
            });
            blockHtml.find('.edit_existing_DreamAlbum').on('click', async function () {
                await editor_func(blockHtml.attr('id'), isScoped);
            });
            blockHtml.find('.export_DreamAlbum').on('click', async function () {
                const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
                const fileData = JSON.stringify(block, null, 4);
                download(fileData, fileName, 'application/json');
            });
            blockHtml.find('.delete_DreamAlbum').on('click', async function () {
                const confirm = await callPopup('Are you sure you want to delete this block?', 'confirm');
                if (!confirm) {
                    return;
                }
                await BlockService.deleteBlock(block.id, isScoped);
                await this.loadBlocks();
            }.bind(this));
            $(container).append(blockHtml);
        };
        extStates.current_set.global_blocks.forEach((block, index) => renderBlock('#DreamAlbum-blocks-global-list', block, false, index));
        const ctx = SillyTavern.getContext();
        let charBlocks = null;
        if (ctx.characterId !== undefined && characters[ctx.characterId] && characters[ctx.characterId].data && characters[ctx.characterId].data.extensions) {
            charBlocks = characters[ctx.characterId].data.extensions.DreamAlbum;
        }
        if (Array.isArray(charBlocks)) {
            charBlocks.forEach((block, index) => renderBlock('#DreamAlbum-blocks-scoped-list', block, true, index));
        }
        if (extStates.DreamAlbum_settings?.dreamalbum_is_enabled) {
            await BlockService.updateDisplayForBlocks();
        }
        // Initialize sortable
        let sortableBlocks = [
            {
                selector: '#DreamAlbum-blocks-global-list',
                setter: x => extensionSettings.DreamAlbum.sets[extensionSettings.DreamAlbum.active_set_idx].global_blocks = x,
                getter: () => extensionSettings.DreamAlbum.sets[extensionSettings.DreamAlbum.active_set_idx].global_blocks ?? [],
            },
            {
                selector: '#DreamAlbum-blocks-scoped-list',
                setter: x => writeExtensionField(SillyTavern.getContext().characterId, extName, x),
                getter: () => characters[SillyTavern.getContext().characterId]?.data?.extensions?.DreamAlbum ?? [],
            },
        ];
        await interactiveSortData(sortableBlocks);
    },
    /**
     * Finds marked blocks in the chat and wraps them with interactive buttons.
     */
    attachBlockWrappers(messageId) {
        if (!extStates.DreamAlbum_settings?.dreamalbum_is_enabled) return;
        const $mes = $(`#chat .mes[mesid="${messageId}"]`);
        if (!$mes.length) return;
        const allBlocks = BlockService.getAllEnabledBlocks();
        const wrapElement = ($el, blockName) => {
            const $img = $el.find('img[data-iig-instruction]').addBack('img[data-iig-instruction]');
            const hasImage = $img.length > 0;
            const $existingContent = $el.parent('.DA-block-content');
            if ($existingContent.length) {
                const $wrapper = $existingContent.parent('.DA-interactive-block');
                $wrapper.toggleClass('DA-img-block', hasImage);
                $wrapper.attr('data-block-name', blockName || 'unknown');
                
                if (!$el.text().trim() && !hasImage) {
                    $existingContent.addClass('DA-is-empty');
                } else {
                    $existingContent.removeClass('DA-is-empty');
                }
                
                const $actions = $wrapper.find('.DA-block-actions');
                if (hasImage && $actions.find('.DA-img-fullscreen').length === 0) {
                    $actions.prepend(`
                        <div class="DA-img-fullscreen" title="На весь экран"><i class="fa-solid fa-expand"></i></div>
                        <div class="DA-img-copy" title="Скопировать промпт"><i class="fa-solid fa-copy"></i></div>
                        <div class="DA-img-edit" title="Редактировать промпт и перегенерировать"><i class="fa-solid fa-pen-to-square"></i></div>
                    `);
                } else if (!hasImage) {
                    $actions.find('.DA-img-fullscreen, .DA-img-copy, .DA-img-edit').remove();
                }
                return;
            }
            
            if ($el.find('.DA-interactive-block').length) return; // Fix double wrapping
            const $wrapper = $(`
                <div class="DA-interactive-block ${hasImage ? 'DA-img-block' : ''}" data-block-name="${blockName || 'unknown'}">
                    <div class="DA-block-content">
                        <div class="DA-block-loading" style="display: none; padding: 20px; text-align: center;">
                            <i class="fa-solid fa-spinner fa-spin"></i>
                        </div>
                    </div>
                    <div class="DA-block-actions">
                        ${hasImage ? '<div class="DA-img-fullscreen" title="На весь экран"><i class="fa-solid fa-expand"></i></div>' : ''}
                        ${hasImage ? '<div class="DA-img-copy" title="Скопировать промпт"><i class="fa-solid fa-copy"></i></div>' : ''}
                        ${hasImage ? '<div class="DA-img-edit" title="Редактировать промпт и перегенерировать"><i class="fa-solid fa-pen-to-square"></i></div>' : ''}
                        <div class="DA-block-delete" title="Удалить блок"><i class="fa-solid fa-trash-can"></i></div>
                    </div>
                </div>
            `);
            $el.before($wrapper);
            $wrapper.find('.DA-block-content').prepend($el);
            
            
            if (!$el.text().trim() && !hasImage) {
                $wrapper.find('.DA-block-content').addClass('DA-is-empty');
            } else {
                $wrapper.find('.DA-block-content').removeClass('DA-is-empty');
            }
            
            if (!$el.parent('.DA-block-content').length) {
                $wrapper.find('.DA-block-content').prepend($el);
            }
        };
        // 1. Find all images with SillyImages instruction
        $mes.find('img[data-iig-instruction]').each(function() {
            const $img = $(this);
            let blockName = 'unknown';
            try {
                const instruction = JSON.parse($img.attr('data-iig-instruction'));
                blockName = instruction.block || 'unknown';
            } catch (e) {}
            wrapElement($img, blockName);
        });
        // 2. Wrap CSS/HTML block containers (images are handled above)
        $mes.find('.da-block-container').each(function() {
            const $container = $(this);
            if ($container.parent('.DA-block-content').length) return;
            if ($container.find('img[data-iig-instruction]').length) return;
            const blockName = $container.attr('data-da-name') || 'unknown';
            wrapElement($container, blockName);
        });
        this.attachShadowHosts(messageId);
        this.attachStyleScoping(messageId);
    },
    /**
     * Attaches wrappers to all messages.
     */
    attachAllBlockWrappers() {
        $('#chat .mes').each((idx, el) => {
            const id = $(el).attr('mesid');
            if (id !== undefined) this.attachBlockWrappers(id);
        });
    },
    /**
     * Moves CSS block content into Shadow DOM so AI-authored styles stay isolated
     * from SillyTavern's global CSS.
     * @param {string|number} messageId
     */
    attachShadowHosts(messageId) {
        const $mes = $(`#chat .mes[mesid="${messageId}"]`);
        if (!$mes.length) return;
        $mes.find('.da-block-container[data-da-shadow="true"]').each(function() {
            const container = this;
            if (container.getAttribute('data-da-shadow-attached')) return;
            if (container.shadowRoot) return;
            const content = container.innerHTML;
            if (!content.trim()) return;
            const shadow = container.attachShadow({ mode: 'open' });
            shadow.innerHTML = `<style>:host{display:block;width:100%;box-sizing:border-box}:host>*{display:block;box-sizing:border-box}</style>${content}`;
            container.classList.add('da-shadow-host');
            container.setAttribute('data-da-shadow-attached', 'true');
        });
    },
    /**
     * Scopes CSS inside .da-block-container elements that contain <style> tags.
     * Fallback for containers without Shadow DOM — prefixes selectors with a
     * unique container ID so rules do not bleed into the rest of the page.
     * @param {string|number} messageId
     */
    attachStyleScoping(messageId) {
        const $mes = $(`#chat .mes[mesid="${messageId}"]`);
        if (!$mes.length) return;
        $mes.find('.da-block-container').each(function() {
            const container = this;
            if (container.getAttribute('data-da-shadow-attached')) return;
            // Skip if already scoped
            if (container.getAttribute('data-da-scoped')) return;
            const styleEls = container.querySelectorAll('style');
            if (!styleEls.length) return;
            // Assign a unique scope ID
            const scopeId = `da-sc-${Math.random().toString(36).slice(2, 8)}`;
            container.id = scopeId;
            container.setAttribute('data-da-scoped', 'true');
            styleEls.forEach(styleEl => {
                const originalCSS = styleEl.textContent || '';
                if (!originalCSS.trim()) return;
                let scopedCSS = '';
                try {
                    // Use CSSStyleSheet API for accurate parsing
                    const sheet = new CSSStyleSheet();
                    sheet.replaceSync(originalCSS);
                    for (const rule of sheet.cssRules) {
                        if (rule instanceof CSSStyleRule) {
                            const prefixed = rule.selectorText
                                .split(',')
                                .map(s => `#${scopeId} ${s.trim()}`)
                                .join(', ');
                            scopedCSS += `${prefixed} { ${rule.style.cssText} }\n`;
                        } else {
                            scopedCSS += rule.cssText + '\n';
                        }
                    }
                } catch (e) {
                    // Fallback: simple regex prefix (handles most cases)
                    scopedCSS = originalCSS.replace(
                        /([^{}@,]+)(?=[,{])/g,
                        (sel) => {
                            const trimmed = sel.trim();
                            if (!trimmed || trimmed.startsWith('@') || trimmed.startsWith('//')) return sel;
                            return sel.replace(trimmed, `#${scopeId} ${trimmed}`);
                        }
                    );
                }
                styleEl.textContent = scopedCSS;
            });
        });
    },
    /**
     * Processes style scoping for all messages in the chat.
     */
    attachAllStyleScoping() {
        $('#chat .mes').each((idx, el) => {
            const id = $(el).attr('mesid');
            if (id !== undefined) this.attachStyleScoping(id);
        });
    }
};