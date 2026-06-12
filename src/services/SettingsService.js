import { getFileText } from '../../../../../utils.js';
import { extStates } from '../core/state.js';
import { defaultSettings, defaultApiPreset, defaultSet } from '../core/constants.js';
import { updateOrInsert } from '../utils/dataUtils.js';

import { ApiService } from './ApiService.js';
import { MainUI } from '../ui/MainUI.js';
import { SettingsUI } from '../ui/SettingsUI.js';

const { uuidv4, saveSettingsDebounced, extensionSettings } = SillyTavern.getContext();

export const SettingsService = {
    /**
     * Validates and migrates settings if necessary.
     */
    checkSettings() {
        const dreamAlbumSettings = extensionSettings.DreamAlbum;
        let needsSave = false;

        if (!dreamAlbumSettings.api_presets) {
            const oldPreset = { ...defaultApiPreset };
            if (dreamAlbumSettings.proxy_preset) {
                oldPreset.proxy_preset = dreamAlbumSettings.proxy_preset;
                const set = dreamAlbumSettings.sets[dreamAlbumSettings.active_set_idx];
                if (set) {
                    oldPreset.chat_completion_source = set.chat_completion_source;
                    oldPreset.model = set.model;
                    oldPreset.temperature = set.temperature;
                    oldPreset.confirmation_jb = set.confirmation_jb;
                }
            }

            dreamAlbumSettings.api_presets = {
                'big': { ...oldPreset },
                'medium': { ...oldPreset },
                'small': { ...oldPreset },
            };
            dreamAlbumSettings.active_api_preset = 'big';
            needsSave = true;
        }

        let migration_done = false;
        for (const presetName in dreamAlbumSettings.api_presets) {
            const preset = dreamAlbumSettings.api_presets[presetName];
            if ('chat_completion_source' in preset || 'proxy_preset' in preset || 'model' in preset) {
                const defaultProfile = extensionSettings.connectionManager?.profiles?.[0];
                if (defaultProfile) {
                    preset.connection_profile = defaultProfile.name;
                    migration_done = true;
                    needsSave = true;
                } else {
                    toastr.error(`[DreamAlbum] Could not migrate API preset "${presetName}". No Connection Profiles found.`);
                }
                delete preset.chat_completion_source;
                delete preset.proxy_preset;
                delete preset.model;
            }

            if (preset.stream !== false) {
                preset.stream = false; // Always disable streaming
                needsSave = true;
            }
            if (preset.top_p === undefined) { preset.top_p = defaultApiPreset.top_p; needsSave = true; }
            if (preset.max_tokens === undefined) { preset.max_tokens = defaultApiPreset.max_tokens; needsSave = true; }
            if (preset.reasoning_effort === undefined) { preset.reasoning_effort = defaultApiPreset.reasoning_effort; needsSave = true; }
        }

        if (migration_done) {
            toastr.warning(`[DreamAlbum] API presets have been migrated to use Connection Profiles. Please review your settings.`);
        }

        // Initialize floating buttons settings if missing
        if (dreamAlbumSettings.floating_buttons_enabled === undefined) {
            dreamAlbumSettings.floating_buttons_enabled = defaultSettings.floating_buttons_enabled;
            needsSave = true;
        }
        if (dreamAlbumSettings.floating_buttons_styles === undefined) {
            dreamAlbumSettings.floating_buttons_styles = defaultSettings.floating_buttons_styles;
            needsSave = true;
        }
        if (dreamAlbumSettings.moodtube_link === undefined) {
            dreamAlbumSettings.moodtube_link = defaultSettings.moodtube_link;
            needsSave = true;
        }
        if (dreamAlbumSettings.album_theme === undefined) {
            dreamAlbumSettings.album_theme = defaultSettings.album_theme;
            needsSave = true;
        }
        if (dreamAlbumSettings.button_position === undefined) {
            dreamAlbumSettings.button_position = defaultSettings.button_position;
            needsSave = true;
        }
        if (dreamAlbumSettings.action_buttons === undefined) {
            dreamAlbumSettings.action_buttons = defaultSettings.action_buttons;
            needsSave = true;
        }

        if (needsSave) {
            saveSettingsDebounced();
        }
    },

    /**
     * Loads settings into the extension state.
     */
    async loadSettings() {
        if (!extensionSettings.DreamAlbum) {
            extensionSettings.DreamAlbum = defaultSettings;
            saveSettingsDebounced();
        }
        this.checkSettings();
        await this.refreshSettings();
    },

    /**
     * Refreshes the local state from extensionSettings.
     */
    async refreshSettings() {
        extStates.DreamAlbum_settings = extensionSettings.DreamAlbum;
        extStates.current_set = extStates.DreamAlbum_settings.sets[extStates.DreamAlbum_settings.active_set_idx];
        extStates.api_preset = extStates.DreamAlbum_settings.api_presets[extStates.DreamAlbum_settings.active_api_preset];
        
        const activeProfileName = extStates.api_preset.connection_profile;
        const profiles = extensionSettings.connectionManager?.profiles ?? [];
        extStates.connection_profile = profiles.find(p => p.name === activeProfileName) ?? profiles[0];

        if (!extStates.connection_profile) {
            console.warn('[DreamAlbum] No connection profiles available in SillyTavern.');
        } else if (extStates.connection_profile.name !== activeProfileName) {
            extStates.api_preset.connection_profile = extStates.connection_profile.name;
        }
    },


    /**
     * Returns a copy of the default set.
     */
    getDefaultSet() {
        return JSON.parse(JSON.stringify(defaultSet));
    },

    /**
     * Changes the active set.
     * @param {number} idx
     */
    async changeSet(idx) {
        const set_name = extensionSettings.DreamAlbum.sets[idx].name;
        extensionSettings.DreamAlbum.active_set = set_name;
        extensionSettings.DreamAlbum.active_set_idx = idx;
        await this.refreshSettings();
        saveSettingsDebounced();

        await ApiService.loadAPI();
        await MainUI.loadBlocks();
        SettingsUI.refreshSetList();
    },

    /**
     * Imports a set from a JSON object.
     * @param {Object} setObject
     * @returns {boolean}
     */
    importSetFromObject(setObject) {
        if (!setObject.name) {
            return false;
        }

        updateOrInsert(extensionSettings.DreamAlbum.sets, setObject);
        saveSettingsDebounced();
        return true;
    },

    /**
     * Imports a set from a file.
     * @param {File} file
     */
    async importSet(file) {
        if (!file) {
            toastr.error('No file provided.');
            return;
        }

        try {
            const fileText = await getFileText(file);
            const extSet = JSON.parse(fileText);
            if (!extSet.name) {
                throw new Error('No name provided.');
            }

            const set_idx = updateOrInsert(extensionSettings.DreamAlbum.sets, extSet);
            await this.changeSet(set_idx);
            toastr.success(`DreamAlbum set "${extSet.name}" imported.`);
        } catch (error) {
            console.error(error);
            toastr.error('Invalid JSON file.');
        }
    }
};