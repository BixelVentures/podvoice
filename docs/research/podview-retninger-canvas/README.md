# PodView Retninger · design-lærred (kopi)

Kopi af claude.ai Design-lærredet "PodView Retninger"
(https://claude.ai/artifact/VE61waWj5UEaixa3wMLJ7t), version 88, 10. nov. 2026.

Kun designforslag. Ingen produktkode er ændret, og intet her er signed off.
Filerne er `.dc.html`-tavler (design canvas) og `canvas.json` (layout).
Billeder refereres som `/_blob/<id>` i artefaktets asset-lager og vises ikke lokalt.

## Designsystem / UI-kit (én kilde)

Siden **UI-kit og principper** på lærredet er designsystemet. Alle skærme er bygget af de samme komponenter;
ingen side har lokale knapper, beskeder eller widgets.

| Komponent | Fil | Bruges på |
|---|---|---|
| Tokens, typografi, trykflader, regler | `K-Kit.dc.html` | alt |
| Knap (6 varianter, 56/44) og kontakt | `K-Btn`, `K-Switch` · tavle `Kit-Knapper` | alle sider |
| Beskedlinje (fuld 72 / kompakt 40) og friskhed | `K-Notice`, `K-Fresh` · tavle `Kit-Beskeder` | Robot, Tesla, Vejr, Lys, Musik, Radio |
| Handlingsflade (calm/attention/busy/done/error) | `K-ActionTile` · tavle `Kit-Handlingsflader` | Tesla-adgang |
| Widget (S/M/L, alle domæner) | `K-Widget` · tavle `Kit-Widgets` | Overblik, Foto-Ro |
| Topbar (timerchip, rødt domænemærke) | `A-Topbar` · tavle `Kit-Topbar` | alle sider |
| Afspiller | `A-Player` | alle sider med afspiller |

Regler: hybridbesked (beskeden står hvor årsagen er og flytter aldrig noget under fingeren; intet skift
inden 500 ms efter tryk), faste tekstlinjer, tilstandsdomæner farvede / indgange hvide / timer mørk,
højst to hero-knapper (primær + »Mere ▾«).

Hvorfor det mindsker funktionsfejl: når produktet skiftes til det nye UI, ændres én komponent ad gangen
(spor B i `CODEX-PLAN.md`), og alle sider følger med. Ingen side skal omskrives, og handlinger/kommandoer
røres ikke — kun komponentens CSS/markup.

Siderne: **Skærme** (én række pr. domæne: widgets først, derefter siden og dens tilstande) og **Arkiv**
(tidligere retninger og fravalgte forslag, kun til reference).
