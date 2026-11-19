// The wall-iPad page. Pre-React stylesheets are resolved for the 1180×820 stage (`?stage`),
// in cascade order; Tailwind and the React screens' styles come last.
import '../../ui/components.css?stage';
import '../../widget-view.css?stage';
import '../../ui/library/library.css?stage';
import '../../frame-layout.css?stage';
import '../../widget-redesign.css?stage';
import '../../timer-notice.css?stage';
import '../../live-music.css?stage';
import '../../ui-kit.css?stage';
import '../styles/app.css';

import '../../ui/stage.js';
// The shell (React): it starts the HA kiosk integration and the host once its nodes are in the page.
import '../shell/boot';
import '../../widget-view.js';
