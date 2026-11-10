// Entry point: the four workflows, in the order they appear.
import { boot } from './shell.js';
import { singleWs } from './ws_single.js';
import { setWs } from './ws_set.js';
import { tolWs } from './ws_tol.js';
import { limitsWs } from './ws_limits.js';

boot([singleWs, setWs, tolWs, limitsWs]);
