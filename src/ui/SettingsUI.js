import { download } from '../../../../../utils.js';
import { 
    templates_path, 
    ElementTemplate, 
    selectionRewriteButton 
} from '../core/constants.js';
import { extStates } from '../core/state.js';
import { updateOrInsert } from '../utils/dataUtils.js';
import { SettingsService } from '../services/SettingsService.js';
import { MacroService } from '../services/MacroService.js';
import { BlockService } from '../services/BlockService.js';
import { MainUI } from './MainUI.js';
import { FloatingUI } from './FloatingUI.js';
import { ApiService } from '../services/ApiService.js';
import { GeneratedEditor } from './editors/GeneratedEditor.js';
import { AccumulationEditor } from './editors/AccumulationEditor.js';
import { ScriptEditor } from './editors/ScriptEditor.js';
import { SelectionRewriteController } from './SelectionRewriteController.js'

const { 
    saveSettingsDebounced, extensionSettings,
    renderExtensionTemplateAsync, callPopup
 } = SillyTavern.getContext();
 
export const SettingsUI = {
    /**
     * Refreshes the set list in the settings panel.
     */
    refreshSetList() {
        let sets_name = extStates.DreamAlbum_settings.sets.map(obj => obj.name);
        $('#DreamAlbum-preset-list').empty();
        sets_name.forEach(function(option) {
            $('#DreamAlbum-preset-list').append($('<option>', {
                value: option,
                text: option
            }));
        });
        $(`#DreamAlbum-preset-list option[value="${extStates.DreamAlbum_settings.active_set}"]`).attr('selected', true);
    },

    /**
     * Sets up all event listeners for the settings panel.
     */
    async setupListeners() {
        $('#dreamalbum_is_enabled').off('click').on('click', async () => {
            const value = $('#dreamalbum_is_enabled').prop('checked');
            extensionSettings.DreamAlbum.dreamalbum_is_enabled = value;
            if (value) {
                await BlockService.updateDisplayForBlocks();
                MacroService.registerExtensionMacros();
            } else {
                MacroService.unregisterExtensionMacros();
                if (SillyTavern.getContext().characterId !== undefined) {
                    await BlockService.purgeAllBlocksDisplayText();
                    BlockService.removeAllBlockInjects();
                }
            }
            FloatingUI.render();
            saveSettingsDebounced();
        });

        $('#DreamAlbum-preset-list').on('change', async function () {
            const idx = $('#DreamAlbum-preset-list').prop('selectedIndex');
            await SettingsService.changeSet(idx);
        }.bind(this));

        $('#DreamAlbum-preset-new').on('click', async function () {
            let newSetHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.NEW_SET_POPUP));
            const popupResult = await callPopup(newSetHtml, 'confirm', undefined, { okButton: 'Save' });
            if (popupResult) {
                let newSet = SettingsService.getDefaultSet();
                newSet.name = String(newSetHtml.find('.DreamAlbum-newset-name').val());
                const set_idx = updateOrInsert(extensionSettings.DreamAlbum.sets, newSet);
                await SettingsService.changeSet(set_idx);
                this.refreshSetList();
            }
        }.bind(this));

        $('#DreamAlbum-preset-importFile').on('change', async function () {
            const inputElement = /** @type {HTMLInputElement} */ (this);
            if (!inputElement.files) return;
            for (const file of inputElement.files) {
                await SettingsService.importSet(file);
            }
            inputElement.value = '';
        });

        $('#DreamAlbum-preset-import').on('click', function () {
            $('#DreamAlbum-preset-importFile').trigger('click');
        });

        $('#DreamAlbum-preset-export').on('click', async function () {
            const fileName = `${extStates.current_set.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
            const fileData = JSON.stringify(extStates.current_set, null, 4);
            download(fileData, fileName, 'application/json');
        });

        $('#DreamAlbum-preset-delete').on('click', async function () {
            const confirm = await callPopup('Are you sure you want to delete this set?', 'confirm');

            if (!confirm) {
                return;
            }

            extensionSettings.DreamAlbum.sets.splice(extensionSettings.DreamAlbum.active_set_idx, 1);
            if (extensionSettings.DreamAlbum.sets.length != 0) {
                await SettingsService.changeSet(0);
            } else {
                const set_idx = updateOrInsert(extensionSettings.DreamAlbum.sets, SettingsService.getDefaultSet());
                await SettingsService.changeSet(set_idx);
            }
        }.bind(this));

        $('#DreamAlbum-api-preset').on('change', async function () {
            const presetName = $(this).val();
            extensionSettings.DreamAlbum.active_api_preset = presetName;
            saveSettingsDebounced();
            await ApiService.loadApiPreset();
        });
        
        $('#DreamAlbum-proxy-toggle').off('click').on('click', function () {
            $('#DreamAlbum-proxy').slideToggle(200, 'swing');
        });

        $('#DreamAlbum-proxy-connection-profile').off('click').on('change', function () {
            const value = $('#DreamAlbum-proxy-connection-profile').val();
            extStates.api_preset.connection_profile = value;
            saveSettingsDebounced();
        });

        $('#DreamAlbum-proxy-connection-profile-refresh').on('click', function() {
            ApiService.refreshConnectionProfiles();
            toastr.success('Connection profiles list refreshed!');
        });

        $('#DreamAlbum-proxy-temperature').off('click').on('input', function () {
            const value = $('#DreamAlbum-proxy-temperature').val();
            extStates.api_preset.temperature = parseFloat(String(value));
            saveSettingsDebounced();
        });

        $('#DreamAlbum-proxy-topp').off('click').on('input', function () {
            const value = $('#DreamAlbum-proxy-topp').val();
            extStates.api_preset.top_p = parseFloat(String(value));
            saveSettingsDebounced();
        });

        $('#DreamAlbum-proxy-maxtokens').off('click').on('input', function () {
            const value = $('#DreamAlbum-proxy-maxtokens').val();
            extStates.api_preset.max_tokens = parseInt(String(value), 10);
            saveSettingsDebounced();
        });

        $('#DreamAlbum-proxy-contextsize').off('input').on('input', function () {
            const value = $(this).val();
            $('#DreamAlbum-proxy-contextsize-val').text(value);
            extStates.api_preset.context_size = parseInt(String(value), 10);
            saveSettingsDebounced();
        });

        $('#DreamAlbum-proxy-reasoningeffort').off('click').on('change', function () {
            const value = $('#DreamAlbum-proxy-reasoningeffort').val();
            extStates.api_preset.reasoning_effort = value;
            saveSettingsDebounced();
        });

        $('#DreamAlbum-enable-jb').off('click').on('click', () => {
            const value = $('#DreamAlbum-enable-jb').prop('checked');
            extStates.api_preset.confirmation_jb = value;
            saveSettingsDebounced();
        });

        $('#DreamAlbum-blocks-global-openeditor').off('click').on('click', () => {
            GeneratedEditor.open(false, false);
        });

        $('#DreamAlbum-blocks-scoped-openeditor').off('click').on('click', () => {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            GeneratedEditor.open(false, true);
        });

        $('#DreamAlbum-blocks-global-openaccumulationeditor').off('click').on('click', () => {
            AccumulationEditor.open(false, false);
        });

        $('#DreamAlbum-blocks-scoped-openaccumulationeditor').off('click').on('click', () => {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            AccumulationEditor.open(false, true);
        });

        $('#DreamAlbum-blocks-global-openscripteditor').off('click').on('click', () => {
            ScriptEditor.open(false, false);
        });

        $('#DreamAlbum-blocks-scoped-openscripteditor').off('click').on('click', () => {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            ScriptEditor.open(false, true);
        });

        $('#DreamAlbum-blocks-global-import-file').on('change', async function () {
            const inputElement = /** @type {HTMLInputElement} */ (this);
            if (!inputElement.files) return;
            for (const file of inputElement.files) {
                await BlockService.importBlock(file, false);
            }
            inputElement.value = '';
            await MainUI.loadBlocks();
        });

        $('#DreamAlbum-blocks-global-import').on('click', function () {
            $('#DreamAlbum-blocks-global-import-file').trigger('click');
        });

        $('#DreamAlbum-blocks-scoped-import-file').on('change', async function () {
            const inputElement = /** @type {HTMLInputElement} */ (this);
            if (!inputElement.files) return;
            for (const file of inputElement.files) {
                await BlockService.importBlock(file, true);
            }
            inputElement.value = '';
            await MainUI.loadBlocks();
        });

        $('#DreamAlbum-blocks-scoped-import').on('click', function () {
            $('#DreamAlbum-blocks-scoped-import-file').trigger('click');
        });

        $('#chat').on('click', '.DreamAlbum-storage-edit', async function() {
            const messageId = $(this).closest('.mes').attr('mesid');
            const blocksStr = BlockService.getBlocksFromExtra(messageId);

            let storageEditorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.STORAGE_EDITOR));
            storageEditorHtml.find('.DreamAlbum-storage').val(blocksStr);

            const popupResult = await callPopup(storageEditorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
            if (popupResult) {
                await BlockService.purgeBlocksExtra(messageId, true);
                await BlockService.addBlocksToExtra(messageId, storageEditorHtml.find('.DreamAlbum-storage').val());
            }
        });

        $('#chat').on('click', '.custom-menu-button', function() {
            const value = $(this).find('.custom-cyoa-option-value').text();
            $('#send_textarea').val(value);
        });

        $('#chat').on('focus', '#curEditTextarea', function () {
            const message = $(this).closest('.mes');
            if (message.find('.mes_edit_buttons .DreamAlbum-selection-rewrite').length === 0) {
                const copyButton = message.find('.mes_edit_buttons .mes_edit_copy');
                copyButton.after(selectionRewriteButton);
            }
        });

        $('#chat').on('click', '.mes_edit_cancel', function() {
            SelectionRewriteController.deactivate();
        });

        $('#chat').on('click', '.mes_edit_done', function() {
            SelectionRewriteController.deactivate();
        });
    }
};