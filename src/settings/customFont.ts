// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 移植自 folia-major（AGPL-3.0，https://github.com/chthollyphile/folia-major）
//   src/services/customLyricsFont.ts
// Modified for Aki Music on 2026-10-11:
//   1. 持久化改用本项目已有的 Dexie（utils/db.js 的 customFonts 表），
//      不再依赖 folia 的缓存服务
//   2. 单槽模型不变（同一时间只保留一个上传字体）；文案走本项目 i18n
//   3. 注册用 FontFace + ArrayBuffer —— 不产生任何 URL 请求，
//      因此不受 CSP font-src 限制，也不需要自定义协议
//
// 用法：
//   const stored = await restoreUploadedFont();      // 启动时恢复
//   const { family, label } = await uploadFont(file); // 用户上传
//   await clearUploadedFont();                        // 移除

import { getCustomFont, removeCustomFont, saveCustomFont } from '@/utils/db';
import locale from '@/locale';

const UPLOADED_FONT_FAMILY_PREFIX = 'AkiUploadedLyricsFont';
export const MAX_UPLOADED_FONT_SIZE = 50 * 1024 * 1024;
const SUPPORTED_FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf'];
const SUPPORTED_FONT_MIME_TYPES = new Set([
  'font/woff2',
  'font/woff',
  'font/ttf',
  'font/otf',
  'application/font-woff',
  'application/font-woff2',
  'application/x-font-ttf',
  'application/x-font-otf',
  'application/vnd.ms-opentype',
]);

export interface UploadedFontRecord {
  id: string;
  /** 原始文件名 */
  name: string;
  /** CSS 里的字体族名（注册与引用都用它） */
  family: string;
  /** 展示名（文件名去扩展名） */
  label: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

/** 已注册过的字体 id —— 重复注册会白读一遍 Blob */
const registeredFontIds = new Set<string>();

const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

const stripExtension = (name: string) => {
  const trimmed = name.trim();
  const matched = SUPPORTED_FONT_EXTENSIONS.find(ext =>
    trimmed.toLowerCase().endsWith(ext)
  );
  return matched ? trimmed.slice(0, -matched.length) : trimmed;
};

const buildFamily = (id: string) =>
  `${UPLOADED_FONT_FAMILY_PREFIX}_${sanitizeId(id)}`;

const buildId = (file: File) => {
  const base = stripExtension(file.name)
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${Date.now()}_${base || 'font'}`;
};

export const isSupportedFontFile = (file: File): boolean => {
  const lowerName = file.name.toLowerCase();
  return (
    SUPPORTED_FONT_EXTENSIONS.some(ext => lowerName.endsWith(ext)) ||
    SUPPORTED_FONT_MIME_TYPES.has(file.type)
  );
};

/** @returns 错误文案；null 表示校验通过 */
export const validateFontFile = (file: File): string | null => {
  if (!isSupportedFontFile(file)) {
    return String(locale.t('settings.lyricsFont.unsupportedFormat'));
  }
  if (file.size > MAX_UPLOADED_FONT_SIZE) {
    return String(locale.t('settings.lyricsFont.tooLarge'));
  }
  return null;
};

const buildRecord = (file: File): UploadedFontRecord => {
  const id = buildId(file);
  return {
    id,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
    family: buildFamily(id),
    label: stripExtension(file.name) || 'Uploaded Font',
    createdAt: Date.now(),
  };
};

/**
 * 注册字体到 document.fonts。必须是 Blob → ArrayBuffer：
 * 这样字体的加载路径完全不经过网络，CSP 与跨域都无需考虑。
 */
export const registerUploadedFont = async (
  record: UploadedFontRecord
): Promise<string> => {
  if (registeredFontIds.has(record.id)) {
    return record.family;
  }
  if (typeof FontFace === 'undefined' || !document.fonts?.add) {
    throw new Error('FontFace API unavailable');
  }

  const data = await record.blob.arrayBuffer();
  const fontFace = new FontFace(record.family, data);
  await fontFace.load();
  document.fonts.add(fontFace);
  registeredFontIds.add(record.id);

  return record.family;
};

/** 上传 → 校验 → 注册 → 持久化（旧的会清掉，保持单槽） */
export const uploadFont = async (
  file: File
): Promise<{ family: string; label: string }> => {
  const error = validateFontFile(file);
  if (error) {
    throw new Error(error);
  }

  const record = buildRecord(file);
  const family = await registerUploadedFont(record);

  // 单槽：先按 id 清掉历史记录，再写入新的
  await removeCustomFont();
  await saveCustomFont(record);

  return { family, label: record.label };
};

/** 启动时恢复：库里还有上传字体就重新注册，返回可用的字体信息 */
export const restoreUploadedFont = async (): Promise<{
  family: string;
  label: string;
} | null> => {
  try {
    const record = (await getCustomFont()) as UploadedFontRecord | undefined;
    if (!record?.id || !record.family || !(record.blob instanceof Blob)) {
      return null;
    }
    const family = await registerUploadedFont(record);
    return { family, label: record.label };
  } catch (error) {
    // 恢复失败不影响启动，歌词回落到默认字体
    console.warn('[fonts] 恢复上传字体失败', error);
    return null;
  }
};

export const clearUploadedFont = async (id?: string): Promise<void> => {
  if (id) {
    registeredFontIds.delete(id);
  } else {
    registeredFontIds.clear();
  }
  await removeCustomFont(id);
};

export const isUploadedFontRegistered = (id: string) =>
  registeredFontIds.has(id);
