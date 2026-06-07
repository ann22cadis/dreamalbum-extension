import { download, getFileText } from '../../../../../../utils.js';
import { 
    templates_path, 
    ElementTemplate, 
    BlockType, 
    MessageRole, 
    ContextType 
} from '../../core/constants.js';
import { EditorService } from '../../services/EditorService.js';
import { BlockService } from '../../services/BlockService.js';
import { interactiveSortData } from '../../utils/uiUtils.js';
import { MainUI } from '../MainUI.js';

const { 
    callPopup, 
    characters, 
    extensionSettings, 
    renderExtensionTemplateAsync, 
    uuidv4,
} = SillyTavern.getContext();

export const GeneratedEditor = {
    /**
     * Opens the editor for a Generated or Rewrite block.
     * @param {string|null} existingId - The ID of the block to edit, or null for a new block.
     * @param {boolean} isScoped - Whether the block is character-scoped.
     */
    async open(existingId, isScoped) {
        const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.GENERATED_EDITOR));
        const array = (isScoped ? characters[SillyTavern.getContext().characterId]?.data?.extensions?.DreamAlbum : extensionSettings.DreamAlbum.sets[extensionSettings.DreamAlbum.active_set_idx].global_blocks) ?? [];
        
        let contextItems = [];
        let editingContextItemId = null;
        let isResettingType = false;
        let existingBlockIndex = -1;
        let blockApiPreset = 'big';

        const getContextItemTypeMeta = (type) => {
            if (type === ContextType.TEXT) {
                return { short: 'T', full: 'Text' };
            }

            if (type === ContextType.LAST_MESSAGES) {
                return { short: 'LM', full: 'Last Message' };
            }

            if (type === ContextType.LAST_MESSAGES_KEYWORD) {
                return { short: 'LMbk', full: 'Last Message by keyword' };
            }

            if (type === ContextType.PREVIOUS_BLOCK) {
                return { short: 'PB', full: 'Previous blocks' };
            }

            return { short: '?', full: 'Unknown type' };
        };

        const getContextItemRoleMeta = (role) => {
            if (role === MessageRole.ASSISTANT) {
                return {
                    icon: 'fa-solid fa-fw fa-robot',
                    title: 'Prompt will be sent as Assistant',
                };
            }

            if ((role ?? MessageRole.USER) === MessageRole.USER) {
                return {
                    icon: 'fa-solid fa-fw fa-user',
                    title: 'Prompt will be sent as User',
                };
            }

            return null;
        };

        // --- Context Management ---

        const loadContextItems = async () => {
            editorHtml.find('#DreamAlbum-editor-context-list').empty();
            const contextItemTemplate = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.CONTEXT_ITEM));

            contextItems.forEach((context_item, index) => {
                const contextItemHtml = contextItemTemplate.clone();
                if (!context_item.id) context_item.id = uuidv4();

                contextItemHtml.attr('id', context_item.id);
                contextItemHtml.find('.DreamAlbum_editor_context_item_name').text(context_item.name);
                const contextTypeMeta = getContextItemTypeMeta(context_item.type);
                contextItemHtml.find('.DreamAlbum-editor-context-item-type')
                    .text(contextTypeMeta.short)
                    .attr('title', contextTypeMeta.full);
                const $roleBadge = contextItemHtml.find('.DreamAlbum-editor-context-item-role');
                const roleMeta = getContextItemRoleMeta(context_item.role);
                $roleBadge.removeClass('is-hidden fa-solid fa-fw fa-user fa-robot');

                if (roleMeta) {
                    $roleBadge
                        .addClass(roleMeta.icon)
                        .attr('title', roleMeta.title);
                } else {
                    $roleBadge
                        .addClass('is-hidden')
                        .removeAttr('title');
                }
                
                const $checkbox = contextItemHtml.find('.disable_DreamAlbum');
                $checkbox.prop('checked', context_item.disabled ?? false);

                $checkbox.on('change', function () {
                    context_item.disabled = !!$(this).prop('checked');
                });

                contextItemHtml.find('.DreamAlbum-toggle-on, .DreamAlbum-toggle-off').on('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    $checkbox.prop('checked', !$checkbox.prop('checked')).trigger('change');
                });

                contextItemHtml.find('.edit_context_item').on('click', () => {
                    editingContextItemId = context_item.id;
                    loadContextItemForEditing(context_item);
                });

                contextItemHtml.find('.delete_context_item').on('click', async () => {
                    contextItems.splice(index, 1);
                    await loadContextItems();
                });

                editorHtml.find('#DreamAlbum-editor-context-list').append(contextItemHtml);
            });
        };

        const updateContextItemFieldsVisibility = (type) => {
            editorHtml.find('#DreamAlbum-editor-context-builder-keywordmessages, #DreamAlbum-editor-context-builder-messages, #DreamAlbum-editor-context-builder-block, #DreamAlbum-editor-context-builder-text').hide();

            if (type === ContextType.TEXT) editorHtml.find('#DreamAlbum-editor-context-builder-text').show();
            else if (type === ContextType.LAST_MESSAGES) editorHtml.find('#DreamAlbum-editor-context-builder-messages').show();
            else if (type === ContextType.PREVIOUS_BLOCK) editorHtml.find('#DreamAlbum-editor-context-builder-block').show();
            else if (type === ContextType.LAST_MESSAGES_KEYWORD) editorHtml.find('#DreamAlbum-editor-context-builder-keywordmessages').show();
        };

        const loadContextItemForEditing = (context_item) => {
            editorHtml.find('.DreamAlbum-editor-context-builder-name').val(context_item.name);
            editorHtml.find('select[name="DreamAlbum-editor-context-builder-role"]').val(context_item.role ?? MessageRole.USER);

            isResettingType = true;
            editorHtml.find(`select[name="DreamAlbum-editor-context-item"]`).val(context_item.type).trigger('change');
            isResettingType = false;
            updateContextItemFieldsVisibility(context_item.type);

            if (context_item.type === ContextType.TEXT) {
                editorHtml.find('.DreamAlbum-editor-context-builder-text-content').val(context_item.text);
            } else if (context_item.type === ContextType.LAST_MESSAGES) {
                editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-count"]').val(context_item.messages_count);
                editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-offset"]').val(context_item.messages_offset ?? 0);
                editorHtml.find('select[name="DreamAlbum-editor-context-builder-messages-separator"]').val(context_item.messages_separator);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-userprefix').val(context_item.user_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-usersuffix').val(context_item.user_suffix);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-charprefix').val(context_item.char_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-charsuffix').val(context_item.char_suffix);
            } else if (context_item.type === ContextType.LAST_MESSAGES_KEYWORD) {
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-keywordstopper').val(context_item.keyword_stopper);
                editorHtml.find('select[name="DreamAlbum-editor-context-builder-keywordmessages-separator"]').val(context_item.messages_separator);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-userprefix').val(context_item.user_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-usersuffix').val(context_item.user_suffix);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-charprefix').val(context_item.char_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-charsuffix').val(context_item.char_suffix);
            } else if (context_item.type === ContextType.PREVIOUS_BLOCK) {
                editorHtml.find('.DreamAlbum-editor-context-builder-block-name').val(context_item.block_name);
                editorHtml.find('input[name="DreamAlbum-editor-context-builder-block-count"]').val(context_item.block_count ?? 1);
            }

            editorHtml.find('#DreamAlbum-editor-context-editor-empty').hide();
            editorHtml.find('#DreamAlbum-editor-context-editor-fields').show();
        };

        const exitEditMode = (context_type = 'text') => {
            editingContextItemId = null;
            editorHtml.find('.DreamAlbum-editor-context-builder-name').val('');
            editorHtml.find('select[name="DreamAlbum-editor-context-builder-role"]').val(MessageRole.USER);
            editorHtml.find('.DreamAlbum-editor-context-builder-text-content').val('');
            editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-count"]').val('');
            editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-offset"]').val('');
            editorHtml.find('select[name="DreamAlbum-editor-context-builder-messages-separator"]').val('double_newline');
            editorHtml.find('.DreamAlbum-editor-context-builder-messages-userprefix').val('');
            editorHtml.find('.DreamAlbum-editor-context-builder-messages-usersuffix').val('');
            editorHtml.find('.DreamAlbum-editor-context-builder-messages-charprefix').val('');
            editorHtml.find('.DreamAlbum-editor-context-builder-messages-charsuffix').val('');
            editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-keywordstopper').val('');
            editorHtml.find('.DreamAlbum-editor-context-builder-block-name').val('');
            editorHtml.find('input[name="DreamAlbum-editor-context-builder-block-count"]').val('1');

            isResettingType = true;
            editorHtml.find(`select[name="DreamAlbum-editor-context-item"]`).val(context_type).trigger('change');
            isResettingType = false;

            editorHtml.find('#DreamAlbum-editor-context-editor-empty').show();
            editorHtml.find('#DreamAlbum-editor-context-editor-fields').hide();
        };

        const handleContextItemTypeChange = () => {
            if (isResettingType) return;
            const value = editorHtml.find(`select[name="DreamAlbum-editor-context-item"]`).val();

            updateContextItemFieldsVisibility(value);
            
            const defaults = EditorService.createContextItem(value);

            if (value === ContextType.TEXT) {
                editorHtml.find('.DreamAlbum-editor-context-builder-text-content').val(defaults.text);
            } else if (value === ContextType.LAST_MESSAGES) {
                editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-count"]').val(defaults.messages_count);
                editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-offset"]').val(defaults.messages_offset);
                editorHtml.find('select[name="DreamAlbum-editor-context-builder-messages-separator"]').val(defaults.messages_separator);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-userprefix').val(defaults.user_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-usersuffix').val(defaults.user_suffix);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-charprefix').val(defaults.char_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-messages-charsuffix').val(defaults.char_suffix);
            } else if (value === ContextType.LAST_MESSAGES_KEYWORD) {
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-keywordstopper').val(defaults.keyword_stopper);
                editorHtml.find('select[name="DreamAlbum-editor-context-builder-keywordmessages-separator"]').val(defaults.messages_separator);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-userprefix').val(defaults.user_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-usersuffix').val(defaults.user_suffix);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-charprefix').val(defaults.char_prefix);
                editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-charsuffix').val(defaults.char_suffix);
            } else if (value === ContextType.PREVIOUS_BLOCK) {
                editorHtml.find('.DreamAlbum-editor-context-builder-block-name').val(defaults.block_name);
                editorHtml.find('input[name="DreamAlbum-editor-context-builder-block-count"]').val(defaults.block_count);
            }
        };

        const getContextItemFromUI = (id) => {
            const name = String(editorHtml.find('.DreamAlbum-editor-context-builder-name').val());
            const role = String(editorHtml.find('select[name="DreamAlbum-editor-context-builder-role"]').val()) || MessageRole.USER;
            const type = editorHtml.find(`select[name="DreamAlbum-editor-context-item"]`).val();
            
            const existingItem = contextItems.find(i => i.id === id);
            const disabled = existingItem ? (existingItem.disabled ?? false) : false;

            const item = { id, name, role, type, disabled };

            if (type === ContextType.TEXT) {
                item.text = String(editorHtml.find('.DreamAlbum-editor-context-builder-text-content').val());
            } else if (type === ContextType.LAST_MESSAGES) {
                item.messages_count = parseInt(String(editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-count"]').val())) || 10;
                item.messages_offset = parseInt(String(editorHtml.find('input[name="DreamAlbum-editor-context-builder-messages-offset"]').val())) || 0;
                item.messages_separator = String(editorHtml.find('select[name="DreamAlbum-editor-context-builder-messages-separator"]').val());
                item.user_prefix = String(editorHtml.find('.DreamAlbum-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n');
                item.user_suffix = String(editorHtml.find('.DreamAlbum-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n');
                item.char_prefix = String(editorHtml.find('.DreamAlbum-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n');
                item.char_suffix = String(editorHtml.find('.DreamAlbum-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n');
            } else if (type === ContextType.LAST_MESSAGES_KEYWORD) {
                item.keyword_stopper = String(editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-keywordstopper').val()) || '';
                item.messages_separator = String(editorHtml.find('select[name="DreamAlbum-editor-context-builder-keywordmessages-separator"]').val());
                item.user_prefix = String(editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-userprefix').val()).replace(/\\n/g, '\n');
                item.user_suffix = String(editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-usersuffix').val()).replace(/\\n/g, '\n');
                item.char_prefix = String(editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-charprefix').val()).replace(/\\n/g, '\n');
                item.char_suffix = String(editorHtml.find('.DreamAlbum-editor-context-builder-keywordmessages-charsuffix').val()).replace(/\\n/g, '\n');
            } else if (type === ContextType.PREVIOUS_BLOCK) {
                item.block_name = String(editorHtml.find('.DreamAlbum-editor-context-builder-block-name').val());
                item.block_count = parseInt(String(editorHtml.find('input[name="DreamAlbum-editor-context-builder-block-count"]').val())) || 1;
            }

            return item;
        };

        // --- Block Logic ---

        const changeTriggerPeriodicity = (trigger_periodicity) => {
            if (trigger_periodicity === "keyword") {
                editorHtml.find('.DreamAlbum-editor-period-wrapper').hide();
                editorHtml.find('.DreamAlbum-editor-keyword-wrapper').show();
            } else {
                editorHtml.find('.DreamAlbum-editor-period-wrapper').show();
                editorHtml.find('.DreamAlbum-editor-keyword-wrapper').hide();
            }
        };

        const handleBlockTypeChange = (blockType) => {
            const hideDisplayWrapper = editorHtml.find('#DreamAlbum-editor-hide-display-wrapper');
            const injectBlockWrapper = editorHtml.find('#DreamAlbum-editor-inject-block-wrapper');
            const injectSettings = editorHtml.find('#DreamAlbum-editor-inject-settings');
            const generationOrderWrapper = editorHtml.find('#DreamAlbum-editor-generation-order-wrapper');
        
            if (blockType === BlockType.REWRITE) {
                injectSettings.hide();
                hideDisplayWrapper.hide();
                injectBlockWrapper.hide();
                generationOrderWrapper.show();
            } else {
                injectSettings.show();
                hideDisplayWrapper.show();
                injectBlockWrapper.show();
                generationOrderWrapper.hide();
            }
        };

        const handleGenerationPauseChange = () => {
            const isPaused = editorHtml.find('input[name="generation_pause"]').is(':checked');
            editorHtml.find('input[name="user_message"]').prop('disabled', isPaused);
            editorHtml.find('input[name="char_message"]').prop('disabled', isPaused);

            if (isPaused) {
                editorHtml.find(`select[name="DreamAlbum-editor-trigger-periodicity"]`).val('keyword').trigger('change');
            }
            editorHtml.find(`select[name="DreamAlbum-editor-trigger-periodicity"]`).prop('disabled', isPaused);
        };

        // --- Initialization ---

        if (existingId) {
            existingBlockIndex = array.findIndex((block) => block.id === existingId);
            if (existingBlockIndex !== -1) {
                const block = array[existingBlockIndex];
                contextItems = (block.context || []).slice();
                blockApiPreset = block.api_preset || 'big';
                
                editorHtml.find('.DreamAlbum-editor-block-name').val(block.name);
                editorHtml.find(`select[name="DreamAlbum-editor-block-type"]`).val(block.block_type ?? BlockType.GENERATED);
                editorHtml.find('.DreamAlbum-editor-block-template').val(block.template ?? '');
                editorHtml.find('.DreamAlbum-editor-block-prompt').val(block.prompt ?? '');
                editorHtml.find('input[name="user_message"]').prop('checked', block.user_message ?? false);
                editorHtml.find('input[name="char_message"]').prop('checked', block.char_message ?? true);
                editorHtml.find('input[name="generation_pause"]').prop('checked', block.generation_pause ?? false);
                
                const trigger_periodicity = (block.keyword && block.keyword !== '') ? "keyword" : "periodic";
                editorHtml.find(`select[name="DreamAlbum-editor-trigger-periodicity"]`).val(trigger_periodicity);
                editorHtml.find('input[name="period"]').val(block.period ?? 2);
                editorHtml.find('input[name="keyword"]').val(block.keyword ?? '');
                editorHtml.find('input[name="keyword_is_regex"]').prop('checked', block.keyword_is_regex ?? false);
                
                editorHtml.find('input[name="hide_display"]').prop('checked', block.hide_display ?? false);
                editorHtml.find('input[name="inject_block"]').prop('checked', block.inject_block ?? false);
                editorHtml.find('input[name="disabled"]').prop('checked', block.disabled ?? false);
                editorHtml.find('input[name="background"]').prop('checked', block.background ?? false);
                editorHtml.find(`select[name="DreamAlbum-editor-injection-role"]`).val(block.injection_role ?? 0);
                editorHtml.find(`select[name="DreamAlbum-editor-injection-position"]`).val(block.injection_position ?? 0);
                editorHtml.find('input[name="injection_depth"]').val(block.injection_depth ?? 4);
                editorHtml.find(`select[name="DreamAlbum-editor-generation-order"]`).val(block.generation_order ?? 'before');
                
                changeTriggerPeriodicity(trigger_periodicity);
                handleBlockTypeChange(block.block_type ?? BlockType.GENERATED);
            }
        } else {
            editorHtml.find('input[name="disabled"]').prop('checked', false);
            editorHtml.find('input[name="char_message"]').prop('checked', true);
            editorHtml.find(`select[name="DreamAlbum-editor-trigger-periodicity"]`).val('periodic');
            changeTriggerPeriodicity('periodic');
        }

        // --- Event Listeners ---

        editorHtml.find('#DreamAlbum-editor-context-item-save').on('click', () => {
            if (editingContextItemId === null) return;

            const isNew = editingContextItemId === 'new';
            const id = isNew ? uuidv4() : editingContextItemId;
            const item = getContextItemFromUI(id);

            if (!EditorService.validateContextItem(item)) {
                toastr.error('Could not save context item: Name is required!');
                return;
            }

            if (isNew) {
                contextItems.push(item);
            } else {
                const index = contextItems.findIndex(i => i.id === editingContextItemId);
                if (index !== -1) {
                    contextItems[index] = item;
                }
            }

            loadContextItems();
            exitEditMode();
        });

        editorHtml.find('.DreamAlbum-preset-context-item-add').on('click', () => {
            exitEditMode();
            editorHtml.find('#DreamAlbum-editor-context-editor-empty').hide();
            editorHtml.find('#DreamAlbum-editor-context-editor-fields').show();
            editingContextItemId = 'new';
        });

        editorHtml.find('#DreamAlbum-editor-context-item-exit').on('click', () => exitEditMode());

        editorHtml.find('.DreamAlbum-editor-tab').on('click', function () {
            const tab = $(this).data('tab');
            editorHtml.find('.DreamAlbum-editor-tab').removeClass('active');
            $(this).addClass('active');
            editorHtml.find('.DreamAlbum-editor-tab-content').hide();
            editorHtml.find(`#DreamAlbum-editor-tab-${tab}`).show();
        });
        editorHtml.find(`select[name="DreamAlbum-editor-context-item"]`).on('change', handleContextItemTypeChange);
        editorHtml.find(`select[name="DreamAlbum-editor-trigger-periodicity"]`).on('change', (e) => changeTriggerPeriodicity($(e.target).val()));
        editorHtml.find(`select[name="DreamAlbum-editor-block-type"]`).on('change', (e) => handleBlockTypeChange($(e.target).val()));
        editorHtml.find('input[name="generation_pause"]').on('change', handleGenerationPauseChange);
        
        editorHtml.find('#DreamAlbum-editor-context-import').on('click', () => editorHtml.find('#DreamAlbum-editor-context-importFile').trigger('click'));
        editorHtml.find('#DreamAlbum-editor-context-importFile').on('change', async function () {
            for (const file of this.files) {
                try {
                    const fileText = await getFileText(file);
                    contextItems = JSON.parse(fileText).items || [];
                    await loadContextItems();
                } catch (e) { toastr.error('Invalid JSON file.'); }
            }
            this.value = '';
        });

        editorHtml.find('#DreamAlbum-editor-context-export').on('click', () => {
            download(JSON.stringify({ items: contextItems }, null, 4), 'context.json', 'application/json');
        });

        handleGenerationPauseChange();
        await loadContextItems();
        await interactiveSortData([{
            selector: editorHtml.find('#DreamAlbum-editor-context-list'),
            setter: (x) => {
                contextItems = x;
                loadContextItems();
            },
            getter: () => contextItems,
        }]);

        const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
        if (popupResult) {
            const trigger_periodicity = editorHtml.find(`select[name="DreamAlbum-editor-trigger-periodicity"]`).val();
            const blockData = {
                id: existingId,
                block_type: editorHtml.find(`select[name="DreamAlbum-editor-block-type"]`).val(),
                name: editorHtml.find('.DreamAlbum-editor-block-name').val(),
                disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
                template: editorHtml.find('.DreamAlbum-editor-block-template').val(),
                prompt: editorHtml.find('.DreamAlbum-editor-block-prompt').val(),
                user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
                char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
                generation_pause: editorHtml.find('input[name="generation_pause"]').prop('checked'),
                period: editorHtml.find('input[name="period"]').val(),
                keyword: trigger_periodicity === 'keyword' ? editorHtml.find('input[name="keyword"]').val() : '',
                keyword_is_regex: editorHtml.find('input[name="keyword_is_regex"]').prop('checked'),
                hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
                inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
                injection_role: editorHtml.find(`select[name="DreamAlbum-editor-injection-role"]`).val(),
                injection_position: editorHtml.find(`select[name="DreamAlbum-editor-injection-position"]`).val(),
                injection_depth: editorHtml.find('input[name="injection_depth"]').val(),
                generation_order: editorHtml.find(`select[name="DreamAlbum-editor-generation-order"]`).val(),
                background: editorHtml.find('input[name="background"]').prop('checked'),
                context: contextItems,
                api_preset: blockApiPreset
            };

            const preparedBlock = EditorService.prepareBlockForSave(blockData);
            await BlockService.saveBlock(preparedBlock, existingBlockIndex, isScoped);
            await MainUI.loadBlocks();
        }
    }
};