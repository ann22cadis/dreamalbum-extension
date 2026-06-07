import { templates_path, ElementTemplate, ExtTopic } from '../core/constants.js';
import { extStates } from '../core/state.js';
import { SettingsService } from '../services/SettingsService.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { GeneratedEditor } from './editors/GeneratedEditor.js';
import { updateOrInsert } from '../utils/dataUtils.js';
const {
    renderExtensionTemplateAsync,
    extensionSettings,
    saveSettingsDebounced,
    callPopup,
    eventSource,
} = SillyTavern.getContext();
export const AlbumUI = {
    /** @type {boolean} */
    _initialized: false,
    /** @type {string|null} */
    _currentChatName: null,
    
    async init() {
        if (this._initialized) return;
        const panelHtml = await renderExtensionTemplateAsync(templates_path, ElementTemplate.ALBUM_PANEL);
        $('body').append(panelHtml);
        this._setupPanelListeners();
        this._initialized = true;
    },
    async open() {
        if (!this._initialized) await this.init();
        
        $('#extensionsMenu').removeClass('displayed');
        
        this._updateChatContext();
        this.scanAndRender();
        const $backdrop = $('#DreamAlbum-backdrop');
        
        // Safety: Move backdrop to the very end of body to avoid being clipped by parent containers
        if (!$backdrop.parent().is('body')) {
            $('body').append($backdrop);
        }
        const $panel = $('#DreamAlbum-panel');
        
        // Ensure main view is visible and sub-panels are hidden on fresh open
        $panel.find('#DA-main-view').show();
        $panel.find('.DA-sub-panel').removeClass('DA-active');
        
        $backdrop.addClass('DA-visible');
        $('body').addClass('DA-no-scroll');
    },
    
    close() {
        $('#DreamAlbum-backdrop').removeClass('DA-visible');
        $('body').removeClass('DA-no-scroll');
    },
    
    _updateChatContext() {
        $('.DA-title').text('Album');
        const ctx = SillyTavern.getContext();
        this._currentChatName = ctx.chatId ?? null;
    },
    
    scanAndRender() {
        const images = this._scanChatImages();
        this._renderGrid(images);
    },
    
     _scanChatImages() {
        const images = [];
        const hidden = extStates.DreamAlbum_settings.hidden_items || [];
        // Simple deterministic hash for a string (djb2-style)
        const hashStr = (s) => {
            let h = 5381;
            for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
            return (h >>> 0).toString(36);
        };
        $('#chat .mes').each(function () {
            const mesId = $(this).attr('mesid') ?? '';
            $(this).find('img[data-iig-instruction]').each(function (idx) {
                const src = $(this).attr('src') ?? '';
                
                if (!src || src === '[IMG:GEN]') return;
                
                const hideKey = `${mesId}-${idx}`;
                if (hidden.includes(hideKey)) return;
                
                let instruction = null;
                const raw = $(this).attr('data-iig-instruction');
                if (raw) {
                    try {
                        instruction = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    } catch(e) {
                        try {
                            instruction = JSON.parse(raw.replace(/\n/g, '\\n').replace(/\r/g, ''));
                        } catch(e2) {
                            const promptMatch = raw.match(/"prompt"\s*:\s*"(.*?)"/s);
                            const blockMatch = raw.match(/"block"\s*:\s*"(.*?)"/s);
                            if (promptMatch) {
                                instruction = { prompt: promptMatch[1], block: blockMatch ? blockMatch[1] : 'unknown' };
                            }
                        }
                    }
                }
                
                images.push({ src, instruction, mesId, hideKey });
            });
        });
        return images;
    },
    
    _renderGrid(images) {
        const $grid = $('#DA-grid');
        const $empty = $('#DA-empty-state');
        $grid.empty();
        if (images.length === 0) {
            $empty.show();
            $grid.hide();
            return;
        }
        $empty.hide();
        $grid.show();
        images.forEach(({ src, instruction, mesId, hideKey }) => {
            const prompt = instruction?.prompt ?? '';
            const style = instruction?.style ?? '';
            
            const isError = src.includes('error');
            const $item = $(`
                <div class="DA-image-item" data-mesid="${mesId}" data-hidekey="${hideKey}" title="${prompt}">
                    <img class="DA-image-thumb" src="${src}" loading="lazy" alt="${prompt}" />
                    <div class="DA-image-overlay">
                        <div class="DA-image-info">
                            ${style ? `<span class="DA-image-style">${style}</span>` : ''}
                            <span class="DA-image-prompt">${prompt ? prompt.slice(0, 60) + (prompt.length > 60 ? '…' : '') : ''}</span>
                        </div>
                        <div class="DA-image-actions">
                            <button class="DA-img-action DA-img-open" title="Открыть">
                                <i class="fa-solid fa-expand"></i>
                            </button>
                            <button class="DA-img-action DA-img-scroll" title="В чат">
                                <i class="fa-solid fa-message"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `);
            
            $item.find('.DA-img-open').on('click', (e) => {
                e.stopPropagation();
                this._openImageViewer(src, prompt, mesId, hideKey);
            });
            
            $item.find('.DA-img-scroll').on('click', (e) => {
                e.stopPropagation();
                this.close();
                const $mes = $(`#chat .mes[mesid="${mesId}"]`);
                if ($mes.length) {
                    $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    $mes.addClass('DA-highlight-mes');
                    setTimeout(() => $mes.removeClass('DA-highlight-mes'), 2000);
                }
            });
            
            $item.on('click', () => this._openImageViewer(src, prompt, mesId, hideKey));
            $grid.append($item);
        });
    },
    
    async _openImageViewer(src, prompt, mesId, hideKey) {
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-image-viewer-panel').remove();
        const allImages = $('.DA-image-thumb').map((_, el) => ({ src: $(el).attr('src'), mesId: $(el).closest('.DA-image-item').data('mesid'), hideKey: $(el).closest('.DA-image-item').data('hidekey'), prompt: $(el).closest('.DA-image-item').attr('title') })).get();
        let currentIndex = allImages.findIndex(img => img.src === src);
        const $viewer = $(`
            <div id="DA-image-viewer-panel" class="DA-sub-panel">
                <div class="DA-sub-header">
                    <div class="DA-sub-title"><i class="fa-solid fa-image"></i> Просмотр</div>
                    <div class="DA-header-actions" style="margin-left: auto; margin-right: 8px;">
                        <button class="DA-icon-btn-sm" id="DA-viewer-fullscreen" title="Во весь экран"><i class="fa-solid fa-expand"></i></button>
                        <button class="DA-icon-btn-sm" id="DA-viewer-close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="DA-viewer-main">
                    <div class="DA-viewer-img-container">
                        <div class="DA-viewer-nav DA-viewer-nav-prev" id="DA-viewer-prev"><i class="fa-solid fa-chevron-left"></i></div>
                        <img class="DA-viewer-img" src="" alt="Image" style="cursor: pointer;" />
                        <div class="DA-viewer-nav DA-viewer-nav-next" id="DA-viewer-next"><i class="fa-solid fa-chevron-right"></i></div>
                    </div>
                </div>
                <div class="DA-viewer-footer">
                    <button class="DA-footer-btn DA-btn-secondary" id="DA-viewer-prompt">
                        <i class="fa-solid fa-quote-left"></i> Промпт
                    </button>
                    <button class="DA-footer-btn DA-btn-secondary" id="DA-viewer-scroll">
                        <i class="fa-solid fa-message"></i> В чат
                    </button>
                    <button class="DA-footer-btn DA-btn-secondary" id="DA-viewer-hide" title="Скрыть из альбома">
                        <i class="fa-solid fa-eye-slash"></i> Скрыть
                    </button>
                </div>
            </div>
        `);
        $panel.append($viewer);
        this._showSubPanel($viewer);
        const updateViewer = (index) => {
            const imgData = allImages[index];
            const $img = $viewer.find('.DA-viewer-img');
            $img.css('opacity', 0);
            
            setTimeout(() => {
                $img.attr('src', imgData.src).css('opacity', 1);
            }, 150);
            
            
            $viewer.find('#DA-viewer-fullscreen').off('click').on('click', () => this.openFullScreenViewer(allImages.map(i => i.src), index));
            $viewer.find('.DA-viewer-img').off('click').on('click', () => this.openFullScreenViewer(allImages.map(i => i.src), index));
            
            $viewer.find('#DA-viewer-hide').off('click').on('click', () => {
                this._hideItem(imgData.hideKey);
                this._closeSubPanel($viewer);
                this.scanAndRender();
            });
            $viewer.find('#DA-viewer-prompt').off('click').on('click', () => this._openPromptViewer(imgData.prompt));
            $viewer.find('#DA-viewer-scroll').off('click').on('click', () => {
                this._closeSubPanel($viewer);
                this.close();
                const $mes = $(`#chat .mes[mesid="${imgData.mesId}"]`);
                if ($mes.length) {
                    $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    $mes.addClass('DA-highlight-mes');
                    setTimeout(() => $mes.removeClass('DA-highlight-mes'), 2000);
                }
            });
        };
        $viewer.find('#DA-viewer-close').on('click', () => this._closeSubPanel($viewer));
        $viewer.find('#DA-viewer-prev').on('click', () => {
            currentIndex = (currentIndex - 1 + allImages.length) % allImages.length;
            updateViewer(currentIndex);
        });
        $viewer.find('#DA-viewer-next').on('click', () => {
            currentIndex = (currentIndex + 1) % allImages.length;
            updateViewer(currentIndex);
        });
        let touchStartX = 0;
        $viewer.find('.DA-viewer-img-container').on('touchstart', (e) => {
            touchStartX = e.originalEvent.touches[0].clientX;
        });
        $viewer.find('.DA-viewer-img-container').on('touchend', (e) => {
            const touchEndX = e.originalEvent.changedTouches[0].clientX;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    currentIndex = (currentIndex + 1) % allImages.length;
                } else {
                    currentIndex = (currentIndex - 1 + allImages.length) % allImages.length;
                }
                updateViewer(currentIndex);
            }
        });
        updateViewer(currentIndex);
    },
    
    openFullScreenViewer(imageList, currentIndex) {
        $('#DA-fullscreen-viewer').remove();
        let index = currentIndex;
        const $fs = $(`
            <div id="DA-fullscreen-viewer">
                <div class="DA-fullscreen-header">
                    <button class="DA-fs-btn" id="DA-fs-rotate-left" title="Повернуть влево"><i class="fa-solid fa-rotate-left"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-rotate-right" title="Повернуть вправо"><i class="fa-solid fa-rotate-right"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="DA-fullscreen-body">
                    <img class="DA-fullscreen-img" src="${imageList[index]}" alt="Fullscreen Image" />
                </div>
            </div>
        `);
        $('body').append($fs);
        $fs[0].offsetHeight;
        $fs.addClass('DA-visible');
        $('body').addClass('DA-no-scroll');
        let rotation = 0;
        const $img = $fs.find('.DA-fullscreen-img');
        const updateFsTransform = () => {
            const isRotated = (rotation / 90) % 2 !== 0;
            if (isRotated) {
                $img.css({ 'max-width': '100vh', 'max-height': '100vw' });
            } else {
                $img.css({ 'max-width': '100%', 'max-height': '100%' });
            }
            $img.css('transform', `rotate(${rotation}deg) translateZ(0)`);
        };
        const updateImage = () => {
            $img.css('transition', 'none');
            rotation = 0;
            updateFsTransform();
            
            // Force reflow
            $img[0].offsetHeight;
            $img.css('transition', '');
            
            $img.attr('src', imageList[index]);
        };
        $fs.find('#DA-fs-rotate-left').on('click', (e) => {
            e.stopPropagation();
            rotation -= 90;
            updateFsTransform();
        });
        $fs.find('#DA-fs-rotate-right').on('click', (e) => {
            e.stopPropagation();
            rotation += 90;
            updateFsTransform();
        });
        const closeFs = () => {
            $fs.removeClass('DA-visible');
            setTimeout(() => {
                $fs.remove();
                if (!$('#DreamAlbum-backdrop').hasClass('DA-visible')) {
                    $('body').removeClass('DA-no-scroll');
                }
            }, 300);
        };
        $fs.find('#DA-fs-close').on('click', closeFs);
        $fs.on('click', (e) => {
            if (e.target.id === 'DA-fullscreen-viewer' || $(e.target).hasClass('DA-fullscreen-body')) {
                closeFs();
            }
        });
        
        let touchStartX = 0;
        $fs.on('touchstart', (e) => {
            touchStartX = e.originalEvent.touches[0].clientX;
        });
        $fs.on('touchend', (e) => {
            const touchEndX = e.originalEvent.changedTouches[0].clientX;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    index = (index + 1) % imageList.length;
                } else {
                    index = (index - 1 + imageList.length) % imageList.length;
                }
                updateImage();
            }
        });
        // ESC to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                closeFs();
                $(document).off('keydown', escHandler);
            }
        };
        $(document).on('keydown', escHandler);
    },
    
    _openPromptViewer(prompt) {
        if (!prompt) {
            toastr.info('Промпт пуст или отсутствует.');
            return;
        }
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-prompt-viewer-panel').remove();
        const $promptPanel = $(`
            <div id="DA-prompt-viewer-panel" class="DA-sub-panel">
                <div class="DA-sub-header">
                    <div class="DA-sub-title"><i class="fa-solid fa-quote-left"></i> Промпт</div>
                    <button class="DA-icon-btn-sm" id="DA-prompt-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="DA-sub-main" style="padding: 16px; display: flex; flex-direction: column; flex: 1; min-height: 0;">
                    <textarea class="DA-textarea" id="DA-prompt-content" readonly style="flex: 1; margin-bottom: 12px; font-size: 0.9rem; min-height: 100px; width: 100%; box-sizing: border-box; overflow-y: auto;">${prompt}</textarea>
                    <div style="flex: none; display: flex; justify-content: center; height: 46px;">
                        <button class="DA-footer-btn DA-btn-primary" id="DA-prompt-copy" style="height: 46px; min-height: 46px; width: 100%; flex: none !important;">
                            <i class="fa-solid fa-copy"></i> Копировать текст
                        </button>
                    </div>
                </div>
            </div>
        `);
        $panel.append($promptPanel);
        this._showSubPanel($promptPanel);
        
        $promptPanel.find('#DA-prompt-close').on('click', () => {
            this._closeSubPanel($promptPanel);
        });
        $promptPanel.find('#DA-prompt-copy').on('click', async () => {
            try {
                await navigator.clipboard.writeText(prompt);
                toastr.success('Промпт скопирован в буфер обмена!');
            } catch (err) {
                toastr.error('Не удалось скопировать текст.');
            }
        });
    },
    
    _openHiddenPanel() {
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-hidden-panel').remove();
        
        const allImages = [];
        $('#chat .mes').each(function () {
            const mesId = $(this).attr('mesid') ?? '';
            $(this).find('img[data-iig-instruction]').each(function (idx) {
                const src = $(this).attr('src') ?? '';
                const hideKey = `${mesId}-${idx}`;
                allImages.push({ src, hideKey });
            });
        });
        const hiddenKeys = extStates.DreamAlbum_settings.hidden_items || [];
        const hiddenImages = allImages.filter(img => hiddenKeys.includes(img.hideKey));
        const $hiddenPanel = $(`
            <div id="DA-hidden-panel" class="DA-sub-panel">
                <div class="DA-sub-header">
                    <div class="DA-sub-title"><i class="fa-solid fa-eye-slash"></i> Скрытые фото</div>
                    <button class="DA-icon-btn-sm" id="DA-hidden-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="DA-sub-main DA-body" style="padding: 12px; flex: 1;">
                    <div id="DA-hidden-grid"></div>
                    <div id="DA-hidden-empty" style="display: none; text-align: center; margin-top: 40px; color: var(--da-text-muted);">
                        Тут пока пусто.
                    </div>
                </div>
            </div>
        `);
        $panel.append($hiddenPanel);
        this._showSubPanel($hiddenPanel);
        const $grid = $hiddenPanel.find('#DA-hidden-grid');
        const $empty = $hiddenPanel.find('#DA-hidden-empty');
        if (hiddenImages.length === 0) {
            $empty.show();
        } else {
            hiddenImages.forEach(({ src, hideKey }) => {
                const $item = $(`
                    <div class="DA-image-item">
                        <img class="DA-image-thumb" src="${src}" />
                    </div>
                `);
                $item.on('click', () => this._openHiddenImageViewer(src, hideKey));
                $grid.append($item);
            });
        }
        $hiddenPanel.find('#DA-hidden-close').on('click', () => {
            this._closeSubPanel($hiddenPanel);
            this.scanAndRender();
        });
    },
    
    async _openHiddenImageViewer(src, hideKey) {
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-image-viewer-panel').remove();
        
        const [mesId, idx] = hideKey.split('-');
        
        
        let prompt = '';
        const $imgEl = $(`#chat .mes[mesid="${mesId}"] img[data-iig-instruction]`).eq(idx);
        if ($imgEl.length) {
            const raw = $imgEl.attr('data-iig-instruction');
            if (raw) {
                try {
                    const instruction = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    prompt = instruction?.prompt ?? '';
                } catch(e) {
                    try {
                        const instruction = JSON.parse(raw.replace(/\n/g, '\\n').replace(/\r/g, ''));
                        prompt = instruction?.prompt ?? '';
                    } catch(e2) {
                        const promptMatch = raw.match(/"prompt"\s*:\s*"(.*?)"/s);
                        if (promptMatch) {
                            prompt = promptMatch[1];
                        }
                    }
                }
            }
        }
        const $viewer = $(`
            <div id="DA-image-viewer-panel" class="DA-sub-panel">
                <div class="DA-sub-header">
                    <div class="DA-sub-title"><i class="fa-solid fa-eye-slash"></i> Просмотр скрытого</div>
                    <div class="DA-header-actions" style="margin-left: auto; margin-right: 8px;">
                        <button class="DA-icon-btn-sm" id="DA-viewer-fullscreen" title="Во весь экран"><i class="fa-solid fa-expand"></i></button>
                        <button class="DA-icon-btn-sm" id="DA-viewer-close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="DA-viewer-main">
                    <div class="DA-viewer-img-container">
                        <div class="DA-viewer-nav DA-viewer-nav-prev" id="DA-viewer-prev"><i class="fa-solid fa-chevron-left"></i></div>
                        <img class="DA-viewer-img" src="${src}" alt="Image" style="cursor: pointer;" />
                        <div class="DA-viewer-nav DA-viewer-nav-next" id="DA-viewer-next"><i class="fa-solid fa-chevron-right"></i></div>
                    </div>
                </div>
                <div class="DA-viewer-footer">
                    <button class="DA-footer-btn DA-btn-secondary" id="DA-viewer-prompt">
                        <i class="fa-solid fa-quote-left"></i> Промпт
                    </button>
                    <button class="DA-footer-btn DA-btn-secondary" id="DA-viewer-scroll">
                        <i class="fa-solid fa-message"></i> В чат
                    </button>
                    <button class="DA-footer-btn DA-btn-primary" id="DA-viewer-unhide">
                        <i class="fa-solid fa-eye"></i> Вернуть
                    </button>
                </div>
            </div>
        `);
        $panel.append($viewer);
        this._showSubPanel($viewer);
        const $img = $viewer.find('.DA-viewer-img');
        
        const close = () => this._closeSubPanel($viewer);
        $viewer.find('#DA-viewer-close').on('click', close);
        
        $viewer.find('#DA-viewer-fullscreen').on('click', () => {
            const allImages = $('.DA-image-thumb').map((_, el) => $(el).attr('src')).get();
            const index = allImages.indexOf(src);
            this.openFullScreenViewer(allImages, index);
        });
        $img.on('click', () => {
            const allImages = $('.DA-image-thumb').map((_, el) => $(el).attr('src')).get();
            const index = allImages.indexOf(src);
            this.openFullScreenViewer(allImages, index);
        });
        
        $viewer.find('#DA-viewer-prev').on('click', () => toastr.info('Переключение в скрытых пока не реализовано.'));
        $viewer.find('#DA-viewer-next').on('click', () => toastr.info('Переключение в скрытых пока не реализовано.'));
        
        $viewer.find('#DA-viewer-unhide').on('click', () => {
            this._unhideItem(hideKey);
            close();
            this._closeSubPanel($('#DA-hidden-panel'));
            this._openHiddenPanel();
        });
        $viewer.find('#DA-viewer-prompt').on('click', () => {
            if (prompt) {
                this._openPromptViewer(prompt);
            } else {
                toastr.info('Информация о промпте недоступна.');
            }
        });
        $viewer.find('#DA-viewer-scroll').on('click', () => {
            close();
            this.close();
            const $mes = $(`#chat .mes[mesid="${mesId}"]`);
            if ($mes.length) {
                $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                $mes.addClass('DA-highlight-mes');
                setTimeout(() => $mes.removeClass('DA-highlight-mes'), 2000);
            }
        });
    },
    
    _unhideItem(hideKey) {
        const hidden = extStates.DreamAlbum_settings.hidden_items || [];
        const index = hidden.indexOf(hideKey);
        if (index !== -1) {
            hidden.splice(index, 1);
            saveSettingsDebounced();
        }
    },
    
    _hideItem(hideKey) {
        if (!extStates.DreamAlbum_settings.hidden_items) {
            extStates.DreamAlbum_settings.hidden_items = [];
        }
        
        if (!extStates.DreamAlbum_settings.hidden_items.includes(hideKey)) {
            extStates.DreamAlbum_settings.hidden_items.push(hideKey);
            saveSettingsDebounced();
            this.scanAndRender();
        }
    },
    /**
     * Helper to show a sub-panel and hide main view
     */
    _showSubPanel($subPanel) {
        $('#DreamAlbum-panel').find('#DA-main-view').hide();
        $subPanel.addClass('DA-active');
    },
    /**
     * Helper to hide a sub-panel and restore main view if no others are open
     */
    _closeSubPanel($subPanel) {
        if (!$subPanel) return;
        $subPanel.removeClass('DA-active');
        const $modal = $('#DreamAlbum-panel');
        if ($modal.find('.DA-sub-panel.DA-active').length === 0) {
            $modal.find('#DA-main-view').show();
        }
    },
    
    async openApiSettings() {
        const $panel = $('#DreamAlbum-panel');
        
        $panel.find('#DA-api-settings-panel').remove();
        const settingsHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.API_SETTINGS));
        $panel.append(settingsHtml);
        
        const $sub = $panel.find('#DA-api-settings-panel');
        this._showSubPanel($sub);
        
        const preset = extStates.api_preset ?? {};
        if (!Array.isArray(extensionSettings.DreamAlbum.custom_proxies)) {
            extensionSettings.DreamAlbum.custom_proxies = [];
        }
        const refreshProxyList = () => {
            ApiService.refreshConnectionProfiles();
        };
        refreshProxyList();
        $sub.find('#DA-proxy-list').on('change', function() {
            const profileName = $(this).val();
            if (profileName) {
                extStates.api_preset.connection_profile = profileName;
                saveSettingsDebounced();
                toastr.success(`Используется профиль: ${profileName}`);
            }
        });
        $sub.find('#DA-proxy-refresh').on('click', () => {
            refreshProxyList();
            toastr.info('Список профилей обновлен');
        });
        const loadSettingsValues = () => {
            const preset = extStates.api_preset ?? {};
            $sub.find('#DA-temperature').val(preset.temperature ?? 0.2);
            $sub.find('#DA-topp').val(preset.top_p ?? 1);
            $sub.find('#DA-maxtokens').val(preset.max_tokens ?? 4096);
            $sub.find('#DA-context-size').val(preset.context_size ?? 10);
            $sub.find('#DA-context-size-val').text(preset.context_size ?? 10);
            $sub.find('#DA-reasoningeffort').val(preset.reasoning_effort ?? 'auto');
            $sub.find('#DA-include-char-card').prop('checked', preset.include_char_card ?? false);
            $sub.find('#DA-include-lorebooks').prop('checked', preset.include_lorebooks ?? false);
            $sub.find('#DA-include-persona').prop('checked', preset.include_persona ?? false);
            $sub.find('#DA-include-previous-blocks').prop('checked', preset.include_previous_blocks ?? false);
            $sub.find('#DA-proxy-list').val(preset.connection_profile || '');
        };
        loadSettingsValues();
        // Floating buttons settings
        const sets = extensionSettings.DreamAlbum.sets || [];
        const floatingStyles = extensionSettings.DreamAlbum.floating_buttons_styles || [];
        
        for (let i = 1; i <= 3; i++) {
            const $select = $sub.find(`#DA-floating-style-${i}`);
            $select.empty().append('<option value="">-- Нет --</option>');
            sets.forEach(set => {
                $select.append($('<option>', { value: set.name, text: set.name }));
            });
            $select.val(floatingStyles[i - 1] || '');
        }
        $sub.find('#DA-api-settings-close').on('click', () => this._closeSubPanel($sub));
        $sub.find('#DA-test-connection').on('click', async () => {
            toastr.info('Проверка...');
            try {
                const ok = await ApiService.testConnection?.();
                if (ok !== false) toastr.success('Успех!');
                else toastr.error('Ошибка.');
            } catch (e) { toastr.error(e.message); }
        });
        $sub.find('#DA-api-settings-save').on('click', async () => {
            const targetPreset = extStates.api_preset;
            if (targetPreset) {
                targetPreset.temperature = parseFloat($sub.find('#DA-temperature').val());
                targetPreset.top_p = parseFloat($sub.find('#DA-topp').val());
                targetPreset.max_tokens = parseInt($sub.find('#DA-maxtokens').val(), 10);
                targetPreset.context_size = parseInt($sub.find('#DA-context-size').val(), 10);
                targetPreset.reasoning_effort = $sub.find('#DA-reasoningeffort').val();
                targetPreset.include_char_card = $sub.find('#DA-include-char-card').prop('checked');
                targetPreset.include_lorebooks = $sub.find('#DA-include-lorebooks').prop('checked');
                targetPreset.include_persona = $sub.find('#DA-include-persona').prop('checked');
                targetPreset.include_previous_blocks = $sub.find('#DA-include-previous-blocks').prop('checked');
            }
            const newFloatingStyles = [];
            for (let i = 1; i <= 3; i++) {
                const val = $sub.find(`#DA-floating-style-${i}`).val();
                if (val) newFloatingStyles.push(val);
            }
            extensionSettings.DreamAlbum.floating_buttons_styles = newFloatingStyles;
            saveSettingsDebounced();
            await ApiService.loadApiPreset?.();
            
            // Re-render floating buttons
            const { FloatingUI } = await import('./FloatingUI.js');
            FloatingUI.render();
            this._closeSubPanel($sub);
            toastr.success('Настройки сохранены.');
        });
    },
    
    async openStylePicker() {
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-style-picker-panel').remove();
        const pickerHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.STYLE_PICKER));
        $panel.append(pickerHtml);
        const $sub = $panel.find('#DA-style-picker-panel');
        const $list = $sub.find('#DA-style-list');
        this._showSubPanel($sub);
        const renderList = () => {
            $list.empty();
            const sets = extensionSettings.DreamAlbum?.sets ?? [];
            const activeSet = extensionSettings.DreamAlbum?.active_set ?? '';
            
            const $createCard = $(`
                <div class="DA-style-create-card" title="Добавить стиль">
                    <i class="fa-solid fa-circle-plus"></i>
                    <span style="font-size: 0.7rem; margin-top: -4px;">Стиль</span>
                </div>
            `);
            $createCard.on('click', () => this.openStyleEditor(null, renderList));
            $list.append($createCard);
            sets.forEach((set, idx) => {
                const isActive = set.name === activeSet;
                const bgStyle = set.image ? `background-image: url('${set.image.replace(/'/g, "\\'")}');` : '';
                const $item = $(`
                    <div class="DA-style-item ${isActive ? 'DA-style-active' : ''}" data-idx="${idx}">
                        ${isActive ? '<span class="DA-style-badge"><i class="fa-solid fa-check"></i></span>' : ''}
                        <div class="DA-style-img" style="${bgStyle}"></div>
                        <div class="DA-style-content">
                            <div class="DA-style-name" title="${set.name}">${set.name}</div>
                            <div class="DA-style-controls">
                                <button class="DA-icon-btn-sm DA-style-edit"><i class="fa-solid fa-pen"></i></button>
                                <button class="DA-icon-btn-sm DA-style-delete"><i class="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                `);
                $item.find('.DA-style-img, .DA-style-name').on('click', async (e) => {
                    e.stopPropagation();
                    await SettingsService.changeSet(idx);
                    renderList();
                    toastr.success(`Выбрано: ${set.name}`);
                });
                $item.find('.DA-style-edit').on('click', (e) => {
                    e.stopPropagation();
                    this.openStyleEditor(idx, renderList);
                });
                $item.find('.DA-style-delete').on('click', async (e) => {
                    e.stopPropagation();
                    const confirmResult = await this._showConfirm(`Удалить стиль «${set.name}»?`);
                    if (confirmResult) {
                        extensionSettings.DreamAlbum.sets.splice(idx, 1);
                        if (extensionSettings.DreamAlbum.sets.length === 0) {
                            extensionSettings.DreamAlbum.sets.push(SettingsService.getDefaultSet());
                        }
                        if (isActive) await SettingsService.changeSet(0);
                        saveSettingsDebounced();
                        renderList();
                    }
                });
                $list.append($item);
            });
        };
        $sub.find('#DA-style-picker-close').on('click', () => this._closeSubPanel($sub));
        renderList();
    },
    
    async openStyleEditor(idx, refreshCallback) {
        const isNew = idx === null || idx === undefined;
        let styleObj = isNew ? SettingsService.getDefaultSet() : extensionSettings.DreamAlbum.sets[idx];
        const $panel = $('#DreamAlbum-panel');
        
        $panel.find('#DA-style-editor-panel').remove();
        const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.NEW_SET_POPUP));
        $panel.append(editorHtml);
        
        const $sub = $panel.find('#DA-style-editor-panel');
        this._showSubPanel($sub);
        
        if (styleObj.name !== 'Default') $sub.find('#DA-style-editor-name').val(styleObj.name);
        if (styleObj.prompt) $sub.find('#DA-style-editor-prompt').val(styleObj.prompt);
        const $imgPreview = $sub.find('#DA-style-editor-img-preview');
        const $imgUpload = $sub.find('#DA-style-editor-img-upload');
        const $imgBtn = $sub.find('#DA-style-editor-img-btn');
        let currentImageBase64 = styleObj.image || '';
        
        const updatePreview = () => {
            if (currentImageBase64) {
                const safeBase64 = currentImageBase64.replace(/'/g, "\\'");
                $imgPreview.css('background-image', `url('${safeBase64}')`);
                $imgPreview.find('i').hide();
            } else {
                $imgPreview.css('background-image', 'none');
                $imgPreview.find('i').show();
            }
        };
        updatePreview();
        const triggerUpload = () => $imgUpload.trigger('click');
        $imgPreview.on('click', triggerUpload);
        $imgBtn.on('click', triggerUpload);
        $imgUpload.on('change', function() {
            const file = this.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                currentImageBase64 = e.target.result;
                updatePreview();
            };
            reader.readAsDataURL(file);
        });
        $sub.find('#DA-style-editor-close').on('click', () => {
            this._closeSubPanel($sub);
        });
        
        $sub.find('#DA-style-editor-save').on('click', async () => {
            const newName = $sub.find('#DA-style-editor-name').val()?.trim() || 'Новый стиль';
            const newPrompt = $sub.find('#DA-style-editor-prompt').val() || '';
            styleObj.name = newName;
            styleObj.prompt = newPrompt;
            styleObj.image = currentImageBase64;
            if (isNew) {
                const setIdx = updateOrInsert(extensionSettings.DreamAlbum.sets, styleObj);
                await SettingsService.changeSet(setIdx);
            } else {
                saveSettingsDebounced();
            }
            
            this._closeSubPanel($sub);
            toastr.success(`Стиль «${styleObj.name}» сохранен.`);
            if (refreshCallback) refreshCallback();
        });
    },
    /**
     * Вешает обработчики на кнопки панели.
     */
    _setupPanelListeners() {
        const $panel = $('#DreamAlbum-panel');
        // Power button
        const $powerBtn = $('#DA-power-btn');
        const updatePowerState = () => {
            if (extensionSettings.DreamAlbum?.dreamalbum_is_enabled) {
                $powerBtn.addClass('DA-power-on');
            } else {
                $powerBtn.removeClass('DA-power-on');
            }
        };
        updatePowerState();
        
        $powerBtn.on('click', async () => {
            const enabled = !extensionSettings.DreamAlbum?.dreamalbum_is_enabled;
            extensionSettings.DreamAlbum.dreamalbum_is_enabled = enabled;
            
            $('#dreamalbum_is_enabled').prop('checked', enabled);
            
            updatePowerState();
            
            // Re-render floating buttons
            const { FloatingUI } = await import('./FloatingUI.js');
            FloatingUI.render();
            saveSettingsDebounced();
            toastr.success(`DreamAlbum ${enabled ? 'включен' : 'выключен'}.`);
        });
        // Floating buttons toggle
        const $floatingToggleBtn = $('#DA-floating-toggle-btn');
        const updateFloatingState = () => {
            if (extensionSettings.DreamAlbum?.floating_buttons_enabled) {
                $floatingToggleBtn.addClass('DA-power-on');
            } else {
                $floatingToggleBtn.removeClass('DA-power-on');
            }
        };
        updateFloatingState();
        $floatingToggleBtn.on('click', async () => {
            const enabled = !extensionSettings.DreamAlbum?.floating_buttons_enabled;
            extensionSettings.DreamAlbum.floating_buttons_enabled = enabled;
            
            updateFloatingState();
            
            const { FloatingUI } = await import('./FloatingUI.js');
            FloatingUI.render();
            saveSettingsDebounced();
            toastr.success(`Плавающие кнопки ${enabled ? 'включены' : 'выключены'}.`);
        });
        $('#DA-close-btn').on('click', () => this.close());
        $('#DreamAlbum-backdrop').on('click', (e) => {
            if (e.target.id === 'DreamAlbum-backdrop') {
                this.close();
            }
        });
        $('#DA-settings-btn').on('click', () => this.openApiSettings());
        $panel.find('#DA-style-btn').on('click', () => this.openStylePicker());
        $panel.find('#DA-create-btn').on('click', () => this._triggerImageGeneration());
        $panel.find('#DA-hidden-btn').on('click', () => this._openHiddenPanel());
    },
    /**
     * Запускает генерацию изображения на основе текущего стиля и контекста чата.
     */
    async _triggerImageGeneration() {
        const ctx = SillyTavern.getContext();
        if (ctx.characterId === undefined && ctx.groupId === undefined) {
            toastr.warning('Сначала откройте чат (персонаж или группа).');
            return;
        }
        const activeSetName = extensionSettings.DreamAlbum?.active_set;
        const activeSet = extensionSettings.DreamAlbum?.sets?.find(s => s.name === activeSetName);
        if (!activeSet || !activeSet.prompt) {
            toastr.warning('Пожалуйста, выберите стиль и убедитесь, что в нем настроен промпт.');
            this.openStylePicker();
            return;
        }
        const $btn = $('#DA-create-btn');
        const originalContent = $btn.html();
        
        try {
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> <span>Генерация...</span>');
            
            await GenerationService.triggerStyleGeneration(activeSet);
            toastr.success('Запрос на генерацию отправлен! Подождите, пока SillyImages создаст изображение.');
            
            setTimeout(() => this.scanAndRender(), 3000);
            setTimeout(() => this.scanAndRender(), 8000);
        } catch (error) {
            console.error('DreamAlbum Generation Error:', error);
            toastr.error(error.message || 'Ошибка при генерации.');
        } finally {
            $btn.prop('disabled', false).html(originalContent);
        }
    },
    /**
     * Показывает красивое встроенное окно подтверждения (Confirm).
     * @param {string} text Текст вопроса.
     * @returns {Promise<boolean>}
     */
    async _showConfirm(text) {
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-confirm-panel').remove();
        return new Promise((resolve) => {
            const $confirm = $(`
                <div id="DA-confirm-panel" class="DA-sub-panel DA-confirm-wrapper">
                    <div class="DA-confirm-box">
                        <div class="DA-confirm-text">${text}</div>
                        <div class="DA-confirm-actions">
                            <button id="DA-confirm-yes" class="DA-btn-confirm DA-btn-primary">Удалить</button>
                            <button id="DA-confirm-no" class="DA-btn-confirm DA-btn-secondary">Отмена</button>
                        </div>
                    </div>
                </div>
            `);
            $panel.append($confirm);
            this._showSubPanel($confirm);
            $confirm.find('#DA-confirm-yes').on('click', () => {
                this._closeSubPanel($confirm);
                $confirm.remove();
                resolve(true);
            });
            $confirm.find('#DA-confirm-no').on('click', () => {
                this._closeSubPanel($confirm);
                $confirm.remove();
                resolve(false);
            });
        });
    }
};