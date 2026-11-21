import { templates_path, ElementTemplate, ExtTopic, FLOATING_GROUP_MAX } from '../core/constants.js';
import { extStates } from '../core/state.js';
import { SettingsService } from '../services/SettingsService.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { FloatingUI } from './FloatingUI.js';
import { askOocInstruction } from './OocModal.js';
import { createZoomController } from './ZoomController.js';
import { GeneratedEditor } from './editors/GeneratedEditor.js';
import { readStore } from '../utils/messageStore.js';
import { fileToThumbnail, dataUrlBytes, COVER_MAX_BYTES } from '../utils/imageUtils.js';
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
        this.applyTheme();
        this._setupPanelListeners();
        this._initialized = true;
    },
    
    applyTheme() {
        const themeId = extensionSettings.DreamAlbum?.album_theme || 'default';
        let css = '';
        if (themeId === 'tavern') {
            // Улучшенные фоллбеки для предотвращения прозрачности
            css = `
                --da-bg: var(--SmartThemeBlurTintColor, var(--SmartThemeBlurColor, var(--main_background, #111)));
                --da-surface: var(--SmartThemeBlurColor, var(--SmartThemeBlurTintColor, var(--grey30, #222)));
                --da-surface2: var(--black30a, rgba(128, 128, 128, 0.15));
                --da-border: var(--SmartThemeBorderColor, var(--grey60, #444));
                --da-border-light: var(--grey30, rgba(128, 128, 128, 0.2));
                --da-accent: var(--SmartThemeQuoteColor, var(--blue60, #8db7d5));
                --da-accent-hover: var(--SmartThemeUserColor, var(--SmartThemeQuoteColor, #8db7d5));
                --da-accent-dim: var(--black30a, rgba(128, 128, 128, 0.1));
                --da-text: var(--blackWhite, var(--SmartThemeBodyColor_text, #eee));
                --da-text-muted: var(--greyWhite, rgba(128,128,128,0.8));
                --da-overlay: rgba(0, 0, 0, 0.6);
            `;
            // Дополнительная проверка на прозрачность
            setTimeout(() => {
                const bg = getComputedStyle(document.documentElement).getPropertyValue('--da-bg').trim();
                const isTransparent = bg.includes('rgba') || bg.includes('hsla') || bg === 'transparent' || bg === '';
                if (isTransparent) {
                    $('#DA-theme-styles').append(` :root { --da-bg: #111 !important; --da-surface: #1a1a1a !important; --da-surface2: #222 !important; } `);
                }
            }, 100);
        } else if (themeId === 'twilight') {
            // New theme based on provided colors: #16131F, #F0D9E4, #C1A0AC, #4A3F4B, #806C79
            css = `--da-bg: #16131F; --da-surface: #1f1b29; --da-surface2: #2a2536; --da-border: #4A3F4B; --da-border-light: #806C79; --da-accent: #C1A0AC; --da-accent-hover: #F0D9E4; --da-accent-dim: rgba(193, 160, 172, 0.15); --da-text: #F0D9E4; --da-text-muted: #806C79;`;
        } else if (themeId === 'ocean') {
            // Deep Ocean: Dark navy/teal base, muted blue text, cool accents
            css = `--da-bg: #0a1118; --da-surface: #111d2b; --da-surface2: #1a2b3c; --da-border: #264059; --da-border-light: #385b7a; --da-accent: #8db7d5; --da-accent-hover: #afd1e9; --da-accent-dim: rgba(141, 183, 213, 0.15); --da-text: #d8e6f3; --da-text-muted: #8aacc7;`;
        } else if (themeId === 'forest') {
            css = `--da-bg: #0f1410; --da-surface: #131a14; --da-surface2: #18211a; --da-border: #263628; --da-border-light: #334736; --da-accent: #78a382; --da-accent-hover: #8fba99; --da-accent-dim: rgba(120, 163, 130, 0.18);`;
        } else if (themeId === 'eclipse') {
            // Eclipse: Very dark purple/black with silver/lavender accents (completely dark, easy on eyes)
            css = `--da-bg: #0d0b14; --da-surface: #151120; --da-surface2: #1e192d; --da-border: #2e2642; --da-border-light: #41365c; --da-accent: #9f8bc2; --da-accent-hover: #b8a6d4; --da-accent-dim: rgba(159, 139, 194, 0.15); --da-text: #e6e2ed; --da-text-muted: #8d839e;`;
        }
        
        let $style = $('#DA-theme-styles');
        if (!$style.length) {
            $style = $('<style id="DA-theme-styles"></style>').appendTo('head');
        }
        $style.text(css ? `:root { ${css} }` : '');
    },
    async open() {
        if (!this._initialized) await this.init();
        
        // Forcefully hide ST extension menu to prevent it from overlapping or staying open
        $('#extensionsMenu').removeClass('displayed').hide();
        
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
    
    /**
     * Parsed images per message, reused while the message text is unchanged. The
     * album is re-scanned after every generation and hide, and parsing each
     * `data-iig-instruction` payload is the costly part of that.
     * @type {Map<number, {mes: string, store: string, items: Array<{src: string, instruction: Object|null, idx: number}>}>}
     */
    _scanCache: new Map(),

    /**
     * Extracts the generated images from one message.
     * `idx` counts every instruction tag, including ones without a usable src, so
     * it stays a stable part of the hide key.
     */
    _parseMessageImages(content) {
        const items = [];
        const imgRegex = /<img[^>]+data-iig-instruction=(['"])(.*?)\1[^>]*>/gi;

        let match;
        let idx = 0;
        while ((match = imgRegex.exec(content)) !== null) {
            const srcMatch = match[0].match(/src=(['"])(.*?)\1/i);
            const src = srcMatch ? srcMatch[2] : '';

            if (src && src !== '[IMG:GEN]') {
                items.push({ src, instruction: this._parseInstruction(match[2]), idx });
            }
            idx++;
        }
        return items;
    },

    _parseInstruction(raw) {
        // Unescape HTML entities if any (like &quot;)
        const unescapedRaw = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        if (!unescapedRaw) return null;

        try {
            return JSON.parse(unescapedRaw);
        } catch (e) {
            try {
                return JSON.parse(unescapedRaw.replace(/\n/g, '\\n').replace(/\r/g, ''));
            } catch (e2) {
                const promptMatch = unescapedRaw.match(/"prompt"\s*:\s*"(.*?)"/s);
                const blockMatch = unescapedRaw.match(/"block"\s*:\s*"(.*?)"/s);
                return promptMatch ? { prompt: promptMatch[1], block: blockMatch ? blockMatch[1] : 'unknown' } : null;
            }
        }
    },

    _scanChatImages() {
        const images = [];
        const hidden = new Set(extStates.DreamAlbum_settings.hidden_items || []);
        const chat = SillyTavern.getContext().chat || [];

        // Entries beyond the end belong to a chat that has since been swapped out.
        if (this._scanCache.size > chat.length) {
            for (const id of this._scanCache.keys()) {
                if (id >= chat.length) this._scanCache.delete(id);
            }
        }

        chat.forEach((message, mesId) => {
            const mes = message.mes || '';
            const store = readStore(message.extra);

            let entry = this._scanCache.get(mesId);
            // Same string references mean unchanged text, so the comparison is cheap.
            if (!entry || entry.mes !== mes || entry.store !== store) {
                // Cheap reject first: messages carry inline base64, so running the regex
                // over every one of them is the expensive part of opening the album.
                const content = `${mes}
${store}`;
                const items = content.indexOf('data-iig-instruction') === -1 ? [] : this._parseMessageImages(content);
                entry = { mes, store, items };
                this._scanCache.set(mesId, entry);
            }

            for (const { src, instruction, idx } of entry.items) {
                const hideKey = `${mesId}-${idx}`;
                if (!hidden.has(hideKey)) images.push({ src, instruction, mesId, hideKey });
            }
        });
        return images;
    },

    /** Images currently shown in the grid, indexed by each item's data-index. */
    _gridImages: [],

    _renderGrid(images) {
        const grid = document.getElementById('DA-grid');
        const $empty = $('#DA-empty-state');
        this._gridImages = images;
        if (images.length === 0) {
            grid.replaceChildren();
            $empty.show();
            $(grid).hide();
            return;
        }
        $empty.hide();
        $(grid).show();

        // Built with DOM properties rather than an HTML string: prompts contain quotes
        // and angle brackets, which broke the old attribute interpolation. One
        // fragment means one layout pass, and interaction is delegated (see
        // _bindGridInteractions), so there are no per-item listeners to create.
        const frag = document.createDocumentFragment();
        images.forEach(({ src, instruction, mesId, hideKey }, index) => {
            const prompt = instruction?.prompt ?? '';

            const item = document.createElement('div');
            item.className = 'DA-image-item';
            item.dataset.index = String(index);
            item.dataset.mesid = String(mesId);
            item.dataset.hidekey = hideKey;
            item.title = prompt;

            const thumb = document.createElement('img');
            thumb.className = 'DA-image-thumb';
            thumb.loading = 'lazy';
            thumb.decoding = 'async';
            thumb.alt = prompt;
            thumb.src = src;

            const overlay = document.createElement('div');
            overlay.className = 'DA-long-press-overlay';
            overlay.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';

            item.append(thumb, overlay);
            frag.append(item);
        });
        grid.replaceChildren(frag);
    },

    /**
     * Tap opens the viewer, a long press hides the image. Bound once on the grid
     * container and resolved through event delegation, so re-rendering a long album
     * never re-attaches handlers.
     */
    _bindGridInteractions($grid) {
        const LONG_PRESS_MS = 400;
        const MOVE_TOLERANCE = 10;
        let timer = null;
        let longFired = false;
        let startX = 0;
        let startY = 0;

        const cancel = () => {
            clearTimeout(timer);
            timer = null;
        };
        const pointOf = (e) => (e.originalEvent?.touches?.[0] ?? e.originalEvent ?? e);
        const imageOf = (el) => this._gridImages[Number(el.dataset.index)];

        $grid.on('mousedown touchstart', '.DA-image-item', (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            const item = e.currentTarget;
            const point = pointOf(e);
            startX = point.clientX;
            startY = point.clientY;
            longFired = false;
            cancel();
            timer = setTimeout(() => {
                timer = null;
                longFired = true;
                const image = imageOf(item);
                item.classList.add('DA-long-pressing');
                if (navigator.vibrate) navigator.vibrate(40);
                // Hiding re-renders the grid; the overlay flashes on the node being removed.
                if (image) this._hideItem(image.hideKey);
            }, LONG_PRESS_MS);
        });

        // A scroll or drag that starts on an image must not turn into a hide.
        $grid.on('touchmove mousemove', '.DA-image-item', (e) => {
            if (!timer) return;
            const point = pointOf(e);
            if (Math.abs(point.clientX - startX) > MOVE_TOLERANCE || Math.abs(point.clientY - startY) > MOVE_TOLERANCE) {
                cancel();
            }
        });
        $grid.on('mouseup mouseleave touchend touchcancel', '.DA-image-item', cancel);

        $grid.on('contextmenu', '.DA-image-item', (e) => {
            if (longFired || timer) e.preventDefault();
        });

        $grid.on('click', '.DA-image-item', (e) => {
            if (longFired) {
                longFired = false;
                return;
            }
            const image = imageOf(e.currentTarget);
            if (image) this._openImageViewer(image.src, image.instruction?.prompt ?? '', image.mesId, image.hideKey);
        });
    },

    _setupLongPress($el, callback) {
        let pressTimer;
        let isLongPress = false;

        const start = (e) => {
            if (e.type === 'click' && e.button !== 0) return;
            isLongPress = false;
            $el.data('long-pressed', false);
            pressTimer = window.setTimeout(() => {
                isLongPress = true;
                $el.data('long-pressed', true);
                $el.addClass('DA-long-pressing');
                
                // Vibration feedback
                if (navigator.vibrate) navigator.vibrate(40);
                
                if (callback) callback();
                
                // Keep overlay visible for 800ms to show the 'eye' before re-rendering or hiding
                setTimeout(() => {
                    $el.removeClass('DA-long-pressing');
                }, 800);
            }, 400); // Reduced to 400ms for snappier feel
        };

        const cancel = () => {
            clearTimeout(pressTimer);
        };

        $el.on('mousedown touchstart', start);
        $el.on('mouseup mouseleave touchend touchcancel', cancel);
        $el.on('contextmenu', (e) => {
            if (isLongPress || pressTimer) {
                e.preventDefault();
                return false;
            }
        });
    },
    
    async _openImageViewer(src, prompt, mesId, hideKey) {
        const $panel = $('#DreamAlbum-panel');
        // A previous viewer may still hold document-level listeners.
        this._viewerZoom?.destroy();
        this._viewerZoom = null;
        $panel.find('#DA-image-viewer-panel').remove();
        const allImages = this._gridImages.map(img => ({
            src: img.src,
            mesId: img.mesId,
            hideKey: img.hideKey,
            prompt: img.instruction?.prompt ?? ''
        }));
        let currentIndex = allImages.findIndex(img => img.src === src);
        const $viewer = $(`
            <div id="DA-image-viewer-panel" class="DA-sub-panel">
                <div class="DA-sub-header">
                    <div class="DA-sub-title"><i class="fa-solid fa-image"></i> Просмотр</div>
                    <div class="DA-header-actions" style="margin-left: auto; margin-right: 8px;">
                        <button class="DA-icon-btn-sm DA-viewer-zoom-level" id="DA-viewer-zoom-reset" title="Сбросить масштаб" hidden></button>
                        <button class="DA-icon-btn-sm" id="DA-viewer-fullscreen" title="Во весь экран"><i class="fa-solid fa-expand"></i></button>
                        <button class="DA-icon-btn-sm" id="DA-viewer-close"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="DA-viewer-main">
                    <div class="DA-viewer-img-container">
                        <div class="DA-viewer-nav DA-viewer-nav-prev" id="DA-viewer-prev"><i class="fa-solid fa-chevron-left"></i></div>
                        <img class="DA-viewer-img DA-zoomable" alt="Image" draggable="false" />
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

        const img = $viewer.find('.DA-viewer-img')[0];
        const $container = $viewer.find('.DA-viewer-img-container');
        const $zoomBadge = $viewer.find('#DA-viewer-zoom-reset');

        const step = (direction) => {
            currentIndex = (currentIndex + direction + allImages.length) % allImages.length;
            updateViewer(currentIndex);
        };

        const zoom = createZoomController({
            img,
            clip: $container[0],
            onSwipe: allImages.length > 1 ? step : null,
            // A tap opens the fullscreen viewer; it waits out a possible double tap,
            // which zooms in place instead.
            onTap: () => this.openFullScreenViewer(allImages.map(i => i.src), currentIndex),
            onChange: (scale) => {
                const zoomed = scale > 1;
                // The prev/next zones cover the image edges; while zoomed they would
                // swallow pans and pinches that start there.
                $container.toggleClass('DA-zoom-active', zoomed);
                $zoomBadge.prop('hidden', !zoomed).text(zoomed ? `${Math.round(scale * 100)}%` : '');
            }
        });
        this._viewerZoom = zoom;

        const closeViewer = () => {
            zoom.destroy();
            if (this._viewerZoom === zoom) this._viewerZoom = null;
            this._closeSubPanel($viewer);
        };

        const updateViewer = (index) => {
            const imgData = allImages[index];
            // Set as a property: the source is user data and must not be parsed as markup.
            img.src = imgData.src;

            $viewer.find('#DA-viewer-hide').off('click').on('click', () => {
                this._hideItem(imgData.hideKey);
                closeViewer();
                this.scanAndRender();
            });
            $viewer.find('#DA-viewer-prompt').off('click').on('click', () => this._openPromptViewer(imgData.prompt));
            $viewer.find('#DA-viewer-scroll').off('click').on('click', () => {
                closeViewer();
                this.close();
                const $mes = $(`#chat .mes[mesid="${imgData.mesId}"]`);
                if ($mes.length) {
                    $mes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    $mes.addClass('DA-highlight-mes');
                    setTimeout(() => $mes.removeClass('DA-highlight-mes'), 2000);
                }
            });
        };

        $viewer.find('#DA-viewer-fullscreen').on('click', () => this.openFullScreenViewer(allImages.map(i => i.src), currentIndex));
        $zoomBadge.on('click', () => zoom.reset());
        $viewer.find('#DA-viewer-close').on('click', closeViewer);
        $viewer.find('#DA-viewer-prev').on('click', () => step(-1));
        $viewer.find('#DA-viewer-next').on('click', () => step(1));
        updateViewer(currentIndex);
    },

    openFullScreenViewer(imageList, currentIndex) {
        FloatingUI.hide();
        $('#DA-fullscreen-viewer').remove();
        let index = currentIndex;
        const $fs = $(`
            <div id="DA-fullscreen-viewer" style="z-index: 2000000 !important;">
                <div class="DA-fullscreen-header">
                    <span class="DA-fs-zoom-level"></span>
                    <button class="DA-fs-btn" id="DA-fs-zoom-out" title="Уменьшить"><i class="fa-solid fa-magnifying-glass-minus"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-zoom-in" title="Увеличить (колесо мыши)"><i class="fa-solid fa-magnifying-glass-plus"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-zoom-reset" title="Сбросить масштаб (двойной клик)"><i class="fa-solid fa-arrows-to-dot"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-rotate-left" title="Повернуть влево"><i class="fa-solid fa-rotate-left"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-rotate-right" title="Повернуть вправо"><i class="fa-solid fa-rotate-right"></i></button>
                    <button class="DA-fs-btn" id="DA-fs-close" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="DA-fullscreen-body">
                    <img class="DA-fullscreen-img DA-zoomable" alt="Fullscreen Image" draggable="false" />
                </div>
            </div>
        `);
        const img = $fs.find('.DA-fullscreen-img')[0];
        // Set as a property: the source is user data and must not be parsed as markup.
        img.src = imageList[index];
        $('body').append($fs);
        $fs[0].offsetHeight;
        $fs.addClass('DA-visible');
        $('body').addClass('DA-no-scroll');

        const BUTTON_STEP = 1.4;
        const $zoomLevel = $fs.find('.DA-fs-zoom-level');

        const showImageAt = (nextIndex) => {
            index = (nextIndex + imageList.length) % imageList.length;
            // Zoom is deliberately kept across images — only the header button, Esc
            // or 0 clears it. Rotation is per-image and still resets.
            zoom.resetRotation();
            img.src = imageList[index];
        };

        const zoom = createZoomController({
            img,
            clip: $fs.find('.DA-fullscreen-body')[0],
            surface: $fs[0],
            onSwipe: imageList.length > 1 ? (direction) => showImageAt(index + direction) : null,
            onChange: (scale) => $zoomLevel.text(scale > 1 ? `${Math.round(scale * 100)}%` : '')
        });

        $fs.find('#DA-fs-zoom-in').on('click', (e) => { e.stopPropagation(); zoom.zoomBy(BUTTON_STEP); });
        $fs.find('#DA-fs-zoom-out').on('click', (e) => { e.stopPropagation(); zoom.zoomBy(1 / BUTTON_STEP); });
        $fs.find('#DA-fs-zoom-reset').on('click', (e) => { e.stopPropagation(); zoom.reset(); });
        $fs.find('#DA-fs-rotate-left').on('click', (e) => { e.stopPropagation(); zoom.rotate(-90); });
        $fs.find('#DA-fs-rotate-right').on('click', (e) => { e.stopPropagation(); zoom.rotate(90); });

        const closeFs = () => {
            zoom.destroy();
            $(document).off('keydown', keyHandler);
            $fs.removeClass('DA-visible');
            setTimeout(() => {
                $fs.remove();
                if (!$('#DreamAlbum-backdrop').hasClass('DA-visible')) {
                    $('body').removeClass('DA-no-scroll');
                }
                FloatingUI.show();
            }, 300);
        };
        $fs.find('#DA-fs-close').on('click', closeFs);
        $fs.on('click', (e) => {
            // A pan that ends over the backdrop must not be read as a dismiss.
            if (zoom.recentlyGestured()) return;
            if (e.target.id === 'DA-fullscreen-viewer' || $(e.target).hasClass('DA-fullscreen-body')) {
                closeFs();
            }
        });

        const keyHandler = (e) => {
            switch (e.key) {
                case 'Escape':
                    if (zoom.isZoomed()) zoom.reset();
                    else closeFs();
                    break;
                case '+':
                case '=':
                    zoom.zoomBy(BUTTON_STEP);
                    break;
                case '-':
                case '_':
                    zoom.zoomBy(1 / BUTTON_STEP);
                    break;
                case '0':
                    zoom.reset();
                    break;
                case 'ArrowLeft':
                    if (!zoom.isZoomed() && imageList.length > 1) showImageAt(index - 1);
                    break;
                case 'ArrowRight':
                    if (!zoom.isZoomed() && imageList.length > 1) showImageAt(index + 1);
                    break;
            }
        };
        $(document).on('keydown', keyHandler);
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
        const chat = SillyTavern.getContext().chat || [];

        chat.forEach((message, mesId) => {
            const contentToScan = (message.mes || '') + '\n' + readStore(message.extra);
            if (contentToScan.indexOf('data-iig-instruction') === -1) return;
            const imgRegex = /<img[^>]+data-iig-instruction=(['"])(.*?)\1[^>]*>/gi;

            let match;
            let idx = 0;
            while ((match = imgRegex.exec(contentToScan)) !== null) {
                const srcMatch = match[0].match(/src=(['"])(.*?)\1/i);
                const src = srcMatch ? srcMatch[2] : '';

                const hideKey = `${mesId}-${idx}`;
                allImages.push({ src, hideKey });
                idx++;
            }
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
                        <div class="DA-long-press-overlay"><i class="fa-solid fa-eye"></i></div>
                    </div>
                `);
                
                this._setupLongPress($item, () => {
                    this._unhideItem(hideKey);
                    this._closeSubPanel($('#DA-hidden-panel'));
                    this._openHiddenPanel();
                });

                $item.on('click', () => {
                    if ($item.data('long-pressed')) {
                        $item.data('long-pressed', false);
                        return;
                    }
                    this._openHiddenImageViewer(src, hideKey);
                });
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
        
        const [mesIdStr, idxStr] = hideKey.split('-');
        const mesId = parseInt(mesIdStr, 10);
        const targetIdx = parseInt(idxStr, 10);
        
        let prompt = '';
        const chat = SillyTavern.getContext().chat || [];
        const message = chat[mesId];
        
        if (message) {
            const contentToScan = (message.mes || '') + '\n' + readStore(message.extra);
            const imgRegex = /<img[^>]+data-iig-instruction=(['"])(.*?)\1[^>]*>/gi;
            
            let match;
            let currentIdx = 0;
            while ((match = imgRegex.exec(contentToScan)) !== null) {
                if (currentIdx === targetIdx) {
                    const raw = match[2];
                    const unescapedRaw = raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                    if (unescapedRaw) {
                        try {
                            const instruction = JSON.parse(unescapedRaw);
                            prompt = instruction?.prompt ?? '';
                        } catch(e) {
                            try {
                                const instruction = JSON.parse(unescapedRaw.replace(/\n/g, '\\n').replace(/\r/g, ''));
                                prompt = instruction?.prompt ?? '';
                            } catch(e2) {
                                const promptMatch = unescapedRaw.match(/"prompt"\s*:\s*"(.*?)"/s);
                                if (promptMatch) {
                                    prompt = promptMatch[1];
                                }
                            }
                        }
                    }
                    break;
                }
                currentIdx++;
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
        
        $viewer.find('#DA-viewer-prev').on('click', () => {});
        $viewer.find('#DA-viewer-next').on('click', () => {});
        
        $viewer.find('#DA-viewer-unhide').on('click', () => {
            this._unhideItem(hideKey);
            close();
            this._closeSubPanel($('#DA-hidden-panel'));
            this._openHiddenPanel();
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
        $sub.find('#DA-moodtube-link').prop('checked', extensionSettings.DreamAlbum.moodtube_link ?? false);
        $sub.find('#DA-extblocks-installed').prop('checked', extensionSettings.DreamAlbum.extblocks_installed ?? false);
        $sub.find('#DA-button-position').val(extensionSettings.DreamAlbum.button_position || 'top-left');

        const btns = extensionSettings.DreamAlbum.action_buttons || { fullscreen: true, copy: true, edit: true, delete: true };
        $sub.find('#DA-btn-show-fullscreen').prop('checked', btns.fullscreen ?? true);
        $sub.find('#DA-btn-show-copy').prop('checked', btns.copy ?? true);
        $sub.find('#DA-btn-show-edit').prop('checked', btns.edit ?? true);
        $sub.find('#DA-btn-show-delete').prop('checked', btns.delete ?? true);

        const fillStyleSelect = ($select, value) => {
            $select.empty().append('<option value="">-- Нет --</option>');
            sets.forEach(set => {
                $select.append($('<option>', { value: set.name, text: set.name }));
            });
            $select.val(value || '');
        };

        for (let i = 1; i <= 3; i++) {
            fillStyleSelect($sub.find(`#DA-floating-style-${i}`), floatingStyles[i - 1]);
        }

        const groupStyles = extensionSettings.DreamAlbum.floating_group_styles || [];
        for (let i = 1; i <= FLOATING_GROUP_MAX; i++) {
            fillStyleSelect($sub.find(`#DA-floating-group-${i}`), groupStyles[i - 1]);
        }
        $sub.find('#DA-api-settings-close').on('click', () => this._closeSubPanel($sub));
        $sub.find('#DA-test-connection').on('click', async () => {
            const $btn = $sub.find('#DA-test-connection');
            if ($btn.prop('disabled')) return;
            const originalHtml = $btn.html();
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Проверка...');
            try {
                // Tests what the panel shows: the active preset and its profile.
                const result = await ApiService.testConnection(extStates.DreamAlbum_settings.active_api_preset);
                if (result.ok) {
                    const reply = result.reply ? ` Ответ: «${result.reply.slice(0, 40)}»` : '';
                    toastr.success(`Профиль «${result.profile}» (${result.model || 'модель по умолчанию'}) отвечает.${reply}`, 'Подключение работает');
                }
                // Failures were already reported by generateBlocks with the HTTP status.
            } finally {
                $btn.prop('disabled', false).html(originalHtml);
            }
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

            const newGroupStyles = [];
            for (let i = 1; i <= FLOATING_GROUP_MAX; i++) {
                const val = $sub.find(`#DA-floating-group-${i}`).val();
                // Duplicates would render two identical buttons in the tray.
                if (val && !newGroupStyles.includes(val)) newGroupStyles.push(val);
            }
            extensionSettings.DreamAlbum.floating_group_styles = newGroupStyles;
            extensionSettings.DreamAlbum.moodtube_link = $sub.find('#DA-moodtube-link').prop('checked');
            extensionSettings.DreamAlbum.extblocks_installed = $sub.find('#DA-extblocks-installed').prop('checked');
            extensionSettings.DreamAlbum.button_position = $sub.find('#DA-button-position').val() || 'top-left';
            extensionSettings.DreamAlbum.action_buttons = {
                fullscreen: $sub.find('#DA-btn-show-fullscreen').prop('checked'),
                copy: $sub.find('#DA-btn-show-copy').prop('checked'),
                edit: $sub.find('#DA-btn-show-edit').prop('checked'),
                delete: $sub.find('#DA-btn-show-delete').prop('checked')
            };
            saveSettingsDebounced();
            await ApiService.loadApiPreset?.();
            
            // Re-render wrappers and floating buttons
            const { MainUI } = await import('./MainUI.js');
            MainUI.attachAllBlockWrappers?.();
            
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
                    // toastr.success(`Выбрано: ${set.name}`);
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
        const sets = extensionSettings.DreamAlbum.sets;
        const styleObj = isNew ? SettingsService.getDefaultSet() : sets[idx];
        const originalName = isNew ? '' : styleObj.name;
        const $panel = $('#DreamAlbum-panel');

        $panel.find('#DA-style-editor-panel').remove();
        const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.NEW_SET_POPUP));
        $panel.append(editorHtml);

        const $sub = $panel.find('#DA-style-editor-panel');
        this._showSubPanel($sub);

        const $name = $sub.find('#DA-style-editor-name');
        const $nameError = $sub.find('#DA-style-editor-name-error');
        const $prompt = $sub.find('#DA-style-editor-prompt');
        const promptEl = $prompt[0];
        const $dirty = $sub.find('#DA-style-editor-dirty');
        const $stats = $sub.find('#DA-style-editor-stats');
        const $warn = $sub.find('#DA-style-editor-warn');
        const $imgPreview = $sub.find('#DA-style-editor-img-preview');
        const $imgUpload = $sub.find('#DA-style-editor-img-upload');

        // The default template carries the placeholder name "Default"; show an empty field instead.
        const initial = {
            name: styleObj.name === 'Default' ? '' : styleObj.name,
            prompt: styleObj.prompt || '',
            image: styleObj.image || ''
        };
        $name.val(initial.name);
        $prompt.val(initial.prompt);
        let currentImageBase64 = initial.image;

        // --- Dirty tracking -----------------------------------------------------
        const isDirty = () => $name.val() !== initial.name
            || $prompt.val() !== initial.prompt
            || currentImageBase64 !== initial.image;
        const refreshDirty = () => $dirty.prop('hidden', !isDirty());

        // --- Prompt statistics --------------------------------------------------
        const fmt = (n) => n.toLocaleString('ru-RU');
        let statsSeq = 0;
        let tokenTimer = null;

        const updateStats = () => {
            const text = promptEl.value;
            const chars = text.length;
            const lines = chars ? text.split('\n').length : 0;
            const macros = (text.match(/\{\{[^{}]*\}\}/g) || []).length;
            const opens = (text.match(/\{\{/g) || []).length;
            const closes = (text.match(/\}\}/g) || []).length;

            const describe = (tokens, exact) => `${fmt(chars)} симв. · ${exact ? '' : '≈'}${fmt(tokens)} ток. · ${fmt(lines)} стр. · макросов: ${macros}`;
            // Instant estimate; the tokenizer's exact count replaces it once typing pauses.
            $stats.text(describe(Math.ceil(chars / 4), false));

            if (opens !== closes) {
                $warn.text('Непарные {{ }} — макрос не подставится').prop('hidden', false);
            } else {
                $warn.prop('hidden', true).text('');
            }

            const countTokens = SillyTavern.getContext().getTokenCountAsync;
            if (typeof countTokens !== 'function' || !chars) return;
            clearTimeout(tokenTimer);
            const seq = ++statsSeq;
            tokenTimer = setTimeout(async () => {
                try {
                    const tokens = await countTokens(text);
                    // Drop the result if the text changed while the tokenizer was busy.
                    if (seq === statsSeq) $stats.text(describe(tokens, true));
                } catch (err) {
                    console.debug('[DreamAlbum] Token count unavailable:', err);
                }
            }, 350);
        };

        // --- Cover --------------------------------------------------------------
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
        $imgPreview.on('click', () => $imgUpload.trigger('click'));
        $imgUpload.on('change', async function() {
            const file = this.files[0];
            if (!file) return;
            // Downscale before storing: covers live inline in settings.json, which is
            // rewritten and backed up on every save.
            try {
                currentImageBase64 = await fileToThumbnail(file);
                updatePreview();
                refreshDirty();
            } catch (err) {
                console.error('[DreamAlbum] Cover upload failed:', err);
                toastr.error(err.message || 'Не удалось загрузить изображение.');
            }
        });

        // --- Name validation ----------------------------------------------------
        // Style names double as identifiers (active style, floating buttons), and the
        // old save path silently overwrote any style that happened to share a name.
        const findNameClash = (name) => sets.findIndex((s, i) => s.name === name && (isNew || i !== idx));
        const validateName = () => {
            const name = $name.val().trim();
            const clash = !!name && findNameClash(name) !== -1;
            $nameError.text(clash ? 'Стиль с таким названием уже есть' : '').prop('hidden', !clash);
            $name.toggleClass('DA-input-invalid', clash);
            return !clash;
        };

        $name.on('input', () => {
            validateName();
            refreshDirty();
        });
        $prompt.on('input', () => {
            updateStats();
            refreshDirty();
        });
        updateStats();

        // --- Macro chips --------------------------------------------------------
        // Built here rather than in the template: templates are rendered through
        // Handlebars, which would substitute the {{...}} text before it ever shows.
        const MACROS = [
            ['{{char}}', 'Имя персонажа'],
            ['{{user}}', 'Имя пользователя'],
            ['{{persona}}', 'Описание персоны'],
            ['{{description}}', 'Описание персонажа'],
            ['{{scenario}}', 'Сценарий'],
        ];
        const $macros = $sub.find('.DA-editor-macros');
        for (const [macro, title] of MACROS) {
            $('<button type="button" class="DA-macro-chip"></button>')
                .attr({ 'data-macro': macro, title })
                .text(macro)
                .appendTo($macros);
        }
        $prompt.attr('placeholder', 'Инструкция для ИИ. Для картинки — полный промпт с требованием тега <img> и нужными параметрами, без CSS/HTML вокруг. Макросы SillyTavern ({{char}}, {{user}}…) подставятся при генерации.');

        // mousedown would move focus off the textarea and collapse the caret.
        $sub.on('mousedown', '.DA-macro-chip', (e) => e.preventDefault());
        $sub.on('click', '.DA-macro-chip', (e) => {
            const macro = e.currentTarget.dataset.macro;
            promptEl.focus();
            promptEl.setRangeText(macro, promptEl.selectionStart, promptEl.selectionEnd, 'end');
            promptEl.dispatchEvent(new Event('input', { bubbles: true }));
        });

        // --- Close / save -------------------------------------------------------
        const close = async () => {
            if (isDirty()) {
                const discard = await this._showConfirm('Закрыть без сохранения? Изменения будут потеряны.', 'Закрыть');
                if (!discard) return;
            }
            clearTimeout(tokenTimer);
            this._closeSubPanel($sub);
        };
        $sub.find('#DA-style-editor-close').on('click', close);

        const save = async () => {
            const newName = $name.val().trim() || 'Новый стиль';
            if (findNameClash(newName) !== -1) {
                $name.val(newName);
                validateName();
                $name.trigger('focus');
                return;
            }

            styleObj.name = newName;
            styleObj.prompt = promptEl.value;
            styleObj.image = currentImageBase64;

            if (!isNew && originalName !== newName) {
                // Other settings point at a style by name; follow the rename.
                SettingsService.renameStyleReferences(originalName, newName);
            }

            if (isNew) {
                sets.push(styleObj);
                await SettingsService.changeSet(sets.length - 1);
            } else {
                saveSettingsDebounced();
            }

            // Floating buttons are built from style names and covers.
            FloatingUI.render();

            clearTimeout(tokenTimer);
            this._closeSubPanel($sub);
            toastr.success(`Стиль «${styleObj.name}» сохранен.`);
            if (refreshCallback) refreshCallback();
        };
        $sub.find('#DA-style-editor-save').on('click', save);
        $sub.on('keydown', (e) => {
            // Ctrl/Alt+Enter are SillyTavern's regenerate/continue hotkeys; typing in
            // the editor must not fire them.
            if (e.key === 'Enter' && (e.ctrlKey || e.altKey || e.metaKey)) {
                e.stopPropagation();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                save();
            }
        });
    },
    /**
     * Вешает обработчики на кнопки панели.
     */
    _setupPanelListeners() {
        const $panel = $('#DreamAlbum-panel');

        // Theme Dropdown
        const $titleContainer = $('#DA-title-container');
        const $themeDropdown = $('#DA-theme-dropdown');
        
        const DA_THEMES = {
            'default': 'Оригинальная',
            'tavern': 'SillyTavern',
            'twilight': 'Сумерки',
            'forest': 'Темный лес',
            'ocean': 'Глубокий океан',
            'eclipse': 'Затмение'
        };

        Object.entries(DA_THEMES).forEach(([id, name]) => {
            const $item = $(`<div style="padding: 6px 10px; cursor: pointer; border-radius: 4px; transition: background 0.2s; color: var(--da-text);" onmouseover="this.style.background='var(--da-surface2)'" onmouseout="this.style.background='transparent'">${name}</div>`);
            $item.on('click', (e) => {
                e.stopPropagation();
                extensionSettings.DreamAlbum.album_theme = id;
                saveSettingsDebounced();
                this.applyTheme();
                $themeDropdown.hide();
            });
            $themeDropdown.append($item);
        });

        $titleContainer.on('click', (e) => {
            e.stopPropagation();
            $themeDropdown.toggle();
        });

        $(document).on('click', (e) => {
            if (!$(e.target).closest('#DA-title-container').length) {
                $themeDropdown.hide();
            }
        });

        this._bindGridInteractions($('#DA-grid'));

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
        // Context whitespace compression toggle
        const $compactBtn = $('#DA-compact-toggle-btn');
        const updateCompactState = () => {
            const enabled = !!extensionSettings.DreamAlbum?.compress_context_whitespace;
            $compactBtn.toggleClass('DA-power-on', enabled);
            $compactBtn.attr('title', enabled
                ? 'Сжатие пробелов в контексте: ВКЛ. Карты, персона, лорбук и история уходят в запрос с одним пробелом вместо переносов, табов и повторов.'
                : 'Сжатие пробелов в контексте: выкл. Нажмите, чтобы отправлять карты, персону, лорбук и историю без лишних пробелов и переносов.');
        };
        updateCompactState();
        $compactBtn.on('click', () => {
            const enabled = !extensionSettings.DreamAlbum?.compress_context_whitespace;
            extensionSettings.DreamAlbum.compress_context_whitespace = enabled;
            updateCompactState();
            saveSettingsDebounced();
            toastr.success(enabled
                ? 'Пробелы в контексте сжимаются: переносы, табы и повторы → один пробел. Промпт стиля не трогается.'
                : 'Сжатие пробелов в контексте выключено.');
        });

        $('#DA-close-btn').on('click', () => this.close());
        $('#DreamAlbum-backdrop').on('click', (e) => {
            if (e.target.id === 'DreamAlbum-backdrop') {
                this.close();
            }
        });
        $('#DA-settings-btn').on('click', () => this.openApiSettings());
        $panel.find('#DA-style-btn').on('click', () => this.openStylePicker());
        this._bindCreateButton($panel.find('#DA-create-btn'));
        $panel.find('#DA-hidden-btn').on('click', () => this._openHiddenPanel());
    },
    /**
     * Запускает генерацию изображения на основе текущего стиля и контекста чата.
     */
    /**
     * Tap generates straight away; holding the button asks for a one-off OOC
     * instruction first. The fill animation (DA-holding) shows how long to hold.
     * @param {jQuery} $btn
     */
    _bindCreateButton($btn) {
        const HOLD_MS = 500;
        const MOVE_TOLERANCE = 10;
        let timer = null;
        let held = false;
        let startX = 0;
        let startY = 0;

        const stop = () => {
            clearTimeout(timer);
            timer = null;
            $btn.removeClass('DA-holding');
        };
        const pointOf = (e) => (e.originalEvent?.touches?.[0] ?? e.originalEvent ?? e);

        $btn.on('mousedown touchstart', (e) => {
            if (e.type === 'mousedown' && e.button !== 0) return;
            if ($btn.prop('disabled')) return;
            const point = pointOf(e);
            startX = point.clientX;
            startY = point.clientY;
            held = false;
            stop();
            $btn.addClass('DA-holding');
            timer = setTimeout(() => {
                timer = null;
                held = true;
                $btn.removeClass('DA-holding');
                if (navigator.vibrate) navigator.vibrate(40);
                this._generateWithOoc();
            }, HOLD_MS);
        });

        $btn.on('touchmove mousemove', (e) => {
            if (!timer) return;
            const point = pointOf(e);
            if (Math.abs(point.clientX - startX) > MOVE_TOLERANCE || Math.abs(point.clientY - startY) > MOVE_TOLERANCE) {
                stop();
            }
        });
        $btn.on('mouseup mouseleave touchend touchcancel', stop);
        // A long press on touch screens otherwise opens the browser's context menu.
        $btn.on('contextmenu', (e) => e.preventDefault());

        $btn.on('click', () => {
            if (held) {
                held = false;
                return;
            }
            this._triggerImageGeneration();
        });
    },

    /**
     * Returns the style generation should use, or null after telling the user why
     * there is none. Checked before the OOC dialog so nobody types into it only to be
     * told the chat or style was missing.
     * @returns {Object|null}
     */
    _getGenerationStyle() {
        const ctx = SillyTavern.getContext();
        if (ctx.characterId === undefined && ctx.groupId === undefined) {
            toastr.warning('Сначала откройте чат (персонаж или группа).');
            return null;
        }
        const activeSetName = extensionSettings.DreamAlbum?.active_set;
        const activeSet = extensionSettings.DreamAlbum?.sets?.find(s => s.name === activeSetName);
        if (!activeSet || !activeSet.prompt) {
            toastr.warning('Пожалуйста, выберите стиль и убедитесь, что в нем настроен промпт.');
            this.openStylePicker();
            return null;
        }
        return activeSet;
    },

    async _generateWithOoc() {
        const activeSet = this._getGenerationStyle();
        if (!activeSet) return;
        const instruction = await askOocInstruction({
            styleName: activeSet.name,
            initial: this._lastOoc || ''
        });
        if (instruction === null) return;
        this._lastOoc = instruction;
        await this._triggerImageGeneration(instruction);
    },

    async _triggerImageGeneration(instruction = null) {
        const activeSet = this._getGenerationStyle();
        if (!activeSet) return;
        const $btn = $('#DA-create-btn');
        const originalContent = $btn.html();
        
        try {
            $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> <span>Генерация...</span>');
            
            await GenerationService.triggerStyleGeneration(activeSet, instruction);
            // toastr.success('Запрос на генерацию отправлен! Подождите, пока SillyImages создаст изображение.');
            
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
    async _showConfirm(text, yesLabel = 'Удалить') {
        const $panel = $('#DreamAlbum-panel');
        $panel.find('#DA-confirm-panel').remove();
        return new Promise((resolve) => {
            const $confirm = $(`
                <div id="DA-confirm-panel" class="DA-sub-panel DA-confirm-wrapper">
                    <div class="DA-confirm-box">
                        <div class="DA-confirm-text"></div>
                        <div class="DA-confirm-actions">
                            <button id="DA-confirm-yes" class="DA-btn-confirm DA-btn-primary"></button>
                            <button id="DA-confirm-no" class="DA-btn-confirm DA-btn-secondary">Отмена</button>
                        </div>
                    </div>
                </div>
            `);
            // Style names reach this text; never interpret them as markup.
            $confirm.find('.DA-confirm-text').text(text);
            $confirm.find('#DA-confirm-yes').text(yesLabel);
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