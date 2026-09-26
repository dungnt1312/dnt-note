// Generates a minimal 32x32 32bpp ICO (blue rounded square + white note fold).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons/icon.ico");
mkdirSync(dirname(out), { recursive: true });

const W = 32, H = 32;
const xor = Buffer.alloc(W * H * 4);
const andMask = Buffer.alloc(W * Math.ceil(W / 8) * H); // 32 bits per row, all opaque

function insideRounded(x, y, r) {
  const cx = Math.min(Math.max(x, r), W - 1 - r);
  const cy = Math.min(Math.max(y, r), H - 1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = ((H - 1 - y) * W + x) * 4; // BMP rows are bottom-up
    if (!insideRounded(x, y, 6)) {
      xor[i + 3] = 0; // transparent
      continue;
    }
    const t = y / (H - 1);
    xor[i + 0] = Math.round(235 - t * 60); // B
    xor[i + 1] = Math.round(99 - t * 20);  // G
    xor[i + 2] = Math.round(37 + t * 30);  // R
    xor[i + 3] = 255;
    // white "note line" stripes
    if ((y === 10 || y === 15 || y === 20) && x >= 8 && x <= 24) {
      xor[i + 0] = 255; xor[i + 1] = 255; xor[i + 2] = 255;
    }
  }
}

const header = Buffer.alloc(40);
header.writeUInt32LE(40, 0);       // biSize
header.writeInt32LE(W, 4);         // width
header.writeInt32LE(H * 2, 8);     // height (XOR + AND)
header.writeUInt16LE(1, 12);       // planes
header.writeUInt16LE(32, 14);      // bit count

const image = Buffer.concat([header, xor, andMask]);
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(1, 4); // count

const entry = Buffer.alloc(16);
entry[0] = W; entry[1] = H;
entry.writeUInt16LE(1, 4);          // planes
entry.writeUInt16LE(32, 6);         // bit count
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(22, 12);        // data offset

writeFileSync(out, Buffer.concat([dir, entry, image]));
console.log("wrote", out);
