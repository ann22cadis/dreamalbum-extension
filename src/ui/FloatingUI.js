import { extStates } from '../core/state.js';
import { SettingsService } from '../services/SettingsService.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { ExtTopic, defaultExtPrefix } from '../core/constants.js';
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
    _setupObservers() {
        const observer = new MutationObserver((mutations) => {
            // Ищем элементы, которые могут быть полноэкранным просмотрщиком
            const fsSelectors = [
                '.lightbox', '.fullscreen', '#slay_lightbox', '.ngy2_lightbox', 
                '[id*="lightbox"]', '[class*="fullscreen"]', '#DA-fullscreen-viewer',
                '#img-preview-container', '.pswp--open', '.nGY2On', '.nGY2_body_scrollbar'
            ];
            
            const fsElements = document.querySelectorAll(fsSelectors.join(', '));
            let isFsActive = document.body.classList.contains('nGY2On') || 
                            document.body.classList.contains('nGY2_body_scrollbar') ||
                            document.body.classList.contains('pswp--open');
            
            if (!isFsActive) {
                for (const el of fsElements) {
                    const style = window.getComputedStyle(el);
                    if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0) {
                        isFsActive = true;
                        break;
                    }
                }
            }
            
            if (isFsActive) {
                if ($('#DA-floating-container').is(':visible')) {
                    console.log('[DreamAlbum] Fullscreen detected, hiding floating buttons');
                    this.hide();
                    this._hiddenByFullscreen = true;
                }
            } else if (this._hiddenByFullscreen) {
                console.log('[DreamAlbum] Fullscreen closed, showing floating buttons');
                this.show();
                this._hiddenByFullscreen = false;
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
        $('#DA-floating-container').remove();
        
        if (!extensionSettings.DreamAlbum.dreamalbum_is_enabled || !extensionSettings.DreamAlbum.floating_buttons_enabled) {
            return;
        }
        const styles = extensionSettings.DreamAlbum.floating_buttons_styles || [];
        if (styles.length === 0) return;
        
        let savedPos = { left: window.innerWidth - 80, top: window.innerHeight - 250 };
        try {
            const stored = localStorage.getItem('DA_floating_pos');
            if (stored) savedPos = JSON.parse(stored);
        } catch(e) {}
        
        savedPos.left = Math.max(0, Math.min(savedPos.left, window.innerWidth - 60));
        savedPos.top = Math.max(0, Math.min(savedPos.top, window.innerHeight - 60));
        
        const $container = $(`
            <div id="DA-floating-container" class="DA-floating-wrap" style="left: ${savedPos.left}px; top: ${savedPos.top}px; right: auto !important; bottom: auto !important; z-index: 15000 !important; touch-action: none;">
                <div class="DA-floating-window"></div>
            </div>
        `);
        styles.forEach(setName => {
            const set = extensionSettings.DreamAlbum.sets.find(s => s.name === setName);
            if (!set) return;
            const bgStyle = set.image ? `background-image: url('${set.image.replace(/'/g, "\\'")}');` : '';
            const $btn = $(`
                <div class="DA-floating-btn" title="Сгенерировать: ${set.name}" style="${bgStyle}">
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
                await this.triggerGeneration(set, $btn);
            });
            $container.find('.DA-floating-window').append($btn);
        });

        if (extensionSettings.DreamAlbum.moodtube_link) {
            const $mtPlaceholder = $(`
                <div id="DA-moodtube-placeholder" class="DA-floating-btn" title="MoodTube (ожидание плагина)" style="background-color: var(--da-surface2); border: 2px dashed var(--da-border);">
                    <i class="fa-solid fa-music" style="color: var(--da-text-muted);"></i>
                </div>
            `);
            $container.find('.DA-floating-window').append($mtPlaceholder);
        }

        $('body').append($container);
        
        
        this.setupDrag($container[0]);
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
    openInstructionModal(set, $btn) {
        const $overlay = $(`
            <div class="DA-confirm-wrapper" style="z-index: 3000000 !important; display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);">
                <div class="DA-confirm-box" style="width: 90%; max-width: 400px; background: var(--da-bg); border: 1px solid var(--da-border); border-radius: var(--da-radius-panel); padding: 20px; box-shadow: var(--da-shadow); color: var(--da-text);">
                    <div class="DA-confirm-text" style="font-weight: 600; font-size: 1.1rem; margin-bottom: 10px;">
                        Пожелание к генерации: <span style="color: var(--da-accent);">${set.name}</span>
                    </div>
                    <div style="font-size: 0.85rem; opacity: 0.8; margin-bottom: 15px; text-align: left; line-height: 1.3;">
                        Введите инструкцию, которую ИИ должен учесть.
                    </div>
                    <textarea class="DA-input" id="DA-instruction-input" rows="3" placeholder="Ваше пожелание..." style="width: 100%; margin-bottom: 20px; resize: none; background: var(--da-surface); border: 1px solid var(--da-border); color: var(--da-text); padding: 10px; border-radius: 8px; font-family: inherit; font-size: 0.95rem; box-sizing: border-box; overflow-y: hidden; min-height: 80px;" oninput="this.style.height = ''; this.style.height = Math.min(this.scrollHeight, 250) + 'px'; this.style.overflowY = this.scrollHeight > 250 ? 'auto' : 'hidden';"></textarea>
                    <div class="DA-confirm-actions" style="display: flex; gap: 10px; justify-content: flex-end;">
                        <button class="DA-btn-confirm" id="DA-inst-cancel" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid var(--da-border); background: var(--da-surface2); color: var(--da-text); cursor: pointer;">Отмена</button>
                        <button class="DA-btn-confirm" id="DA-inst-generate" style="flex: 1; padding: 10px; border-radius: 8px; border: none; background: var(--da-accent); color: white; cursor: pointer; font-weight: bold;">Сгенерировать</button>
                    </div>
                </div>
            </div>
        `);

        $('body').append($overlay);
        $overlay.find('#DA-instruction-input').focus();

        $overlay.find('#DA-inst-cancel').on('click', () => {
            $overlay.remove();
        });

        $overlay.find('#DA-inst-generate').on('click', async () => {
            let instruction = $overlay.find('#DA-instruction-input').val();
            if (instruction) {
                instruction = instruction.replace(/'/g, "&apos;");
            }
            $overlay.remove();
            await this.triggerGeneration(set, $btn, instruction);
        });
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
        const $btns = $('#DA-floating-container .DA-floating-btn:not(#DA-moodtube-placeholder)');
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