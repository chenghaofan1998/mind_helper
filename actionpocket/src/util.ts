// 通用小工具：时间、哈希、短 id、slug

import { createHash } from 'crypto';

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 从卡 id 派生稳定短 id：slug-8位哈希 */
export function shortId(seed: string): string {
  return sha256(seed).slice(0, 8);
}

export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'doc';
}

/** 逐文件异步读（兼容普通路径） */
export function readTextFile(path: string): string {
  return require('fs').readFileSync(path, 'utf8');
}
