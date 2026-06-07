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

export const AccumulationEditor = {
    /**
     * Opens the editor for an Accumulation block.
     * @param {string|null} existingId - The ID of the block to edit, or null for a new block.
     * @param {boolean} isScoped - Whether the block is character-scoped.
     */
    async open(existingId, isScoped) {
        const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.ACCUMULATION_EDITOR));
        const array = (isScoped ? characters[SillyTavern.getContext().characterId]?.data?.extensions?.DreamAlbum : extensionSettings.DreamAlbum.sets[extensionSettings.DreamAlbum.active_set_idx].global_blocks) ?? [];

        let existingBlockIndex = -1;

        if (existingId) {
            existingBlockIndex = array.findIndex((block) => block.id === existingId);
            if (existingBlockIndex !== -1) {
                const block = array[existingBlockIndex];
                editorHtml.find('.DreamAlbum-accumulationeditor-block-name').val(block.name);
                editorHtml.find('.DreamAlbum-accumulationeditor-blockupdater-name').val(block.updater_name);
                editorHtml.find('input[name="user_message"]').prop('checked', block.user_message ?? false);
                editorHtml.find('input[name="char_message"]').prop('checked', block.char_message ?? true);
                editorHtml.find('input[name="hide_display"]').prop('checked', block.hide_display ?? false);
                editorHtml.find('input[name="inject_block"]').prop('checked', block.inject_block ?? false);
                editorHtml.find('input[name="disabled"]').prop('checked', block.disabled ?? false);
                editorHtml.find(`select[name="DreamAlbum-accumulationeditor-injection-role"]`).val(block.injection_role ?? 0);
                editorHtml.find(`select[name="DreamAlbum-accumulationeditor-injection-position"]`).val(block.injection_position ?? 0);
                editorHtml.find('input[name="injection_depth"]').val(block.injection_depth ?? 4);
            }
        } else {
            editorHtml.find('input[name="disabled"]').prop('checked', false);
            editorHtml.find('input[name="char_message"]').prop('checked', true);
        }

        editorHtml.find('#DreamAlbum-accumulationeditor-copy-prompt').on('click', () => {
            const blockName = editorHtml.find('.DreamAlbum-accumulationeditor-block-name').val() || 'block_name';
            const updaterName = editorHtml.find('.DreamAlbum-accumulationeditor-blockupdater-name').val() || 'updater_name';
            const prompt = `To update the <${blockName}> block, use the <${updaterName}> block with MongoDB-style operators ($set, $inc, $push, $pull, $unset) in YAML format. Dot notation (e.g., path.to.0.field) is supported.
Example:
<${updaterName}>
$inc:
  gold: 10
$push:
  inventory: Sword
$set:
  status.is_happy: true
  knownLocations.0.visited: true
</${updaterName}>`;
            navigator.clipboard.writeText(prompt);
            toastr.success('Default prompt copied to clipboard!');
        });

        const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save' });
        if (popupResult) {
            const blockData = {
                id: existingId,
                block_type: BlockType.ACCUMULATION,
                name: editorHtml.find('.DreamAlbum-accumulationeditor-block-name').val(),
                updater_name: editorHtml.find('.DreamAlbum-accumulationeditor-blockupdater-name').val(),
                disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
                user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
                char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
                hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
                inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
                injection_role: editorHtml.find(`select[name="DreamAlbum-accumulationeditor-injection-role"]`).val(),
                injection_position: editorHtml.find(`select[name="DreamAlbum-accumulationeditor-injection-position"]`).val(),
                injection_depth: editorHtml.find('input[name="injection_depth"]').val(),
            };

            const preparedBlock = EditorService.prepareBlockForSave(blockData);
            await BlockService.saveBlock(preparedBlock, existingBlockIndex, isScoped);
            await MainUI.loadBlocks();
        }
    }
};