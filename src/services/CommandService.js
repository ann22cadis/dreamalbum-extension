import { system_avatar, system_message_types } from '../../../../../../script.js';
import { BlockService } from './BlockService.js';
import { GenerationService } from './GenerationService.js';
import { ContextService } from './ContextService.js';

const { 
    substituteParams, 
    chat,
    saveChat,
    addOneMessage, 
    eventSource, 
    event_types 
} = SillyTavern.getContext();

export const CommandService = {
    /**
     * Callback for the generate slash command.
     */
    async runBlockGenerationCallback(args, additional_prompt) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const block_names = args.name.split(',').map((name) => name.trim());

        const allBlocks = BlockService.getBlocksByType(['generated']);
        const blocks = allBlocks.filter((e) => block_names.includes(e.name));
        if (blocks.length > 0) {
            const messageId = chat.length - 1;
            let additionalMacro = {};
            if (additional_prompt) {
                additionalMacro = { additionalPrompt: substituteParams(additional_prompt) }
            }
            let is_separate = false;
            if (args.is_separate) {
                is_separate = args.is_separate;
            }
            const generatedBlocksList = await GenerationService.handleBlocksGeneration(messageId, false, allBlocks, blocks, additionalMacro, is_separate);
            if (generatedBlocksList && generatedBlocksList.length > 0) {
                const combinedGeneratedContent = generatedBlocksList.join('\n');
                const allEnabledBlocks = BlockService.getAllEnabledBlocks();
                await GenerationService.handleBlocksAccumulation(messageId, false, allEnabledBlocks, combinedGeneratedContent);
            }
        } else {
            toastr.warning(`Blocks not found.`);
        }
        return '';
    },

    /**
     * Callback for the rewrite slash command.
     */
    async runRewriteBlocksCallback(args, additional_prompt) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const block_names = args.name.split(',').map((name) => name.trim());

        const allBlocks = BlockService.getBlocksByType(['rewrite']);
        const blocks = allBlocks.filter((e) => block_names.includes(e.name));
        if (blocks.length > 0) {
            const messageId = chat.length - 1;
            let additionalMacro = {};
            if (additional_prompt) {
                additionalMacro = { additionalPrompt: substituteParams(additional_prompt) }
            }
            let is_separate = false;
            await GenerationService.handleBlocksGeneration(messageId, false, allBlocks, blocks, additionalMacro, is_separate);
        } else {
            toastr.warning(`Blocks not found.`);
        }
        return '';
    },

    /**
     * Callback for the execute-script slash command.
     */
    async runScriptsExecutionCallback(args, _) {
        if (!args.name) {
            toastr.warning(`No block name provided`);
            return '';
        }
        const block_names = args.name.split(',').map((name) => name.trim());

        const allBlocks = BlockService.getBlocksByType(['script']);
        const blocks = allBlocks.filter((e) => block_names.includes(e.name));
        if (blocks.length > 0) {
            const messageId = chat.length - 1;
            await GenerationService.handleBlocksGeneration(messageId, false, allBlocks, blocks, {}, false);
        } else {
            toastr.warning(`Blocks not found.`);
        }
        return '';
    },

    /**
     * Callback for the regenerate slash command.
     */
    async runBlockRegenerationCallback() {
        const messageId = chat.length - 1;
        if (messageId === 0) {
            return;
        }
        const isUser = chat[messageId].is_user;

        await BlockService.purgeBlocksExtra(messageId);

        await GenerationService.handleMessageTrigger(messageId, isUser);
        return '';
    },

    /**
     * Callback for the storage-append slash command.
     */
    async appendStringToExtraCallback(_, blocksStr) {
        await BlockService.addBlocksToExtra(chat.length - 1, blocksStr);
        return '';
    },

    /**
     * Callback for the storage-purge slash command.
     */
    async purgeExtraCallback() {
        await BlockService.purgeBlocksExtra(chat.length - 1);
        return '';
    },

    /**
     * Callback for the storage-export slash command.
     */
    async exportBlocksCallback() {
        if (SillyTavern.getContext().characterId !== undefined) {
            const blocks = BlockService.getAllEnabledBlocks();
            let blocksStrArray = [];
            blocks.forEach(block => {
                blocksStrArray.push(ContextService.getPreviousBlockContextUnconditional(block, chat.length - 1, true).trim());
            });
            const blocksStr = blocksStrArray.join('\n\n');

            const message = {
                name: 'System',
                is_user: false,
                is_system: true,
                mes: blocksStr,
                force_avatar: system_avatar,
                extra: {
                    type: system_message_types.NARRATOR,
                    bias: null,
                    gen_id: Date.now(),
                    api: 'manual',
                    model: 'slash command',
                },
            };
            chat.push(message);
            await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
            addOneMessage(message);
            await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
            await saveChat();
        }
        return '';
    }
};