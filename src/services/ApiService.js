import { proxies, chat_completion_sources, getChatCompletionModel, oai_settings } from '../../../../../openai.js';
import { getEventSourceStream } from '../../../../../sse-stream.js';
import { extStates } from '../core/state.js';
import { MessageRole, defaultExtPrefix } from '../core/constants.js';
import { SettingsService } from './SettingsService.js';
const { getRequestHeaders, extensionSettings, chatCompletionSettings } = SillyTavern.getContext();
export const ApiService = {
    /**
     * Normalizes a profile API URL before sending it to the backend.
     */
    normalizeApiUrl(url) {
        if (typeof url !== 'string') {
            return '';
        }
        return url.trim().replace(/\/+$/, '');
    },
    /**
     * Applies source-specific connection profile fields to the generate payload.
     */
    applyConnectionProfileData(generate_data, connection_profile, cc_source) {
        const profileApiValue = connection_profile?.['api-url'];
        if (cc_source === chat_completion_sources.CUSTOM) {
            const customUrl = this.normalizeApiUrl(profileApiValue);
            if (customUrl) {
                generate_data['custom_url'] = customUrl;
            }
            const postProcessing = connection_profile?.['prompt-post-processing'] ?? chatCompletionSettings.custom_prompt_post_processing;
            if (postProcessing) {
                generate_data['custom_prompt_post_processing'] = postProcessing;
            }
            if (chatCompletionSettings.custom_include_body) {
                generate_data['custom_include_body'] = chatCompletionSettings.custom_include_body;
            }
            if (chatCompletionSettings.custom_exclude_body) {
                generate_data['custom_exclude_body'] = chatCompletionSettings.custom_exclude_body;
            }
            if (chatCompletionSettings.custom_include_headers) {
                generate_data['custom_include_headers'] = chatCompletionSettings.custom_include_headers;
            }
        } else if (cc_source === chat_completion_sources.VERTEXAI && profileApiValue) {
            generate_data['vertexai_region'] = profileApiValue;
            if (chatCompletionSettings.vertexai_auth_mode) {
                generate_data['vertexai_auth_mode'] = chatCompletionSettings.vertexai_auth_mode;
            }
            if (chatCompletionSettings.vertexai_express_project_id) {
                generate_data['vertexai_express_project_id'] = chatCompletionSettings.vertexai_express_project_id;
            }
        } else if (cc_source === chat_completion_sources.ZAI && profileApiValue) {
            generate_data['zai_endpoint'] = profileApiValue;
        }
    },
    /**
     * Loads the API preset into the UI.
     */
    async loadApiPreset() {
        await SettingsService.refreshSettings();
        const preset = extStates.api_preset;
        const connection_profile = extStates.connection_profile;
        $(`#DreamAlbum-proxy-connection-profile`).val(connection_profile.name);
        $('#DreamAlbum-proxy-temperature').val(preset.temperature);
        $('#DreamAlbum-proxy-topp').val(preset.top_p);
        $('#DreamAlbum-proxy-maxtokens').val(preset.max_tokens);
        $('#DreamAlbum-proxy-contextsize').val(preset.context_size ?? 10);
        $('#DreamAlbum-proxy-contextsize-val').text(preset.context_size ?? 10);
        $('#DreamAlbum-proxy-reasoningeffort').val(preset.reasoning_effort);
    },
    /**
     * Refreshes the connection profiles list in the UI.
     */
    refreshConnectionProfiles() {
        const connection_profiles = extensionSettings.connectionManager?.profiles ?? [];
        const connection_profile_names = connection_profiles.map(obj => obj.name);
        
        // Refresh both variants of the profile selector
        const selects = [$('#DreamAlbum-proxy-connection-profile'), $('#DA-proxy-list')];
        
        selects.forEach(select => {
            if (!select.length) return;
            select.empty();
            
            // Add a default option for the mini-panel if it's the DA-proxy-list
            if (select.attr('id') === 'DA-proxy-list') {
                select.append($('<option>', { value: '', text: '-- Выберите профиль --' }));
            }
            connection_profile_names.forEach(function(option) {
                select.append($('<option>', {
                    value: option,
                    text: option
                }));
            });
            select.val(extStates.api_preset.connection_profile);
        });
    },
    /**
     * Initializes the API settings.
     */
    async loadAPI() {
        this.refreshConnectionProfiles();
        const connection_profiles = extensionSettings.connectionManager?.profiles ?? [];
        const connection_profile_names = connection_profiles.map(obj => obj.name);
        if (!connection_profile_names.find(p => p === extStates.api_preset.connection_profile)) {
            extStates.api_preset.connection_profile = connection_profile_names[0] || '';
        }
        
        $('#DreamAlbum-api-preset').val(extStates.DreamAlbum_settings.active_api_preset);
        await this.loadApiPreset();
    },
    /**
     * Gets an API preset by name.
     */
    getApiPreset(presetName) {
        if (!presetName) return extStates.api_preset;
        const preset = extStates.DreamAlbum_settings.api_presets[presetName];
        if (preset) return preset;
        else return extStates.api_preset;
    },
    /**
     * Gets a connection profile for a given preset.
     */
    getConnectionProfile(apiPreset) {
        const connection_profiles = extensionSettings.connectionManager?.profiles ?? [];
        const preset = apiPreset || extStates.api_preset;
        const connection_profile = connection_profiles.find(p => p.name === preset.connection_profile);
        if (connection_profile) return connection_profile;
        else return connection_profiles[0];
    },
    /**
     * Maps API names to chat completion sources.
     */
    getChatCompletionSource(apiName) {
        if (!apiName) return 'openai';
        if (apiName === 'google') return chat_completion_sources.MAKERSUITE;
        // Mapping Antigravity profiles to OpenAI source for proper key handling
        if (apiName.toLowerCase().includes('antigravity')) return chat_completion_sources.OPENAI;
        return apiName;
    },
    /**
     * Extracts the reply from a streaming response.
     */
    getStreamingReply(data, cc_source) {
        if (cc_source === chat_completion_sources.CLAUDE) {
            return data?.delta?.text || '';
        } else if (cc_source === chat_completion_sources.MAKERSUITE) {
            return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            return data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? '';
        }
    },
    /**
     * Generates blocks using the specified messages and preset.
     */
    async generateBlocks(messages, apiPresetName) {
        const preset = this.getApiPreset(apiPresetName);
        const connection_profile = this.getConnectionProfile(preset);
        const cc_source = this.getChatCompletionSource(connection_profile.api);
        const stream = false; // Forced to false to avoid issues with stale settings
        let generate_data = {
            'messages': messages,
            'model': connection_profile.model,
            'temperature': preset.temperature,
            'stream': stream,
            'chat_completion_source': cc_source,
            'max_tokens': preset.max_tokens,
            'reasoning_effort': preset.reasoning_effort ?? 'auto'
        };
        const top_p = preset.top_p;
        if (preset.top_p !== 1.0) {
            generate_data['top_p'] = top_p;
        }
        const proxy_preset = proxies.find(p => p.name === connection_profile.proxy);
        if (proxy_preset && cc_source !== chat_completion_sources.OPENROUTER) {
            generate_data['reverse_proxy'] = proxy_preset.url;
            generate_data['proxy_password'] = proxy_preset.password;
        }
        this.applyConnectionProfileData(generate_data, connection_profile, cc_source);
        if (cc_source === chat_completion_sources.CUSTOM && !generate_data.custom_url) {
            const message = '[DreamAlbum] В выбранном Custom профиле отсутствует API URL.';
            toastr.error(message);
            throw new Error(message);
        }
        if (cc_source === chat_completion_sources.MAKERSUITE || cc_source === chat_completion_sources.CLAUDE) {
            generate_data['use_sysprompt'] = true;
        }
        extStates.abortController = new AbortController();
        const generate_url = '/api/backends/chat-completions/generate';
        console.log('[DreamAlbum] Sending request to ST backend with profile:', connection_profile.name);
        
        const response = await fetch(generate_url, {
            method: 'POST',
            body: JSON.stringify(generate_data),
            headers: getRequestHeaders(),
            signal: extStates.abortController.signal,
        });
        
        extStates.abortController = null;
        if (response.ok) {
            let data;
            if (stream) {
                const eventStream = getEventSourceStream();
                response.body.pipeThrough(eventStream);
                const reader = eventStream.readable.getReader();
                let text = '';
                const swipes = [];
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const rawData = value.data;
                    if (rawData === '[DONE]') break;
                    const parsed = JSON.parse(rawData);
                    if (Array.isArray(parsed?.choices) && parsed?.choices?.[0]?.index > 0) {
                        const swipeIndex = parsed.choices[0].index - 1;
                        swipes[swipeIndex] = (swipes[swipeIndex] || '') + this.getStreamingReply(parsed, cc_source);
                    } else {
                        text += this.getStreamingReply(parsed, cc_source);
                    }
                }
                data = { content: text, swipes: swipes };
            } else {
                data = await response.json();
                if (data.error) {
                    toastr.error(data.error.message || response.statusText, 'API returned an error');
                    throw new Error(JSON.stringify(data.error));
                }
            }
            return data;
        } else {
            const errorText = await response.text();
            console.error('[DreamAlbum] API response error:', response.status, errorText);
            let friendlyMsg = '';
            if (response.status === 429) {
                friendlyMsg = `Ошибка 429: слишком много запросов. Попробуйте позже или смените профиль.`;
            } else if (response.status === 401 || response.status === 403) {
                friendlyMsg = `Ошибка ${response.status}: неверный API-ключ или нет доступа.`;
            } else if (response.status >= 500) {
                friendlyMsg = `Ошибка сервера ${response.status}. Попробуйте позже.`;
            } else {
                // Try to extract a message from the error body
                try {
                    const errJson = JSON.parse(errorText);
                    friendlyMsg = errJson?.error?.message || errJson?.message || `Ошибка ${response.status}: ${response.statusText}`;
                } catch {
                    friendlyMsg = `Ошибка ${response.status}: ${errorText.substring(0, 120)}`;
                }
            }
            toastr.error(friendlyMsg, `[DreamAlbum] Ошибка генерации`);
            throw new Error(`Got response status ${response.status}: ${errorText.substring(0, 100)}`);
        }
    },
    /**
     * Extracts the message content from the API response.
     */
    extractMessageFromData(data, preset) {
        const connection_profile = this.getConnectionProfile(preset);
        const cc_source = this.getChatCompletionSource(connection_profile.api);
        
        let content = '';
        // Check if data is already in streaming-extracted format {content: '...', swipes: [...]}
        // or if it's a raw API response.
        if (data && typeof data.content === 'string' && !data.choices) {
            content = data.content;
        } else {
            if (cc_source === chat_completion_sources.CLAUDE) {
                // Formatting for Claude via ST backend
                if (typeof data.content === 'string') {
                    content = data.content;
                } else if (Array.isArray(data.content) && data.content[0]?.text) {
                    content = data.content[0].text;
                } else {
                    content = data.choices?.[0]?.message?.content || '';
                }
            } else if (cc_source === chat_completion_sources.MAKERSUITE) {
                content = data.candidates?.[0]?.content?.parts?.[0]?.text || data.choices?.[0]?.message?.content || '';
            } else {
                content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
            }
        }
        content = content.trim();
        console.log('[DreamAlbum] Raw result from AI:', `"${content}"`);
        if (!content || content.trim() === '') {
            const msg = 'ИИ прислал пустой ответ. Возможно, сработал фильтр безопасности или произошла ошибка прокси.';
            console.error(`[DreamAlbum] ${msg}`, data);
            toastr.error(msg);
            throw new Error(msg);
        }
        
        if (!content.includes('<img')) {
            console.log('[DreamAlbum] AI returned a text-only block (no <img> tag found).');
        }
        return content;
    },
    /**
     * Aborts the current generation.
     */
    abortGeneration() {
        if (extStates.abortController) {
            extStates.abortController.abort();
            extStates.abortController = null;
            toastr.info(`${defaultExtPrefix} Generation aborted.`);
        }
    }
};