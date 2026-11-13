# UX & IA principles for a shared, wall-mounted family display (ambient + touch + voice)

Scope: evidence-based principles, with numbers where they exist, for a 9.5/10 family wall dashboard (overview, photo/ambient, weather, vacuum, lights, Tesla, music/radio, recipes/timers, voice-answer cards). Research date 2026-11-13. Publication years are given where known.

## 1. At-distance legibility (viewing distance, type size, contrast)

### Takeaway
Use two reading tiers, the way Amazon does for Echo Show. The glance tier (clock, temperature, timer, now-playing title, the single alert) has to read at about 3 m. The interaction tier (everything else) has to read at arm's length, about 1 m. Contrast should be at least 4.5:1. No official font-size spec exists for smart displays, so the sizes below come from signage standards and need a real test on the iPad.

### Cited findings
- Amazon's current Alexa multimodal guidance (Alexa Haus / Alexa+ visual foundations, about 2024–25):
  - Check that the most important on-screen information is readable at 10 ft (about 3 m) and everything else at 3 ft / arm's length (about 1 m).
  - Foreground/background contrast must be at least 4.5:1.
  - Sources: [Alexa Haus multimodal intro](https://developer.amazon.com/en-US/alexa/alexa-haus/multimodal-introduction), [Alexa+ Visual Foundations](https://developer.amazon.com/en-US/docs/alexaplus/add-ons/mcp-addon-visual-foundations.html)
- Older Alexa guidance (about 2017–18) used shorter distances: about 7 ft for Echo Show and 5 ft for Echo Spot. — [Building for Echo Show/Spot VUI+GUI](https://developer.amazon.com/blogs/alexa/post/05a2ea89-2118-4dcb-a8df-af3d8ac623a8/building-for-echo-show-and-echo-spot-vui-gui-best-practices), [Multimodal Display Guide](https://www.developer.amazon.com/docs/alexa-voice-service/ux-design-display.html)
- 2010 ADA Standards, Table 703.5.5, visual character height for signs with baseline 40–70 in. above the floor:
  - Minimum cap height (uppercase "I") is 5/8 in. (16 mm) for viewing distances under 6 ft (1.83 m), plus 1/8 in. (3.2 mm) for each additional foot.
  - Stroke width must be 10–30% of character height, and character width 55–110% of height.
  - Source: [Corada ADAAG summary](https://www.corada.com/documents/2019CBCPG/11b-703-5-visual-characters); [JP+ sign legibility](https://jpplus.com/i-can-see-clearly-now-sign-legibility)
- Signage rules of thumb (secondary sources):
  - About 1 in. of character height per 10 ft of distance (conservative).
  - SEGD: about 1 in. of cap height per 25 ft (best-case).
  - Source: [JP+ sign legibility](https://jpplus.com/i-can-see-clearly-now-sign-legibility)
- DOJ technical assistance: signs are more legible for low-vision readers when character/background contrast is about 70% or more. — [DOJ TA (justice.gov)](https://www.justice.gov/crt/foia/readingroom/frequent_requests/ada_tal/tal044.txt)
- Google Nest Hub, as reported by press (2019):
  - It uses ultrasound proximity sensing to show glanceable, larger, less dense content from a distance, and switches to more detail when someone approaches. Simply scaling the font up was judged not enough; density has to change too.
  - Sources: [Android Police](https://www.androidpolice.com/2019/12/05/your-nest-hub-will-show-your-info-more-proactively-thanks-to-ultrasound-sensing/), [Google support: Ultrasound sensing](https://support.google.com/googlenest/answer/9509981)
- An informal (non-peer-reviewed) case study found Home Hub text hard to read beyond about 5 ft and suggested about 50 pt for 20 ft. — [UX Planet case study](https://uxplanet.org/google-home-hub-redesign-concept-a-ux-case-study-7af6beda0c3d)

### Inferences
- Applying the ADA formula:
  - At 3 m (9.8 ft) the formula gives about 1.1 in. (28 mm) cap height. On an iPad at about 132 CSS px/in (0.19 mm per CSS px), that is roughly 145 CSS px of cap height, which means a font-size around 200 px. This low-vision-safe ceiling is realistic only for the clock and the hero numeral.
  - At 1.8 m it gives 16 mm, about 85 px cap height.
- A practical scale to validate on the device:
  - Hero numerals: 120–200 px.
  - Glance labels (temperature, timer, track title): ≥ 48–64 px.
  - Arm's-length body text: ≥ 20–24 px.
  - Nothing important below 17 px.
- Proximity-driven density, as on Nest Hub, is the established pattern: fewer and bigger items when nobody is close, more detail on approach or touch.
- Prefer tabular (monospaced) numerals and medium-to-bold weights for numbers read at a distance. ADA's stroke-width rule means thin weights fail at distance.

### Gaps
- I found no peer-reviewed study that gives x-height or degree-of-visual-angle thresholds specifically for home wall displays. The signage numbers are proxies.
- I found no official Google or Apple size spec for smart displays.

## 2. Touch targets for mixed users and wall ergonomics

### Takeaway
Treat WCAG's 24 px and Apple's 44 pt as floors, not targets. Because children and elderly users share the device, primary controls should be about 2 cm × 2 cm or larger (roughly 96–110 CSS px on iPad), with generous spacing. The interactive zone of the display should sit within about 38–122 cm (15–48 in.) from the floor.

### Cited findings
- WCAG 2.2 SC 2.5.8 (AA, 2023):
  - Pointer targets must be at least 24×24 CSS px, or be spaced so that a 24 px circle around each target doesn't touch another.
  - SC 2.5.5 (AAA) requires 44×44.
  - Sources: [W3C What's new in 2.2](https://w3.org/WAI/standards-guidelines/wcag/new-in-22/), [Deque WCAG 2.2](https://dequeuniversity.com/resources/wcag-2.2)
- Platform minimums:
  - Apple HIG: 44×44 pt (about 7 mm). Material: 48×48 dp (about 9 mm), with about 8 dp spacing.
  - Material's automotive "Design for Driving" guidance uses 76×76 dp, a precedent for glance-and-reach contexts.
  - These figures come from secondary summaries: [Tetralogical](https://tetralogical.com/blog/2022/12/20/foundations-target-size/), [specification.website](https://specification.website/spec/accessibility/touch-target-size/)
- NN/g, citing Parhi, Karlson & Bederson (2006): 1 cm × 1 cm is the minimum for quick, accurate adult touch, and "merely the minimum". — [NN/g Touch Target Size](https://www.nngroup.com/articles/touch-target-size/)
- NN/g recommends at least 2 cm × 2 cm targets for young children. — [NN/g Children's UX: physical development](https://www.nngroup.com/articles/children-ux-physical-development/)
- Brown & Anthony (CHI 2012 EA): in a tablet task, children missed the target 46% of the time versus 32% for adults, with misses concentrated on small targets. — [Brown & Anthony 2012](https://lisa-anthony.com/wp-content/uploads/2012/03/brown-and-anthony-chi2012eist.pdf), [Anthony et al. 2013](https://lisa-anthony.com/wp-content/uploads/2013/04/anthony-et-al-jpuc2013.pdf)
- Older adults show longer selection times and higher error rates on touch input than younger adults. — [Maynooth target spacing study](https://mural.maynoothuniversity.ie/6045/1/PS-Target-Spacing.pdf) (findings seen only via snippet)
- 2010 ADA / US Access Board:
  - Unobstructed forward reach is 15–48 in. (38–122 cm) above the floor.
  - Wall-mounted objects may protrude no more than 4 in. (10 cm) between 27 and 80 in.
  - Source: [Access Board guide, Ch. 3 Operable Parts](https://www.access-board.gov/ada/guides/chapter-3-operable-parts/)

### Inferences
- The iPad is the main constraint. A wall-mounted iPad mounted around eye height (about 140–150 cm center) puts the top controls above 122 cm, out of reach for small children and wheelchair users. Place primary touch controls (play/pause, light toggles, timer stop) in the lower half of the screen.
- Make the timer/alarm "Stop" control the biggest target on screen (≥ 2 cm, ideally full-card tap). Children and guests hit it under stress.
- Keep ≥ 8 px gaps between targets, and avoid placing adjacent destructive and benign actions next to each other.

### Gaps
- I didn't retrieve a validated mounting-height standard for home tablets. Typical vendor advice (eye-height, about 150 cm) is not evidence-based.
- I found no study of standing touch at arm's length on vertical wall tablets for children or the elderly.

## 3. Information architecture for multi-domain home control

### Takeaway
Families use shared kitchen displays mainly for awareness, not for deep task work. The home screen should therefore be a glanceable overview with one tap down to each domain (shallow, two levels at most). Persistent elements should be limited to time, active timers/alerts and now-playing.

### Cited findings
- LINC field trials (Neustaedter & Brush, CHI 2006; GI 2007):
  - The family calendar in the kitchen functioned more as an awareness tool than a coordination tool.
  - A month-long trial with 4 families showed it fit existing routines without disrupting social practice.
  - Its background could be any family photo, an early blend of photo frame and information.
  - Sources: [LINC field trial (GI 2007)](https://grouplab.cpsc.ucalgary.ca/grouplab/uploads/Publications/Publications/2007-LinkFieldTrial.GI.pdf), [MSR: LINC-ing the family](https://www.microsoft.com/en-us/research/?p=151951), [Domestic displays workshop 2008](https://grouplab.cpsc.ucalgary.ca/grouplab/uploads/Publications/Publications/2008-ReflectingDomesticDisplays.CHIWorkshop.pdf)
- Mankoff et al. (CHI 2003) list three relevant ambient heuristics:
  - "Sufficient information design": convey just enough, since too much cramps the display.
  - "Easy transition to more in-depth information": if the display has multi-level information, getting to the detail must be easy and quick.
  - "Useful and relevant information" for the setting.
  - Source: [Mankoff et al. 2003 PDF](https://cs4760.csl.mtu.edu/resources/HE2.pdf)
- Calm technology (Weiser & Brown 1995; Case 2015) says technology should use the periphery, take the smallest possible amount of attention, and be the minimum needed. — [Wikipedia: Calm technology](https://en.wikipedia.org/wiki/Calm_technology), [Case principles](https://www.caseorganic.com/post/principles-of-calm-technology)

### Inferences
- Choose function-first top-level IA (Music, Lights, Vacuum, Car, Recipes/Timers, Weather), around 5–7 items, with rooms as a filter inside Lights rather than as the top level. On a single-household kitchen display, people ask "is the vacuum done?" more than "what's in the living room?". This is an inference; I found no comparative study of room-first vs function-first IA for home dashboards.
- The overview should show state, not controls: one status line per domain (vacuum: docked; car: 78%, locked; lights: 3 on). Tapping a tile opens the detail view, which matches the "easy transition" heuristic.
- Persistent layer:
  - Clock, at glance tier.
  - Active timers, visible from every screen and never hidden.
  - Now-playing mini-player.
  - One alert slot.
- Everything else is reachable in at most 2 taps or by voice.

### Gaps
- I found no quantitative study on the optimal number of top-level items for home dashboards.
- I found no comparative study of room-first vs function-first vs activity-first IA.

## 4. Attention and notification models

### Takeaway
Classify every event by the interruption, reaction and comprehension it requires (McCrickard's IRC model). Map those classes to a small set of priority levels (ambient → glance badge → banner → full takeover, the last only for alarms and timers firing). Transitions should be slow fades, not blinking.

### Cited findings
- McCrickard & Chewar (CACM 2003; TOCHI 2003):
  - Notification systems are characterized by Interruption, Reaction and Comprehension (IRC).
  - Usability improves when a feature's actual IRC matches its intended IRC.
  - Sources: [McCrickard TOCHI 2003](https://www.interruptions.net/literature/McCrickard-TOCHI03.pdf), [CACM 2003](https://people.cs.vt.edu/mccricks/papers/mc-cacm03.pdf)
- A secondary-display animation study (McCrickard et al., 2003) found:
  - Ticker text best supported comprehension.
  - Fading best supported reaction.
  - Slow fade was the best secondary-display animation overall, the least disruptive to the primary task.
  - Source: [McCrickard papers (VT)](https://people.cs.vt.edu/mccricks/papers/CM03b.pdf) (via snippet)
- Mankoff 2003, "Peripherality of display": a display "should be unobtrusive and remain so unless it requires the user's attention". "Visibility of state": transitions between states should be easily perceptible. — [Mankoff et al. 2003](https://cs4760.csl.mtu.edu/resources/HE2.pdf)
- Nest Hub shows pending notifications on the ambient screen only when someone is nearby, as detected by ultrasound. — [Google support](https://support.google.com/googlenest/answer/9509981)

### Inferences
- Proposed four levels:
  - **P0 ambient:** a change in tile state (vacuum finished).
  - **P1 badge/corner dot:** needs eventual attention (car not plugged in at night).
  - **P2 non-modal banner:** occupies a fixed slot and doesn't cover the content or the timer (doorbell, washing machine done).
  - **P3 takeover with sound:** only for user-set timers and alarms, and it must have one huge Stop control.
- Shared-device etiquette:
  - Show the source or owner on now-playing ("Spotify · Mads").
  - Never show personal messages in full.
  - Treat a stranger's tap as permitted for shared controls (lights, music volume) and gated for car or account actions.
  - This is an inference; I found no study covering it.

### Gaps
- I found no family-specific research on whose account or music ownership applies on shared displays. Look at Sonos/Spotify product patterns instead.

## 5. Ambient vs active modes, night mode and motion

### Takeaway
The display should fall back to an ambient photo/clock mode after inactivity. Changes in ambient mode should be slow fades. Honor reduced motion. Any auto-moving content longer than 5 s, such as a photo slideshow with Ken Burns motion, needs a way to pause.

### Cited findings
- WCAG 2.3.3 (AAA): motion triggered by interaction must be disableable unless essential. The CSS `prefers-reduced-motion` media query is a sufficient technique (C39). — [W3C Understanding 2.3.3](https://w3c.github.io/wcag/understanding/animation-from-interactions.html), [W3C C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html)
- WCAG 2.2.2 (A), Pause, Stop, Hide: auto-started moving content lasting more than 5 s alongside other content needs a pause mechanism. I saw this in a secondary summary but not on the W3C page. — [Passiro summary](https://passiro.com/web-accessibility/designers/animation-motion)
- Mankoff 2003:
  - "Aesthetic and pleasing design": the display should be pleasing in its setting.
  - "Match between design and environment": you should notice an ambient display because the data changed, not because its design clashes with the room.
  - Source: [Mankoff et al. 2003](https://cs4760.csl.mtu.edu/resources/HE2.pdf)
- McCrickard: slow fade was the least disruptive secondary-display transition. — [VT paper](https://people.cs.vt.edu/mccricks/papers/CM03b.pdf)

### Inferences
- Idle timeout from active to ambient: 30–60 s after the last touch, but never while a timer, answer card or alert is active. This is a design choice, not from a source.
- Night mode: dim, warm, low-luminance clock and essential state only, with photos off. A bright screen in a dark kitchen breaks the "match with environment" heuristic.
- Photo transitions: crossfade around 1 s, image change every 30–60 s. Under reduced motion, drop Ken Burns pans and use plain fades.

### Gaps
- I found no published idle-timeout studies for home displays.

## 6. Voice + visual answer cards

### Takeaway
The screen supports voice; it does not replace it. Show a large glanceable answer card while Alexa or PodVoice speaks. The key fact should be readable at 3 m. The card should not repeat the spoken sentence word for word, and it should stay up long enough for follow-ups.

### Cited findings
- Amazon tips for Echo Show:
  - Design voice-first; visuals complement speech and should not just transcribe it.
  - Make primary content recognizable at a distance.
  - Customers may use screen readers, so the voice response needs an appropriate information hierarchy.
  - Sources: [7 tips for multimodal Echo Show](https://developer.amazon.com/blogs/alexa/post/a7f25291-5418-4488-a6e3-fa531e49545c/7-tips-for-creating-great-multimodal-experiences-for-echo-show), [How to design visual components for voice-first skills](https://developer.amazon.com/blogs/alexa/post/5959e319-1656-40cb-b689-b35c988d6b91/how-to-design-visual-components-for-voice-first-alexa-skills), [Inclusive voice design](https://developer.amazon.com/blogs/alexa/post/3b3aa3c7-a9cd-4b2d-ac3d-473eb6075173/alexa-skills-for-everyone-how-to-design-an-inclusive-voice-experience)
- Alexa Haus says to put the most important info at 10 ft legibility, as in section 1. — [Alexa Haus](https://developer.amazon.com/en-US/alexa/alexa-haus/multimodal-introduction)

### Inferences
- Card anatomy:
  - One hero fact (number or short phrase) at glance tier.
  - One supporting line.
  - Optional 2–3 tappable follow-up chips at arm's-length tier.
  - Source or attribution.
- Keep the card up while speaking plus about 8–15 s, extending while the mic is open for follow-ups. Then fade back to the previous screen.
- The card must not cover running timers or the alert slot.

### Gaps
- I didn't retrieve Google's Conversation Design pages on display surfaces (the Nest/Assistant developer surfaces were largely deprecated). Specific card-duration numbers from Amazon or Google were not found.

## 7. Evaluation: defining "9.5/10"

### Takeaway
Score the display with Mankoff's ambient heuristics plus Nielsen's 10 heuristics for the interactive layer. Use 3–5 evaluators with severity ratings. Mankoff showed the ambient set finds more, and more severe, problems on ambient displays than Nielsen's set does.

### Cited findings
- Mankoff et al. (CHI 2003) final ambient heuristics:
  1. Useful and relevant information
  2. Peripherality of display
  3. Match between design of ambient display and environments
  4. Sufficient information design
  5. Consistent and intuitive mapping
  6. Easy transition to more in-depth information
  7. Visibility of state
  8. Aesthetic and pleasing design
  9. Nielsen's retained heuristics for error prevention, flexibility, user control, etc. (paper Table 1; experts rated relevance 4.2–4.8 of 5).
  - Source: [Mankoff et al. 2003](https://cs4760.csl.mtu.edu/resources/HE2.pdf)
- Results:
  - Evaluators using the ambient heuristics found more severe problems than evaluators using Nielsen's.
  - 3–5 evaluators found 40–60% of known issues.
  - 8 evaluators found about 75% (a follow-up figure from the UW summary).
  - Sources: [Mankoff et al. 2003](https://cs4760.csl.mtu.edu/resources/HE2.pdf), [UW CHiLL lab](https://depts.washington.edu/chilllab/?p=204)
- McCrickard's IRC target values can serve as a benchmark: rate the intended vs observed I/R/C level per notification type. — [TOCHI 2003](https://www.interruptions.net/literature/McCrickard-TOCHI03.pdf)

### Inferences
- Proposed rubric: about 12 criteria, each scored 0–10 by 3–5 raters, where 9.5 means the mean is at least 9.5 and no criterion scores below 8. Hard gates must pass:
  - Glance tier reads at 3 m (Alexa Haus).
  - Contrast is at least 4.5:1.
  - Primary targets are at least 2 cm and in the lower reach zone.
  - The timer is always visible and stoppable in 1 tap.
  - No P0/P1 event covers content.
  - Reduced motion is honored.
  - Each domain is reachable in at most 2 taps.
  - Every state shown traces to real data.
- Add task-based checks with real family members (child, adult, grandparent): "Stop the timer", "Is the car charged?", "Turn off the kitchen lights", "Change radio station". Measure success and time, since heuristics alone find only part of the problems.

### Gaps
- I found no published "score out of 10" standard for ambient displays. The rubric is a proposed construction.
