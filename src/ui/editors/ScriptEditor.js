import { setSlashCommandAutoComplete } from '../../../../../../slash-commands.js';
import { JSAutocomplete } from '../../utils/autocompleteUtils.js';
import {
    templates_path,
    ElementTemplate, 
    BlockType 
} from '../../core/constants.js';
import { EditorService } from '../../services/EditorService.js';
import { BlockService } from '../../services/BlockService.js';
import { MainUI } from '../MainUI.js';

const {
    callPopup,
    characters,
    extensionSettings,
    renderExtensionTemplateAsync
} = SillyTavern.getContext();

export const ScriptEditor = {
    /**
     * Opens the editor for a Script block.
     * @param {string|null} existingId - The ID of the block to edit, or null for a new block.
     * @param {boolean} isScoped - Whether the block is character-scoped.
     */
    async open(existingId, isScoped) {
        const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.SCRIPT_EDITOR));
        const array = (isScoped ? characters[SillyTavern.getContext().characterId]?.data?.extensions?.DreamAlbum : extensionSettings.DreamAlbum.sets[extensionSettings.DreamAlbum.active_set_idx].global_blocks) ?? [];
        
        const changeTriggerPeriodicity = (trigger_periodicity) => {
            if (trigger_periodicity === "keyword") {
                editorHtml.find('.DreamAlbum-scripteditor-period-wrapper').hide();
                editorHtml.find('.DreamAlbum-scripteditor-keyword-wrapper').show();
            } else {
                editorHtml.find('.DreamAlbum-scripteditor-period-wrapper').show();
                editorHtml.find('.DreamAlbum-scripteditor-keyword-wrapper').hide();
            }
        };

        const handleGenerationPauseChange = () => {
            const isPaused = editorHtml.find('input[name="generation_pause"]').is(':checked');
            editorHtml.find('input[name="user_message"]').prop('disabled', isPaused);
            editorHtml.find('input[name="char_message"]').prop('disabled', isPaused);

            if (isPaused) {
                editorHtml.find(`select[name="DreamAlbum-scripteditor-trigger-periodicity"]`).val('keyword').trigger('change');
            }
            editorHtml.find(`select[name="DreamAlbum-scripteditor-trigger-periodicity"]`).prop('disabled', isPaused);
        };

        let existingBlockIndex = -1;
        if (existingId) {
            existingBlockIndex = array.findIndex((block) => block.id === existingId);
            if (existingBlockIndex !== -1) {
                const block = array[existingBlockIndex];
                editorHtml.find('.DreamAlbum-scripteditor-block-name').val(block.name);
                editorHtml.find(`select[name="DreamAlbum-scripteditor-script-type"]`).val(block.script_type ?? 'stscript');
                editorHtml.find('.DreamAlbum-scripteditor-script').val(block.script ?? '');
                editorHtml.find('input[name="user_message"]').prop('checked', block.user_message ?? false);
                editorHtml.find('input[name="char_message"]').prop('checked', block.char_message ?? true);
                editorHtml.find('input[name="generation_pause"]').prop('checked', block.generation_pause ?? false);
                
                const trigger_periodicity = (block.keyword && block.keyword !== '') ? "keyword" : "periodic";
                editorHtml.find(`select[name="DreamAlbum-scripteditor-trigger-periodicity"]`).val(trigger_periodicity);
                editorHtml.find('input[name="period"]').val(block.period ?? 2);
                editorHtml.find('input[name="keyword"]').val(block.keyword ?? '');
                editorHtml.find('input[name="keyword_is_regex"]').prop('checked', block.keyword_is_regex ?? false);
                editorHtml.find('input[name="disabled"]').prop('checked', block.disabled ?? false);
                editorHtml.find(`select[name="DreamAlbum-editor-execution-order"]`).val(block.execution_order ?? 'before');
                
                changeTriggerPeriodicity(trigger_periodicity);
            }
        } else {
            editorHtml.find('input[name="disabled"]').prop('checked', false);
            editorHtml.find('input[name="char_message"]').prop('checked', true);
            editorHtml.find(`select[name="DreamAlbum-scripteditor-trigger-periodicity"]`).val('periodic');
            changeTriggerPeriodicity('periodic');
        }

        editorHtml.find(`select[name="DreamAlbum-scripteditor-trigger-periodicity"]`).on('change', (e) => changeTriggerPeriodicity($(e.target).val()));
        editorHtml.find('input[name="generation_pause"]').on('change', handleGenerationPauseChange);
        handleGenerationPauseChange();

        let scriptTextarea = editorHtml.find('.DreamAlbum-scripteditor-script');
        const syntaxLayer = editorHtml.find('.DreamAlbum-editor-message-syntax');
        const syntaxInner = editorHtml.find('.DreamAlbum-editor-message-syntax-inner');
        const scriptTypeSelect = editorHtml.find('select[name="DreamAlbum-scripteditor-script-type"]');
        let jsAutocomplete = null;

        const updateSyntax = () => {
            const scriptType = scriptTypeSelect.val();
            const language = scriptType === 'js' ? 'javascript' : 'stscript';
            const code = scriptTextarea.val();
            
            syntaxInner.removeClass('language-stscript language-javascript').addClass(`language-${language}`);

            if (window.hljs) {
                const highlighted = window.hljs.highlight(code + (code.endsWith('\n') ? ' ' : ''), { language, ignoreIllegals: true }).value;
                syntaxInner.html(highlighted);
            } else {
                syntaxInner.text(code);
            }
        };

        const syncScroll = () => {
            if (syntaxLayer[0] && scriptTextarea[0]) {
                syntaxLayer[0].scrollTop = scriptTextarea[0].scrollTop;
                syntaxLayer[0].scrollLeft = scriptTextarea[0].scrollLeft;
            }
        };

        const attachEvents = (el) => {
            el.on('input scroll wheel', () => {
                syncScroll();
            });
            el[0].addEventListener('scroll', syncScroll, { passive: true });
            el.on('keydown', (e) => {
                if (e.key === 'Tab') {
                    if (jsAutocomplete && jsAutocomplete.isActive) return;

                    e.preventDefault();
                    const start = el[0].selectionStart;
                    const end = el[0].selectionEnd;
                    const value = el.val();

                    if (e.shiftKey) {
                        // Unindent
                        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                        if (value.substring(lineStart, lineStart + 4) === '    ') {
                            el.val(value.substring(0, lineStart) + value.substring(lineStart + 4));
                            el[0].selectionStart = el[0].selectionEnd = start - 4;
                        } else if (value.substring(lineStart, lineStart + 1) === '\t') {
                            el.val(value.substring(0, lineStart) + value.substring(lineStart + 1));
                            el[0].selectionStart = el[0].selectionEnd = start - 1;
                        }
                    } else {
                        // Indent
                        el.val(value.substring(0, start) + '    ' + value.substring(end));
                        el[0].selectionStart = el[0].selectionEnd = start + 4;
                    }
                    el.trigger('input');
                }
            });
        };

        const initEditor = () => {
            const scriptType = scriptTypeSelect.val();
            if (jsAutocomplete) {
                jsAutocomplete.destroy();
                jsAutocomplete = null;
            }

            if (scriptType === 'stscript') {
                try {
                    setSlashCommandAutoComplete(scriptTextarea[0], true);
                } catch {
                    // do nothing
                }
            } else if (scriptType === 'js') {
                jsAutocomplete = new JSAutocomplete(scriptTextarea[0]);
            }
            attachEvents(scriptTextarea);
            updateSyntax();
        };

        scriptTypeSelect.on('change', () => {
            const val = scriptTextarea.val();
            const newTextarea = scriptTextarea.clone();
            newTextarea.val(val);
            scriptTextarea.replaceWith(newTextarea);
            scriptTextarea = newTextarea;
            
            initEditor();
        });

        let lastValue = null;
        const syntaxLoop = () => {
            if (!$.contains(document, editorHtml[0])) return;
            
            const currentValue = scriptTextarea.val();
            if (currentValue !== lastValue) {
                lastValue = currentValue;
                updateSyntax();
            }
            syncScroll();
            requestAnimationFrame(syntaxLoop);
        };
        requestAnimationFrame(syntaxLoop);

        initEditor();
     
        const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
        if (popupResult) {
            const trigger_periodicity = editorHtml.find(`select[name="DreamAlbum-scripteditor-trigger-periodicity"]`).val();
            const blockData = {
                id: existingId,
                block_type: BlockType.SCRIPT,
                name: editorHtml.find('.DreamAlbum-scripteditor-block-name').val(),
                script_type: editorHtml.find(`select[name="DreamAlbum-scripteditor-script-type"]`).val(),
                script: editorHtml.find('.DreamAlbum-scripteditor-script').val(),
                disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
                user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
                char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
                generation_pause: editorHtml.find('input[name="generation_pause"]').prop('checked'),
                period: editorHtml.find('input[name="period"]').val(),
                keyword: trigger_periodicity === 'keyword' ? editorHtml.find('input[name="keyword"]').val() : '',
                keyword_is_regex: editorHtml.find('input[name="keyword_is_regex"]').prop('checked'),
                execution_order: editorHtml.find(`select[name="DreamAlbum-editor-execution-order"]`).val() || 'before'
            };

            const preparedBlock = EditorService.prepareBlockForSave(blockData);
            await BlockService.saveBlock(preparedBlock, existingBlockIndex, isScoped);
            await MainUI.loadBlocks();
        }
    }
};