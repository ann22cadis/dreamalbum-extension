import {
    MESSAGE_STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    DISPLAY_SECTION_START,
    DISPLAY_SECTION_END
} from '../core/constants.js';
import { getRegexForBlock } from './blockUtils.js';

/**
 * DreamAlbum used to share `message.extra.extblocks` with the original Ext-blocks
 * extension. Ext-blocks clears that key unconditionally on swipes, which wiped
 * DreamAlbum's generated images. Everything DreamAlbum owns now lives under its
 * own key; the legacy key is read once for migration and then left alone so
 * Ext-blocks keeps whatever belongs to it.
 */

/**
 * Reads DreamAlbum's block storage off a message `extra` object.
 * @param {Object} extra
 * @returns {string}
 */
export function readStore(extra) {
    return extra?.[MESSAGE_STORAGE_KEY] || '';
}

/**
 * Writes DreamAlbum's block storage onto a message `extra` object.
 * @param {Object} extra
 * @param {string} value
 */
export function writeStore(extra, value) {
    if (!extra) return;
    extra[MESSAGE_STORAGE_KEY] = value || '';
}

/**
 * Rewrites a matched block's own opening/closing tag name, leaving its content and
 * attributes untouched. Anchored to the start/end of the match (which is exactly
 * what `getRegexForBlock` captures), so it cannot touch an unrelated occurrence of
 * the same text buried inside the block's content.
 * @param {string} html One block match, e.g. `<old attr="x">body</old>`.
 * @param {string} oldName
 * @param {string} newName
 * @returns {string}
 */
function renameTag(html, oldName, newName) {
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return html
        .replace(new RegExp(`^(\\s*)<${escaped}(?=[\\s>])`), `$1<${newName}`)
        .replace(new RegExp(`<\\/${escaped}>(\\s*)$`), `</${newName}>$1`);
}

/**
 * Lifts DreamAlbum-owned tags out of the legacy `extblocks` key into the new one.
 * Runs once per `extra` object; the legacy value is never modified.
 * @param {Object} extra
 * @param {string[]} blockNames Names of blocks DreamAlbum knows about.
 * @param {Object.<string,string>} [aliasMap] Old tag name -> current tag name, for
 *   blocks that used to be called something else. Matched content is renamed to the
 *   current tag on the way in, so it stays discoverable after the rename.
 * @returns {boolean} True if anything was carried over.
 */
export function migrateExtra(extra, blockNames, aliasMap = {}) {
    if (!extra || typeof extra !== 'object') return false;
    if (extra[MESSAGE_STORAGE_KEY] !== undefined) return false;

    const legacy = extra[LEGACY_STORAGE_KEY];
    // Nothing to lift: leave the message untouched rather than stamping an empty
    // key onto every message in the chat file.
    if (!legacy || typeof legacy !== 'string') return false;

    const owned = [];
    for (const name of blockNames) {
        try {
            const matches = legacy.match(new RegExp(getRegexForBlock(name), 'g'));
            if (matches) owned.push(...matches);
        } catch (e) {
            // A block name that does not compile into a regex simply has nothing to migrate.
        }
    }
    for (const [oldName, newName] of Object.entries(aliasMap)) {
        // A block that has since been renamed to one of its current names would
        // already be covered by the loop above; only the old tag text needs this.
        if (blockNames.some(n => n.toLowerCase() === oldName.toLowerCase())) continue;
        try {
            const matches = legacy.match(new RegExp(getRegexForBlock(oldName), 'g'));
            if (matches) owned.push(...matches.map(m => renameTag(m, oldName, newName)));
        } catch (e) {
            // Same as above.
        }
    }

    if (!owned.length) return false;

    extra[MESSAGE_STORAGE_KEY] = owned.join('\n').trim();
    return true;
}

/**
 * Migrates a whole message, including its per-swipe extras.
 * @param {Object} message
 * @param {string[]} blockNames
 * @param {Object.<string,string>} [aliasMap]
 * @returns {boolean} True if anything was carried over.
 */
export function migrateMessage(message, blockNames, aliasMap = {}) {
    if (!message) return false;
    let moved = migrateExtra(message.extra, blockNames, aliasMap);
    if (message.swipe_info) {
        for (const info of Object.values(message.swipe_info)) {
            if (migrateExtra(info?.extra, blockNames, aliasMap)) moved = true;
        }
    }
    return moved;
}

/**
 * Removes DreamAlbum's marker-delimited section from a `display_text` value,
 * leaving any content other extensions appended intact.
 * @param {string} text
 * @returns {string}
 */
export function stripDisplaySection(text) {
    if (!text || typeof text !== 'string') return text || '';
    const start = text.indexOf(DISPLAY_SECTION_START);
    if (start === -1) return text;
    const end = text.indexOf(DISPLAY_SECTION_END, start);
    const tail = end === -1 ? '' : text.slice(end + DISPLAY_SECTION_END.length);
    return (text.slice(0, start) + tail).replace(/\s+$/, '');
}

/**
 * Builds a `display_text` that carries DreamAlbum's blocks without discarding
 * what another extension (typically Ext-blocks) already appended.
 * @param {string} mes Raw message text.
 * @param {string|undefined} existingDisplay Current `extra.display_text`, if any.
 * @param {string} blocksHtml DreamAlbum's rendered blocks, may be empty.
 * @returns {string|null} The new display text, or null when none is needed.
 */
export function composeDisplayText(mes, existingDisplay, blocksHtml) {
    const base = mes || '';

    // Keep a foreign suffix only when it is genuinely appended to the current
    // message text — a stale display_text from a previous swipe must be dropped.
    let foreignTail = '';
    if (existingDisplay) {
        const stripped = stripDisplaySection(existingDisplay);
        if (stripped.startsWith(base)) foreignTail = stripped.slice(base.length);
    }

    const section = blocksHtml
        ? `\n${DISPLAY_SECTION_START}\n${blocksHtml}\n${DISPLAY_SECTION_END}`
        : '';

    const composed = base + foreignTail + section;
    return composed === base ? null : composed;
}
