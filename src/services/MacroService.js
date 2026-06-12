import { checkWorldInfo } from '../../../../../world-info.js';
import { macros as macroSystem } from '../../../../../macros/macro-system.js';
import { mainPromptMacros, worldInfoMacrosNames, extName, MacroName, ExtTopic } from '../core/constants.js';
import { BlockService } from './BlockService.js';
import { ContextService } from './ContextService.js';
import { CommandService } from './CommandService.js';
const {
    chat,
    chatCompletionSettings,
    setupChatCompletionPromptManager,
    powerUserSettings,
    eventSource
} = SillyTavern.getContext();
const { runBlockGenerationCallback, runRewriteBlocksCallback, runScriptsExecutionCallback } = CommandService;
export const MacroService = {
    /**
     * Registers all extension macros.
     */
    registerExtensionMacros() {
        powerUserSettings.experimental_macro_engine = true;
        macroSystem.registry.registerMacro(MacroName.MAIN, {
            category: extName,
            description: 'Returns the content of a block by its name.',
            unnamedArgs: [
                {
                    name: 'name',
                    description: 'Block name.',
                    type: 'string',
                }
            ],
            aliases: [
                { alias: MacroName.GET_BLOCK_BY_NAME, visible: true }
            ],
            handler: ({ unnamedArgs: [name] }) => {
                if (SillyTavern.getContext().characterId === undefined) return '';
                const allBlocks = BlockService.getAllEnabledBlocks();
                const block = allBlocks.find(b => b.name === name);
                if (!block) return '';
                else return ContextService.getPreviousBlockContextUnconditional(block, chat.length - 1, true);
            }
        });
        macroSystem.registry.registerMacro(MacroName.CALL_GENERATION, {
            category: extName,
            description: 'Calls block generation by block name.',
            unnamedArgs: [
                {
                    name: 'name',
                    description: 'Block name or blocks names, separated by comma.',
                    type: 'string',
                },
                {
                    name: 'additional_prompt',
                    description: 'Additional prompt for blocks.',
                    optional: true,
                    type: "string"
                }
            ],
            returns: '',
            handler: async ({ unnamedArgs: [name, additional_prompt] }) => {
                if (SillyTavern.getContext().characterId === undefined) return '';
                await runBlockGenerationCallback({ name }, additional_prompt);
                return '';
            }
        });
        macroSystem.registry.registerMacro(MacroName.CALL_REWRITE, {
            category: extName,
            description: 'Calls message rewrite by block name.',
            unnamedArgs: [
                {
                    name: 'name',
                    description: 'Block name or blocks names, separated by comma.',
                    type: 'string',
                },
                {
                    name: 'additional_prompt',
                    description: 'Additional prompt for blocks.',
                    optional: true,
                    type: "string"
                }
            ],
            returns: '',
            handler: async ({ unnamedArgs: [name, additional_prompt] }) => {
                if (SillyTavern.getContext().characterId === undefined) return '';
                await runRewriteBlocksCallback({ name }, additional_prompt);
                return '';
            }
        });
        macroSystem.registry.registerMacro(MacroName.CALL_SCRIPT, {
            category: extName,
            description: 'Runs script execution generation by block name.',
            unnamedArgs: [
                {
                    name: 'name',
                    description: 'Block name or blocks names, separated by comma.',
                    type: 'string',
                }
            ],
            returns: '',
            handler: async ({ unnamedArgs: [name] }) => {
                if (SillyTavern.getContext().characterId === undefined) return '';
                await runScriptsExecutionCallback({ name });
                return '';
            }
        });
    },
    /**
     * Unregisters extension macros.
     */
    unregisterExtensionMacros() {
        macroSystem.registry.unregisterMacro(MacroName.GET_BLOCK_BY_NAME);
        macroSystem.registry.unregisterMacro(MacroName.MAIN);
        macroSystem.registry.unregisterMacro(MacroName.CALL_GENERATION);
        macroSystem.registry.unregisterMacro(MacroName.CALL_REWRITE);
        macroSystem.registry.unregisterMacro(MacroName.CALL_SCRIPT);
    },
    /**
     * Processes World Info macros in the prompt.
     */
    async checkWorldInfoMacros(prompt) {
        const containsWorldInfoMacros = prompt.some(message =>
            worldInfoMacrosNames.some(wiMacros => message.content.includes(wiMacros))
        );
        
        if (containsWorldInfoMacros && SillyTavern.getContext().characterId !== undefined) {
            const promptChat = prompt.map(msg => msg.content).reverse();
            const maxContext = 2e5;
            const activatedWorldInfo = await checkWorldInfo(promptChat, maxContext, true, {});
            
            let worldInfoAll = [];
            let worldInfoBefore = activatedWorldInfo.worldInfoBefore;
            if (worldInfoBefore !== '') {
                worldInfoAll.push(worldInfoBefore);
            }
            
            let worldInfoAfter = activatedWorldInfo.worldInfoAfter;
            if (worldInfoAfter !== '') {
                worldInfoAll.push(worldInfoAfter);
            }
            
            let worldInfoExamples = activatedWorldInfo.EMEntries ?? [];
            if (worldInfoExamples.length !== 0) {
                worldInfoExamples = worldInfoExamples.map(item => item.content).join('\n\n');
                worldInfoAll.push(worldInfoExamples);
            } else {
                worldInfoExamples = '';
            }
            
            let worldInfoDepth = activatedWorldInfo.WIDepthEntries ?? [];
            if (worldInfoDepth.length !== 0) {
                worldInfoDepth = worldInfoDepth.map(item => item.entries.join('\n')).join('\n\n');
                worldInfoAll.push(worldInfoDepth);
            } else {
                worldInfoDepth = '';
            }
            
            worldInfoAll = worldInfoAll.join('\n\n');
            prompt = prompt.map(message => {
                let content = message.content;
                content = content.replace(/{{wiBefore}}/gi, worldInfoBefore);
                content = content.replace(/{{wiAfter}}/gi, worldInfoAfter);
                content = content.replace(/{{wiExamples}}/gi, worldInfoExamples);
                content = content.replace(/{{wiDepth}}/gi, worldInfoDepth);
                content = content.replace(/{{wiAll}}/gi, worldInfoAll);
                
                return {
                    ...message,
                    content
                };
            });
        }
        return prompt;
    },
    /**
     * Processes Main Prompt macros in the prompt.
     */
    checkMainPromptMacros(prompt) {
        const containsMainPromptMacros = prompt.some(message =>
            message.content.includes(mainPromptMacros)
        );
        
        if (containsMainPromptMacros) {
            const promptCollection = setupChatCompletionPromptManager(chatCompletionSettings).getPromptCollection();
            let mainPrompt = promptCollection.collection.find(p => p.identifier === 'main');
            if (mainPrompt) {
                mainPrompt = mainPrompt.content;
            } else {
                mainPrompt = '';
            }
            prompt = prompt.map(message => {
                if (message.content.includes(mainPromptMacros)) {
                    return {
                        ...message,
                        content: message.content.replace(/{{mainPrompt}}/gi, mainPrompt)
                    };
                }
                return message;
            });
        }
        return prompt;
    },
    /**
     * Processes all macros in the prompt and appends character card/lorebook contexts if configured.
     */
    async checkAllMacros(prompt) {
        prompt = await this.checkWorldInfoMacros(prompt);
        prompt = this.checkMainPromptMacros(prompt);
        const data = { template: prompt };
        await eventSource.emit(ExtTopic.PROMPT_TEMPLATE_ENGINE, data);
        prompt = data.template;
        
        const context = SillyTavern.getContext();
        const dreamAlbumSettings = context.extensionSettings.DreamAlbum || {};
        const activePresetName = dreamAlbumSettings.active_api_preset || 'big';
        const preset = dreamAlbumSettings.api_presets?.[activePresetName] || {};
        let extraContextText = '';
        if (preset.include_char_card && context.characterId !== undefined) {
            const char = context.characters?.[context.characterId];
            if (char && char.data) {
                extraContextText += `### Character Card Context: ${char.name}\n`;
                if (char.data.description) extraContextText += `Description:\n${char.data.description}\n\n`;
                if (char.data.personality) extraContextText += `Personality:\n${char.data.personality}\n\n`;
                if (char.data.scenario) extraContextText += `Scenario:\n${char.data.scenario}\n\n`;
            }
        }
        if (preset.include_persona) {
            try {
                const personaName = context.name1 ?? '';
                const personaDesc = powerUserSettings.persona_description ?? '';
                if (personaName || personaDesc) {
                    extraContextText += `### User Persona:\n`;
                    if (personaName) extraContextText += `Name: ${personaName}\n`;
                    if (personaDesc) extraContextText += `Description:\n${personaDesc}\n\n`;
                }
            } catch (err) {
                console.error('[DreamAlbum] Failed to inject persona context:', err);
            }
        }
        if (preset.include_lorebooks && context.characterId !== undefined) {
            const promptChat = prompt.map(msg => msg.content).reverse();
            try {
                const activatedWorldInfo = await checkWorldInfo(promptChat, 2e5, true, {});
                let worldInfoAll = [];
                if (activatedWorldInfo.worldInfoBefore) worldInfoAll.push(activatedWorldInfo.worldInfoBefore);
                if (activatedWorldInfo.worldInfoAfter) worldInfoAll.push(activatedWorldInfo.worldInfoAfter);
                if (activatedWorldInfo.EMEntries?.length) {
                    worldInfoAll.push(activatedWorldInfo.EMEntries.map(item => item.content).join('\n\n'));
                }
                if (activatedWorldInfo.WIDepthEntries?.length) {
                    worldInfoAll.push(activatedWorldInfo.WIDepthEntries.map(item => item.entries.join('\n')).join('\n\n'));
                }
                if (worldInfoAll.length > 0) {
                    extraContextText += `### World Info (Lorebook) Context:\n${worldInfoAll.join('\n\n')}\n\n`;
                }
            } catch (err) {
                console.error('[DreamAlbum] Failed to compile world info context:', err);
            }
        }
        if (extraContextText !== '') {
            if (prompt.length > 0 && prompt[0].role === 'system') {
                prompt[0].content = `${extraContextText}${prompt[0].content}`;
            } else {
                prompt.unshift({ role: 'system', content: extraContextText });
            }
        }
        return prompt;
    }
};