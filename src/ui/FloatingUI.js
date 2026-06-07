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
    init() {
        if (this._initialized) return;
        this.render();
        this._initialized = true;
    },
    render() {
        console.log('[DreamAlbum] FloatingUI render() called');
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
            <div id="DA-floating-container" class="DA-floating-wrap" style="left: ${savedPos.left}px; top: ${savedPos.top}px; right: auto !important; bottom: auto !important; z-index: 9999999 !important; touch-action: none;">
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
            $btn.on('click', async (e) => {
                e.stopPropagation();
                await this.triggerGeneration(set, $btn);
            });
            $container.find('.DA-floating-window').append($btn);
        });
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
    async triggerGeneration(set, $activeBtn) {
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
            await GenerationService.triggerStyleGeneration(set);
            
            
            if ($activeBtn) {
                
                const originalContent = $activeBtn.html();
                const originalStyle = $activeBtn.attr('style');
                
                $activeBtn.html('<i class="fa-solid fa-check" style="font-size: 1.5rem !important;"></i>')
                          .css({
                              'background-image': 'none',
                              'border-color': 'var(--da-accent)',
                              'background-color': 'var(--da-surface2)'
                          });
                setTimeout(() => {
                    $activeBtn.html(originalContent).attr('style', originalStyle);
                }, 3000);
            }
        } catch (error) {
            console.error('DreamAlbum Generation Error:', error);
            toastr.error(error.message || 'Ошибка при генерации.');
        } finally {
            if ($activeBtn) {
                $activeBtn.removeClass('DA-is-generating').prop('disabled', false);
            }
        }
    }
};