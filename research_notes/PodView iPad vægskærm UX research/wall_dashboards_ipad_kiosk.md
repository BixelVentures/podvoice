# Wall-mounted home dashboards and iPad kiosk practicalities (as of Nov 2026)

Scope note: a short pass (about 9 searches, no full-page fetches). Findings come from search-result summaries, so verify anything load-bearing against the linked primary source.

## What do the best dedicated wall/family displays and dashboard tools do?

### Takeaway
Home Assistant's own direction since 2024 has been a Sections grid of Tile cards plus a row of badges, with one clear primary action per card. Family-calendar displays (Hearth, Skylight) win on glanceable schedules and kids' routines, and reviewers rank ease of use above how customizable they are. DAKboard is the "bring your own screen, customize everything" option.

### Cited Findings
- HA Sections view arrived as an experiment in 2024.3 and became the default for new views in 2024.11 — [tink.de](https://www.tink.de/blog/home-assistant-dashboard-erstellen/); [HA docs: Sections](https://home-assistant.io/dashboards/sections/); [Dashboard chapter 1](https://home-assistant.io/blog/2024/03/04/dashboard-chapter-1)
- HA design principle: "Each card used for controls should have a clear primary action." — [HA blog, Dashboard chapter 2](https://www.home-assistant.io/blog/2024/07/26/dashboard-chapter-2/)
- Since 2025.3, Tile cards draw a circular background around icons that perform actions; informational tiles have no circle. 2025.3 also added view headers — [CNX Software](https://www.cnx-software.com/2025/03/07/home-assistant-2025-3-released-with-dashboard-view-headers-tile-card-improvements-better-smartthings-integration/); [Smarthomejunkie](https://www.smarthomejunkie.net/whats-new-in-home-assistant-march-2025-3-release-header-tile-card-enhancements/)
- Badges were redesigned in 2024.8 and work in both Sections and Masonry views; sidebar and panel views don't support them — [HA docs: views](https://www.home-assistant.io/dashboards/views/)
- Community threads in 2025 report rough edges in Sections (badge sizing, column breakpoints) — [HA community tag: sections](https://community.home-assistant.io/tag/sections)
- Skylight Calendar Max: 27", $599.99 plus $79/yr; syncs with Google Calendar; one family emails school newsletters into it — [Blesser House](https://blesserhouse.com/our-family-tried-the-skylight-calendar-heres-what-we-loved-didnt); [Hey Nori 2026 roundup](https://heynori.com/article/family-operations-system/best-digital-smart-family-calendars-with-displays)
- Hearth Display: 27" touchscreen built around kids' routines; reviewers call it faster and more intuitive than Skylight. WeTried.it scored Hearth 10/10 vs Skylight Max 6/10 — [WeTried.it compare](https://wetried.it/compare/skylight-calendar-max-vs-hearth-display/); [The Quality Edit](https://www.thequalityedit.com/articles/hearth-vs-skylight-review)
- DAKboard runs on your own hardware, is highly customizable and needs no subscription (the vendor's own claim). Independent reviewers call it less family-focused and less user-friendly — [DAKboard vs Skylight](https://dakboard.com/c/comparisons/dakboard-vs-skylight/) (vendor marketing); [theme404](https://theme404.com/blog/best-hearth-display-alternatives)
- Wall-panel guides say no single best HA wall-panel solution exists. They recommend permanent USB-C power, and they favor Fully Kiosk Browser on Android — [SONOFF wall-panel guide](https://sonoff.tech/pt-br/blogs/news/home-assistant-wall-panel-guide); [home-assistant-guide.com](https://home-assistant-guide.com/guide/the-best-tablet-to-display-your-home-assistant-dashboard/)

### Inferences
- The common pattern across products: a large clock/date, today's agenda, a few status badges at the top, and big single-action tiles. Rich controls sit one tap deeper.
- Family displays win on low friction for non-technical household members. Customization depth matters less.

### Gaps
- No reliable sources gathered this pass on Samsung Family Hub / SmartThings Station screens, Lenovo/Meta Portal, Brilliant or Josh.ai panel IA, or on Mushroom/Bubble card community conventions.
- Reddit r/homeassistant love/hate threads weren't reviewed. The HA 2026.5 per-section themes are unverified.

## How do you run a web app well on a wall-mounted iPad Air 5 (M1)?

### Takeaway
The cleanest iPad routes are: (1) the HA Companion app's kiosk mode, a Labs feature since 2026.4, which keeps the screen awake, controls brightness and shows a screensaver; (2) a Home Screen web app plus the Screen Wake Lock API, which only works in Home Screen apps since iOS/iPadOS 18.4, with Guided Access set to Display Auto-Lock = Never; (3) a supervised device in Single App Mode, which survives reboots. Battery: the 80% limit setting is documented for M2/M4 iPads, so it may not appear on the Air 5 (M1). Apple reportedly lets kiosk-powered iPads self-limit to about 80% anyway.

### Cited Findings
- HA Companion iOS kiosk mode (Labs, app 2026.4.0+): hides system UI, prevents auto-lock, can take over brightness (manual 0–100%, intended for dark rooms at night) and shows a clock/date screensaver after inactivity — [HA Companion docs: iOS kiosk mode](https://companion.home-assistant.io/docs/integrations/ios-kiosk-mode)
- 2026.7.0 refreshed kiosk mode. 2026.7.2 added the commands `kiosk_set_screensaver_mode` and `kiosk_set_screensaver_brightness`. A "Kiosk Screensaver" binary sensor reports whether the screensaver is showing. Photo/URL screensavers and a day/night brightness schedule are roadmap items, not confirmed shipped — [Notebookcheck](https://www.notebookcheck.net/New-Home-Assistant-app-update-improves-Kiosk-Mode.1354556.0.html); [GitHub discussion #2403](https://github.com/orgs/home-assistant/discussions/2403); [iOS PR #5063](https://github.com/home-assistant/iOS/pull/5063)
- Screen Wake Lock API: Safari has had it since 16.4, but it was broken in Home Screen web apps (WebKit bug 254545) until iOS/iPadOS 18.4. MDN may still show the old limitation, and the fix isn't confirmed in Apple's release notes — [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545); [Progressier](https://progressier.com/pwa-capabilities/screen-wake-lock)
- Safari 26.0: any site can be added to the Home Screen and opens as a web app by default — [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- Web Push for Home Screen web apps has existed since 16.4. Declarative Web Push arrived in iOS/iPadOS 18.4 — [WebKit: Safari 18.4](https://webkit.org/blog/16574/digital-credentials-api/)
- Later releases: Safari 26.1, 26.4 and 26.5 feature posts exist. A WWDC26 session says WebKit keeps updating Anchor Positioning and View Transitions — [Safari 26.1](https://webkit.org/blog/17541/webkit-features-for-safari-26-1/); [Safari 26.4](https://webkit.org/?p=17862); [Safari 26.5](https://webkit.org/?p=17938); [WWDC26 session 204](https://developer.apple.com/videos/play/wwdc2026/204/)
- Guided Access: set Accessibility > Guided Access > Display Auto-Lock = Never to keep the screen on. After a reboot, Guided Access drops back to the Home Screen. Single App Mode needs a supervised device (Apple Configurator/MDM) and relaunches the locked app after a reboot — [Kiosk Group: Guided Access vs Single App Mode](https://support.kioskgroup.com/article/866-guided-access-vs-single-app-mode); [Apple Configurator: Single App Mode features](https://support.apple.com/guide/apple-configurator-mac/single-app-mode-features-cadb1d640325/2.21/mac/15.7)
- Conflicting reports on Auto-Lock under Single App Mode (an iPadOS 15 forum bug; vendors disagree), so test on your own device — [Apple Dev Forums](https://developer.apple.com/forums/thread/695316); [Hexnode](https://www.hexnode.com/blogs/single-app-mode-vs-autonomous-single-app-mode-vs-guided-access-mode-vs-automatic-assessment-configuration/)
- 80% charge limit (Settings > Battery > Battery Health) is documented for iPad Pro M4 and iPad Air M2. It charges to about 80% and resumes at about 75%, with occasional full charges for calibration. Some older models don't show the option — [MacRumors how-to](https://www.macrumors.com/how-to/limit-ipad-pro-air-battery-charge/); [Apple Community: 97% despite limit](https://discussions.apple.com/thread/256220889); [Apple Community: Air 4 missing](https://discussions.apple.com/thread/256224206)
- An Apple Community reply (apparently quoting Apple) says iPads on long-term external power, as in kiosks, may on their own cap charge at about 80%. Third-party charge-limit apps aren't possible on iPadOS — [Apple Community](https://discussions.apple.com/thread/256176443); [MacRumors forum](https://forums.macrumors.com/threads/battery-charge-management-apps-vs-ipad-a-la-al-dente-rest-80.2468395)
- One user reports the 80% limit can drop the USB data connection when it kicks in — [Apple Community](https://discussions.apple.com/thread/256184148)

### Inferences
- For PodView as a web app: request `navigator.wakeLock` and re-request it on `visibilitychange`, and pair it with Guided Access (Auto-Lock Never) as a belt-and-braces setup. The HA Companion kiosk is the zero-code alternative if PodView is reachable as an HA dashboard or panel.
- The iPad Air 5 has a 60 Hz LCD with no OLED burn-in risk. Long-term image retention is minimal, but dimming at night via app-controlled brightness or a dark screensaver is still worthwhile for the room. Note: a web app can't set the hardware brightness, while the HA Companion kiosk can.
- Container queries, `:has()`, `color-mix()` and `dvh` all shipped in Safari before 18 (from training knowledge, not verified in this pass), so they're safe on iPadOS 18/26.

### Gaps
- Not verified this pass: whether the Air 5 (M1) on iPadOS 26 shows the 80% limit option; Fully Kiosk on iOS (believed not to exist); Kiosk Pro specifics; safe-area insets in standalone mode; memory/long-running SPA guidance for WebKit; wall mounts and power hardware; motion/proximity wake (the iPad has no API for this in Safari; it would need an HA motion sensor plus the Companion kiosk commands, which is unverified).
