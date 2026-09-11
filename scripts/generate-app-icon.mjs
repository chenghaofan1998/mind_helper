import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";

const width = 32;
const pixels = Buffer.alloc((width * 4 + 1) * width);
const glyphs = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
};
for (let y = 0; y < width; y += 1) {
  const row = y * (width * 4 + 1);
  for (let x = 0; x < width; x += 1) {
    const corner = Math.min(x, y, width - 1 - x, width - 1 - y);
    const inside = corner >= 0 && !((x < 4 || x > 27) && (y < 4 || y > 27) && (x - (x < 4 ? 4 : 27)) ** 2 + (y - (y < 4 ? 4 : 27)) ** 2 > 16);
    const offset = row + 1 + x * 4;
    pixels.set(inside ? [24, 58, 50, 255] : [0, 0, 0, 0], offset);
  }
}
for (const [letter, startX] of [["A", 5], ["P", 18]]) {
  glyphs[letter].forEach((line, y) => [...line].forEach((bit, x) => {
    if (bit === "1") for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
      const offset = (8 + y * 2 + dy) * (width * 4 + 1) + 1 + (startX + x * 2 + dx) * 4;
      pixels.set([255, 255, 255, 255], offset);
    }
  }));
}
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(width, 4); header.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
const output = resolve("icons/action-pocket.png");
await mkdir(resolve("icons"), { recursive: true });
await writeFile(output, png);
console.log(output);
