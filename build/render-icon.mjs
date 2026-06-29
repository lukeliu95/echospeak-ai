// Render build/icon.svg -> build/icon.png (1024x1024) via @resvg/resvg-js.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, 'icon.svg'), 'utf8');
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } });
const png = resvg.render().asPng();
writeFileSync(join(here, 'icon.png'), png);
console.log(`icon.png written: ${png.length} bytes`);
