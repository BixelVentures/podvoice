# Apple home-control and ambient UI as references for PodView (as of 13 Nov 2026)

Scope note: this was a lightweight pass (about 10 tool calls). Apple HIG pages are rendered client-side and could not be fetched directly, so most HIG specifics below come from secondary sources and are marked as such. Treat this file as a starting point, not an exhaustive audit.

## 1. Apple Home app (iPadOS 18/26) and the Apple home hub (HomeView)

### Takeaway
Apple's own wall/counter dashboard, **HomeView**, is now real. It was announced 13 Oct 2026 at $299 and ships around 12–13 Nov 2026 with a 7" square 1088×1088 display. It is built around swappable full-screen "faces" (Photos, Weather, Calendar, Home Modular, Home Camera…) and per-person recognition, not a dense tile grid. The Home app's tile and category model is mostly from iOS 16 (2022). I found no evidence of a Home tile redesign in iPadOS 26 beyond Liquid Glass styling.

### Cited Findings
- Apple Newsroom press release dated 13 Oct 2026: "Meet Apple HomeView, a new way to enjoy entertainment, stay connected, and manage the home". I saw only the headline, not the body — [Apple Newsroom](https://apple.com/newsroom/2026/10/meet-apple-homeview-a-new-way-to-enjoy-entertainment-and-manage-the-home)
- HomeView costs $299, with pre-orders from 13 Oct and retail availability on 13 Nov 2026 — [ABC13](https://abc13.com/story/what-know-new-apple-homeview-smart-home-display-hub/19937996/); [Tech Insider](https://tech-insider.org/?p=33279); [OSXDaily](https://osxdaily.com/2026/10/13/apple-release-new-homeview-device-updated-apple-tv-homepod-mini/)
- Display: 7" square Liquid Retina LCD, 1088×1088 at 220 ppi, 500 nits max and 0.3 nits min (reported as the lowest of any Apple display). It comes as a tabletop model with a speaker base or a wall-mount model with a mount sold separately — [MacRumors guide](https://www.macrumors.com/guide/apple-smart-home-display/)
- Watch-style faces: Photos (picture frame), Calendar, Weather, Home, Flow (reacts to movement), Snoopy (changes with time, weather, sports and holidays), **Home Modular** (thermostat, lights, scenes, video) and **Home Camera** (up to 9 live feeds). Some faces change through the day — [MacRumors guide](https://www.macrumors.com/guide/apple-smart-home-display/)
- Apple says some features show more information as you get closer (proximity-adaptive detail). I found no specifics — [MacRumors guide](https://www.macrumors.com/guide/apple-smart-home-display/)
- No App Store. Built-in apps include Music, Calendar, FaceTime, Home, Safari and Messages. Live Activities such as timers are supported. Siri opens by voice or by swiping down from the top edge. English only at launch and not launching in the EU. Requires iOS/iPadOS 27.2 — [MacRumors guide](https://www.macrumors.com/guide/apple-smart-home-display/)
- Recognises up to 6 household members by face (and voice per MacRumors). The Home Screen, apps and widgets adapt to whoever is using it, personal content stays hidden from others, and photos and music can be shared with guests — [Macworld](https://www.macworld.com/article/3259547/apples-completely-personal-homeview-smart-home-hub-is-built-for-sharing.html); [GVWire](https://gvwire.com/2026/10/13/apple-unveils-homeview-a-299-tablet-for-the-home/)
- Household notifications: camera recognition of people, familiar faces, pets, packages and vehicles (needs iCloud+), plus smoke/CO alarm sound detection — [Macworld](https://www.macworld.com/article/3259547/apples-completely-personal-homeview-smart-home-hub-is-built-for-sharing.html)
- Chip: one source says A18, but a secondary search summary flagged this as not primary-confirmed — [MacRumors guide](https://www.macrumors.com/guide/apple-smart-home-display/)
- Older history: the hub was rumoured for 2025, then spring 2026, then slipped — [MacRumors, Mar 2026](https://www.macrumors.com/2026/03/06/homepad-now-rumored-to-launch-even-later/)
- Home app tiles (iOS/iPadOS 16, 2022, still the basis): small rectangular tiles plus larger landscape rectangles. Tapping a category chip (Climate, Lights, Security…) blurs Home and overlays that category's accessories grouped by room — [MacStories iOS 16 Home](https://www.macstories.net/stories/everything-new-coming-to-the-home-app-in-ios-16-and-macos-ventura/)
- iOS 18 (2024): the Energy tab gained utility-data graphs and peak/off-peak breakdown (PG&E only). The "Preferred Home Hub" is now selectable, and iPads no longer serve as home hubs under the new architecture — [MacRumors iOS 18 HomeKit](https://www.macrumors.com/2024/06/10/ios-18-homekit-features/); [heise](https://heise.de/-9766327)
- June 2026 (iOS 27 cycle): Home is getting AI video descriptions and smarter notifications — [MacRumors](https://www.macrumors.com/2026/06/08/apple-adds-ai-descriptions-and-smarter-notifications-to-home/)

### Inferences
- Apple's 2026 answer to a "family wall screen" is **one face at a time, full-bleed, glanceable**, with control reached through a dedicated Home Modular face. It is not a permanent dense control grid. For PodView on 1180×820 this argues for an ambient-first resting state, with controls promoted on interaction.
- **Proximity-adaptive detail** (less from afar, more up close) and the **0.3-nit floor** show that Apple treats night and distance as first-class states.
- Per-person adaptation is a premium signal, but it needs identity sensing that PodView (a WKWebView kiosk) probably lacks. A borrowable version is "household by default, personal only when asked".
- Home tile convention from iOS 16 onward: tap toggles, while the tile body or a long-press opens detail. I did not verify the latter for iOS 18/26.

### Gaps
- I could not read the full Newsroom text or Apple's HomeView product page, so face layouts, type sizes, the Now Playing UI and night behaviour on HomeView are unknown.
- I found no source on an iPadOS 26 Home app layout change, and no Home long-press semantics for iOS 18/26.
- I found no hands-on HomeView reviews (it ships today).

## 2. StandBy and ambient/always-on modes

### Takeaway
StandBy (iOS 17+, 2023) is Apple's canonical "glance from across the room" pattern: landscape, huge clock or widgets, and photos. It automatically dims and turns red in a dark room (Night Mode). Always-On works only on Pro/AOD hardware, and Sleep Focus turns the display off by default.

### Cited Findings
- Night Mode dims the display and tints everything red when the room is dark. It can be turned off under Settings > StandBy > Display > Night Mode — [MacRumors how-to](https://www.macrumors.com/how-to/disable-red-tint-ios-standby-mode); [MacRumors StandBy](https://www.macrumors.com/how-to/use-standby-mode-iphone/)
- Night Mode only works when "Turn Display Off" is set to Automatically or After 20 Seconds. Setting it to Never disables Night Mode — [iPhoneLife](https://iphonelife.com/content/how-to-use-standby-mode)
- Continuous always-on StandBy is limited to Pro models with an AOD panel, and other models wake on tap. Sleep Focus disables AOD by default — [iPhoneLife](https://iphonelife.com/content/how-to-use-standby-mode-different-focus-modes)
- Users report always-on behaviour as erratic (forum anecdote, low weight) — [MacRumors forums](https://forums.macrumors.com/threads/standby-mode-weirdness.2404108)
- WidgetKit exposes `isLuminanceReduced` and `widgetRenderingMode` (full colour, accented, vibrant) so that widgets restyle themselves for AOD, StandBy and tinted contexts. This came from a fetch-tool summary of Apple docs rather than the rendered page — [Apple Developer: Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets)

### Inferences
- PodView can borrow the principles without copying the look: (a) an ambient landscape state with one dominant element (time or now-playing), (b) an automatic night state that sharply cuts luminance and saturation (red/amber monochrome) on an ambient-light or time-based trigger, and (c) a "reduced luminance" variant of every card rather than a separate night layout.
- iPad has no StandBy (I found no evidence of one). PodView has to implement its own ambient/night state in the web layer, for example with a time schedule plus Fully Kiosk or HA light sensor data.

### Gaps
- StandBy layout metrics (clock size, widget-stack dimensions) were not sourced.

## 3. Media control: Now Playing, AirPlay picker, multi-room

### Takeaway
I did not research this to citable depth in this pass. The only relevant sourced item is iOS 18's Control Center redesign, which added Home controls and resizable control pages.

### Cited Findings
- iOS 18 redesigned Control Center into multiple pages with resizable controls, including Home and media controls — [MacStories iOS 18 review, Control Center](https://www.macstories.net/stories/ios-and-ipados-18-the-macstories-review/4/)

### Inferences
- (Unsourced, from general knowledge, so verify before use) Apple's AirPlay picker lists speakers with checkboxes for multi-room, shows per-speaker volume sliders, and puts the Now Playing artwork plus a single transport row on top.

### Gaps
- I have no sourced details on the AirPlay picker, the multi-room UI, or the "another household member is playing" takeover behaviour on HomePod or Apple TV. This needs a dedicated pass (support.apple.com articles on HomePod multiuser and AirPlay).

## 4. Apple HIG for iPadOS: targets, type, Liquid Glass, motion, widgets

### Takeaway
The firm number is a **44×44 pt minimum hit area**, which can extend beyond the visible glyph. Liquid Glass (iOS/iPadOS 26, Sept 2025) is a translucent material for controls and navigation that sit above content, and guidance warns to reduce transparency over busy backgrounds. Widget guidance stresses one primary fact, short text, and system margins.

### Cited Findings
- Apple's tips page lists a minimum 44pt × 44pt tappable area for controls — [Apple Design Tips](https://developer.apple.com/design/tips)
- The hit area may exceed the visual size, typically through padding — [Deque](https://dequeuniversity.com/rules/attest-ios/1.0/touch-target-size); [Ahmad Shadeed](https://ishadeed.com/article/target-size/)
- Liquid Glass shipped with iOS 26 and iPadOS 26 (Sept 2025) and updates the design of controls, toolbars and navigation — [Apple iPadOS 26 features PDF](https://www.apple.com/sg/os/pdf/All_New_Features_iPadOS_26_Sept_2025.pdf); [MacRumors iPadOS 26](https://www.macrumors.com/roundup/ipados-26)
- Caution with translucency over busy backgrounds. This is a third-party summary, not Apple — [skills summary](https://skillselion.com/skills/alirezarezvani/claude-skills/apple-hig-expert)
- Widget families include `systemExtraLarge` (iPad only) and `accessory*` (Lock Screen/StandBy). Use `containerBackground` and system margins rather than hard-coded padding. Refreshes are budgeted by the system and not real-time — [Apple Developer: Widgets](https://developer.apple.com/design/human-interface-guidelines/widgets) (via a fetch summary)
- Even Apple's own iPadOS 27 UI is reported to fall short of the 44 pt target in places — [Apple Developer Forums](https://developer.apple.com/forums/thread/845804)

### Inferences
- A wall screen is used at arm's length or from across the room, so 44 pt is a floor, not a target. Primary family actions should be much larger (≥ 60–80 pt is my inference, not an Apple number).
- Glass or translucency suits transient overlays such as a player sheet or Siri-like answer card on top of photos. Resting cards over photo backgrounds need a solid or strongly frosted backing for legibility.
- Honour `prefers-reduced-motion` and `prefers-reduced-transparency` in CSS. Safari supports both media queries. This comes from general web knowledge, not sourced here.

### Gaps
- I could not fetch the HIG pages for Typography (Dynamic Type sizes per style), Layout (iPad margins and safe areas), Motion, or the Liquid Glass "Materials" guidance. A next pass should read them through a fetch that renders JavaScript.

## 5. One dominant fact: Weather, Sports, Siri answers

### Takeaway
Apple Sports is a deliberately minimal "quick scoreboard" that pushes one game into a Live Activity. Live Activities are Apple's pattern for "one changing fact persists while you do other things".

### Cited Findings
- Apple Sports added its own Live Activities in v2.0 (Sept 2024) and scheduled Live Activities later, and v4.5 (Oct 2026) shows key stats during breaks — [9to5Mac 2024](https://9to5mac.com/2024/09/16/apple-sports-adds-live-activities-in-ios-18-for-easy-score-tracking/); [9to5Mac Oct 2026](https://9to5mac.com/2026/10/15/apple-sports-update-improves-live-activity-support-adds-soccer-leagues-); [iClarified Feb 2026](https://www.iclarified.com/95857/apple-sports-app-updated-with-key-plays-scheduled-live-activities-more)
- Critics described the early design as a placeholder-like quick scoreboard, and a Live Activity follows one specific game — [Tom's Guide](https://www.tomsguide.com/phones/iphones/i-spent-two-weeks-using-the-apple-sports-app-heres-why-its-not-ready-for-the-big-leagues); [AppleMagazine](https://applemagazine.com/apple-sports-widgets-027g/amp/)

### Inferences
- The borrowable principle for PodView answer cards is one huge value (score, temperature, time) plus one line of context plus an optional secondary row, and one "live" item pinned while it is active.

### Gaps
- I did not source Apple Weather layout specifics (hero temperature size, condition backgrounds) or the Siri snippet layout on iPad.
