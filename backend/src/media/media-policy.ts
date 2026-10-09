import { BadRequestException } from '@nestjs/common';
import type { MediaType } from '@prisma/client';

export interface MediaPolicy {
  maxBytes: number;
  allowedMimeTypes: string[];
  /** Magic-number prefixes used to detect a lying Content-Type. */
  allowedPrefixes: string[];
}

const IMAGES: MediaPolicy = {
  maxBytes: 5 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  allowedPrefixes: ['ffd8ff', '89504e47', '52494646', '00000018', '00000020'],
};

const VIDEOS: MediaPolicy = {
  maxBytes: 100 * 1024 * 1024,
  allowedMimeTypes: ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'],
  allowedPrefixes: ['00000018', '00000020', '1a45dfa3', '464c56'],
};

const AUDIO: MediaPolicy = {
  maxBytes: 25 * 1024 * 1024,
  allowedMimeTypes: [
    'audio/mpeg',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/opus',
    'audio/webm',
    'audio/3gpp',
    'audio/amr',
    'audio/wav',
  ],
  allowedPrefixes: ['494433', 'fffb', 'fff3', '1a45dfa3', '4f67670', '52494646', 'fff1'],
};

export const mediaPolicy = (type: MediaType): MediaPolicy => {
  switch (type) {
    case 'IMAGE':
      return IMAGES;
    case 'VIDEO':
      return VIDEOS;
    case 'AUDIO':
      return AUDIO;
    default:
      throw new BadRequestException('Unsupported media type');
  }
};

export const extensionFor = (mimeType: string): string => {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/webm': 'weba',
    'audio/3gpp': '3gp',
    'audio/amr': 'amr',
    'audio/wav': 'wav',
  };
  return map[mimeType.toLowerCase()] ?? 'bin';
};

export interface BinaryHeaderCheck {
  ok: boolean;
  reason?: string;
}

/** Cheap content sniffing on the first bytes of the upload. */
export function sniffBinaryHeader(buffer: Buffer, policy: MediaPolicy): BinaryHeaderCheck {
  if (buffer.length < 8) return { ok: false, reason: 'File is empty or truncated' };

  const hex = buffer.subarray(0, 16).toString('hex');

  // Simple text-ish / script payloads are rejected outright.
  const asText = buffer.subarray(0, 32).toString('utf8');
  if (/^\s*<(!doctype html|html|script)/i.test(asText)) {
    return { ok: false, reason: 'Executable or markup payloads are not allowed' };
  }

  const matched = policy.allowedPrefixes.some((prefix) => hex.startsWith(prefix));
  return matched ? { ok: true } : { ok: false, reason: 'File content does not match the declared media type' };
}
