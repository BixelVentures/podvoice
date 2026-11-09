// Let fixture playback settle in the UI while keeping the review silent.
HTMLMediaElement.prototype.play = function () {
    this.muted = true;
    return Promise.resolve();
};

const previewOpeners = new Map([
    ['#player-detail', '#music-detail'],
    ['#output', '#rooms'],
    ['#header-ro', '#quick-sheet'],
    ['#open-history', '#history'],
    ['#home-radio', '#radio-view'],
    ['#home-recipes', '#recipes-view'],
    ['#answer-host details:not([hidden]) > summary', null]
]);

window.addEventListener('DOMContentLoaded', async () => {
    const host = document.querySelector('pv-widget-host');
    if (!host || host.live !== false) return;
    const params = new URLSearchParams(location.search);
    // This local review holds the selected specimen. Keep the product lifecycle
    // unchanged: no idle return, wake navigation or kiosk maintenance in a fixture.
    host.screenLifecycle?.cleanup();
    if (params.get('motion') === 'reduced') {
        host.dataset.motion = 'reduced';
        host.motion?.cancel();
        host.render();
    }
    const weatherCondition = params.get('weatherCondition');
    // Explicit local specimen: exercise the existing deadline renderer near
    // completion without waiting ten minutes or introducing another timer owner.
    if (params.get('timerFixture') === 'short' && params.get('stage') === 'timer-detail-running') {
        const { sceneTransition } = await import('/scene-model.js');
        const now = Date.now();
        const cleared = sceneTransition(host.state, {type:'timer', id:host.state.timer?.id, action:'cancel'});
        host.state = sceneTransition(sceneTransition(cleared, {
            type:'timer-start', name:'', seconds:600, now:now-570000
        }), { type:'tick', now });
        host.render();
    }
    if (['sunny','clear-night','partlycloudy','cloudy','rainy','snowy','fog','windy','lightning'].includes(weatherCondition)) {
        const [{ WEATHER_CHANGE_EXAMPLE }, { conditionLabel }] = await Promise.all([
            import('/weather-view.js'), import('/weather-observation.js')
        ]);
        host.state = { ...host.state, weatherFixture: { ...WEATHER_CHANGE_EXAMPLE,
            conditionCode: weatherCondition, condition: conditionLabel(weatherCondition),
            isDaytime: weatherCondition !== 'clear-night' } };
        host.localWeatherBuilt = false;
        host.render();
        // An explicit review-only observation change, in the same mounted
        // renderer. No service request, invented forecast or recurring loop.
        const nextCondition = params.get('weatherTransition');
        if (['sunny','cloudy','rainy','snowy','fog','windy','lightning'].includes(nextCondition)) {
            const change = setTimeout(() => {
                if (!host.isConnected || host.live !== false) return;
                host.state = { ...host.state, weatherFixture: {
                    ...host.state.weatherFixture,
                    conditionCode:nextCondition, condition:conditionLabel(nextCondition)
                } };
                host.localWeatherBuilt = false;
                host.render();
            }, 4000);
            window.addEventListener('pagehide', () => clearTimeout(change), {once:true});
        }
    }
    if (params.get('recipeFixture') === 'example') {
        const { recipes } = await import('/comparison/recipe-fixture.js');
        const originalFetch = window.fetch.bind(window);
        window.fetch = (input, options) => {
            const url = new URL(input instanceof Request ? input.url : String(input), location.href);
            if (url.origin === location.origin && ['/api/recipes', '/api/recipe-upload-history'].includes(url.pathname)) {
                if (options?.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
                return Promise.resolve(new Response(JSON.stringify(url.pathname === '/api/recipes' ? { recipes } : { uploads: [] }), {
                    status: 200, headers: { 'Content-Type': 'application/json' }
                }));
            }
            return originalFetch(input, options);
        };
    }

    if (params.get('reference') === 'overview' && ['robot-overview-docked', 'robot-overview-cleaning', 'robot-overview-paused'].includes(params.get('stage'))) {
        const [{ previewScene }, { TRACKS }] = await Promise.all([
            import('/preview-scenes.js'),
            import('/widget-model.js')
        ]);
        const light = previewScene('light-overview-on').devices.find(device => device.kind === 'light');
        if (light) {
            host.state = {
                ...host.state,
                devices: host.state.devices.map(device => device.kind === 'light' ? light : device),
                music: {
                    ...host.state.music,
                    previewTracks: TRACKS.map(track => track.id === 'heartless'
                        ? { ...track, art: 'review-heartless.jpg' }
                        : track)
                }
            };
            host.render();
        }
    }

    // The combined comparison fixture has known local artwork in both columns.
    // Explicit missing-art scenarios keep their native fallback.
    if (params.get('stage') === 'activities-combined') {
        const { TRACKS } = await import('/widget-model.js');
        host.state = {...host.state, music: {...host.state.music,
            previewTracks: TRACKS.map(track => track.id === 'heartless'
                ? {...track, art: 'review-heartless.jpg'} : track)}};
        host.render();
    }

    if (document.documentElement.dataset.design === 'candidate') {
        const desktop = matchMedia('(min-width: 760px) and (min-height: 700px)');
        const alignOverview = host.alignOverview.bind(host);
        const music = document.getElementById('home-music');
        const originalMusicSize = music?.getAttribute('data-overview-size');
        host.alignOverview = () => {
            if (host.hasAttribute('data-library-widget-sizes')) { alignOverview(); return; }
            if (!desktop.matches) {
                alignOverview();
                if (originalMusicSize === null) music?.removeAttribute('data-overview-size');
                else if (music) music.dataset.overviewSize = originalMusicSize;
                return;
            }
            // The candidate's fixed composition owns this one ordering pass.
            // Running the activity sort first would move these same nodes twice.
            const playerOffset = 'var(--pv-player-inset)';
            if (host.style.getPropertyValue('--active-player-offset') !== playerOffset)
                host.style.setProperty('--active-player-offset', playerOffset);
            for (const id of ['home-music', 'home-radio']) {
                const node = document.getElementById(id);
                if (node && !node.dataset.kitSize && node.dataset.overviewSize !== 's') node.dataset.overviewSize = 's';
            }
            const overview = document.getElementById('now-view');
            if (!overview || overview.hidden) return;
            const selectors = ['#home-weather', '.resource-card[data-kind="vacuum"]',
                '.resource-card[data-kind="light"]', '#home-vehicle', '#home-music',
                '#home-radio', '#home-recipes', '#timer-card'];
            const nodes = selectors.map(selector => overview.querySelector(selector)).filter(Boolean);
            const active = document.activeElement;
            const feed = host.querySelector('.responses');
            const scrollTop = feed?.scrollTop;
            let cursor = overview.firstChild;
            for (const [index, node] of nodes.entries()) {
                const rank = String(index);
                if (node.style.order !== rank) node.style.order = rank;
                if (node.dataset.overviewRank !== rank) node.dataset.overviewRank = rank;
                if (node === cursor) { cursor = node.nextSibling; continue; }
                if (overview.moveBefore) overview.moveBefore(node, cursor);
                else overview.insertBefore(node, cursor);
            }
            if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
            if (feed && feed.scrollTop !== scrollTop) feed.scrollTop = scrollTop;
        };
        const updateComposition = () => { host.render(); };
        updateComposition();
        desktop.addEventListener('change', updateComposition);
        const sourceTopbar = host.renderTopbar.bind(host);
        host.renderTopbar = (...args) => {
            const result = sourceTopbar(...args);
            if (host.state.focus === 'recipes' && !document.querySelector('#history')?.open) {
                host.renderHeaderTitle?.('Opskrifter', true);
            }
            return result;
        };
        const sourceRender = host.render.bind(host);
        host.render = (...args) => {
            const result = sourceRender(...args);
            const batteryLabel = document.querySelector('#home-vehicle > span > .resource-value');
            const percent = batteryLabel?.textContent?.match(/^(\d+)\s*%$/);
            if (percent && !batteryLabel.querySelector('.claude-unit')) {
                const unit = document.createElement('span');
                unit.className = 'claude-unit'; unit.textContent = ' %';
                batteryLabel.replaceChildren(document.createTextNode(percent[1]), unit);
            }
            const musicLabel = document.querySelector('#home-music')?.querySelector(':scope > span > strong');
            if (musicLabel && musicLabel.textContent !== 'Find musik') musicLabel.textContent = 'Find musik';
            return result;
        };
        host.render();
        window.addEventListener('pagehide', () => desktop.removeEventListener('change', updateComposition), { once: true });
    }

    if (document.documentElement.dataset.design === 'candidate') {
        const { installLightMaterial } = await import('/comparison/light-material.js');
        installLightMaterial(host);
        const { installNavigationScroll } = await import('/comparison/navigation-scroll.js');
        installNavigationScroll(host);
        const { installRobotMaterial } = await import('/comparison/robot-material-motion.js');
        installRobotMaterial(host);
        const { installVehicleMaterial } = await import('/comparison/vehicle-material-motion.js');
        installVehicleMaterial(host);
        const { installRecipeIdentity } = await import('/comparison/recipe-identity.js');
        installRecipeIdentity(host);
    }

    const opener = params.get('open');
    if (!previewOpeners.has(opener)) return;
    const target = document.querySelector(opener);
    const destination = previewOpeners.get(opener);
    const view = destination ? document.querySelector(destination) : null;
    if (view?.open || target?.parentElement.open) return;
    if (target?.getClientRects().length) target.click();
}, { once: true });
