import { templates_path, ElementTemplate } from './src/core/constants.js';
import { SettingsService } from './src/services/SettingsService.js';
import { MacroService } from './src/services/MacroService.js';
import { ApiService } from './src/services/ApiService.js';
import { MainUI } from './src/ui/MainUI.js';
import { AlbumUI } from './src/ui/AlbumUI.js';
import { SettingsUI } from './src/ui/SettingsUI.js';
import { EventController } from './src/ui/EventController.js';
import { SlashCommandController } from './src/ui/SlashCommandController.js';
import { SelectionRewriteController } from './src/ui/SelectionRewriteController.js';
import { PluginRegistry } from './src/core/PluginRegistry.js';
import { ScriptPlugin } from './src/plugins/ScriptPlugin.js';
import { AccumulationPlugin } from './src/plugins/AccumulationPlugin.js';
import { RewritePlugin } from './src/plugins/RewritePlugin.js';
import { GeneratedPlugin } from './src/plugins/GeneratedPlugin.js';
const { renderExtensionTemplateAsync, extensionSettings } = SillyTavern.getContext();
function initPlugins() {
    PluginRegistry.register(ScriptPlugin);
    PluginRegistry.register(AccumulationPlugin);
    PluginRegistry.register(RewritePlugin);
    PluginRegistry.register(GeneratedPlugin);
}
async function loadSettings() {
    await SettingsService.loadSettings();
    $('#dreamalbum_is_enabled').prop('checked', extensionSettings.DreamAlbum.dreamalbum_is_enabled);
    SettingsUI.refreshSetList();
    await ApiService.loadAPI();
    await MainUI.loadBlocks();
}
function injectWandButton() {
    
    $('#DA-wand-button').remove();
    const $btn = $(`
        <a id="DA-wand-button"
           class="list-group-item flex-container flexGap5"
           title="Открыть DreamAlbum"
           tabindex="0"
           role="button">
            <i class="fa-solid fa-images"></i>
            <span>DreamAlbum</span>
        </a>
    `);
    $btn.on('click', () => {
        AlbumUI.open();
    });
    
    $('#extensionsMenu').append($btn);
}
jQuery(async () => {
    try {
        initPlugins();
        
        await SettingsService.loadSettings();
        
        Promise.all([
            (async () => {
                const settingsHtml = await renderExtensionTemplateAsync(templates_path, ElementTemplate.SETTINGS);
                
                // $('#extensions_settings').append(settingsHtml);
                $('#dreamalbum_is_enabled').prop('checked', extensionSettings.DreamAlbum.dreamalbum_is_enabled);
                SettingsUI.refreshSetList();
                await SettingsUI.setupListeners();
            })(),
            (async () => {
                await ApiService.loadAPI();
                await MainUI.loadBlocks();
            })(),
            SelectionRewriteController.init(),
            AlbumUI.init()
        ]).catch(err => {
            console.error('[DreamAlbum] Async init failed:', err);
        });
        EventController.init();
        SlashCommandController.init();
        if (extensionSettings.DreamAlbum.dreamalbum_is_enabled) {
            MacroService.registerExtensionMacros();
        }
        
        injectWandButton();
        console.log(`[DreamAlbum] extension loaded`);
    } catch (error) {
        console.error('[DreamAlbum] Critical extension load error:', error);
        toastr.error(error.message || String(error), 'DreamAlbum Load Error', { timeOut: 15000 });
    }
});