import { BlockType, ScriptType, defaultExtPrefix } from '../core/constants.js';

// Extension API for JS blocks
import { extStates } from '../core/state.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { ApiService } from '../services/ApiService.js';
import { SettingsService } from '../services/SettingsService.js';
import { ContextService } from '../services/ContextService.js';
import { MacroService } from '../services/MacroService.js';
import { PluginRegistry } from '../core/PluginRegistry.js';
import { GeneratedPlugin } from './GeneratedPlugin.js';
import { RewritePlugin } from './RewritePlugin.js';
import { AccumulationPlugin } from './AccumulationPlugin.js';

const context = SillyTavern.getContext();

/**
 * Executes a SillyTavern slash command script.
 * @param {string} text 
 */
async function executeST(text) {
    const parser = new context.SlashCommandParser();
    const closure = parser.parse(text);
    await closure.execute();
}

/**
 * Executes a JavaScript script.
 * @param {string} text 
 */
async function executeJS(text, args = {}) {
    const { messageId, isUser, allBlocks, triggeredBlocks, additionalMacro, is_separate } = args;
    try {
        await eval(`(async () => { ${text} })()`);
    } catch (error) {
        toastr.error(`${defaultExtPrefix} An error occurred in script: ${error.message}`);
    }
}

/**
 * Plugin for handling Script blocks.
 */
export const ScriptPlugin = {
    type: BlockType.SCRIPT,

    /**
     * Executes the script blocks.
     * @param {Object[]} blocks - The script blocks to execute.
     * @param {Object} options - Execution options.
     * @param {string} [options.execution_order] - Filter by execution order ('before' or 'after').
     */
    async execute(blocks, options = {}) {
        const { execution_order } = options;
        
        const scriptsToExecute = execution_order 
            ? blocks.filter(block => block.execution_order === execution_order)
            : blocks;

        for (const block of scriptsToExecute) {
            const blockScript = block.script;
            const blockScriptType = block.script_type;
            
            if (blockScriptType === ScriptType.ST) {
                await executeST(blockScript);
            } else if (blockScriptType === ScriptType.JS) {
                await executeJS(blockScript, options);
            }
        }
    }
};