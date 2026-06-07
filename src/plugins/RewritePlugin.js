import { BlockType, defaultExtPrefix } from '../core/constants.js';
import { extStates } from '../core/state.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { MacroService } from '../services/MacroService.js';
import { getMultiBlockContentFromMessage } from '../utils/blockUtils.js';

const { chat } = SillyTavern.getContext();

/**
 * Plugin for handling Rewrite blocks.
 */
export const RewritePlugin = {
    type: BlockType.REWRITE,

    /**
     * Generates a rewrite for a specific block.
     */
    async generateRewrite(rewriteBlock, messageId, allBlocks, additionalMacro = {}) {
        if (!additionalMacro.textToRewrite) {
            additionalMacro.textToRewrite = chat[messageId].mes;
        }

        let fullPrompt = BlockService.getSingleBlockFullPrompt(rewriteBlock, messageId, allBlocks, additionalMacro);
        fullPrompt = await MacroService.checkAllMacros(fullPrompt);

        const blocksData = await ApiService.generateBlocks(fullPrompt, rewriteBlock.api_preset);
        const preset = rewriteBlock.api_preset ? extStates.DreamAlbum_settings.api_presets[rewriteBlock.api_preset] : extStates.api_preset;
        const blocks = ApiService.extractMessageFromData(blocksData, preset);
        return getMultiBlockContentFromMessage(blocks, 'rewritten text');
    },

    /**
     * Executes the rewrite blocks.
     * @param {Object[]} blocks - The rewrite blocks to process.
     * @param {Object} options - Execution options.
     * @param {number} options.messageId - The ID of the message being processed.
     * @param {Object[]} options.allBlocks - All enabled blocks.
     * @param {string} [options.generation_order] - Filter by generation order ('before' or 'after').
     * @param {Object} [options.additionalMacro] - Additional macros for substitution.
     */
    async execute(blocks, options = {}) {
        const { messageId, allBlocks, generation_order, additionalMacro = {} } = options;
        
        const blocksToProcess = generation_order 
            ? blocks.filter(block => block.generation_order === generation_order)
            : blocks;

        if (blocksToProcess.length === 0) return;

        toastr.info(`${defaultExtPrefix} Rewriting, please wait...`);
        let isSuccess = true;
        let isPartialSuccess = false;

        for (const rewriteBlock of blocksToProcess) {
            const rewrittenText = await this.generateRewrite(rewriteBlock, messageId, allBlocks, additionalMacro);

            if (rewrittenText && !rewrittenText.includes('Proxy error')) {
                if (additionalMacro.textToRewrite && additionalMacro.textToRewrite !== chat[messageId].mes) {
                    chat[messageId].mes = chat[messageId].mes.replace(additionalMacro.textToRewrite, rewrittenText);
                } else {
                    chat[messageId].mes = rewrittenText;
                }
                isPartialSuccess = true;
            } else {
                isSuccess = false;
            }
        }

        if (chat[messageId].swipe_id && isPartialSuccess) {
            chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
        }

        if (isPartialSuccess) {
            await BlockService.updateBlocksDisplay(messageId);
        }

        if (isSuccess) {
            toastr.success(`${defaultExtPrefix} Rewriting is done!`);
        } else if (isPartialSuccess) {
            toastr.warning(`${defaultExtPrefix} Rewriting probably failed.`);
        } else {
            toastr.error(`${defaultExtPrefix} Rewriting failed.`);
        }
    }
};