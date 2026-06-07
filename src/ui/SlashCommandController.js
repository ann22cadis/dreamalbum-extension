import { ExtSlashCommand } from '../core/constants.js';
import { CommandService } from '../services/CommandService.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';

const { 
    SlashCommand, 
    SlashCommandArgument, 
    SlashCommandNamedArgument, 
    SlashCommandParser,
    ARGUMENT_TYPE
} = SillyTavern.getContext();

const {
    runBlockGenerationCallback,
    appendStringToExtraCallback,
    purgeExtraCallback,
    runBlockRegenerationCallback,
    runRewriteBlocksCallback,
    runScriptsExecutionCallback,
    exportBlocksCallback
} = CommandService;

export const SlashCommandController = {
    /**
     * Registers all slash commands for the extension.
     */
    init() {
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.GENERATE,
            callback: runBlockGenerationCallback,
            returns: 'void',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'name',
                    description: 'block name(s)',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                }),
                SlashCommandNamedArgument.fromProps({
                    name: 'is_separate',
                    description: 'whether the block should create a new message',
                    typeList: [ARGUMENT_TYPE.BOOLEAN],
                    isRequired: false,
                })
            ],
            unnamedArgumentList: [
                new SlashCommandArgument(
                    'additional prompt', [ARGUMENT_TYPE.STRING], false, false, ''
                ),
            ],
            helpString: 'Starts generating block(s) by its/their name.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.STORAGE_APPEND,
            callback: appendStringToExtraCallback,
            returns: 'void',
            unnamedArgumentList: [
                new SlashCommandArgument(
                    'block string', [ARGUMENT_TYPE.STRING], false, false, ''
                ),
            ],
            helpString: 'Appends block/blocks to the last message block storage.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.STORAGE_PURGE,
            callback: purgeExtraCallback,
            returns: 'void',
            helpString: 'Purge the last message block storage.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.REGENERATE,
            callback: runBlockRegenerationCallback,
            returns: 'void',
            helpString: 'Regenerates last blocks.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.FLUSH_INJECTS,
            callback: async () => {
                await BlockService.selfReloadCurrentChat();
                return "";
            },
            returns: 'void',
            helpString: 'Flushes DreamAlbum injects.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.STORAGE_EXPORT,
            callback: exportBlocksCallback,
            returns: 'void',
            helpString: 'Exports each enabled block to a system message.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.REWRITE,
            callback: runRewriteBlocksCallback,
            returns: 'void',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'name',
                    description: 'rewrite block name(s)',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                })
            ],
            unnamedArgumentList: [
                new SlashCommandArgument(
                    'additional prompt', [ARGUMENT_TYPE.STRING], false, false, ''
                ),
            ],
            helpString: 'Rewrites the last message using rewriting blocks.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.EXECUTE_SCRIPT,
            callback: runScriptsExecutionCallback,
            returns: 'void',
            namedArgumentList: [
                SlashCommandNamedArgument.fromProps({
                    name: 'name',
                    description: 'script block name(s)',
                    typeList: [ARGUMENT_TYPE.STRING],
                    isRequired: true,
                })
            ],
            helpString: 'Executes script blocks.',
        }));

        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: ExtSlashCommand.ABORT,
            callback: () => {
                ApiService.abortGeneration();
                return ""
            },
            returns: 'void',
            helpString: 'Aborts the current block generation.',
        }));
    }
};