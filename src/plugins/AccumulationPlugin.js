import { BlockType } from '../core/constants.js';
import { ContextService } from '../services/ContextService.js';
import { BlockService } from '../services/BlockService.js';
import { getMultiBlockContentFromMessage } from '../utils/blockUtils.js';
import { applyMongoUpdate } from '../utils/dataUtils.js';
import * as yaml from '../../external/js-yaml.mjs';

const { chat } = SillyTavern.getContext();

/**
 * Parses a YAML/JSON string into a JSON object.
 */
function parseYaml(str) {
    try {
        return yaml.load(str);
    } catch (e) {
        console.error('[DreamAlbum] Failed to parse YAML:', e);
        return {};
    }
}

/**
 * Converts a JSON object to a YAML string.
 */
function stringifyYaml(obj) {
    try {
        return yaml.dump(obj, { lineWidth: -1 });
    } catch (e) {
        console.error('[DreamAlbum] Failed to stringify YAML:', e);
        return '';
    }
}

/**
 * Plugin for handling Accumulation blocks.
 */
export const AccumulationPlugin = {
    type: BlockType.ACCUMULATION,

    /**
     * Executes the accumulation blocks.
     * @param {Object[]} blocks - The accumulation blocks to process.
     * @param {Object} options - Execution options.
     * @param {number} options.messageId - The ID of the message being processed.
     */
    async execute(blocks, options = {}) {
        const { messageId, externalContent } = options;
        const results = [];

        for (const block of blocks) {
            const blockStr = ContextService.getPreviousBlockContextUnconditional(block, messageId, true);
            
            let blockJson;
            if (!blockStr) {
                blockJson = {};
            } else {
                const content = getMultiBlockContentFromMessage(blockStr, block.name);
                blockJson = parseYaml(content);
            }
            const sourceText = externalContent || chat[messageId].mes;
            const blockUpdaterStr = getMultiBlockContentFromMessage(sourceText, block.updater_name);
            
            if (blockUpdaterStr) {
                let updaterContent = blockUpdaterStr;

                const updateOps = parseYaml(updaterContent);
                const updatedBlock = applyMongoUpdate(blockJson, updateOps);
                
                const newContent = stringifyYaml(updatedBlock);
                const updatedBlockStr = `${`<${block.name}>`}\n${newContent.trim()}\n${`</${block.name}>`}`;
                results.push(updatedBlockStr);
            }
        }

        if (results.length > 0) {
            await BlockService.addBlocksToExtra(messageId, results.join('\n'));
        }
    }
};