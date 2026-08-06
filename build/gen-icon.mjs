// Rasterize the ZnxStudio brand mark (build/icon.svg) into the platform icons
// electron-builder expects: build/icon.ico (Windows), build/icon.png (Linux + the
// source macOS uses to derive icon.icns). Run: `node build/gen-icon.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const buildDir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(buildDir, 'icon.svg'));

// Windows .ico carries several sizes so the shell can pick the right one
// (taskbar, alt-tab, large icons view). 256 is the max a .ico stores.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

const png = async (size) =>
  sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain' }).png().toBuffer();

const icoPngs = await Promise.all(icoSizes.map(png));
writeFileSync(join(buildDir, 'icon.ico'), await pngToIco(icoPngs));

// A single 512×512 PNG is the Linux icon and macOS icns source.
writeFileSync(join(buildDir, 'icon.png'), await png(512));

console.log(`icon.ico (${icoSizes.join(',')}) + icon.png (512) written to build/`);
