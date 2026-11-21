const { connection_profiles } = SillyTavern.getContext();

const defaultConnectionProfileName = connection_profiles?.[0]?.name ?? '';

export const defaultApiPreset = {
    temperature: 0.2,
    top_p: 1,
    max_tokens: 4096,
    reasoning_effort: 'auto',
    confirmation_jb: false,
    connection_profile: defaultConnectionProfileName,
    stream: false,
    context_size: 10,
    include_char_card: false,
    include_lorebooks: false,
    include_persona: false,
    include_previous_blocks: false,
};

export const defaultSet = {
    name: 'Default',
    image: '',
    prompt: '',
    global_blocks: [],
};

export const defaultSettings = {
    dreamalbum_is_enabled: false,
    active_set: 'Default',
    active_set_idx: 0,
    active_api_preset: 'big',
    api_presets: {
        'big': { ...defaultApiPreset },
        'medium': { ...defaultApiPreset },
        'small': { ...defaultApiPreset },
    },
    sets: [ defaultSet ],
    hidden_items: [],
    floating_buttons_enabled: false,
    /** Collapse whitespace in request context (cards, persona, lorebook, history). */
    compress_context_whitespace: false,
    floating_buttons_styles: [],
    /** Styles shown inside the expanding group button, max FLOATING_GROUP_MAX. */
    floating_group_styles: [],
    moodtube_link: false,
    album_theme: 'default',
    extblocks_installed: false,
    button_position: 'top-left',
    action_buttons: {
        fullscreen: true,
        copy: true,
        edit: true,
        delete: true
    },
};

/** How many styles the expanding floating group button can hold. */
export const FLOATING_GROUP_MAX = 5;

export const extName = 'DreamAlbum';
export const defaultExtPrefix = '[DreamAlbum]';
export const worldInfoMacrosNames = ['{{wiBefore}}', '{{wiAfter}}', '{{wiExamples}}', '{{wiDepth}}', '{{wiAll}}'];
export const mainPromptMacros = '{{mainPrompt}}';

function resolveExtensionPath() {
    const marker = '/scripts/extensions/';
    const suffix = '/src/core/constants.js';
    const url = import.meta.url;
    const markerIndex = url.indexOf(marker);
    const suffixIndex = url.indexOf(suffix);

    if (markerIndex !== -1 && suffixIndex !== -1 && suffixIndex > markerIndex) {
        return url.slice(markerIndex + marker.length, suffixIndex);
    }

    return 'third-party/DreamAlbum';
}

export const path = resolveExtensionPath();
export const templates_path = path + '/templates';

export const BlockType = {
    GENERATED: 'generated',
    ACCUMULATION: 'accumulation',
    REWRITE: 'rewrite',
    SCRIPT: 'script'
};

export const ContextType = {
    TEXT: 'text',
    LAST_MESSAGES: 'last_messages',
    LAST_MESSAGES_KEYWORD: 'last_messages_keyword',
    PREVIOUS_BLOCK: 'previous_block'
};

export const ScriptType = {
    ST: 'stscript',
    JS: 'js'
};

export const MessageRole = {
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant'
};

export const ElementTemplate = {
    SETTINGS: 'settings',
    BLOCK: 'block',
    CONTEXT_ITEM: 'context_item',
    NEW_SET_POPUP: 'new_set_popup',
    STORAGE_EDITOR: 'storage_editor',
    GENERATED_EDITOR: 'editor',
    ACCUMULATION_EDITOR: 'accumulation_editor',
    SCRIPT_EDITOR: 'script_editor',
    SELECTION_POPUP: 'selection_popup',
    ALBUM_PANEL: 'album_panel',
    API_SETTINGS: 'api_settings',
    STYLE_PICKER: 'style_picker',
};

export const ExtSlashCommand = {
    GENERATE: 'dreamalbum-generate',
    REGENERATE: 'dreamalbum-regenerate',
    REWRITE: 'dreamalbum-rewrite',
    EXECUTE_SCRIPT: 'dreamalbum-execute-script',
    STORAGE_APPEND: 'dreamalbum-storage-append',
    STORAGE_PURGE: 'dreamalbum-storage-purge',
    STORAGE_EXPORT: 'dreamalbum-storage-export',
    FLUSH_INJECTS: 'dreamalbum-flushinjects',
    ABORT: 'dreamalbum-abort-generation'
};

export const MacroName = {
    MAIN: `${extName}`,
    GET_BLOCK_BY_NAME: `${extName}-GetBlockByName`,
    CALL_GENERATION: `${extName}-Call`,
    CALL_REWRITE: `${extName}-CallRewrite`,
    CALL_SCRIPT: `${extName}-CallScript`
}

export const ExtTopic = {
    GENERATE_BLOCKS: '/dreamalbum/generate',
    BLOCKS_GENERATED: '/dreamalbum/generated',
    BLOCKS_GENERATED_IIG: 'dreamalbum_blocks_generated',
    FATPRESETS_IMPORT: '/fatpresets/import/dreamalbum',
    FATPRESETS_CHANGE: '/fatpresets/change/dreamalbum',
    FATPRESETS_DISABLE: '/fatpresets/disable/dreamalbum',
    PROMPT_TEMPLATE_ENGINE: '/prompttemplateengine/render'
}

/**
 * Key under `message.extra` where DreamAlbum keeps its block storage.
 * Deliberately NOT `extblocks`: the original Ext-blocks extension owns that key
 * and clears it on swipes, which used to wipe DreamAlbum's images.
 */
export const MESSAGE_STORAGE_KEY = 'dreamalbum';

/** Legacy key used before the split. Read-only: migrated on first access, never written. */
export const LEGACY_STORAGE_KEY = 'extblocks';

/**
 * Maps a block's previous tag name to its current one. Old chat data still has the
 * old tag text sitting in the legacy `extblocks` key; without this, renaming a block
 * (e.g. to resolve a name collision with another extension) would silently orphan
 * every image already stored under the old tag. Extend this whenever a shipped
 * block's name changes.
 */
export const LEGACY_BLOCK_ALIASES = {
    'ext-blocks': 'dreamalbum',
};

/** Markers delimiting DreamAlbum's own section inside the shared `extra.display_text`. */
export const DISPLAY_SECTION_START = '<!--DA:BLOCKS-->';
export const DISPLAY_SECTION_END = '<!--/DA:BLOCKS-->';

export const editButton = `<div title="Edit dreamalbum" class="mes_button DreamAlbum-storage-edit fa-solid fa-pen-to-square interactable" tabindex="0"></div>`;
export const selectionRewriteButton = `<div title="[DreamAlbum] Partial rewrite" class="menu_button DreamAlbum-selection-rewrite fa-solid fa-pen-to-square interactable" tabindex="0" role="button"></div>`;