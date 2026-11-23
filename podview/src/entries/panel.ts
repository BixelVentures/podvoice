// The Home Assistant panel (custom_components/podvoice/frontend/podview-panel.js, registered by panel.py). Same
// stylesheets, in the same order, as the wall page, then the panel's own; the stage (1180×820, uniform scale) and
// the frame meter install on import.
import '../../ui/components.css?stage';
import '../../widget-view.css?stage';
import '../../ui/library/library.css?stage';
import '../../frame-layout.css?stage';
import '../../widget-redesign.css?stage';
import '../../timer-notice.css?stage';
import '../../live-music.css?stage';
import '../../ui-kit.css?stage';
import '../styles/app.css';
import '../panel/panel.css';

import '../../ui/stage.js';
import {installPanelDocument} from '../panel/document';
import {definePanel} from '../panel/element';

installPanelDocument(import.meta.url);
definePanel();
