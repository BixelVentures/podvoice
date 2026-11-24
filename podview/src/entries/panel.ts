// The Home Assistant panel (custom_components/podvoice/frontend/podview-panel.js, loaded by podview-loader.js, which
// panel.py registers): the kit's stylesheet, Tailwind and the panel's own, the 1180×820 stage, then the element.
import '../styles/motion-tokens.css';
import '../styles/kit.css';
import '../styles/app.css';
import '../panel/panel.css';

import {installPanelDocument, runningBundle} from '../panel/document';
import {definePanel} from '../panel/element';
import {installStage} from '../lib/ui/stage';

installStage();
installPanelDocument(import.meta.url);
definePanel('podview-panel', runningBundle(import.meta.url));
