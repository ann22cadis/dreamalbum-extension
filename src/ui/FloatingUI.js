import { extStates } from '../core/state.js';
import { SettingsService } from '../services/SettingsService.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { ExtTopic, defaultExtPrefix, FLOATING_GROUP_MAX } from '../core/constants.js';
import { askOocInstruction } from './OocModal.js';
const {
    extensionSettings,
    saveSettingsDebounced,
    eventSource
} = SillyTavern.getContext();
export const FloatingUI = {
    _initialized: false,
    _hiddenByFullscreen: false,
    init() {
        if (this._initialized) return;
        this.render();
        this._setupObservers();
        this._initialized = true;
    },
    /** Selectors that could be a third-party fullscreen viewer. */
    _fsSelectors: [
        '.lightbox', '.fullscreen', '#slay_lightbox', '.ngy2_lightbox',
        '[id*="lightbox"]', '[class*="fullscreen"]', '#DA-fullscreen-viewer',
        '#img-preview-container', '.pswp--open', '.nGY2On', '.nGY2_body_scrollbar'
    ],

    /** Body classes that mean a viewer is open without any element query. */
    _fsBodyClasses: ['nGY2On', 'nGY2_body_scrollbar', 'pswp--open'],

    _isFullscreenActive() {
        for (const cls of this._fsBodyClasses) {
            if (document.body.classList.contains(cls)) return true;
        }
        // querySelectorAll with attribute-substring selectors plus getComputedStyle
        // forces layout, so this only ever runs from the throttled callback below.
        for (const el of document.querySelectorAll(this._fsSelectors.join(', '))) {
            if (el.offsetHeight <= 0) continue;
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden') return true;
        }
        return false;
    },

    _checkFullscreen() {
        const isFsActive = this._isFullscreenActive();

        if (isFsActive) {
            if ($('#DA-floating-container').is(':visible')) {
                this.hide();
                this._hiddenByFullscreen = true;
            }
        } else if (this._hiddenByFullscreen) {
            this.show();
            this._hiddenByFullscreen = false;
        }
    },

    _setupObservers() {
        // SillyTavern rewrites class/style on chat nodes constantly while streaming.
        // Coalesce every burst into a single check on the next animation frame, and
        // ignore mutations inside #chat entirely — a viewer never opens in there.
        let scheduled = false;
        const chatEl = document.getElementById('chat');

        const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                this._checkFullscreen();
            });
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                const target = mutation.target;
                if (!(target instanceof Node)) continue;
                if (chatEl && chatEl.contains(target)) continue;
                if (target.nodeType === Node.ELEMENT_NODE && target.closest('#DA-floating-container')) continue;
                schedule();
                return;
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    },
    hide() {
        const $el = $('#DA-floating-container');
        $el.hide();
    },
    show() {
        const $el = $('#DA-floating-container');
        $el.show();
    },
    render() {
        $('#DA-floating-container').find('.DA-floating-group').each((_, g) => $(g).data('daCloseTray')?.());
        $('#DA-floating-container').remove();
        
        if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled || !extensionSettings.DreamAlbum.floating_buttons_enabled) {
            return;
        }
        const styles = extensionSettings.DreamAlbum.floating_buttons_styles || [];
        const groupStyles = (extensionSettings.DreamAlbum.floating_group_styles || []).slice(0, FLOATING_GROUP_MAX);
        const wantsMoodtube = !!extensionSettings.DreamAlbum.moodtube_link;
        if (styles.length === 0 && groupStyles.length === 0 && !wantsMoodtube) return;
        
        let savedPos = { left: window.innerWidth - 80, top: window.innerHeight - 250 };
        try {
            const stored = localStorage.getItem('DA_floating_pos');
            if (stored) savedPos = JSON.parse(stored);
        } catch(e) {}
        
        const $container = $(`
            <div id="DA-floating-container" class="DA-floating-wrap" style="left: ${savedPos.left}px; top: ${savedPos.top}px; right: auto !important; bottom: auto !important; z-index: 15000 !important; touch-action: none;">
                <div class="DA-floating-window"></div>
            </div>
        `);
        /**
         * Builds a style button: tap generates, long press asks for an instruction.
         * @param {Object} set
         * @param {string} [extraClass] Extra class, used to mark tray buttons.
         * @param {Function} [onActivate] Runs before generation, e.g. to close the tray.
         */
        const buildStyleButton = (set, extraClass = '', onActivate = null) => {
            const bgStyle = set.image ? `background-image: url('${set.image.replace(/'/g, "\\'")}');` : '';
            const $btn = $(`
                <div class="DA-floating-btn ${extraClass}" title="Сгенерировать: ${set.name}" style="${bgStyle}">
                    ${!set.image ? `<i class="fa-solid fa-wand-sparkles"></i>` : ''}
                </div>
            `);

            let pressTimer = null;
            let isLongPress = false;
            let startX = 0, startY = 0;

            const startPress = (e) => {
                if (e.button !== undefined && e.button !== 0) return; // Only left click
                isLongPress = false;
                const evt = e.touches ? e.touches[0] : e;
                startX = evt ? evt.clientX : e.clientX;
                startY = evt ? evt.clientY : e.clientY;
                pressTimer = setTimeout(() => {
                    isLongPress = true;
                    document.body.classList.add('DA-no-select');
                    this.openInstructionModal(set, $btn);
                }, 500); // 500ms for long press
            };

            const cancelPress = (e) => {
                if (!pressTimer) return;
                const evt = e.touches ? e.touches[0] : e;
                if (evt) {
                    const dx = evt.clientX - startX;
                    const dy = evt.clientY - startY;
                    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                        clearTimeout(pressTimer);
                        pressTimer = null;
                        document.body.classList.remove('DA-no-select');
                    }
                } else {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                    document.body.classList.remove('DA-no-select');
                }
            };

            $btn.on('mousedown touchstart', startPress);
            $btn.on('mousemove touchmove mouseleave touchcancel', cancelPress);
            $btn.on('mouseup touchend', (e) => {
                clearTimeout(pressTimer);
                pressTimer = null;
                // We keep DA-no-select until click handler or some delay to be safe
                setTimeout(() => document.body.classList.remove('DA-no-select'), 100);
            });

            $btn.on('click', async (e) => {
                e.stopPropagation();
                if (isLongPress) {
                    isLongPress = false;
                    return;
                }
                if (onActivate) onActivate();
                await this.triggerGeneration(set, $btn);
            });

            return $btn;
        };

        styles.forEach(setName => {
            const set = extensionSettings.DreamAlbum.sets.find(s => s.name === setName);
            if (!set) return;
            $container.find('.DA-floating-window').append(buildStyleButton(set));
        });

        if (groupStyles.length > 0) {
            $container.find('.DA-floating-window').append(this._buildGroup(groupStyles, buildStyleButton));
        }

        if (extensionSettings.DreamAlbum.moodtube_link) {
            const $mtPlaceholder = $(`
                <div id="DA-moodtube-placeholder" class="DA-floating-btn" title="MoodTube (ожидание плагина)" style="background-color: var(--da-surface2); border: 2px dashed var(--da-border);">
                    <i class="fa-solid fa-music" style="color: var(--da-text-muted);"></i>
                </div>
            `);
            $container.find('.DA-floating-window').append($mtPlaceholder);
        }

        $('body').append($container);

        // Clamp only once the stack is in the DOM: its height depends on how many
        // buttons were added, and the old fixed 60px guess let a taller column —
        // extra styles, the group button, MoodTube — hang off the bottom edge.
        this._clampIntoViewport($container[0]);
        $(window).off('resize.dafloat').on('resize.dafloat', () => {
            const el = document.getElementById('DA-floating-container');
            if (el) this._clampIntoViewport(el);
        });

        this.setupDrag($container[0]);
    },

    /**
     * Keeps the dock fully on screen, measuring what it actually occupies.
     * @param {HTMLElement} el
     */
    _clampIntoViewport(el) {
        const margin = 8;
        const width = el.offsetWidth;
        const height = el.offsetHeight;

        const maxLeft = Math.max(margin, window.innerWidth - width - margin);
        const maxTop = Math.max(margin, window.innerHeight - height - margin);

        const left = Math.max(margin, Math.min(parseFloat(el.style.left) || 0, maxLeft));
        const top = Math.max(margin, Math.min(parseFloat(el.style.top) || 0, maxTop));

        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
    },
    /**
     * Builds the expanding group button: one dock button that opens a sideways tray
     * holding the user's chosen styles.
     * @param {string[]} groupStyles Style names, already capped to FLOATING_GROUP_MAX.
     * @param {Function} buildStyleButton Factory shared with the plain floating buttons.
     * @returns {jQuery}
     */
    _buildGroup(groupStyles, buildStyleButton) {
        const $group = $(`
            <div class="DA-floating-group">
                <div class="DA-floating-btn DA-floating-group-btn" title="Стили (${groupStyles.length})">
                    <i class="fa-solid fa-layer-group"></i>
                </div>
                <div class="DA-floating-group-tray" aria-hidden="true"></div>
            </div>
        `);

        const $btn = $group.find('.DA-floating-group-btn');
        const $tray = $group.find('.DA-floating-group-tray');

        const close = () => {
            if (!$group.hasClass('DA-group-open')) return;
            $group.removeClass('DA-group-open');
            $tray.attr('aria-hidden', 'true');
            $(document).off('.dagroup');
        };

        /**
         * Opens towards whichever side has room. The container is draggable, so the
         * side is decided at open time, not when the button was built.
         */
        const open = () => {
            const rect = $btn[0].getBoundingClientRect();
            const needed = $tray[0].scrollWidth || (groupStyles.length * 48);
            const gap = 16;
            const roomRight = window.innerWidth - rect.right - gap;
            const roomLeft = rect.left - gap;
            // Prefer the roomier side, and only insist on a side that actually fits.
            const openLeft = roomRight < needed && roomLeft > roomRight;

            $group.toggleClass('DA-group-left', openLeft);
            $group.toggleClass('DA-group-right', !openLeft);
            $group.addClass('DA-group-open');
            $tray.attr('aria-hidden', 'false');

            // Bound to document so a tap anywhere else dismisses the tray.
            $(document).on('mousedown.dagroup touchstart.dagroup', (e) => {
                if ($(e.target).closest('.DA-floating-group').length) return;
                close();
            });
            $(document).on('keydown.dagroup', (e) => {
                if (e.key === 'Escape') close();
            });
        };

        $group.data('daCloseTray', close);

        $btn.on('click', (e) => {
            e.stopPropagation();
            if ($group.hasClass('DA-group-open')) close();
            else open();
        });

        groupStyles.forEach(setName => {
            const set = extensionSettings.DreamAlbum.sets.find(s => s.name === setName);
            if (!set) return;
            $tray.append(buildStyleButton(set, 'DA-tray-btn', close));
        });

        // Nothing resolved to a real style — do not leave an empty tray behind.
        if ($tray.children().length === 0) return $();

        return $group;
    },

    setupDrag(el) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let currentDx = 0, currentDy = 0;
        let rafId = null;
        const dragStart = (e) => {
            
            if (e.type === 'mousedown' && e.button !== 0) return;
            
            isDragging = false;
            const event = e.type.startsWith('touch') ? e.touches[0] : e;
            startX = event.clientX;
            startY = event.clientY;
            
            initialLeft = el.offsetLeft;
            initialTop = el.offsetTop;
            currentDx = 0;
            currentDy = 0;
            
            el.style.cursor = 'grabbing';
            
            el.style.transition = 'none';
        };
        const dragMove = (e) => {
            if (startX === undefined) return;
            
            const event = e.type.startsWith('touch') ? e.touches[0] : e;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            
            
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging = true;

            if (isDragging) {
                // The tray picked its side from the old position; drop it.
                $(el).find('.DA-floating-group').each((_, g) => $(g).data('daCloseTray')?.());
                
                if (e.cancelable) e.preventDefault();
                
                const maxLeft = window.innerWidth - el.offsetWidth;
                const maxTop = window.innerHeight - el.offsetHeight;
                
                let newLeft = initialLeft + dx;
                let newTop = initialTop + dy;
                
                
                newLeft = Math.max(0, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));
                
                
                currentDx = newLeft - initialLeft;
                currentDy = newTop - initialTop;
                
                
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    el.style.transform = `translate3d(${currentDx}px, ${currentDy}px, 0)`;
                    document.body.classList.add('DA-no-select');
                });
            }
        };
        const dragEnd = (e) => {
            if (startX === undefined) return;
            startX = undefined;
            if (rafId) cancelAnimationFrame(rafId);
            
            el.style.cursor = 'grab';
            document.body.classList.remove('DA-no-select');
            
            if (isDragging) {
                
                el.style.transform = 'none';
                el.style.left = (initialLeft + currentDx) + 'px';
                el.style.top = (initialTop + currentDy) + 'px';
                
                
                localStorage.setItem('DA_floating_pos', JSON.stringify({
                    left: initialLeft + currentDx,
                    top: initialTop + currentDy
                }));
                
                
                setTimeout(() => { isDragging = false; }, 50);
            }
        };
        
        el.addEventListener('mousedown', dragStart, { passive: false });
        el.addEventListener('touchstart', dragStart, { passive: false });
        
        document.addEventListener('mousemove', dragMove, { passive: false });
        document.addEventListener('touchmove', dragMove, { passive: false });
        
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('touchend', dragEnd);
        document.addEventListener('touchcancel', dragEnd);
        
        el.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
            }
        }, true);
    },
    async openInstructionModal(set, $btn) {
        const instruction = await askOocInstruction({ styleName: set.name });
        if (instruction === null) return;
        await this.triggerGeneration(set, $btn, instruction);
    },
    async triggerGeneration(set, $activeBtn, instruction = null) {
        const ctx = SillyTavern.getContext();
        if (ctx.characterId === undefined && ctx.groupId === undefined) {
            toastr.warning('Сначала откройте чат.');
            return;
        }
        
        if (!$activeBtn) {
            const $btns = $('#DA-floating-container .DA-floating-btn');
            $btns.each((_, btn) => {
                if (btn.title === `Сгенерировать: ${set.name}`) {
                    $activeBtn = $(btn);
                }
            });
        }

        if ($activeBtn) {
            $activeBtn.addClass('DA-is-generating').prop('disabled', true);
        }
        
        try {
            await GenerationService.triggerStyleGeneration(set, instruction);
            
            if ($activeBtn) {
                // Сохраняем оригинальное состояние ПЕРЕД изменениями для успеха
                const originalContent = $activeBtn.html();
                const originalStyle = $activeBtn.attr('style') || '';
                
                // Сначала убираем класс анимации, затем показываем галочку
                $activeBtn.removeClass('DA-is-generating');
                
                $activeBtn.html('<i class="fa-solid fa-check" style="font-size: 1.5rem !important; color: white !important; text-shadow: 0 0 10px white;"></i>')
                          .css({
                              'background-image': 'none',
                              'background-color': 'var(--da-accent)',
                              'border-color': 'var(--da-accent)',
                              'box-shadow': '0 0 25px var(--da-accent)'
                          });
                          
                setTimeout(() => {
                    $activeBtn.html(originalContent).attr('style', originalStyle);
                    $activeBtn.prop('disabled', false);
                }, 3000);
            }
        } catch (error) {
            console.error('DreamAlbum Generation Error:', error);
            if ($activeBtn) {
                $activeBtn.removeClass('DA-is-generating').prop('disabled', false);
            }
        }
    },
    
    triggerSuccessAnimation() {
        const $btns = $('#DA-floating-container .DA-floating-btn:not(#DA-moodtube-placeholder):not(.DA-tray-btn)');
        let $activeBtn = $btns.first();
        
        if ($activeBtn.length === 0) {
            // Если плавающая кнопка выключена, анимируем кнопку "Создать" в меню расширения (AlbumUI)
            const $albumBtn = $('#DA-generate-btn');
            if ($albumBtn.length) {
                const originalHtml = $albumBtn.html();
                $albumBtn.html('<i class="fa-solid fa-check"></i> Успешно')
                         .css({ 'background-color': 'var(--da-accent)', 'color': 'white' });
                setTimeout(() => {
                    $albumBtn.html(originalHtml).css({ 'background-color': '', 'color': '' });
                }, 3000);
            }
            return;
        }

        const originalContent = $activeBtn.html();
        const originalStyle = $activeBtn.attr('style') || '';
        
        $activeBtn.removeClass('DA-is-generating');
        $activeBtn.html('<i class="fa-solid fa-check" style="font-size: 1.5rem !important; color: white !important; text-shadow: 0 0 10px white;"></i>')
                  .css({
                      'background-image': 'none',
                      'background-color': 'var(--da-accent)',
                      'border-color': 'var(--da-accent)',
                      'box-shadow': '0 0 25px var(--da-accent)'
                  });
                  
        setTimeout(() => {
            $activeBtn.html(originalContent).attr('style', originalStyle);
            $activeBtn.prop('disabled', false);
        }, 3000);
    }
};