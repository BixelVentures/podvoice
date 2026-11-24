// The Home Assistant panel (custom_components/podvoice/frontend/podview-panel.js, loaded by podview-loader.js, which
// panel.py registers): the stylesheet (styles/app.css), the 1180×820 stage, then the element.
import '../styles/app.css';

import {installPanelDocument, runningBundle} from '../panel/document';
import {definePanel} from '../panel/element';
import {installStage} from '../lib/ui/stage';

installStage();
installPanelDocument(import.meta.url);
definePanel('podview-panel', runningBundle(import.meta.url));
