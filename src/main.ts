/** Application entry. Boots the renderer, the worker and the UI, then hands control to the player. */
import './ui/styles.css';
import { boot } from './app/bootstrap.ts';

void boot();
